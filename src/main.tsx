// Must come first: everything below it is what it is watching.
import './boot';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerOfflineShell } from './services/pwa';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('AfterImage: #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The offline shell. It is the only thing that has to happen for an installed
// AfterImage to open with no network, and nothing in the interface waits on it:
// registering it here rather than in a component keeps it out of the render
// path, and the guard inside handles the desktop build and the dev server.
registerOfflineShell();
