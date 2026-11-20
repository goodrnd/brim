import {defineConfig, loadEnv, type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {createIntent} from './src/llm.ts';

/** POST /api/intent {prompt, current} → Intent. 404 when no LLM key is set, so the client falls back to the regex parser. */
const intentApi = (): Plugin => {
  const setup: Plugin['configureServer'] = async (server) => {
    const intent = await createIntent();
    console.log(intent ? `brim: LLM intent on ${process.env.BRIM_MODEL || 'default model'}` : 'brim: no LLM key, using the regex parser');
    server.middlewares.use('/api/intent', async (req, res) => {
      if (!intent || req.method !== 'POST') return ((res.statusCode = 404), res.end());
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const {prompt, current} = JSON.parse(body);
        if (typeof prompt !== 'string' || prompt.length > 2000) throw new Error('bad prompt');
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(await intent(prompt, current)));
      } catch (e) {
        res.statusCode = 422;
        res.end((e as Error).message);
      }
    });
  };
  return {name: 'brim-intent', configureServer: setup, configurePreviewServer: setup as Plugin['configurePreviewServer']};
};

export default defineConfig(({mode}) => {
  // .env lives at the repo root; load every var (not just VITE_*) into process.env for the server only.
  Object.assign(process.env, {...loadEnv(mode, '../..', ''), ...process.env});
  return {plugins: [react(), intentApi()]};
});
