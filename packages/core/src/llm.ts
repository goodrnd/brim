// Node-only: resolves the configured LLM and answers intent requests. Imported by vite.config.ts, never by the browser.
import type {Models} from '@earendil-works/pi-ai';
import {builtinModels} from '@earendil-works/pi-ai/providers/all';
import {buildContext, type Current, feedbackContext, type Intent, readFeedback, readIntent} from './intent.ts';
import type {Size, Spec} from './model.ts';

/** BRIM_MODEL is "provider/model-id"; any pi-ai provider works, with its usual API key env var. */
export const modelRef = () => process.env.BRIM_MODEL || 'opencode-go/deepseek-v4.1-flash';
const opts = () => ({reasoning: 'minimal' as const, sessionId: crypto.randomUUID()});

export async function createIntent(models: Models = builtinModels()) {
  const [provider, ...id] = modelRef().split('/');
  const model = models.getModel(provider, id.join('/'));
  if (!model || !(await models.checkAuth(provider))) {
    return undefined;
  } // no key: the client uses the regex parser
  return {
    intent: async (prompt: string, current?: Current, size?: Size): Promise<Intent> =>
      readIntent(await models.completeSimple(model, buildContext(prompt, current), opts()), size),
    feedback: async (prompt: string, spec: Spec): Promise<string> =>
      readFeedback(await models.completeSimple(model, feedbackContext(prompt, spec), opts())),
  };
}
