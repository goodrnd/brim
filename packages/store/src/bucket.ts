/**
 * The local bucket: file bytes on disk, named by their sha256, so the same upload is stored once.
 * Layout is `<dir>/<first 2 hex>/<sha256>`. Metadata (name, type) lives in the database, not here.
 */
import {createHash, randomUUID} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, rename, rm, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';

const shaRe = /^[0-9a-f]{64}$/;

export function bucket(dir: string) {
  const path = (sha256: string) => {
    if (!shaRe.test(sha256)) {
      throw new Error('bad sha256');
    }
    return join(dir, sha256.slice(0, 2), sha256);
  };

  return {
    path,
    /** Streams `source` in, hashing as it goes; stops with an error past `maxBytes`. Returns the sha256 and size. */
    async put(source: AsyncIterable<Uint8Array> | Iterable<Uint8Array>, maxBytes = Infinity) {
      await mkdir(dir, {recursive: true});
      const tmp = join(dir, `.tmp-${randomUUID()}`);
      const hash = createHash('sha256');
      let size = 0;
      const count = new Transform({
        transform(chunk: Buffer, _, done) {
          size += chunk.length;
          if (size > maxBytes) {
            return done(new Error('file too large'));
          }
          hash.update(chunk);
          done(null, chunk);
        },
      });
      try {
        await pipeline(source, count, createWriteStream(tmp));
        const sha256 = hash.digest('hex');
        await mkdir(join(dir, sha256.slice(0, 2)), {recursive: true});
        // Same bytes give the same name, so overwriting an existing blob is harmless.
        await rename(tmp, path(sha256));
        return {sha256, size};
      } finally {
        await rm(tmp, {force: true});
      }
    },
    async has(sha256: string) {
      return stat(path(sha256)).then(
        () => true,
        () => false,
      );
    },
    read: (sha256: string) => createReadStream(path(sha256)),
    remove: (sha256: string) => rm(path(sha256), {force: true}),
  };
}

export type Bucket = ReturnType<typeof bucket>;
