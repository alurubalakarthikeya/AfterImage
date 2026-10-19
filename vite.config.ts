import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, rmSync } from 'node:fs';

// The renderer's own version, taken from package.json rather than typed out.
// It is the browser preview's answer to "which build is this?" — the desktop
// build asks the running binary instead, which is the answer that matters
// there, and the two are kept in step by comparing them.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const buildTime = new Date().toISOString();

/**
 * Keep the staged installer out of the application bundle.
 *
 * `public/downloads/AfterImage-setup.exe` is copied into `dist` by every build
 * so the website can serve the file from its own folder — and the desktop build
 * embeds `dist`, so the installer was being packed inside itself. Not
 * metaphorically: one NSIS installer carried the bytes of the previous release
 * as a resource, which is why a 5 MB program downloaded as 10 MB and grew with
 * every release.
 *
 * The copy is removed from the build output here. `scripts/release.mjs` puts it
 * back afterwards, for the deployment — so what ships to the browser bundle
 * still has the file beside the page, and what ships inside the application
 * does not.
 */
function excludeStagedDownloads(): Plugin {
  return {
    name: 'afterimage:exclude-staged-downloads',
    apply: 'build',
    closeBundle() {
      rmSync(new URL('./dist/downloads', import.meta.url), { recursive: true, force: true });
    },
  };
}

// AfterImage is a Tauri desktop app, but the renderer must also run in a plain
// browser so the UI can be developed and reviewed without the Rust toolchain.
export default defineConfig({
  plugins: [react(), tailwindcss(), excludeStagedDownloads()],
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
