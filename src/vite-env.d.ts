/// <reference types="vite/client" />

interface Window {
  /** Injected by Tauri 2 into every webview. Absent in a plain browser. */
  __TAURI_INTERNALS__?: unknown;
  /** Set by the Rust shell so the UI can show which mode it is running in. */
  __AFTERIMAGE_HOST__?: 'tauri' | 'browser';
  /** Notification permission bridge used by the Tauri webview. */
  __TAURI__?: unknown;
}
