import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import test from 'node:test';
import {printersApi} from '../src/api.ts';
import type {Env, Progress} from '../src/bambu.ts';

const serial = '20P00A000000001';
const token = '12345678';
const json = {'content-type': 'application/json'};

void test('printers api: discover, reject bad input and codes, connect, status without the code', async (t) => {
  const opened: Array<Partial<Env>> = [];
  let closed = 0;
  const api = printersApi({
    find: async () => ({network: 'complete', printers: [{host: '192.168.1.5', serial, name: 'X2D', model: 'x2d'}]}),
    open: async (env) => {
      opened.push(env);
      const state: Progress['state'] = env.BAMBU_TOKEN === token ? 'idle' : 'offline';
      return {
        progress: async (): Promise<Progress> => ({state, problems: []}),
        filaments: async () => ({trays: [{slot: 0, tray_type: 'PLA'}]}),
        close: async () => void closed++,
      };
    },
  });
  const server = createServer(api.middleware).listen(0);
  t.after(() => (server.close(), api.close()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown) =>
    fetch(`${base}/${serial}`, {method: 'POST', headers: json, body: JSON.stringify(body)}).then(
      async (r) => [r.status, await r.text()] as const,
    );

  const found = await (await fetch(`${base}/discover`)).json();
  assert.equal(found.printers[0].serial, serial);
  assert.equal((await fetch(`${base}/${serial}`)).status, 404);
  assert.equal((await fetch(`${base}/not-a-serial`)).status, 404);

  const simple = await fetch(`${base}/${serial}`, {
    method: 'POST',
    body: JSON.stringify({host: '192.168.1.5', model: 'x2d', token}),
  });
  assert.equal(simple.status, 415);
  const cross = await fetch(`${base}/discover`, {headers: {origin: 'http://localhost:9999'}});
  assert.equal(cross.status, 403);
  assert.equal((await post({host: 'printer.local', model: 'x2d', token}))[0], 400);
  assert.equal((await post({host: '8.8.8.8', model: 'x2d', token}))[0], 400);
  assert.equal((await post({host: '192.168.1.5', model: 'nope', token}))[0], 400);
  assert.equal((await post({host: '192.168.1.5', model: 'x2d', token: 'a b'}))[0], 400);
  assert.equal(opened.length, 0);

  assert.equal((await post({host: '192.168.1.5', model: 'x2d', token: '00000000'}))[0], 401);
  assert.equal(closed, 1);
  assert.equal((await fetch(`${base}/${serial}`)).status, 404);

  const [status, text] = await post({host: '192.168.1.5', model: 'x2d', token});
  assert.equal(status, 200);
  assert.ok(!text.includes(token));
  assert.deepEqual(opened.at(-1), {
    PRINTER_HOST: '192.168.1.5',
    BAMBU_SERIAL: serial,
    BAMBU_TOKEN: token,
    BAMBU_MODEL: 'x2d',
  });

  const live = await fetch(`${base}/${serial}`);
  const liveText = await live.text();
  assert.equal(live.status, 200);
  assert.equal(JSON.parse(liveText).progress.state, 'idle');
  assert.ok(!liveText.includes(token));
});
