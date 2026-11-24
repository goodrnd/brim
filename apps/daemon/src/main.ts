/**
 * The Brim daemon: the API (api.ts) and the built web app on one port, for the machine on the printers' network.
 *
 *   npm run build && npm run daemon     http://127.0.0.1:2746
 *
 * BRIM_PORT and BRIM_HOST change where it listens. It listens on this machine only by default: put a proxy that
 * adds TLS and access control in front (e.g. `tailscale serve`, which passes the browser's Host header through)
 * and name the proxy's host in BRIM_HOSTS.
 */
import {createReadStream, existsSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {extname, join, resolve, sep} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createApi} from './api.ts';

const root = resolve(import.meta.dirname, '../../..');

const types = new Map([
  ['.css', 'text/css'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
]);

/** Serves the files of the built web app in `dist`. */
const files = (dist: string) => async (req: IncomingMessage, res: ServerResponse) => {
  const end = (status: number) => ((res.statusCode = status), res.end());
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return end(405);
  }
  let path;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    return end(400);
  }
  const file = join(dist, path === '/' ? 'index.html' : path);
  // Inside dist only: `join` has already resolved any `..` in the path.
  const found = file.startsWith(dist + sep) ? await stat(file).catch(() => undefined) : undefined;
  if (!found?.isFile()) {
    return end(404);
  }
  res.setHeader('content-type', types.get(extname(file)) ?? 'application/octet-stream');
  res.setHeader('content-length', found.size);
  res.setHeader('x-content-type-options', 'nosniff');
  // Vite names everything in assets/ by its content.
  res.setHeader('cache-control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  return req.method === 'HEAD' ? res.end() : pipeline(createReadStream(file), res);
};

export async function start({dist = join(root, 'apps/web/dist'), host = '127.0.0.1', port = 2746} = {}) {
  if (!existsSync(join(dist, 'index.html'))) {
    throw new Error(`No web app in ${dist}. Run \`npm run build\` first.`);
  }
  const api = await createApi();
  const web = files(dist);
  const server = createServer((req, res) =>
    api.middleware(req, res, () => void web(req, res).catch(() => res.destroy())),
  );
  await new Promise<void>((done, fail) => server.once('error', fail).listen(port, host, done));
  return {
    port: (server.address() as AddressInfo).port,
    async stop() {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await api.close();
    },
  };
}

if (import.meta.main) {
  // The repo-root .env, as the dev server reads it. Variables already set win.
  if (existsSync(join(root, '.env'))) {
    process.loadEnvFile(join(root, '.env'));
  }
  const host = process.env.BRIM_HOST || undefined;
  const {port} = await start({host, port: Number(process.env.BRIM_PORT) || undefined});
  // oxlint-disable-next-line no-console
  console.log(`brim: http://${host ?? '127.0.0.1'}:${port}`);
}
