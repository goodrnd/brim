import '@earendil-works/elanor-fonts/mallos-serif.css';
import '@earendil-works/elanor-fonts/commit-mono.css';
import '@earendil-works/elanor-fonts/departure-mono.css';
import '@earendil-works/elanor-react/elanor.min.css';
import './app.css';

import {createRoot} from 'react-dom/client';
import {App} from './App.tsx';
import {migrate} from './lib/migrate.ts';
import {loadState} from './lib/server.ts';
import {setServer} from './lib/store.ts';

migrate(localStorage);
// The dev server's database when it runs; a static build keeps localStorage.
setServer(
  await loadState(localStorage).catch((error) => {
    // oxlint-disable-next-line no-console
    console.warn('Server storage unavailable, using this browser’s storage', error);
    return undefined;
  }),
);

createRoot(document.getElementById('root')!).render(<App />);
