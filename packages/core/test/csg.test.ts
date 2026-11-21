import assert from 'node:assert/strict';
import test from 'node:test';
import {toManifold} from '../src/csg.ts';
import {applyOps, bounds, buildPositions, editMesh, newSpec, volume, type Model} from '../src/model.ts';

/** Closed means manifold-3d accepts it as a solid with no open edges. */
const closed = (p: Float32Array) => {
  const m = toManifold(p);
  const ok = m.status() === 'NoError' && m.genus() >= 0;
  m.delete();
  return ok;
};

void test('cube joined with a cylinder is closed with the expected volume', async () => {
  const cube: Model = {type: 'param', spec: newSpec('box', {width: 20, depth: 20, height: 20, wall: 0, corner: 0})};
  const {model, changes} = await applyOps(cube, [
    {op: 'add', part: newSpec('cylinder', {width: 10, height: 30, segments: 192}), at: [0, 0, 0]},
  ]);
  assert.ok(model.type === 'mesh' && !changes.some((c) => c.startsWith('skipped')), String(changes));
  const expected = 20 ** 3 + Math.PI * 5 ** 2 * 10; // cylinder sticks 10 mm out of the top
  assert.ok(
    Math.abs(volume(model.positions) / expected - 1) < 0.01,
    `volume ${volume(model.positions)} vs ${expected}`,
  );
  assert.ok(closed(model.positions));
  assert.equal(Math.round(bounds(model.positions)[1][2]), 30);
});

// shortcut: a cup stands in for Benchy until GOO-53 clears its license; swap in the Benchy fixture then.
void test('a hole cut through an imported mesh leaves it closed', async () => {
  const mesh = buildPositions(newSpec('cup'));
  const {model, changes} = await editMesh('drill a 6mm hole', {type: 'mesh', name: 'cup', positions: mesh});
  assert.ok(model.type === 'mesh');
  const {positions} = model;
  assert.ok(
    changes.some((c) => c.startsWith('subtract')),
    String(changes),
  );
  assert.ok(closed(positions));
  assert.ok(volume(positions) < volume(mesh));
});

void test('subtracting everything is skipped, not applied', async () => {
  const m: Model = {type: 'param', spec: newSpec('cylinder')};
  const {model, changes} = await applyOps(m, [
    {op: 'subtract', part: newSpec('box', {width: 100, depth: 100, height: 100, wall: 0}), at: [0, 0, -10]},
  ]);
  assert.equal(model, m);
  assert.match(changes[0], /^skipped .*left nothing/);
});
