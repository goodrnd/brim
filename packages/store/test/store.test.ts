import assert from 'node:assert/strict';
import {mkdtemp, readdir, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type TestContext} from 'node:test';
import {storeApi} from '../src/api.ts';
import {bucket} from '../src/bucket.ts';
import {openDb} from '../src/db.ts';

async function serve(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'brim-store-'));
  const db = await openDb(join(dir, 'brim.db'));
  const files = bucket(join(dir, 'files'));
  const api = storeApi(db, files);
  const server = createServer((req, res) => api(req, res, () => ((res.statusCode = 418), res.end()))).listen(0);
  t.after(async () => (server.close(), await db.destroy(), await rm(dir, {recursive: true})));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const put = (path: string, body: unknown) =>
    fetch(`${base}/${path}`, {
      method: 'PUT',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
    });
  return {dir, db, files, base, put};
}

void test('files: upload, dedupe, list, download, delete', async (t) => {
  const {dir, files, base} = await serve(t);
  const upload = (name: string, body: string) =>
    fetch(`${base}/files?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {'content-type': 'model/stl'},
      body,
    });

  const a = await (await upload('cube.stl', 'solid cube')).json();
  const b = await (await upload('copy.stl', 'solid cube')).json();
  assert.equal(a.sha256, b.sha256);
  assert.equal(a.size, 10);
  assert.equal((await readdir(join(dir, 'files', a.sha256.slice(0, 2)))).length, 1);
  assert.equal((await upload('../evil', 'x')).status, 400);
  assert.equal((await fetch(`${base}/files`, {headers: {origin: 'http://evil.test'}})).status, 403);
  const form = await fetch(`${base}/files?name=x`, {
    method: 'POST',
    headers: {'content-type': 'text/plain'},
    body: 'x',
  });
  assert.equal(form.status, 415);

  const list = await (await fetch(`${base}/files`)).json();
  assert.deepEqual(list.map((f: {name: string}) => f.name).sort(), ['copy.stl', 'cube.stl']);

  const got = await fetch(`${base}/files/${a.id}`);
  assert.equal(got.headers.get('content-type'), 'model/stl');
  assert.match(got.headers.get('content-disposition')!, /attachment/);
  assert.equal(await got.text(), 'solid cube');

  // Bytes stay while another File shares them, and go with the last one.
  await fetch(`${base}/files/${a.id}`, {method: 'DELETE'});
  assert.equal(await files.has(a.sha256), true);
  await fetch(`${base}/files/${b.id}`, {method: 'DELETE'});
  assert.equal(await files.has(a.sha256), false);
  assert.equal((await fetch(`${base}/files/${a.id}`)).status, 404);
  assert.equal((await fetch(`${base.replace('/api', '')}/other`)).status, 418, 'other paths fall through');
});

void test('state: collections round-trip in order, mesh entries by hash, bad input keeps the old value', async (t) => {
  const {base, put} = await serve(t);
  const blob = await (
    await fetch(`${base}/blobs`, {method: 'PUT', body: new Uint8Array(new Float32Array([1, 2, 3]).buffer)})
  ).json();
  const parts = [
    {
      id: 'p2',
      name: 'Box',
      edited: 2,
      history: [{prompt: 'box', changes: ['box'], model: {type: 'param', spec: {kind: 'box', width: 10}}}],
    },
    {id: 'p1', history: [{prompt: 'Imported a.stl', changes: [], model: {type: 'mesh', name: 'a', ...blob}}]},
  ];
  assert.equal((await put('state/parts', parts)).status, 200);
  assert.equal(
    (
      await put('state/jobs', [
        {
          id: 'j',
          partId: 'p1',
          part: 'a',
          printer: 'MK4',
          material: 'PLA',
          layer: 0.2,
          infill: 15,
          seconds: 60,
          grams: 1.5,
          at: 1,
        },
      ])
    ).status,
    200,
  );
  assert.equal((await put('state/printers', {mk4: {name: 'MK4', bed: [250, 210, 220]}})).status, 200);
  assert.equal((await put('state/slice', {printer: 'mk4', layer: 0.2})).status, 200);

  assert.equal((await put('state/parts', [{id: 'x'}])).status, 400);
  assert.equal((await put('state/nope', [])).status, 404);

  const state = await (await fetch(`${base}/state`)).json();
  assert.deepEqual(state.parts, parts, 'same order and shape; unset fields stay unset');
  assert.equal(state.jobs[0].grams, 1.5);
  assert.equal('outcome' in state.jobs[0], false);
  assert.deepEqual(state.printers, {mk4: {name: 'MK4', bed: [250, 210, 220]}});
  assert.equal(state.materials, undefined, 'never saved: the client uses its presets');
  assert.deepEqual(state.slice, {printer: 'mk4', layer: 0.2});

  const bytes = new Float32Array(await (await fetch(`${base}/blobs/${blob.sha256}`)).arrayBuffer());
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal((await fetch(`${base}/blobs/${'0'.repeat(64)}`)).status, 404);
});

void test('state: browser storage is imported once', async (t) => {
  const {base} = await serve(t);
  const post = (body: unknown) =>
    fetch(`${base}/state/import`, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
    }).then((r) => r.json());
  assert.equal((await (await fetch(`${base}/state`)).json()).imported, false);
  // One bad collection imports nothing, so the next try starts clean.
  assert.ok((await post({projects: [{id: 'x', name: 'Half', edited: 1}], notes: 'broken'})).error);
  const before = await (await fetch(`${base}/state`)).json();
  assert.deepEqual([before.projects, before.imported], [[], false]);
  assert.deepEqual(await post({projects: [{id: 'a', name: 'Desk', edited: 1}], notes: null}), {imported: true});
  assert.deepEqual(await post({projects: [{id: 'b', name: 'Other', edited: 1}]}), {imported: false});
  const state = await (await fetch(`${base}/state`)).json();
  assert.equal(state.imported, true);
  assert.deepEqual(state.projects, [{id: 'a', name: 'Desk', edited: 1}]);
});

void test('bucket: rejects uploads over the cap and leaves no temp file', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'brim-bucket-'));
  t.after(() => rm(dir, {recursive: true}));
  const files = bucket(dir);
  await assert.rejects(files.put([Buffer.from('12345')], 4), /too large/);
  assert.deepEqual(await readdir(dir), []);
  assert.throws(() => files.path('../../etc/passwd'), /bad sha256/);
});
