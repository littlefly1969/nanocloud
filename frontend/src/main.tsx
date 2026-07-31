import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// NubArca typography, bundled from node_modules by Vite — the woff2 files are
// emitted into our own dist and served from our own origin. Nothing is fetched
// from a third-party CDN at runtime.
//
// Only the weights the stylesheet actually asks for, latin subset only (the UI
// ships en + it). @fontsource sets `font-display: swap`, so text paints in the
// fallback stack immediately and is never invisible while a face loads.
//
// Both families are SIL Open Font License 1.1; the notices ship at
// /fonts/ (see frontend/public/fonts/) and are listed in docs/brand.md.
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-700.css';
import '@fontsource/exo-2/latin-400.css';
import '@fontsource/exo-2/latin-500.css';
import '@fontsource/exo-2/latin-600.css';
import '@fontsource/exo-2/latin-700.css';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (root === null) {
  throw new Error('Missing #root element.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
