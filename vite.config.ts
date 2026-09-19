import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// AfterImage is a Tauri desktop app, but the renderer must also run in a plain
// browser so the UI can be developed and reviewed without the Rust toolchain.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Tauri expects a fixed port and owns the terminal output.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: false,
    watch: {
      ignored: ['**/src-tauri/**', '**/services/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // The Tauri webview (WebKit/WebView2) supports modern syntax.
    target: 'es2022',
    minify: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
