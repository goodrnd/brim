import assert from 'node:assert/strict';
import test from 'node:test';
import {
  itemsIn,
  projectsOf,
  removePart,
  removeProject,
  withProjects,
  type Note,
  type Project,
  type Use,
} from '../src/lib/library.ts';

const projects: Array<Project> = [
  {id: 'a', name: 'Desk', edited: 1},
  {id: 'b', name: 'Plants', edited: 1},
];
const note = (id: string, projectId: string): Note => ({id, projectId, body: '', edited: 1});
const use = (projectId: string, itemId: string, qty = 1): Use => ({projectId, itemId, qty});

void test('one part can be used in several projects', () => {
  const uses = withProjects('1', ['a', 'b'], []);
  assert.deepEqual(projectsOf('1', uses), ['a', 'b']);
  assert.deepEqual([...itemsIn('b', uses)], ['1']);
});

void test('withProjects adds and removes uses and keeps qty of the ones that stay', () => {
  const uses = [use('a', '1', 3), use('b', '1'), use('a', '2')];
  assert.deepEqual(withProjects('1', ['a'], uses), [use('a', '1', 3), use('a', '2')]);
  assert.deepEqual(withProjects('2', [], uses), [use('a', '1', 3), use('b', '1')]);
});

void test('removing a project drops its uses and notes, not other projects', () => {
  const uses = [use('a', '1'), use('b', '1'), use('a', '2')];
  const r = removeProject('a', {projects, uses, notes: [note('n1', 'a'), note('n2', 'b')]});
  assert.deepEqual(
    r.projects.map((p) => p.id),
    ['b'],
  );
  assert.deepEqual(r.uses, [use('b', '1')]);
  assert.deepEqual(
    r.notes.map((n) => n.id),
    ['n2'],
  );
});

void test('removing a part drops its uses in every project', () => {
  const parts = [
    {id: '1', history: []},
    {id: '2', history: []},
  ];
  const r = removePart('1', {parts, uses: [use('a', '1'), use('b', '1'), use('a', '2')]});
  assert.deepEqual(
    r.parts.map((p) => p.id),
    ['2'],
  );
  assert.deepEqual(r.uses, [use('a', '2')]);
});
