import assert from 'node:assert/strict';
import test from 'node:test';
import {parseMesh} from '../src/mesh.ts';

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

test('ASCII STL', () => {
  const stl =
    'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid';
  assert.deepEqual([...parseMesh('a.STL', enc(stl))], [0, 0, 0, 1, 0, 0, 0, 1, 0]);
});

test('OBJ quad becomes two triangles', () => {
  const obj = 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n';
  assert.equal(parseMesh('a.obj', enc(obj)).length, 18);
});

test('empty OBJ is rejected', () => {
  assert.throws(() => parseMesh('a.obj', enc('# nothing')), /No triangles/);
});
