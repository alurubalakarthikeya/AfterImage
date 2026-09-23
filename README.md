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
- **Reads the picture, not just the file** — an image's DNA: its palette, brightness, contrast, detail and colour cast, measured locally from its own pixels.
- **Keeps what was there before an edit** — when a file changes on disk, the presentation copy that is about to be replaced is kept, and can be compared against the current one with a draggable before/after divider.
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
│   │   ├── files/               # FileCard, FileGrid, FileList, FileTimeline, FilePreview, ImageDna
│   │                        # (measured picture data), Comparison (before/after), metadata, tags, OCR
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
│   ├── src/{dna,versions}.rs    # pixel measurement, and the copies kept for comparison
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
npm run tauri:build           # produces the platform bundle (NSIS on Windows)
```

#### Windows prerequisites

Two things have to be on the machine before `npm run tauri:build` can succeed:

```powershell
# 1. Rust. The MSVC toolchain needs the C++ build tools as well.
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

# 2. Python 3.11+ for the local indexer (optional but recommended).
winget install Python.Python.3.12
```

Close and reopen the terminal afterwards so `cargo` and `python` land on `PATH`.

#### Where the archive lives

Everything AfterImage writes stays under the app-data directory:

| Path | Contents |
| --- | --- |
| `%APPDATA%\app.afterimage.desktop\afterimage.sqlite` | the index: files, OCR text, FTS5, tags, collections, activity |
| `%APPDATA%\app.afterimage.desktop\thumbnails\` | grid thumbnails (640px) |
| `%APPDATA%\app.afterimage.desktop\thumbnails\previews\` | the larger derivative the hero and the comparison view show (1600px) |
| `%APPDATA%\app.afterimage.desktop\thumbnails\versions\` | kept copies of the presentations a file has had (at most 12 per file) |

Deleting that folder resets the application to a first run. Your own files are
never moved, renamed or modified — only read.

#### Verifying a build end to end

With the app open:

1. `Choose Folder` → pick a real folder (`%USERPROFILE%\Pictures`, `Downloads`).
2. The status line counts up; thumbnails appear in the grid as they are written.
3. Home's hero shows one of your own landscape photographs — or its plain tint if
you have none indexed yet.
4. `Ctrl K` → search for a word you know is inside one of your screenshots.
5. Drop a new file into the folder; it appears without a rescan.
6. Quit and reopen: the index persists.

### Local indexer (optional)

```bash
npm run service:venv          # create services/indexer/.venv with a real Python
npm run service:install       # light stack: OCR, PDF text, vector index (~250 MB)
npm run service:install:full  # + torch and sentence-transformers, for embeddings
npm run service:dev           # http://127.0.0.1:8765  (uvicorn)
npm run service:build         # freeze it into src-tauri/resources/indexer
```

These are wrappers around `scripts/service.mjs`, which finds a Python even when
it is not on `PATH` — on Windows the only `python` on `PATH` is usually the
Microsoft Store stub, which fails when a script runs it. The script searches the
per-user install directory and the `py` launcher before giving up.

The service starts without any optional dependency: `/health` reports which
capabilities are actually present, and the desktop app adapts (OCR unavailable →
text extraction is skipped, embeddings unavailable → full-text search only).

The desktop app starts the service itself and stops it with the window, so there
is nothing to keep running by hand. It is normally started in the background at
launch; Settings also has a **Start indexer** button for the case where that
first attempt loses the race on a slow machine, and pressing **Download** for the
face models starts it too when it is not already up. Everything the service
prints goes to `indexer.log` beside the database — an indexer that fails to
start is the one failure a person cannot diagnose from the window, so it is the
one that keeps a log.

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
size — the same reasoning that keeps the model optional in the first place. The
model named in Settings is passed with each request, so choosing one takes effect
on the next search rather than on the next restart.

## What the switches change

Each switch on the Settings page maps to a preference the backend actually
reads, and they are deliberately separate — nothing is a master switch for
something it does not name.

| Switch | Preference | What changes |
| --- | --- | --- |
| Local processing | `local_processing` | The gate on everything that needs the Python service: OCR, labels, embeddings, faces, model downloads |
| Index new files automatically | `auto_index` | Whether a change on disk is enough to start indexing, or waits to be asked |
| Keep indexing on battery | `index_on_battery` | When off, the queue holds while the machine is on battery power and resumes on mains; nothing is half-processed |
| Semantic search | `semantic_search` | Whether embeddings are produced and searched, on top of full-text search |
| Local model | `llm_enabled`, `llm_model` | Whether the optional model rewrites queries, and which model |
| Indexer service port | `service_port` | The loopback port the local service binds |
| Show file metadata on cards | renderer only | The size, pixel dimensions and date under each tile |
| Reduce transparency | renderer only | Blur and translucency off for the floating chrome |

The renderer's own store is the copy a person edits; its values are pushed to
the archive database when a session opens, which is what the watcher and the
pipeline read (they never see the renderer).

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

## How to build AfterImage on Windows

The whole sequence, in order, from a clean machine. PowerShell, from the folder
that contains this file.

```powershell
# 1. Node 20+ (22 LTS is what this was developed against)
winget install OpenJS.NodeJS.LTS          # skip if `node -v` already works

# 2. Rust, plus the MSVC C++ build tools the default toolchain needs
winget install Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

# 3. Python 3.11 or 3.12, for the local indexer (optional but recommended)
winget install Python.Python.3.12

# Close and reopen PowerShell so cargo, rustup and python land on PATH,
# then confirm all three:
cargo -V        # cargo 1.8x
node -v         # v22.x
python -V       # Python 3.12.x

# 4. Front-end dependencies
cd <this folder>
npm install

# 5. The local indexer: OCR, PDF text and the vector index (~250 MB).
#    For generated titles and similarity search as well:
#        npm run service:install:full        (adds torch, several GB)
npm run service:venv
npm run service:install

# 6. Freeze the indexer into the app. This is what removes the Python
#    requirement from the machine you install on.
npm run service:build        # → src-tauri/resources/indexer/afterimage-indexer.exe

# 7. Run it in development (hot reload, real database, real folders)
npm run tauri:dev

# 8. Build the installer
npm run tauri:build
```

### What the build produces

The bundle is NSIS only (`bundle.targets` in `src-tauri/tauri.conf.json`), which
is the target that needs no extra tooling beyond the prerequisites above.
Everything lands under `src-tauri/target/release/`:

| Path | What it is |
| --- | --- |
| `src-tauri/target/release/afterimage.exe` | the application itself, portable (run it in place) |
| `src-tauri/target/release/bundle/nsis/AfterImage_0.1.1_x64-setup.exe` | the installer |

The installer is per-user — it does not need administrator rights, and it can be
copied to another Windows machine as-is. That machine needs no Node, no Rust, no
Python and no network: the indexer is carried inside `resources/indexer/`, and
the Rust supervisor starts and stops it with the window.

To confirm what a build shipped, look inside the installed folder for
`resources\indexer\afterimage-indexer.exe`. If it is there, OCR and similarity
search work on that machine. If it is not, the application still runs and says
so in Settings — indexing, thumbnails and full-text search are all in Rust and
do not depend on the indexer at all.

### Which build am I running?

Two builds of AfterImage look identical once they are running, and the installer
always writes to the same place (`%LOCALAPPDATA%\AfterImage`), so re-running an
old `*-setup.exe` you still have on disk reinstalls that old build and shows the
old interface. Nothing is broken when that happens; the installer is simply the
version it was built from.

So the application describes itself. Settings → Privacy ends with the version,
the moment the running executable was written, the path it is running from, and
the data directory it is using:

```
AfterImage 0.1.1 · Built 23 Sep 2026 at 11:52 · Host: tauri
%APPDATA%\app.afterimage.desktop
C:\Users\you\AppData\Local\AfterImage\afterimage.exe
```

Those values are read from the binary and the filesystem at the moment the page
opens, never typed in by hand. After installing a new build, check that line: if
the version and the build time moved, the new build is the one running.

### Nothing leaves the machine

AfterImage has no server to talk to and no account to talk to it with. The
renderer is bundled into the executable (no CDN, no remote fonts — Inter and
JetBrains Mono ship inside the bundle), the index is SQLite on disk, and the only
HTTP in the whole application is to `127.0.0.1`: the local indexer on its own
port, and Ollama if you have enabled the local model.

The single exception is a deliberate one: downloading model files (the ~37 MB
face bundle, or OCR and embedding models for the Python service) happens once,
on request, from the URLs in `services/indexer/app/models.py`. After that the
machine is offline-capable, and nothing about your files is ever sent anywhere.

There is nothing to deploy. `npm run tauri build` produces a self-contained
installer; there is no hosted component, no `npm publish`, and no release step.

### Installing and launching

1. Double-click `AfterImage_0.1.1_x64-setup.exe` and follow the installer.
2. Launch **AfterImage** from the Start menu.
3. `Choose Folder` → pick something real (`%USERPROFILE%\Pictures`, `Downloads`).
4. Watch the status line count up; tiles appear as thumbnails are written.
5. `Ctrl K` and search for a word you know is inside one of your screenshots.
6. Quit and reopen: the index is where you left it.

The archive lives in `%APPDATA%\app.afterimage.desktop\` — `afterimage.sqlite`,
`thumbnails\` and `thumbnails\previews\`. Deleting that folder is a full reset;
your own files are never moved, renamed or modified.

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
| Similar images | Requires the local embedding model; the button appears only for files that have an embedding |
| Indexer lifecycle | Rust starts and stops the service; packaged by `npm run service:build`, or a `.venv` on a development machine |
| Image DNA | Measured in Rust from the file's own pixels, on demand and cached per revision. A format this build cannot decode reports the facts the scan already knew and says why |
| Kept versions | The presentation copy is kept whenever the scan sees a file's content change, including changes made while the application was closed. Capped at 12 per file, oldest first out |
| Volume capacity | Not reported yet, so the storage widget shows what is indexed rather than a fraction of the disk |

---

## Design

Light surfaces at `#F4F7F6`, white cards, `rgba(20,33,36,0.08)` borders, a single
teal accent (`#2F7773`) used sparingly. Inter for interface text, JetBrains Mono
for extracted text. An 8px spacing rhythm, three fixed columns (224px sidebar,
flexible workspace, 320px inspector), and no glow, no neon, no sparkle icons.

Three rules do most of the work:

* **Surfaces are separated by hairlines, not shadows.** A card that needs a drop
  shadow to read as a card is usually a card that did not need to exist. Shadow
  is reserved for things that genuinely float: menus, modals, drag previews.
* **Colour means state.** Success, warning, failure — and the brand accent. A
  file's type is never encoded in a colour, because a red row has to mean
  "something is wrong", not "this is a PDF".
* **One radius scale**, 6 / 8 / 12 / 16. Nothing is rounded for decoration.

The product rule that shapes the interface: **you should never have to organise
your archive before you can use it.**
