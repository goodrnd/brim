import assert from 'node:assert/strict';
import test from 'node:test';
import {changes} from '../src/lib/server.ts';

const use = (projectId: string, itemId: string, qty = 1) => ({projectId, itemId, qty});

void test('changes: only the items that differ from what the server has', () => {
  const [a, b, c] = [
    {id: 'a', body: 'one'},
    {id: 'b', body: 'two'},
    {id: 'c', body: 'three'},
  ];
  const edited = {...b, body: 'TWO'};
  const added = {id: 'd', body: 'four'};
  assert.deepEqual(changes('notes', [a, b, c], [a, edited, added]), {put: [edited, added], remove: ['c']});
  assert.deepEqual(changes('notes', [a, b], [b, a]), {put: [], remove: []}, 'reordering is not a change');

  const [u1, u2] = [use('p', 'x'), use('p', 'y')];
  const more = use('p', 'x', 2);
  assert.deepEqual(changes('uses', [u1, u2], [more]), {put: [more], remove: [{projectId: 'p', itemId: 'y'}]});

  const [mk4, x2d] = [{name: 'MK4'}, {name: 'X2D'}];
  const renamed = {name: 'MK4S'};
  assert.deepEqual(changes('printers', {mk4, x2d}, {mk4: renamed}), {put: {mk4: renamed}, remove: ['x2d']});
  // Never saved: the server has nothing, so the presets go up with the first edit.
  assert.deepEqual(changes('materials', undefined, {pla: mk4}), {put: {pla: mk4}, remove: []});
  assert.deepEqual(changes('slice', {layer: 0.2}, {layer: 0.1}), {put: {layer: 0.1}, remove: []});
});
