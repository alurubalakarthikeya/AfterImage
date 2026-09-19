# Bundled indexer

This folder is shipped with the application as `resources/indexer`. The Rust
supervisor (`src-tauri/src/supervisor.rs`) looks for an executable here before it
falls back to a development virtual environment.

Nothing needs to be committed to it. Run

```bash
npm run service:venv
npm run service:install      # add --full for embeddings and generated titles
npm run service:build        # freezes the service into this folder
```

and PyInstaller will place `afterimage-indexer` (`.exe` on Windows) here. The
next `npm run tauri:build` then produces an installer that carries its own
indexer, so the machine it is installed on needs no Python, no pip and no
virtual environment.

Without it the application still works: files are indexed, thumbnailed and
searchable by name, path, tags and extracted text. What is missing is OCR,
generated titles, visual labels and similarity search — and the Settings screen
says so rather than pretending otherwise.
