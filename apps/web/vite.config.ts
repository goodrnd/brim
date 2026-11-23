import type {IncomingMessage, ServerResponse} from 'node:http';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {createIntent} from '@brim/core/llm.ts';
import {sizes} from '@brim/core/model.ts';
import {printersApi} from '@brim/printer/api.ts';

/**
 * POST /api/intent {prompt, current, size} → Intent; POST /api/feedback {prompt, spec} → text review of the plan.
 * 404 when no LLM key is set, so the client falls back to the regex parser.
 */
const setup: Plugin['configureServer'] = async (server) => {
  const llm = await createIntent();
  // oxlint-disable-next-line no-console
  console.log(
    llm
      ? `brim: LLM intent on ${process.env.BRIM_MODEL || 'default model'}`
      : 'brim: no LLM key, using the regex parser',
  );
  const printers = printersApi();
  server.middlewares.use('/api/printers', printers.middleware);
  server.httpServer?.on('close', () => void printers.close());
  const post =
    (answer: (body: any, run: NonNullable<typeof llm>) => Promise<unknown>) =>
    async (req: IncomingMessage, res: ServerResponse) => {
      if (!llm || req.method !== 'POST') {
        return ((res.statusCode = 404), res.end());
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      try {
        const json = JSON.parse(body);
        if (typeof json.prompt !== 'string' || json.prompt.length > 2000) {
          throw new Error('bad prompt');
        }
        const out = await answer(json, llm);
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(out));
      } catch (error) {
        res.statusCode = 422;
        res.end((error as Error).message);
      }
    };
  server.middlewares.use(
    '/api/intent',
    post(({prompt, current, size}, run) => {
      if (size !== undefined && !Object.hasOwn(sizes, size)) {
        throw new Error('bad size');
      }
      return run.intent(prompt, current, size);
    }),
  );
  server.middlewares.use(
    '/api/feedback',
    post(({prompt, spec}, run) => {
      if (!spec || typeof spec !== 'object' || typeof spec.kind !== 'string') {
        throw new Error('bad spec');
      }
      return run.feedback(prompt, spec);
    }),
  );
};
const intentApi = (): Plugin => ({
  name: 'brim-intent',
  configureServer: setup,
  configurePreviewServer: setup as Plugin['configurePreviewServer'],
});

export default defineConfig(({mode}) => {
  // .env lives at the repo root; load every var (not just VITE_*) into process.env for the server only.
  Object.assign(process.env, {...loadEnv(mode, '../..', ''), ...process.env});
  // ES workers: the slicer worker pulls in model.ts, whose lazy csg import needs code splitting.
  return {plugins: [react(), intentApi()], worker: {format: 'es'}};
});
