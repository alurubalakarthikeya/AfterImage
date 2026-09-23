/// <reference types="vite/client" />

/**
 * Constants the bundler substitutes at build time (see `vite.config.ts`).
 *
 * They exist so "which build is this?" has a single answer that cannot drift
 * from `package.json`, for the renderer's side of the answer. The desktop build
 * reads the same question off the running binary instead.
 */
declare const __BUILD_VERSION__: string;
declare const __BUILD_TIME__: string;

/**
 * The parts of the File System Access API this project uses that TypeScript's
 * DOM library does not describe yet.
 *
 * They are declared rather than cast away at every call site: the web build's
 * entire ability to read a folder rests on these three methods, and a typo in
 * one of them would otherwise be a runtime failure nobody sees until a user
 * tries to import something.
 */
interface FileSystemHandle {
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
}

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

interface Window {
  /** Chromium's directory picker: the web build's equivalent of a folder dialog. */
  showDirectoryPicker?(options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }): Promise<FileSystemDirectoryHandle>;
  /** Injected by Tauri 2 into every webview. Absent in a plain browser. */
  __TAURI_INTERNALS__?: unknown;
  /** Set by the Rust shell so the UI can show which mode it is running in. */
  __AFTERIMAGE_HOST__?: 'tauri' | 'browser';
  /** Notification permission bridge used by the Tauri webview. */
  __TAURI__?: unknown;
}
