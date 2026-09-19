# AfterImage

A local-first desktop application for your personal digital archive. It watches the
folders you point it at, indexes what it finds, extracts the text and metadata that
make files findable later, and presents all of it in a calm desktop interface.

Nothing leaves the machine. There is no account, no sync, no telemetry, and the
application is fully functional offline and without a language model.

---

## What it does

- **Watches folders you choose** — new files are picked up automatically and queued for processing. Add a folder once; there is no import step.
- **Indexes automatically** — metadata, thumbnails, and extracted text land in a local SQLite database with FTS5 full-text search.
- **Starts empty, and stays honest** — there is no sample archive, no placeholder statistics and no invented text. Every number on screen is a `COUNT(*)` from the database, and a file that no model could describe keeps its filename.
- **Extracts text** — OCR for screenshots and photos, PyMuPDF for PDF text layers, plain reads for text files.
- **Searches like a desktop app** — instant FTS5 search across filenames, extracted text, tags, folders, collections, and projects, with structured filters (`kind:screenshot`, `#react`, `is:favorite`, `since:7`).
- **Optionally goes semantic** — CLIP/SigLIP and sentence-transformer embeddings behind a local vector index (sqlite-vec, FAISS, or numpy). Off by default; on when you install the models.
- **Organises without you organising** — smart collections, tags, projects, favorites, and related files computed from the archive itself.

---

## Stack

```
┌───────────────────────────────────────────────┐
│  AfterImage UI                                │
│  React 19 · TypeScript · Vite · Tailwind 4    │
│  Framer Motion · Lucide · Zustand             │
└───────────────────────┬───────────────────────┘
                        │  Tauri commands (typed on both sides)
┌───────────────────────┴───────────────────────┐
│  Tauri 2 / Rust                               │
│  filesystem · watcher · thumbnails · SQLite   │
│  SQLite FTS5 · import queue · native dialogs  │
└───────────────────────┬───────────────────────┘
                        │  loopback HTTP (127.0.0.1:8765)
┌───────────────────────┴───────────────────────┐
│  Local indexer (optional) — Python · FastAPI  │
│  PaddleOCR / RapidOCR · PyMuPDF · CLIP        │
│  sentence-transformers · sqlite-vec / FAISS   │
└───────────────────────┬───────────────────────┘
                        │  optional, user-installed
                    Ollama (local LLM)
```

---

## Layout

```
afterimage/
├── index.html
├── package.json
├── vite.config.ts
├── src/                         # React renderer
│   ├── components/
│   │   ├── layout/              # AppShell, Sidebar, TopBar, Inspector, FirstRun, IndexingPanel
│   │   ├── dashboard/           # HeroCard, QuickStats, RecentFiles, SmartCollections, Activity
│   │   ├── files/               # FileCard, FileGrid, FileList, FileTimeline, FilePreview, metadata, tags, OCR
│   │   ├── search/              # SearchBar, SearchResults, SearchFilters, CommandPalette
│   │   └── common/              # IconButton, Badge, Avatar, Card, EmptyState, ContextMenu…
│   ├── pages/                   # Home, AllFiles, Photos, Screenshots, Documents, Videos, Projects, Collections, Search, Settings
│   ├── hooks/                   # appearance, media query, host events, shortcuts, drop import, file queries
│   ├── stores/                  # Zustand: ui, archive, search, collections, settings
│   ├── services/                # the host boundary: nativeHost (Tauri) and developmentHost (browser)
│   ├── types/                   # the shared vocabulary
│   └── utils/                   # formatting, and search-term highlighting
├── src-tauri/                   # Rust backend
│   ├── src/{lib,commands,db,scan,pipeline,watcher,thumbs,search,service,index,state,models,error}.rs
│   ├── capabilities/default.json
│   └── tauri.conf.json
├── services/indexer/            # local Python indexing service
│   └── app/{main,ocr,extract,describe,embed,vector_store,llm,config,capabilities,schemas}.py
└── scripts/generate-icons.mjs   # writes the desktop icon set (no image dependency)
```

---

## Running it

### Renderer only (fastest way to see the UI)

```bash
npm install
npm run dev          # http://localhost:1420
```

The renderer detects the absence of a Tauri host and switches to a development
host that has no filesystem, no SQLite and no watcher — and says so. The
interface shows its real first-run and empty states rather than a demonstration
archive, because an archive application that shows invented files is misleading
about the user's own data. Everything that needs disk access reports that it
needs the desktop build.

### Desktop application

```bash
npm install
npm run tauri:dev
```

Requires a Rust toolchain. The first build compiles SQLite, the watcher, and the
image codecs, so give it a few minutes.

```bash
npm run tauri:build           # produces the platform bundle
```

### Local indexer (optional)

```bash
npm run service:install       # pip install -r services/indexer/requirements.txt
npm run service:dev           # http://127.0.0.1:8765  (uvicorn, reload)
```

The service starts without any optional dependency: `/health` reports which
capabilities are actually present, and the desktop app adapts (OCR unavailable →
text extraction is skipped, embeddings unavailable → full-text search only).

Configuration is environment-driven; the notable knobs:

| Variable | Default | Purpose |
| --- | --- | --- |
| `AFTERIMAGE_PORT` | `8765` | service port (loopback only) |
| `AFTERIMAGE_OCR` | `1` | enable OCR |
| `AFTERIMAGE_OCR_LANGUAGES` | `en` | comma-separated language codes |
| `AFTERIMAGE_EMBEDDINGS` | `1` | enable embeddings |
| `AFTERIMAGE_VISION` | `1` | enable labels and generated titles |
| `AFTERIMAGE_CAPTION_MODEL` | `Salesforce/blip-image-captioning-base` | captioning model |
| `AFTERIMAGE_LABEL_FLOOR` | `0.18` | minimum zero-shot probability for a label |
| `AFTERIMAGE_VECTOR_BACKEND` | `auto` | `auto` / `sqlite-vec` / `faiss` / `numpy` |
| `AFTERIMAGE_LLM` | `0` | use Ollama to interpret queries |
| `AFTERIMAGE_LLM_MODEL` | `llama3.2:3b` | model name |
| `AFTERIMAGE_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama endpoint |
| `AFTERIMAGE_DATA_DIR` | platform app-data | models and vector index |

### Icons

```bash
npm run icons
```

### Reviewing the desktop layout in a small pane

AfterImage is laid out for a 1200px minimum content width, so a phone-sized
browser pane shows the compact shell rather than the real window. To inspect
the actual thing, `tools/desktop-frame.html` hosts the app in a 1440×900 iframe
and takes the visible region from the URL:

```
/tools/desktop-frame.html                  the real window, at 1:1
/tools/desktop-frame.html?x=430&y=330      pan to a point
/tools/desktop-frame.html?scale=0.34&h=1500  fit the whole dashboard in view
/tools/desktop-frame.html?w=1280&h=800     the smallest supported window
```

---

## First run

AfterImage starts with nothing indexed. The workspace asks for one thing — a
folder — and explains what happens next. Once a folder is granted it is scanned
immediately, and every later change is picked up by the watcher.

## How a file becomes searchable

```
filesystem
    ↓  notify (debounced) ──► rescan the folder the path belongs to
scan                             size + modification fingerprint per file
    ↓                            unchanged files are skipped, never re-read
SQLite row (pending) ──────────────────────────────────────► searchable by name
    ↓
processing queue (one worker, pause/resume, failures recorded)
    ├── probe       image dimensions, document page count
    ├── thumbnail   Rust image crate → JPEG in the app's data directory
    ├── text        PyMuPDF text layer → OCR only on scanned pages → plain reads
    ├── describe    CLIP labels + a captioning title (optional)
    └── embedding   CLIP for visuals, MiniLM for text (optional)
                        ↓
              vector index (sqlite-vec / FAISS / numpy)
                        ↓
                local database
```

Rows exist from the moment a file is discovered, so the grid fills in
immediately and gets richer as stages complete. Each stage can fail alone: no
thumbnail is a placeholder, no text is a note that says extraction was
unavailable, and no embedding leaves the file fully searchable by name, text,
tag and folder. A file that disappears is marked `missing` rather than deleted,
so its tags and collections survive it being moved back.

Status is surfaced once, quietly, in the sidebar (`12,179 indexed · 28 queued`)
rather than as a modal or a spinner per file. Clicking it opens the queue:
progress, throughput, failures, pause and resume.

## How a search is answered

```
query
  ├──► parser          rules always, model optionally — produces structured criteria
  ├──► FTS5            filenames, extracted text, tags, folders, collections, projects
  └──► vector search   nearest neighbours (only when embeddings exist)
                        ↓
                     fusion      normalised rank blending, FTS weighted higher
                        ↓
                   file results
```

An optional local model never searches the archive. It only rewrites a sentence
into those structured criteria, which keeps result time independent of archive
size — the same reasoning that keeps the model optional in the first place.

---

## Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd + K` | Command palette (files, places, actions) |
| `Ctrl/Cmd + F` | Focus search |
| `Ctrl/Cmd + O` | Add a folder to index |
| `Ctrl/Cmd + I` | Toggle the inspector |
| `Ctrl/Cmd + A` | Select every file on screen |
| `Ctrl/Cmd + 1…9` | Jump to a section |
| `Ctrl/Cmd + /` | Keyboard shortcuts |
| `Space` | Quick look at the selection |
| `Enter` | Open the selected file in its default application |
| `F` / `R` | Favourite / reveal in the file manager |
| `← → ↑ ↓` | Move the selection |
| `Delete` | Move the selection to the OS trash |
| `Esc` | Close the menu, panel or palette |

---

## Status of each layer

| Layer | State |
| --- | --- |
| Renderer | Complete: ten routes, three view modes, search, palette, inspector, indexing panel, dark theme |
| SQLite + FTS5 schema and queries | Complete |
| Folder picker, recursive scan, incremental rescan, watcher | Complete |
| Thumbnail pipeline | Images complete; video frames when `ffmpeg` is on `PATH`; documents show a kind placeholder |
| Text extraction | Via the local service: PDF text layer, OCR only on scanned pages, plain reads for text-like files |
| Generated titles and labels | Via the local service when CLIP/transformers are installed; otherwise absent by design |
| Hybrid retrieval | FTS5 + vector fusion + reranking, with per-hit match reasons |
| Related files | Scored locally from shared tags, shared text terms, folder, project and time |
| Similar images | Requires the local embedding model; the button is disabled without it |
| Volume capacity | Not reported yet, so the storage widget shows what is indexed rather than a fraction of the disk |

---

## Design

Light surfaces at `#F4F7F6`, white cards, `rgba(20,33,36,0.08)` borders, a single
teal accent (`#2F7773`) used sparingly, 18–22px card radii, and shadows weak
enough to be felt rather than seen. Inter for interface text, JetBrains Mono for
extracted text. An 8px spacing rhythm, three fixed columns (224px sidebar,
flexible workspace, 320px inspector), and no glow, no neon, no sparkle icons.

The product rule that shapes the interface: **you should never have to organise
your archive before you can use it.**
