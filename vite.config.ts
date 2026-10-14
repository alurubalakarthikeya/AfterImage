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

// AfterImage is a Tauri desktop app, but the renderer must also run in a plain
// browser so the UI can be developed and reviewed without the Rust toolchain.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_VERSION__: JSON.stringify(pkg.version ?? '0.0.0'),
    __BUILD_TIME__: JSON.stringify(buildTime),
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
