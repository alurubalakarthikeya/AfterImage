import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

// The renderer's own version, taken from package.json rather than typed out.
// It is the browser preview's answer to "which build is this?" — the desktop
// build asks the running binary instead, which is the answer that matters
// there, and the two are kept in step by comparing them.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const buildTime = new Date().toISOString();

/**
 * `owner/name` for the release downloads, taken from the manifest rather than
 * typed into the interface.
 *
 * The web build offers the installers to whoever opens it, and those links have
 * to survive a rename, a fork or a move to another host. Reading them from the
 * one place they are already recorded means there is nothing to remember at
 * deployment time and nothing that can drift.
 */
const releaseRepo = ((): string => {
  const url = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (typeof url !== 'string') return '';
  const match = url.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/i);
  return match ? match[1] : '';
})();

// AfterImage is a Tauri desktop app, but the renderer must also run in a plain
// browser so the UI can be developed and reviewed without the Rust toolchain.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
    __BUILD_TIME__: JSON.stringify(buildTime),
    __RELEASE_REPO__: JSON.stringify(releaseRepo),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri expects a fixed port and owns the terminal output.
  clearScreen: false,
  // Nothing in the renderer is served from a remote origin, so there is no
  // crossorigin handling to get wrong: every asset is bundled from this repo.
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    watch: {
      ignored: ['**/src-tauri/**', '**/services/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  // The dev server is loopback-only and the built bundle is loaded from the
  // application's own resources, never from a CDN.
  build: {
    // The Tauri webview (WebKit/WebView2) supports modern syntax.
    target: 'es2022',
    minify: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
