import assert from 'node:assert/strict';
import test from 'node:test';
import {migrate} from '../src/lib/migrate.ts';

const store = (init: Record<string, string>) => {
  const m = new Map(Object.entries(init));
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};

void test('moves brim-models to brim-parts and renames job fields', () => {
  const s = store({
    'brim-models': '[{"id":"a"}]',
    'brim-jobs': JSON.stringify([{id: 'j', projectId: 'a', model: 'Box', done: false}]),
  });
  migrate(s);
  assert.equal(s.m.get('brim-parts'), '[{"id":"a"}]');
  assert.equal(s.m.has('brim-models'), false);
  assert.deepEqual(JSON.parse(s.m.get('brim-jobs')!), [{id: 'j', partId: 'a', part: 'Box'}]);
  const after = new Map(s.m);
  migrate(s);
  assert.deepEqual(s.m, after, 'second run is a no-op');
});

void test('moves Part.projectId into brim-uses', () => {
  const s = store({'brim-parts': JSON.stringify([{id: '1', projectId: 'a'}, {id: '2'}])});
  migrate(s);
  assert.deepEqual(JSON.parse(s.m.get('brim-parts')!), [{id: '1'}, {id: '2'}]);
  assert.deepEqual(JSON.parse(s.m.get('brim-uses')!), [{projectId: 'a', itemId: '1', qty: 1}]);
  const after = new Map(s.m);
  migrate(s);
  assert.deepEqual(s.m, after, 'second run is a no-op');
});

void test('never overwrites existing parts and survives broken jobs', () => {
  const s = store({'brim-models': '[{"id":"old"}]', 'brim-parts': '[{"id":"new"}]', 'brim-jobs': '{oops'});
  migrate(s);
  assert.equal(s.m.get('brim-parts'), '[{"id":"new"}]');
  assert.equal(s.m.get('brim-jobs'), '{oops');
});

void test('turns Job.done into outcome', () => {
  const s = store({
    'brim-jobs': JSON.stringify([
      {id: 'a', done: true},
      {id: 'b', done: false},
      {id: 'c', outcome: 'failed'},
    ]),
  });
  migrate(s);
  assert.deepEqual(JSON.parse(s.m.get('brim-jobs')!), [
    {id: 'a', outcome: 'ok'},
    {id: 'b'},
    {id: 'c', outcome: 'failed'},
  ]);
  const after = new Map(s.m);
  migrate(s);
  assert.deepEqual(s.m, after, 'second run is a no-op');
});
