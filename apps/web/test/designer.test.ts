import assert from 'node:assert/strict';
import test from 'node:test';
import {newSpec} from '@brim/core/model.ts';
import {chips, withEdits} from '../src/designer/fields.ts';

void test('chips follow the kind', () => {
  const gear = chips(newSpec('gear')).map((c) => c.field);
  assert.deepEqual(gear, ['width', 'height', 'hole', 'teeth']);
  assert.ok(chips(newSpec('box')).some((c) => c.field === 'depth'));
  assert.ok(!chips(newSpec('sphere')).some((c) => c.field === 'height'));
});

void test('chip edits apply only to the kind they were made for', () => {
  const vase = newSpec('vase');
  assert.equal(withEdits(vase, {kind: 'vase', values: {height: 80}}).height, 80);
  assert.equal(withEdits(vase, {kind: 'box', values: {height: 80}}).height, vase.height);
  // Edits still go through normalize: a wall thicker than the part is clamped.
  assert.ok(withEdits(vase, {kind: 'vase', values: {wall: 500}}).wall < vase.width / 2);
});
