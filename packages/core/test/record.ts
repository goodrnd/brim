// Runs the README prompts and paraphrases against the real LLM and saves the replies for intent.test.ts.
// Usage: npm run record   (needs the provider key, e.g. OPENCODE_API_KEY in ../../.env; BRIM_MODEL picks the model)
/* oxlint-disable no-console -- CLI script: printing results is its job */
import {writeFileSync} from 'node:fs';
import {builtinModels} from '@earendil-works/pi-ai/providers/all';
import {buildContext, type Current, readIntent} from '../src/intent.ts';
import {modelRef} from '../src/llm.ts';
import {parsePrompt} from '../src/model.ts';
import {paraphrases} from './paraphrases.ts';
import {cases, sameSpec} from './cases.ts';

process.loadEnvFile?.('../../.env');
const models = builtinModels();
const [provider, ...id] = modelRef().split('/');
const model = models.getModel(provider, id.join('/'));
if (!model || !(await models.checkAuth(provider))) {
  throw new Error(`no model or key for ${modelRef()}`);
}

const run = async (prompt: string, current?: Current) => {
  const reply = await models.completeSimple(model, buildContext(prompt, current), {
    reasoning: 'minimal',
    sessionId: crypto.randomUUID(),
  });
  // Keep only what replay needs; drop usage and ids so diffs stay readable.
  return {
    prompt,
    current,
    content: reply.content.filter((b) => b.type === 'toolCall'),
    stopReason: reply.stopReason,
    errorMessage: reply.errorMessage,
  };
};

const out = {model: modelRef(), cases: [] as Array<unknown>, paraphrases: [] as Array<unknown>};
for (const c of cases) {
  out.cases.push(await run(c.prompt, c.current));
}
let pass = 0,
  total = 0;
for (const [canonical, list] of Object.entries(paraphrases)) {
  const want = parsePrompt(canonical).spec;
  const replies = await Promise.all(list.map((p) => run(p)));
  for (const r of replies) {
    total++;
    try {
      const got = readIntent(r);
      if (got.type === 'spec' && sameSpec(got.spec, want)) {
        pass++;
      } else {
        console.log('MISMATCH', r.prompt, JSON.stringify(got));
      }
    } catch (error) {
      console.log('INVALID', r.prompt, (error as Error).message);
    }
    out.paraphrases.push({canonical, ...r});
  }
}
writeFileSync(new URL('./fixtures/llm-replies.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
console.log(`${modelRef()}: ${pass}/${total} paraphrases resolve to the README spec (M1 exit: ≥ 18/20)`);
