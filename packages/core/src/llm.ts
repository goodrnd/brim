// Node-only: resolves the configured LLM and answers intent requests. Imported by vite.config.ts, never by the browser.
import type {Models} from '@earendil-works/pi-ai';
import {builtinModels} from '@earendil-works/pi-ai/providers/all';
import {buildContext, type Current, type Intent, readIntent} from './intent.ts';

/** BRIM_MODEL is "provider/model-id"; any pi-ai provider works, with its usual API key env var. */
export const modelRef = () => process.env.BRIM_MODEL || 'opencode-go/deepseek-v4.1-flash';

export async function createIntent(models: Models = builtinModels()) {
  const [provider, ...id] = modelRef().split('/');
  const model = models.getModel(provider, id.join('/'));
  if (!model || !(await models.checkAuth(provider))) {
    return undefined;
  } // no key: the client uses the regex parser
  return async (prompt: string, current?: Current): Promise<Intent> =>
    readIntent(
      await models.completeSimple(model, buildContext(prompt, current), {
        reasoning: 'minimal',
        sessionId: crypto.randomUUID(),
      }),
    );
}
