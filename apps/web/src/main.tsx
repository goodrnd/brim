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
const root = createRoot(document.getElementById('root')!);
try {
  // The daemon's database when there is one; a static build keeps localStorage.
  setServer(await loadState(localStorage));
  root.render(<App />);
} catch (error) {
  // Rendering from localStorage here would show old data and save new edits where the server never sees them.
  document.documentElement.dataset.ready = ''; // the body is hidden until App loads a theme
  root.render(<p role="alert">{(error as Error).message}. Reload to try again.</p>);
}
