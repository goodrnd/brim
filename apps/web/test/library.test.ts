import assert from 'node:assert/strict';
import test from 'node:test';
import {isLoose, removeProject, type Note, type Project} from '../src/library.ts';

const projects: Array<Project> = [
  {id: 'a', name: 'Desk', edited: 1},
  {id: 'b', name: 'Plants', edited: 1},
];
const note = (id: string, projectId: string): Note => ({id, projectId, body: '', edited: 1});

void test('parts without a project, or with a deleted one, are loose', () => {
  assert.equal(isLoose({}, projects), true);
  assert.equal(isLoose({projectId: 'a'}, projects), false);
  assert.equal(isLoose({projectId: 'gone'}, projects), true);
});

void test('removing a project frees its parts and drops only its notes', () => {
  const parts = [{id: '1', projectId: 'a'}, {id: '2', projectId: 'b'}, {id: '3'}];
  const r = removeProject('a', {projects, parts, notes: [note('n1', 'a'), note('n2', 'b')]});
  assert.deepEqual(
    r.projects.map((p) => p.id),
    ['b'],
  );
  assert.deepEqual(r.parts, [{id: '1', projectId: undefined}, {id: '2', projectId: 'b'}, {id: '3'}]);
  assert.deepEqual(
    r.notes.map((n) => n.id),
    ['n2'],
  );
  assert.equal(JSON.stringify(r.parts[0]), '{"id":"1"}', 'stored without projectId');
});
