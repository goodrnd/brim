import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {request} from 'node:http';
import {connect} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {setTimeout as wait} from 'node:timers/promises';
import {start} from '../src/main.ts';

/** A daemon on a free port, with a stand-in web app and its own data dir. */
async function serve(t: TestContext, env: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'brim-daemon-'));
  const dist = join(dir, 'dist');
  await mkdir(join(dist, 'assets'), {recursive: true});
  await writeFile(join(dist, 'index.html'), '<title>Brim</title>');
  await writeFile(join(dist, 'assets', 'app-1a2b.js'), 'export {}');
  await writeFile(join(dir, 'secret.txt'), 'outside dist');
  Object.assign(process.env, {BRIM_DATA: join(dir, 'data'), ...env});
  const daemon = await start({dist, port: 0});
  t.after(async () => (await daemon.stop(), await rm(dir, {recursive: true})));
  return daemon;
}

void test('daemon: serves the web app and the API, to its own pages only', async (t) => {
  // BRIM_MODEL none/none: no LLM.
  const daemon = await serve(t, {BRIM_MODEL: 'none/none', BRIM_HOSTS: 'brim.tail1234.ts.net'});

  // fetch cannot set Host, and normalises `..` out of paths.
  const get = (path: string, headers: Record<string, string> = {}) =>
    new Promise<{status: number; type?: string; body: string}>((done, fail) =>
      request({host: '127.0.0.1', port: daemon.port, path, headers}, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => done({status: res.statusCode!, type: res.headers['content-type'], body}));
      })
        .on('error', fail)
        .end(),
    );

  const page = await get('/');
  assert.equal(page.body, '<title>Brim</title>');
  assert.match(page.type!, /^text\/html/);
  assert.equal((await get('/assets/app-1a2b.js')).type, 'text/javascript');
  assert.equal((await get('/nope.js')).status, 404);
  assert.equal((await get('/../secret.txt')).status, 404);
  assert.equal((await get('/%2e%2e/secret.txt')).status, 404);

  const state = await get('/api/state');
  assert.match(state.type!, /^application\/json/, 'the web app takes anything else to mean "no daemon"');
  assert.deepEqual(JSON.parse(state.body).parts, []);
  assert.equal((await get('/api/intent')).status, 404, 'no LLM: the client uses its own parser');
  assert.equal((await get('/api/nope')).status, 404);
  assert.equal((await get('/api/printers/not-a-serial')).status, 404);

  // Behind a proxy that adds TLS, the page's origin is https and its host is the proxy's name.
  const host = 'brim.tail1234.ts.net';
  assert.equal((await get('/api/state', {host, origin: `https://${host}`})).status, 200);
  assert.equal((await get('/api/state', {origin: 'http://evil.test'})).status, 403);
  assert.equal((await get('/api/files', {'sec-fetch-site': 'cross-site'})).status, 403);
  // A page on another port of this machine is the same site, and an <img> there sends no Origin.
  assert.equal((await get('/api/printers/discover', {'sec-fetch-site': 'same-site'})).status, 403);
  assert.equal((await get('/api/state', {'sec-fetch-site': 'same-origin'})).status, 200);
  assert.equal((await get('/api/state', {'sec-fetch-site': 'none'})).status, 200, 'the address typed by a person');
  assert.equal((await get('/api/printers/discover', {origin: 'http://localhost:9999'})).status, 403);
  // DNS rebinding: another site's name pointed at this machine.
  assert.equal((await get('/api/state', {host: 'evil.test', origin: 'http://evil.test'})).status, 403);
});

void test('daemon: a bad or cut-off prompt request is refused and leaves the daemon running', async (t) => {
  // A key makes the LLM routes live; nothing here gets as far as calling the LLM.
  delete process.env.BRIM_MODEL;
  const daemon = await serve(t, {OPENCODE_API_KEY: 'test'});
  const base = `http://127.0.0.1:${daemon.port}/api`;
  const post = (body: string) =>
    fetch(`${base}/intent`, {method: 'POST', headers: {'content-type': 'application/json'}, body});

  assert.equal((await post('{}')).status, 422, 'bad prompt; a 404 here means the test has no LLM');
  assert.equal((await post(JSON.stringify({prompt: 'box', pad: 'x'.repeat(200_000)}))).status, 422);

  // The connection drops before the body it announced has arrived.
  await new Promise<void>((done) => {
    const socket = connect(daemon.port, '127.0.0.1', () => {
      socket.write(
        'POST /api/intent HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n' +
          'Content-Length: 5000\r\n\r\n{"prompt":"bo',
      );
      setTimeout(() => socket.destroy(), 100);
    });
    socket.on('close', () => done());
  });
  await wait(200);
  assert.equal((await fetch(`${base}/state`)).status, 200);
});
