import {defineConfig, loadEnv, type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {createApi} from '@brim/daemon/api.ts';

/** Mounts the daemon's API (apps/daemon) on the dev and preview servers, so `npm run dev` needs no second process. */
const setup: Plugin['configureServer'] = async (server) => {
  const api = await createApi();
  server.middlewares.use(api.middleware);
  server.httpServer?.on('close', () => void api.close());
};
const daemonApi = (): Plugin => ({
  name: 'brim-daemon',
  configureServer: setup,
  configurePreviewServer: setup as Plugin['configurePreviewServer'],
});

export default defineConfig(({mode}) => {
  // .env lives at the repo root; load every var (not just VITE_*) into process.env for the server only.
  Object.assign(process.env, {...loadEnv(mode, '../..', ''), ...process.env});
  // ES workers: the slicer worker pulls in model.ts, whose lazy csg import needs code splitting.
  return {plugins: [react(), daemonApi()], worker: {format: 'es'}};
});
