/**
 * The web app's printer endpoints, as Node HTTP middleware. The daemon's api.ts mounts it at /api/printers and
 * refuses cross-origin requests before they get here.
 *
 *   GET  /discover        Bambu printers announcing on the LAN
 *   POST /<serial>        {host, model, token}: connect; 401 when the printer does not answer with that code
 *   GET  /<serial>        live {progress, filaments}; 404 until connected
 *   GET  /<serial>/camera?since=<seq>   the next camera Frame (long-polls up to 5 s); 404 until connected
 *
 * Access codes live only in this process's memory (one MCP child per printer) and are never sent back.
 */
import type {IncomingMessage, ServerResponse} from 'node:http';
import {isIPv4} from 'node:net';
import {bambuModels} from '@brim/core/slicer.ts';
import {type Confirm, connect, discover, type Env, type Printer} from './bambu.ts';

type Discover = typeof discover;
/** What these endpoints use of a connected printer. */
type Live = Pick<Printer, 'progress' | 'filaments' | 'camera' | 'close'>;
type Connect = (env: Env, confirm: Confirm) => Promise<Live>;

const serialRe = /^[A-Z0-9]{6,32}$/;
// Discovery only reports private addresses; anything else would send the access code off the LAN.
const privateIPv4 = (ip: string) => isIPv4(ip) && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

async function body(req: IncomingMessage) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 4096) {
      throw new Error('body too large');
    }
  }
  return JSON.parse(text) as unknown;
}

export function printersApi({find = discover, open = connect}: {find?: Discover; open?: Connect} = {}) {
  const connected = new Map<string, Live>();

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const send = (status: number, value: unknown) => {
      res.statusCode = status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(value));
    };
    const url = new URL(req.url ?? '', 'http://x');
    const path = url.pathname.replace(/^\/+/, '');
    if (req.method === 'GET' && path === 'discover') {
      return send(200, await find());
    }
    const [, cameraOf] = /^([A-Z0-9]{6,32})\/camera$/.exec(path) ?? [];
    if (req.method === 'GET' && cameraOf) {
      const printer = connected.get(cameraOf);
      if (!printer) {
        return send(404, {error: 'not connected'});
      }
      const since = Number(url.searchParams.get('since'));
      try {
        return send(200, await printer.camera(Number.isSafeInteger(since) && since > 0 ? since : 0));
      } catch (error) {
        return send(502, {error: (error as Error).message});
      }
    }
    if (!serialRe.test(path)) {
      return send(404, {error: 'not found'});
    }
    const serial = path;
    if (req.method === 'GET') {
      const printer = connected.get(serial);
      if (!printer) {
        return send(404, {error: 'not connected'});
      }
      try {
        const [progress, filaments] = await Promise.all([printer.progress(), printer.filaments()]);
        return send(200, {progress, filaments});
      } catch {
        // The MCP child died; drop it so the UI says "not connected" instead of failing forever.
        connected.delete(serial);
        await printer.close().catch(() => {});
        return send(404, {error: 'not connected'});
      }
    }
    if (req.method !== 'POST') {
      return send(405, {error: 'method not allowed'});
    }
    // JSON only, so a plain HTML form cannot post here.
    if (!req.headers['content-type']?.startsWith('application/json')) {
      return send(415, {error: 'Send JSON {host, model, token}.'});
    }
    let input: {host?: unknown; model?: unknown; token?: unknown};
    try {
      input = (await body(req)) as typeof input;
    } catch {
      return send(400, {error: 'Send JSON {host, model, token}.'});
    }
    const {host, model, token} = input ?? {};
    if (typeof host !== 'string' || !privateIPv4(host)) {
      return send(400, {error: 'host must be a private IPv4 address.'});
    }
    if (typeof model !== 'string' || !(model in bambuModels)) {
      return send(400, {error: 'model must be a bambu_model value.'});
    }
    if (typeof token !== 'string' || !/^[A-Za-z0-9]{4,32}$/.test(token)) {
      return send(400, {error: 'The access code is the letters and digits on the printer’s screen.'});
    }
    // The MCP asks a person before physical steps; status never needs one, so decline.
    const printer = await open(
      {PRINTER_HOST: host, BAMBU_SERIAL: serial, BAMBU_TOKEN: token, BAMBU_MODEL: model},
      async () => false,
    );
    let progress;
    try {
      progress = await printer.progress();
    } catch (error) {
      await printer.close();
      return send(502, {error: (error as Error).message});
    }
    // A wrong code and an unreachable printer look the same: MQTT refuses or never answers.
    if (progress.state === 'offline') {
      await printer.close();
      return send(401, {error: 'The printer did not answer. Check the access code and that it is on.'});
    }
    const old = connected.get(serial);
    connected.set(serial, printer);
    await old?.close().catch(() => {});
    return send(200, {progress});
  }

  return {
    middleware(req: IncomingMessage, res: ServerResponse) {
      handle(req, res).catch((error: Error) => {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({error: error.message}));
      });
    },
    async close() {
      await Promise.all([...connected.values()].map((p) => p.close()));
      connected.clear();
    },
  };
}
