# AfterImage

AfterImage is a local-first desktop archive that turns the folders you already keep into a searchable, self-describing library. It watches the directories you point it at, indexes what it finds — metadata, thumbnails, extracted text, visual labels, faces and embeddings — and presents all of it in a calm desktop interface. Nothing is uploaded, there is no account, and your files are never moved unless you explicitly ask the organiser to file them.

## Core Capabilities

### Automatic Folder Indexing

Every added folder is walked once, and every file in it becomes a row in a local SQLite database before any processing begins, so the grid fills in immediately and grows richer as the pipeline catches up. Change detection uses the pair of byte size and modification time rather than hashing every file, which keeps a rescan of a large library to a directory walk. A native filesystem watcher reports additions, edits and deletions from then on, feeding the same idempotent scan so nothing is ever imported twice.

The pipeline itself is a single worker thread that processes one file at a time through discrete stages: dimensions and stills, thumbnails, text extraction, visual understanding, embeddings, then faces. Each stage is allowed to fail on its own — a file with no thumbnail keeps a labelled placeholder, a file with no extractable text is recorded as having none — and the row states (`ocr_state`, `analysis_state`, `faces_state`, `embedding_state`) say exactly which stages ran rather than collapsing everything into "done".

### Extraction and Local Vision

Text comes from three places depending on the file: RapidOCR (with PaddleOCR when the environment can build it) for pixels, PyMuPDF for a PDF's own text layer before any rasterising, and a direct read for text-like documents. Videos and PDFs are decoded by the service into a single high-resolution still, which becomes both the grid thumbnail and the presentation image used by the hero and the quick-look panel.

What the picture *is* comes from a two-stage classifier rather than a generative model. CLIP ViT-B/32 first decides what kind of picture it is — screenshot, document, diagram, photograph, illustration, graphic — restricted by the kind the scan already assigned, and then scores a short vocabulary that belongs to that kind. Each label is asked two or three ways, the phrasings are pooled, and shares are renormalised across labels, so a threshold means "how much of this picture is a dog" rather than a slice of a sixty-way prompt soup. Broad labels are suppressed when a specific child wins (`dog` over `animal`), and every machine tag carries its provenance: `vision` for a model label, `ocr` or `filename` for something read, `kind` for the format itself.

An optional captioner (BLIP, when PyTorch is installed) writes a title, and an optional local vision model served by Ollama may add a sentence in words a person would search with. Nothing is invented to fill a gap — a file no model could describe keeps its filename, its extracted text and its metadata, and the share behind every kept label is stored so the inspector can say why a tag is there.

### Hybrid Retrieval

Search runs over SQLite FTS5 with a `unicode61 remove_diacritics 2` tokenizer across name, generated title, description, labels, inferred context, extracted text, folder, tags, project and the names of people in the file. A small query language sits in front of it — `kind:screenshot`, `#react`, `is:favorite`, `since:7` — and is parsed by rules first, with an optional local language model only rewriting the question into criteria, never searching the archive itself.

Ranking is a second, separate question from candidate selection. Full-text candidates are reranked by how much of the query each file accounts for and how close those words sit to each other, so "a man beside a red motorcycle on a rainy street" prefers the photograph described in those words over the file merely named `red`. When semantic search is enabled, CLIP image vectors and MiniLM text vectors are fused into the candidate set, using `sqlite-vec` where available and falling back to FAISS or a numpy store.

### Face Grouping Without the Cloud

Faces are detected with YuNet and embedded with SFace, both ONNX models running on the machine. Grouping happens in the Rust process next to the rows it writes: a new face is compared by cosine similarity against existing people and either joins one or starts a new unnamed group. The application never guesses who anybody is — it groups, and you name the group.

From there the archive supports renaming, merging two or many groups with a single undo, hiding a group from the People view, and forgetting a person entirely. A face-only pass scans files that were indexed before the models arrived without re-reading them for text and embeddings that are already stored.

### Version History and Comparison

When a file's bytes change, the presentation copy that is about to be replaced is kept before the new one is written — at most twelve per file. That is what the before/after view compares against, with a draggable divider over the two images. Versions can also be captured by hand, and deleted individually; the original file on disk is never touched by any of it.

### Non-Destructive Organisation

Tags, collections, projects and favourites are all saved views over the index, not folder structures. A tag added by hand survives re-analysis because machine tags are stored with their own sources (`vision`, `ocr`, `filename`, `kind`) and replaced wholesale, while anything with `source = 'user'` is never touched. Smart collections are real collections with real counts and strips built from thumbnails of files that genuinely belong to them.

The one control that moves anything is the organiser, and it is built around showing the plan first: file count, bytes, folders to be created, and the files being left alone each with its reason. A file in a collection is filed under that collection inside its kind; everything else goes to `Unfiled`; name collisions are resolved with a suffix rather than an overwrite. The plan is recomputed at apply time, so what was shown is what runs.

### Privacy by Construction

The Python service binds to loopback only and rejects any request whose client address is not local. The webview runs under a CSP that permits the asset protocol for the thumbnail directory alone. There is no telemetry, no sync and no account; the website is a download page and nothing more, because a browser cannot read folders or run the models.

## Planning: Upcoming Features

### Self-Contained Intelligence Engine

`npm run service:build` now freezes the service with PyInstaller and stages the folder beside the shell, and the supervisor starts it from there. One problem remains: the frozen engine serves `/health` and `/models`, then segfaults inside ONNX Runtime on the first inference — reproducible with both single-file and folder builds, while the same code in a virtual environment is fine. Until that is fixed the installer deliberately ships no engine, and model features require the development checkout. Fixing the native runtime inside the bundle is the next release item.

### Automatic Re-analysis on Model Arrival

A library indexed before its models were installed is marked `analysed` with nothing a model wrote, and nothing revisits it. A repair pass exists (Settings → Analyze library, and installing a vision bundle reopens the rows), but it should also run unprompted the first time the service reports its model bundles ready.

### Duplicate and Near-Duplicate Detection

Files are currently identified by path and fingerprint. A perceptual hash per image would let the archive collapse the same photograph saved five times under five names without hiding any of the originals.

### Archive Backup and Restore

The index, thumbnails and versions live under one directory but have no export. A single-file backup — schema version included — would make moving a library between machines a copy rather than a rebuild.

## Technical Architecture

The application is a desktop program with a native core, a webview interface and an optional local service for the models. It is one installable binary; there is no server component and no network dependency at runtime.

**Frontend Interface:** React 19 with TypeScript, built by Vite and styled with Tailwind 4. Zustand holds the archive, search, settings and UI state; Framer Motion handles transitions. The renderer reaches the native side through one typed host boundary, which also has a development implementation so the interface runs in a plain browser.

**Native Core:** Tauri 2 on Rust. The core owns scanning, watching, thumbnailing, the SQLite schema and migrations, full-text and vector retrieval, face clustering, version keeping, the organiser, and the supervision of the Python service as a child process that is stopped when the window closes.

**Intelligence Layer:** A FastAPI service on `127.0.0.1:8765`. It hosts OCR, document text and page rendering, video stills, CLIP classification, captioning, embeddings, the vector index, face detection and optional Ollama calls. Capabilities are detected at import time and reported by `/health`, so a partially installed environment degrades instead of crashing.

**Data Orchestration:** SQLite is the single source of truth, with FTS5 as a projection of it rather than a parallel copy, and a sidecar vector store kept beside it. Model weights are downloaded on demand into the same application-data directory and verified before use.

## Technology Stack

**Frontend (React/TypeScript)**

- UI Framework: React 19, Vite 8, TypeScript 5.9
- Styling: Tailwind 4 with a custom glass material, Inter and JetBrains Mono
- State Management: Zustand stores
- Motion: Framer Motion; Icons: Lucide

**Native Core (Rust)**

- Shell: Tauri 2 (frameless window, asset protocol, native dialogs)
- Data: rusqlite with bundled SQLite, FTS5, WAL
- Files: notify-based watcher, image decoding and thumbnail derivation
- Runtime: one pipeline worker, one scan lock, typed error surface

**Intelligence Layer (Python)**

- API Framework: FastAPI, Uvicorn
- OCR and Documents: RapidOCR / PaddleOCR, PyMuPDF
- Vision: ONNX Runtime (CLIP ViT-B/32, MiniLM-L6-v2, YuNet, SFace)
- Optional: PyTorch and Transformers for captioning; Ollama for descriptions and query parsing
- Vectors: `sqlite-vec`, FAISS or numpy

**Infrastructure**

- Storage: local SQLite and an on-disk vector index, under the OS application-data directory
- Distribution: NSIS installer for Windows, built by `tauri build`
- Website: a single static page that serves the installers from its own folder

## Project Structure

```
AfterImage/
├── src/                       # React renderer
│   ├── components/            # layout, dashboard, files, search, people, settings, common
│   ├── pages/                 # Home, AllFiles, Photos, Screenshots, Documents, Videos,
│   │                          # People, PersonDetail, Projects, Collections, Search, Settings,
│   │                          # Landing (the website)
│   ├── stores/                # Zustand: archive, search, collections, people, settings, ui, pwa
│   ├── services/              # the host boundary: nativeHost (Tauri), developmentHost, webHost
│   ├── hooks/                 # appearance, host events, shortcuts, drop import, file queries
│   ├── types/                 # the shared vocabulary
│   └── utils/                 # formatting, highlighting, installer probing
├── src-tauri/                 # Rust core
│   ├── src/
│   │   ├── lib.rs             # app setup, command registration, shutdown
│   │   ├── commands.rs        # the typed command surface
│   │   ├── db.rs              # schema, migrations, FTS5 projection
│   │   ├── scan.rs            # classification and directory walks
│   │   ├── watcher.rs         # filesystem events
│   │   ├── pipeline.rs        # the indexing pipeline
│   │   ├── thumbs.rs          # thumbnails, previews, media stills
│   │   ├── search.rs          # query language, retrieval, ranking
│   │   ├── people.rs          # face storage and clustering
│   │   ├── versions.rs        # kept presentation copies
│   │   ├── dna.rs             # pixel measurements
│   │   ├── organize.rs        # plan and apply
│   │   ├── service.rs         # HTTP client for the indexer
│   │   └── supervisor.rs      # starting and stopping the service
│   ├── resources/indexer/     # where a packaged engine belongs
│   └── tauri.conf.json
├── services/indexer/          # local Python service
│   ├── app/                   # main, ocr, extract, describe, embed, faces, vlm, llm, models,
│   │                          # vector_store, stills, frames, capabilities, config, schemas
│   └── requirements.txt
├── scripts/                   # icons, release staging, service setup, search regression suite
├── public/                    # site assets and downloads/
└── index.html
```

## Running It

### Renderer only

```bash
npm install
npm run dev          # http://localhost:1420
```

In a browser the page is the download. The archive needs a process that can read folders, keep a database and run the models, so the website offers the program rather than imitating it.

### Desktop application

```bash
npm install
npm run service:venv      # creates services/indexer/.venv
npm run service:install   # installs the service's dependencies
npm run tauri:dev
```

Windows needs the Rust toolchain with the MSVC build tools, and Python 3.11+ for the local service. The first build compiles SQLite, the watcher and the image codecs, so give it a few minutes.

```bash
npm run tauri:build       # NSIS installer only
npm run service:build     # freezes the indexer into src-tauri/resources/indexer
npm run release           # freezes the engine (when PyInstaller is installed),
                          # builds the installer, stages it into public/downloads/
```

### Checks

```bash
npm run typecheck         # tsc --noEmit
npm run check:search      # 52-case search regression suite
npm run service:test      # tagging and embedding rules (no models needed)
cargo test                # 49 Rust tests

# Tag quality over a folder of pictures: distinct sets, empty results, latency.
npm run eval:tags -- --dir "C:/path/to/pictures" --limit 40
```

### Where everything lives

| Path | Contents |
| --- | --- |
| `%APPDATA%\app.afterimage.desktop\afterimage.sqlite` | the index: files, OCR text, FTS5, tags, collections, projects, people, activity |
| `%APPDATA%\app.afterimage.desktop\thumbnails\` | grid thumbnails and the larger presentation copies |
| `%APPDATA%\app.afterimage.desktop\thumbnails\versions\` | kept copies of presentations a file has had |
| `%APPDATA%\app.afterimage.desktop\thumbnails\faces\` | face crops |
| `%APPDATA%\app.afterimage.desktop\indexer\` | model weights, the vector index, the service log |
| `%APPDATA%\app.afterimage.desktop\indexer.log` | what the service did, appended per run |

## Developers

**[@alurubalakarthikeya](https://github.com/alurubalakarthikeya)**

## Repo Activity

![Last commit](https://img.shields.io/github/last-commit/alurubalakarthikeya/AfterImage?style=flat-square)
![Version](https://img.shields.io/github/package-json/v/alurubalakarthikeya/AfterImage?style=flat-square)
![License](https://img.shields.io/github/license/alurubalakarthikeya/AfterImage?style=flat-square)

## License

Apache License 2.0 — refer to the [LICENSE](LICENSE) file for full terms and conditions.
