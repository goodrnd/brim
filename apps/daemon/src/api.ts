/**
 * Brim's HTTP API, as one Node middleware for everything under /api (calls `next` for any other path):
 *
 *   /api/printers/…                       @brim/printer/api.ts
 *   /api/state, /api/blobs, /api/files    @brim/store/api.ts
 *   POST /api/intent {prompt, current, size} → Intent
 *   POST /api/feedback {prompt, spec} → text review of the plan
 *
 * The two LLM routes answer 404 when no LLM key is set, so the client falls back to the regex parser.
 * main.ts serves this beside the built web app; apps/web/vite.config.ts mounts it on the Vite dev server.
 */
import {mkdir} from 'node:fs/promises';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {isIP} from 'node:net';
import {join, resolve} from 'node:path';
import type {Current, Intent} from '@brim/core/intent.ts';
import {createIntent} from '@brim/core/llm.ts';
import {sizes, type Size, type Spec} from '@brim/core/model.ts';
import {printersApi} from '@brim/printer/api.ts';
import {storeApi} from '@brim/store/api.ts';
import {bucket} from '@brim/store/bucket.ts';
import {openDb} from '@brim/store/db.ts';

// A prompt is 2000 characters at most, and a Spec is a few numbers.
const maxBody = 100_000;

/** Request body; `prompt` is checked in post, the rest by each endpoint. */
type Body = {prompt: string; current?: Current; size?: Size; spec?: Spec};

export async function createApi() {
  const llm = await createIntent();
  // oxlint-disable-next-line no-console
  console.log(
    llm
      ? `brim: LLM intent on ${process.env.BRIM_MODEL || 'default model'}`
      : 'brim: no LLM key, using the regex parser',
  );
  const printers = printersApi();
  // Data dir: the SQLite db and the local file bucket. BRIM_DATA overrides; relative to the repo root.
  const data = resolve(import.meta.dirname, '../../..', process.env.BRIM_DATA || '.brim');
  await mkdir(data, {recursive: true});
  const db = await openDb(join(data, 'brim.db'));
  const store = storeApi(db, bucket(join(data, 'files')));

  // Names a browser may reach Brim by, beyond this machine and IP addresses (e.g. its Tailscale name).
  const hosts = (process.env.BRIM_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  /** A page on another site can point its own DNS name at this machine, so a name must be one we know. */
  const known = (host: string) => {
    const name = (URL.parse(`http://${host}`)?.hostname ?? '').replaceAll(/^\[|\]$/g, '');
    return name === 'localhost' || name.endsWith('.localhost') || isIP(name) > 0 || hosts.includes(name.toLowerCase());
  };

  const post =
    (answer: (body: Body, run: NonNullable<typeof llm>) => Promise<Intent | string>) =>
    async (req: IncomingMessage, res: ServerResponse) => {
      if (!llm || req.method !== 'POST') {
        return ((res.statusCode = 404), res.end());
      }
      try {
        // Inside the try: reading throws when the connection drops mid-body, and nothing else would catch it.
        if (Number(req.headers['content-length']) > maxBody) {
          throw new Error('body too large');
        }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > maxBody) {
            throw new Error('body too large');
          }
        }
        const json: Body = JSON.parse(body);
        if (typeof json.prompt !== 'string' || json.prompt.length > 2000) {
          throw new Error('bad prompt');
        }
        const out = await answer(json, llm);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(out));
      } catch (error) {
        res.statusCode = 422;
        res.end((error as Error).message);
      }
    };
  const intent = post(({prompt, current, size}, run) => {
    if (size !== undefined && !Object.hasOwn(sizes, size)) {
      throw new Error('bad size');
    }
    return run.intent(prompt, current, size);
  });
  const feedback = post(({prompt, spec}, run) => {
    if (!spec || typeof spec !== 'object' || typeof spec.kind !== 'string') {
      throw new Error('bad spec');
    }
    return run.feedback(prompt, spec);
  });

  return {
    middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
      const path = (req.url ?? '').split('?')[0];
      if (path !== '/api' && !path.startsWith('/api/')) {
        return next();
      }
      const refuse = (status: number, error: string) => {
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({error}));
      };
      const host = req.headers.host ?? '';
      if (!known(host)) {
        return refuse(403, `Brim does not know the host ${host}. Add it to BRIM_HOSTS.`);
      }
      // Same-origin only: any page can send a GET or a JSON-looking POST here, and some routes spawn the MCP or
      // spend LLM tokens. The scheme is left out of the comparison, as a proxy in front may add TLS.
      // Browsers leave Origin off a plain GET (an <img>), so Sec-Fetch-Site is checked too: `same-site` is a page
      // on another port of this machine, `none` is an address a person typed. Other clients send neither header.
      const origin = req.headers.origin;
      const site = req.headers['sec-fetch-site'] ?? 'none';
      if ((origin && URL.parse(origin)?.host !== host) || (site !== 'same-origin' && site !== 'none')) {
        return refuse(403, 'cross-origin request');
      }
      if (path === '/api/printers' || path.startsWith('/api/printers/')) {
        // The printers API reads its paths from its own root.
        req.url = req.url!.slice('/api/printers'.length) || '/';
        return printers.middleware(req, res);
      }
      if (path === '/api/intent') {
        return void intent(req, res);
      }
      if (path === '/api/feedback') {
        return void feedback(req, res);
      }
      store(req, res, () => refuse(404, 'not found'));
    },
    async close() {
      await printers.close();
      await db.destroy();
    },
  };
}
