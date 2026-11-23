/**
 * The whole printer path on one machine: the simulator announces itself over SSDP, the web app's dev server
 * discovers it through bambu-printer-mcp, connects with its access code, and reads live status and AMS spools.
 * Needs the real Bambu ports free (8883, 990, 6000, UDP 2021: stop `npm run simulator` and Bambu Studio) and a
 * private LAN address, as the MCP ignores announcements from loopback.
 */
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {createServer} from 'vite';
import {defaults, start} from '@brim/simulator/server.ts';
import {lanAddresses} from '@brim/simulator/ssdp.ts';

void test(
  'discover the simulated X2D and read its status through the web server',
  {skip: !lanAddresses().length && 'needs a private LAN address'},
  async (t) => {
    const sim = await start({...defaults, dir: mkdtempSync(join(tmpdir(), 'brim-e2e-'))});
    t.after(() => sim.stop());

    const vite = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)),
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      server: {port: 0, host: '127.0.0.1'},
      logLevel: 'silent',
    });
    await vite.listen();
    t.after(() => vite.close());
    const api = `http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}/api/printers`;

    const found = await (await fetch(`${api}/discover`)).json();
    assert.equal(found.network, 'complete', 'UDP 2021 is held by another app (Bambu Studio?)');
    // Ours, not another simulator on the same network (e.g. a parallel run on a shared Dagger engine).
    const x2d = found.printers.find(
      (p: {serial: string; host: string}) =>
        p.serial === defaults.serial && lanAddresses().some((a) => a.address === p.host),
    );
    assert.ok(x2d, `simulator not discovered: ${JSON.stringify(found)}`);
    assert.equal(x2d.model, 'x2d');

    const post = (token: string) =>
      fetch(`${api}/${x2d.serial}`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({host: x2d.host, model: x2d.model, token}),
      });
    assert.equal((await post('00000000')).status, 401);
    const connected = await post(defaults.token);
    assert.equal(connected.status, 200, await connected.clone().text());
    assert.ok(!(await connected.text()).includes(defaults.token));

    const live = await fetch(`${api}/${x2d.serial}`);
    const text = await live.text();
    assert.equal(live.status, 200);
    assert.ok(!text.includes(defaults.token));
    const {progress, filaments} = JSON.parse(text);
    assert.equal(progress.state, 'idle');
    // AMS 2 Pro: four loaded slots.
    assert.equal(filaments.summary.loaded_slots, 4);
  },
);
