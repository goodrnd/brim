import '@earendil-works/elanor-fonts/mallos-serif.css';
import '@earendil-works/elanor-fonts/commit-mono.css';
import '@earendil-works/elanor-fonts/departure-mono.css';
import '@earendil-works/elanor-react/elanor.min.css';
import './app.css';

import {createRoot} from 'react-dom/client';
import {App} from './App.tsx';
import {migrate} from './migrate.ts';

migrate(localStorage);

createRoot(document.getElementById('root')!).render(<App />);
