// Replays saved LLM replies (test/fixtures, refresh with `npm run record`) through a mocked provider.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type ToolCall,
} from '@earendil-works/pi-ai';
import {buildContext, readIntent, type Current, type Intent} from '../src/intent.ts';
import {applyOps, parsePrompt} from '../src/model.ts';
import {cases, sameSpec} from './cases.ts';
import {paraphrases} from './paraphrases.ts';

type Saved = {
  prompt: string;
  current?: Current;
  canonical?: string;
  content: Array<{name: string; arguments: ToolCall['arguments']}>;
  stopReason: string;
};
const saved: {cases: Array<Saved>; paraphrases: Array<Saved>} = JSON.parse(
  readFileSync(new URL('./fixtures/llm-replies.json', import.meta.url), 'utf8'),
);

const faux = fauxProvider();
const models = createModels();
models.setProvider(faux.provider);
/** Sends the request through pi-ai with the saved reply queued, as the dev server would. */
async function replay(r: Saved): Promise<Intent> {
  faux.setResponses([
    fauxAssistantMessage(
      r.content.map((c) => fauxToolCall(c.name, c.arguments)),
      {stopReason: 'toolUse'},
    ),
  ]);
  return readIntent(await models.completeSimple(faux.getModel(), buildContext(r.prompt, r.current)));
}

void test('README prompts resolve to valid specs and ops', async () => {
  assert.deepEqual(
    saved.cases.map((c) => c.prompt),
    cases.map((c) => c.prompt),
    'fixtures are stale: npm run record',
  );
  for (const r of saved.cases) {
    const intent = await replay(r);
    if (!r.current) {
      assert.equal(intent.type, 'spec', r.prompt);
      assert.ok(
        intent.type === 'spec' && sameSpec(intent.spec, parsePrompt(r.prompt).spec),
        `${r.prompt} matches the regex parser`,
      );
    } else {
      assert.equal(intent.type, 'ops', r.prompt);
      const {changes} = await applyOps(
        r.current.type === 'param' ? r.current : {...r.current, positions: new Float32Array(9)},
        intent.type === 'ops' ? intent.ops : [],
      );
      assert.ok(changes.length && !changes.some((c) => c.startsWith('skipped')), `${r.prompt}: ${changes}`);
    }
  }
});

void test('M1 exit: 20+ paraphrases resolve to the README spec', async () => {
  const total = Object.values(paraphrases).flat().length;
  assert.ok(total >= 20);
  assert.equal(saved.paraphrases.length, total, 'fixtures are stale: npm run record');
  let pass = 0;
  for (const r of saved.paraphrases) {
    const intent = await replay(r);
    if (intent.type === 'spec' && sameSpec(intent.spec, parsePrompt(r.canonical!).spec)) {
      pass++;
    }
  }
  assert.equal(pass, total);
});

void test('bad tool calls are rejected, not applied', async () => {
  const bad = (name: string, args: ToolCall['arguments']) =>
    replay({prompt: 'x', content: [{name, arguments: args}], stopReason: 'toolUse'});
  await assert.rejects(bad('new_shape', {kind: 'teapot'}));
  await assert.rejects(bad('new_shape', {kind: 'box', width: -5}));
  await assert.rejects(bad('edit', {ops: [{op: 'set', field: 'positions', value: 1}]}));
  await assert.rejects(bad('edit', {ops: [{op: 'set', field: 'height'}]}));
  await assert.rejects(bad('edit', {ops: [{op: 'scale', x: 0}]}));
  await assert.rejects(replay({prompt: 'x', content: [], stopReason: 'stop'}));
});

void test('mesh ops: rotate 180 about X flips, scale scales', async () => {
  const m = {type: 'mesh' as const, name: 't', positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 0, 10])};
  const {model} = await applyOps(m, [
    {op: 'rotate', axis: 'x', degrees: 180},
    {op: 'scale', x: 2, y: 2, z: 2},
  ]);
  assert.ok(model.type === 'mesh');
  const z = [...model.positions].filter((_, i) => i % 3 === 2);
  assert.deepEqual(
    z.map(Math.round).sort((a, b) => a - b),
    [0, 20, 20],
  ); // the top vertex is now at the bottom, rested on z=0
});

void test('feedback: the plan goes out with the reviewer prompt, text comes back', async () => {
  const {feedbackContext, feedbackPrompt, readFeedback} = await import('../src/intent.ts');
  const {newSpec} = await import('../src/model.ts');
  const ctx = feedbackContext('vase 120 tall', newSpec('vase', {height: 120}));
  assert.equal(ctx.systemPrompt, feedbackPrompt);
  assert.equal(ctx.tools, undefined);
  assert.match(String(ctx.messages[0].content), /Request: vase 120 tall\nPlan: \{"kind":"vase".*"height":120/);
  faux.setResponses([fauxAssistantMessage([fauxText('  - Walls are fine.  ')])]);
  assert.equal(readFeedback(await models.completeSimple(faux.getModel(), ctx)), '- Walls are fine.');
  assert.throws(() => readFeedback({stopReason: 'stop', content: []}), /no feedback/);
  assert.throws(() => readFeedback({stopReason: 'error', errorMessage: 'boom', content: []}), /boom/);
});
