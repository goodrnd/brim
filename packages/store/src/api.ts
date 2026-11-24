/**
 * The web app's storage endpoints, as one Node HTTP middleware (calls `next` for any other path):
 *
 *   GET    /api/state              every collection, see state.ts
 *   PUT    /api/state/<name>       replaces one collection (JSON body)
 *   PUT    /api/blobs              raw bytes → {sha256, size}; used for mesh triangles
 *   GET    /api/blobs/<sha256>     the bytes
 *   GET    /api/files              every File, newest first
 *   POST   /api/files?name=…       raw bytes in the body, MIME type in content-type → the new File
 *   GET    /api/files/<id>         the bytes, as a download
 *   DELETE /api/files/<id>         removes the File and its Uses; its bytes go when no other File has them
 */
import type {IncomingMessage, ServerResponse} from 'node:http';
import {pipeline} from 'node:stream/promises';
import {tooLarge, type Bucket} from './bucket.ts';
import type {Db, FileTable} from './db.ts';
import {collections, readState, writeCollection, type Collection, type Json} from './state.ts';

const idRe = /^[0-9a-f-]{36}$/;
const shaRe = /^[0-9a-f]{64}$/;
// shortcut: 200 MB cap per upload, held in one request; switch to resumable uploads if people store bigger scans.
const maxBytes = 200 * 1024 * 1024;
// Parts carry webp thumbnails, so a full library can be a few MB of JSON.
const maxJson = 50 * 1024 * 1024;

async function text(req: IncomingMessage) {
  const chunks: Array<Buffer> = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maxJson) {
      throw tooLarge('body too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

export function storeApi(db: Db, files: Bucket) {
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, value: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(value));
    };
    // Same-origin only, as in /api/printers: Vite's CORS allows any localhost origin.
    const origin = req.headers.origin;
    if ((origin && origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
      return send(403, {error: 'cross-origin request'});
    }
    const url = new URL(req.url ?? '', 'http://x');
    const [, area, id = ''] = url.pathname.split('/').slice(1);
    // Writes are JSON or raw bytes, never a form, so a plain HTML form cannot post here.
    const type = req.headers['content-type'] ?? '';
    if (req.method !== 'GET' && /^(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)/.test(type)) {
      return send(415, {error: 'unsupported content type'});
    }

    if (area === 'state') {
      if (req.method === 'GET' && !id) {
        return send(200, await readState(db));
      }
      if (!type.startsWith('application/json')) {
        return send(415, {error: 'send JSON'});
      }
      let body;
      const raw = await text(req);
      try {
        body = JSON.parse(raw) as Json;
      } catch {
        return send(400, {error: 'send JSON'});
      }
      try {
        if (req.method === 'PUT' && collections.includes(id as Collection)) {
          await writeCollection(db, id as Collection, body);
          return send(200, {});
        }
      } catch (error) {
        return send(400, {error: (error as Error).message});
      }
      return send(404, {error: 'not found'});
    }

    if (area === 'blobs') {
      if (req.method === 'PUT' && !id) {
        return send(200, await files.put(req, maxBytes));
      }
      if (req.method === 'GET' && shaRe.test(id) && (await files.has(id))) {
        res.setHeader('content-type', 'application/octet-stream');
        // Named by content, so it never changes.
        res.setHeader('cache-control', 'private, max-age=31536000, immutable');
        return pipeline(files.read(id), res);
      }
      return send(404, {error: 'not found'});
    }

    if (!id) {
      if (req.method === 'GET') {
        return send(200, await db.selectFrom('files').selectAll().orderBy('created', 'desc').execute());
      }
      if (req.method !== 'POST') {
        return send(405, {error: 'method not allowed'});
      }
      const name = url.searchParams.get('name')?.trim();
      if (!name || name.length > 255 || /[\\/\0]/.test(name)) {
        return send(400, {error: 'name must be a file name.'});
      }
      if (Number(req.headers['content-length']) > maxBytes) {
        return send(413, {error: 'file too large'});
      }
      const blob = await files.put(req, maxBytes);
      const file: FileTable = {
        id: crypto.randomUUID(),
        name,
        type: type.split(';')[0].trim() || 'application/octet-stream',
        created: Date.now(),
        ...blob,
      };
      await db.insertInto('files').values(file).execute();
      return send(201, file);
    }

    if (!idRe.test(id)) {
      return send(404, {error: 'not found'});
    }
    const file = await db.selectFrom('files').selectAll().where('id', '=', id).executeTakeFirst();
    if (!file) {
      return send(404, {error: 'not found'});
    }
    if (req.method === 'GET') {
      res.setHeader('content-type', file.type);
      res.setHeader('content-length', file.size);
      // Uploaded HTML or SVG must not run as this origin.
      res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
      res.setHeader('content-security-policy', 'sandbox');
      res.setHeader('x-content-type-options', 'nosniff');
      return pipeline(files.read(file.sha256), res);
    }
    if (req.method === 'DELETE') {
      await db.transaction().execute(async (trx) => {
        await trx.deleteFrom('files').where('id', '=', id).execute();
        await trx.deleteFrom('uses').where('itemId', '=', id).execute();
      });
      // Bytes stay while another File or a mesh Entry still names them.
      // shortcut: blobs dropped by undo or part deletion are never swept; add a GC pass if .brim grows.
      const shared = await db.selectFrom('files').select('id').where('sha256', '=', file.sha256).executeTakeFirst();
      if (!shared) {
        const inEntry = await db
          .selectFrom('entries')
          .select('partId')
          .where('model', 'like', `%${file.sha256}%`)
          .executeTakeFirst();
        if (!inEntry) {
          await files.remove(file.sha256);
        }
      }
      return send(200, {});
    }
    return send(405, {error: 'method not allowed'});
  }

  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!/^\/api\/(state|blobs|files)(\/|\?|$)/.test(req.url ?? '')) {
      return next();
    }
    handle(req, res).catch((error: Error) => {
      if (res.headersSent) {
        return res.destroy(error);
      }
      res.statusCode = (error as {code?: string}).code === 'TOO_LARGE' ? 413 : 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({error: error.message}));
    });
  };
}
