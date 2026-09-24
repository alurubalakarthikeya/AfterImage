import type {
  ActivityEntry,
  AnalysisStatus,
  ArchiveCollection,
  ArchiveFile,
  ArchiveFolder,
  ArchiveTotals,
  BuildInfo,
  FileFace,
  FileKind,
  FileVersion,
  ImageDna,
  IndexStatus,
  ModelStatus,
  OrganizePlan,
  PeopleSnapshot,
  Person,
  Project,
  QueryInterpretation,
  SearchHit,
  SearchQuery,
  SearchResponse,
  StorageStats,
  Tag,
} from '@/types';
import type {
  ArchiveHost,
  ArchiveSnapshot,
  FilePage,
  FileQuery,
  HostCapabilities,
  HostEvent,
  HostListener,
  HostPreferences,
} from './host';
import {
  available as storageAvailable,
  clearAll,
  footprint,
  put,
  putMany,
  readAll,
  remove,
  removeMany,
  type StoredBlobs,
  type StoredFile,
  type StoredFolder,
  type StoredVersion,
} from './web/store';
import {
  generate,
  measure as measurePixels,
  releaseAll,
  releaseUrl,
  rememberUrl,
  temperature as temperatureOf,
  urlFor,
  videoPoster,
  type Analysis,
} from './web/media';

/**
 * The web build's archive.
 *
 * This is AfterImage running as an ordinary web page, with the archive kept in
 * the browser itself: IndexedDB for the records, thumbnails and kept copies, and
 * the File System Access API for the folders the user grants. No server, no
 * account, no network call — the same local-first promise the desktop build
 * makes, delivered with the tools a page actually has.
 *
 * What it deliberately does not pretend to do:
 *
 *   * **Rename a file, move it to the trash, reveal it in Explorer.** A page
 *     cannot do any of those. It says so instead of showing a button that fails.
 *   * **Detect faces.** Face grouping needs the local models, which live in the
 *     desktop build's indexer.
 *   * **Reorganize the disk.** The desktop build can file your files for you
 *     because it can write to them; a page cannot, so the option is absent.
 *
 * Everything else — importing folders, thumbnails, image DNA, collections, tags,
 * favourites, search, previews of video and PDF, and before/after of anything
 * the user captures a copy of — works here, offline, and survives a reload.
 */

/** Longest edge a generated tile is kept at. Matches the desktop thumbnail. */
const CAPABILITIES: HostCapabilities = {
  // The browser has a real directory picker of its own.
  nativeDialogs: true,
  // There is no watcher: a page is not told when a file on disk changes.
  fileWatch: false,
  notifications: typeof Notification !== 'undefined',
  reveal: false,
  trash: false,
  sqlite: false,
  appearance: true,
  // A page never learns an absolute path; it works in folder handles.
  realPaths: false,
  indexing: true,
  thumbnails: true,
};

/** Directories a photo archive never wants, same list the desktop scan uses. */
const IGNORED = [
  'node_modules',
  '.git',
  '.next',
  '.cache',
  'dist',
  'build',
  'out',
  'vendor',
  'Pods',
  'DerivedData',
  'Library',
  '$RECYCLE.BIN',
  'System Volume Information',
  '.Trash',
];

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif'];
const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'];
const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac'];
const DOC_EXTS = [
  'pdf', 'txt', 'md', 'markdown', 'rtf', 'json', 'csv', 'log', 'yaml', 'yml', 'toml', 'xml', 'doc',
  'docx', 'odt', 'pages', 'tex',
];
const DESIGN_EXTS = ['psd', 'ai', 'fig', 'sketch', 'xd', 'afdesign', 'svg', 'indd', 'eps'];
const ARCHIVE_EXTS = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'dmg', 'iso'];

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  zip: 'application/zip',
};

/** The kinds the pipeline actually reads pixels or text out of. */
const RENDERABLE: FileKind[] = ['photo', 'screenshot', 'design'];

const EMPTY_BY_KIND: Record<FileKind, number> = {
  photo: 0,
  screenshot: 0,
  document: 0,
  video: 0,
  audio: 0,
  design: 0,
  archive: 0,
  other: 0,
};

function nowIso(): string {
  return new Date().toISOString();
}

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index + 1).toLowerCase();
}

/**
 * The bucket a file belongs in — the same rule the desktop scan applies, so a
 * folder imported in a browser and the same folder imported by the app agree
 * about what a screenshot is.
 */
function classify(name: string, ext: string, folderName: string): FileKind {
  const lower = name.toLowerCase();
  const folder = folderName.toLowerCase();
  const looksLikeCapture =
    lower.startsWith('screenshot') ||
    lower.startsWith('screen shot') ||
    lower.startsWith('capture') ||
    lower.startsWith('snip') ||
    lower.startsWith('cleanshot') ||
    lower.includes('screen capture') ||
    folder.includes('screenshot') ||
    folder.includes('capture');

  if (IMAGE_EXTS.includes(ext)) return looksLikeCapture ? 'screenshot' : 'photo';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (DOC_EXTS.includes(ext)) return 'document';
  if (DESIGN_EXTS.includes(ext)) return 'design';
  if (ARCHIVE_EXTS.includes(ext)) return 'archive';
  return 'other';
}

function uuidLike(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(36)}${random}`;
}

function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

const SURFACES = ['mint', 'lavender', 'peach', 'blue', 'neutral'] as const;

/** The permission a stored handle needs before it can be read again. */
async function permissionGranted(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const options = { mode: 'read' as const };
  try {
    if ((await handle.queryPermission(options)) === 'granted') return true;
    return (await handle.requestPermission(options)) === 'granted';
  } catch {
    return false;
  }
}

export function createWebHost(): ArchiveHost {
  const listeners = new Set<HostListener>();

  const folders = new Map<string, StoredFolder>();
  const files = new Map<string, StoredFile>();
  const collections = new Map<string, ArchiveCollection>();
  const tags = new Map<string, Tag>();
  const projects = new Map<string, Project>();
  const kept = new Map<string, StoredVersion[]>();
  /** Which record owns which thumbnail: what `assetUrl` and `releaseUrl` key on. */
  const blobs = new Map<string, StoredBlobs>();
  let activity: ActivityEntry[] = [];
  let preferences: HostPreferences = {};
  let paused = false;
  let walking = false;
  let lastScanAt: string | null = null;
  /** Folders picked but not yet registered, so the two-step onboarding flow works. */
  const pending = new Map<string, ArchiveFolder>();

  const emit = (event: HostEvent) => {
    for (const listener of listeners) listener(event);
  };

  const notice = (level: 'info' | 'warn' | 'error', message: string) =>
    emit({ type: 'notice', level, message });

  /**
   * A desktop notification, when the browser allows one.
   *
   * The permission is never requested from here: asking for it because an
   * indexing pass finished would be a permission prompt in exchange for nothing.
   * If it was granted for something else, the user gets told the run finished.
   */
  const notify = async (title: string, body: string): Promise<void> => {
    if (typeof Notification === 'undefined') return;
    try {
      if (Notification.permission === 'granted') new Notification(title, { body });
    } catch {
      /* a courtesy, never a requirement */
    }
  };

  const refuse = async (what: string): Promise<never> => {
    const message = `${what} needs the desktop build — a web page cannot change files on your disk.`;
    notice('warn', message);
    throw new Error(message);
  };

  const status = (): IndexStatus => ({
    state: paused ? 'paused' : walking ? 'indexing' : 'idle',
    pending: 0,
    processing: walking ? 1 : 0,
    done: files.size,
    failed: 0,
    total: files.size,
    perMinute: 0,
    currentFile: null,
    currentFolder: walking ? currentFolderName : null,
    lastScanAt,
    problem: null,
  });

  let currentFolderName: string | null = null;

  // -------------------------------------------------------------------------
  // Boot: read the browser's own archive back into memory
  // -------------------------------------------------------------------------

  let loaded: Promise<void> | null = null;

  async function load(): Promise<void> {
    if (!storageAvailable()) return;
    if (loaded) return loaded;

    loaded = (async () => {
      const [storedFolders, storedFiles, storedBlobs, storedVersions, storedCollections, storedTags, storedProjects, entries] =
        await Promise.all([
          readAll<StoredFolder>('folders'),
          readAll<StoredFile>('files'),
          readAll<StoredBlobs>('blobs'),
          readAll<StoredVersion>('versions'),
          readAll<ArchiveCollection>('collections'),
          readAll<Tag>('tags'),
          readAll<Project>('projects'),
          readAll<ActivityEntry>('activity'),
        ]);

      for (const entry of storedFolders) folders.set(entry.folder.id, entry);
      for (const entry of storedFiles) files.set(entry.file.id, entry);
      for (const entry of storedBlobs) blobs.set(entry.fileId, entry);
      for (const entry of storedVersions) {
        const list = kept.get(entry.fileId) ?? [];
        list.push(entry);
        kept.set(entry.fileId, list);
      }
      for (const entry of storedCollections) collections.set(entry.id, entry);
      for (const entry of storedTags) tags.set(entry.id, entry);
      for (const entry of storedProjects) projects.set(entry.id, entry);
      activity = entries.slice().sort((a, b) => b.at.localeCompare(a.at));

      // A blob's URL has to exist before the first render asks for it, because
      // `assetUrl` is synchronous. This is that moment.
      for (const entry of storedBlobs) {
        if (entry.thumb) rememberUrl(thumbKey(entry.fileId), entry.thumb);
        if (entry.preview) rememberUrl(previewKey(entry.fileId), entry.preview);
      }
      for (const entry of storedVersions) rememberUrl(versionKey(entry.id), entry.blob);
    })();

    return loaded;
  }

  const thumbKey = (fileId: string) => `mem:thumb:${fileId}`;
  const previewKey = (fileId: string) => `mem:preview:${fileId}`;
  const versionKey = (versionId: string) => `mem:version:${versionId}`;
  const originalKey = (fileId: string) => `mem:original:${fileId}`;

  const sleep = (milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

  async function waitWhilePaused(): Promise<void> {
    while (paused) await sleep(150);
  }

  // -------------------------------------------------------------------------
  // Reading folders
  // -------------------------------------------------------------------------

  interface Entry {
    handle: FileSystemFileHandle;
    /** Path inside the granted folder, with `/` separators. */
    relative: string;
    /** The folder it sits in, relative to the granted root. */
    parent: string;
  }

  /**
   * Every file under a granted directory.
   *
   * Breadth-first with an explicit stack rather than recursion: a folder tree
   * thousands deep would otherwise be a stack overflow, and the walk has to be
   * interruptible so pausing indexing does something.
   */
  async function collect(root: FileSystemDirectoryHandle): Promise<Entry[]> {
    const found: Entry[] = [];
    const stack: { handle: FileSystemDirectoryHandle; relative: string }[] = [
      { handle: root, relative: '' },
    ];

    while (stack.length > 0) {
      await waitWhilePaused();
      const next = stack.pop();
      if (!next) break;

      // `for await` over the async iterator is the supported way to enumerate in
      // Chrome; the webkit fallback in some builds wants `entries()`.
      const batch: [string, FileSystemHandle][] = [];
      for await (const entry of next.handle.entries()) batch.push(entry);

      for (const [name, handle] of batch) {
        if (name.startsWith('.') || IGNORED.includes(name)) continue;
        const relative = next.relative ? `${next.relative}/${name}` : name;
        if (handle.kind === 'directory') {
          stack.push({ handle: handle as FileSystemDirectoryHandle, relative });
        } else {
          const parent = relative.includes('/')
            ? relative.slice(0, relative.lastIndexOf('/'))
            : '';
          found.push({ handle: handle as FileSystemFileHandle, relative, parent });
        }
      }
    }

    return found;
  }

  /** One file, turned into a record — with its thumbnail made if it needs one. */
  async function ingest(
    entry: Entry,
    folder: ArchiveFolder,
  ): Promise<{ record: StoredFile; touched: boolean } | null> {
    let file: File;
    try {
      file = await entry.handle.getFile();
    } catch {
      return null;
    }

    const name = file.name;
    const ext = extensionOf(name);
    const kind = classify(name, ext, folder.name);
    const id = `web:${folder.id}:${entry.relative}`;
    const existing = files.get(id);
    const modifiedAt = iso(file.lastModified);
    const displayPath = `${folder.name}/${entry.relative}`;

    const record: ArchiveFile = {
      id,
      name,
      path: displayPath,
      kind,
      ext,
      mime: file.type || MIME[ext] || 'application/octet-stream',
      // Nothing in the browser infers tags, so every tag on a browser-archive
      // file is one the user typed. The field is still populated rather than
      // absent, so the inspector's tag group behaves the same in both builds.
      machineTagIds: [],
      bytes: file.size,
      folderId: folder.id,
      folderPath: `${folder.name}${entry.parent ? `/${entry.parent}` : ''}`,
      createdAt: modifiedAt,
      modifiedAt,
      indexedAt: nowIso(),
      favorite: existing?.file.favorite ?? false,
      tagIds: existing?.file.tagIds ?? [],
      collectionIds: existing?.file.collectionIds ?? [],
      projectId: existing?.file.projectId ?? null,
      generatedTitle: existing?.file.generatedTitle ?? null,
      description: existing?.file.description ?? null,
      labels: existing?.file.labels ?? [],
      ocrState: 'none',
      indexState: 'indexed',
      hash: null,
      thumbPath: thumbKey(id),
      previewPath: previewKey(id),
      embeddingState: 'unavailable',
    };

    // What the browser can measure about a picture, from the picture itself.
    if (RENDERABLE.includes(kind) && IMAGE_EXTS.includes(ext)) {
      const unchanged =
        existing &&
        existing.file.bytes === file.size &&
        existing.file.modifiedAt === modifiedAt &&
        blobs.get(id)?.thumb;
      if (!unchanged) {
        const generated = await generate(file);
        if (generated) {
          record.width = generated.width;
          record.height = generated.height;
          record.description = describe(generated.analysis);
          blobs.set(id, { fileId: id, thumb: generated.thumb, preview: generated.preview });
          rememberUrl(thumbKey(id), generated.thumb);
          rememberUrl(previewKey(id), generated.preview);
        }
      } else {
        const stored = existing?.file;
        if (stored.width) record.width = stored.width;
        if (stored.height) record.height = stored.height;
        if (stored.description) record.description = stored.description;
      }
    }

    // A video tile is worth a frame, and it is the only frame the archive will
    // ever have of it: nothing in a browser can decode one on demand cheaply.
    if (kind === 'video' && !blobs.get(id)?.thumb) {
      const poster = await videoPoster(file);
      if (poster) {
        const held = blobs.get(id) ?? { fileId: id };
        blobs.set(id, { ...held, thumb: poster });
        rememberUrl(thumbKey(id), poster);
      }
    }

    return { record: { file: record, handle: entry.handle }, touched: true };
  }

  /** The one-line description Image DNA shows, measured rather than guessed. */
  function describe(analysis: Analysis | null): string | null {
    if (!analysis) return null;
    const tone =
      analysis.brightness > 0.62 ? 'Bright' : analysis.brightness < 0.32 ? 'Dark' : 'Evenly lit';
    const contrast =
      analysis.contrast > 0.24 ? 'high contrast' : analysis.contrast < 0.1 ? 'low contrast' : 'soft';
    return `${tone} · ${contrast}`;
  }

  /**
   * Walk one granted folder and reconcile it with the archive.
   *
   * Files that are already indexed and untouched are left alone, so a second
   * scan of a large folder is a directory walk and nothing more. Files that have
   * gone are removed, because an archive that keeps showing pictures the user
   * deleted is worse than one that is briefly empty.
   */
  async function indexFolder(folderId: string): Promise<void> {
    const stored = folders.get(folderId);
    if (!stored?.handle) return;

    const handle = stored.handle;
    const granted = await permissionGranted(handle);
    if (!granted) {
      folders.set(folderId, {
        ...stored,
        folder: {
          ...stored.folder,
          status: 'denied',
          problem: 'This browser needs permission to read that folder again. Rescan to grant it.',
        },
      });
      await put('folders', folders.get(folderId));
      emit({ type: 'folders-changed' });
      return;
    }

    walking = true;
    currentFolderName = stored.folder.name;
    folders.set(folderId, { ...stored, folder: { ...stored.folder, status: 'scanning', problem: undefined } });
    emit({ type: 'index-status', status: status() });
    emit({ type: 'folders-changed' });

    try {
      const entries = await collect(handle);
      const seen = new Set<string>();
      const batch: StoredFile[] = [];
      const batchBlobs: StoredBlobs[] = [];
      let processed = 0;

      for (const entry of entries) {
        await waitWhilePaused();
        try {
          const result = await ingest(entry, stored.folder);
          if (!result) continue;
          files.set(result.record.file.id, result.record);
          seen.add(result.record.file.id);
          batch.push(result.record);
          const held = blobs.get(result.record.file.id);
          if (held) batchBlobs.push(held);
        } catch {
          // One unreadable file is one tile missing, never a failed scan.
        }

        processed += 1;
        if (processed % 25 === 0) {
          emit({ type: 'index-status', status: { ...status(), currentFile: entry.relative } });
          await putMany('files', batch.splice(0, batch.length));
          await putMany('blobs', batchBlobs.splice(0, batchBlobs.length));
        }
      }

      await putMany('files', batch);
      await putMany('blobs', batchBlobs);

      // Anything this folder used to hold that the walk did not find is gone.
      const vanished = [...files.values()]
        .filter((entry) => entry.file.folderId === folderId && !seen.has(entry.file.id))
        .map((entry) => entry.file.id);
      for (const id of vanished) {
        files.delete(id);
        blobs.delete(id);
        releaseUrl(thumbKey(id));
        releaseUrl(previewKey(id));
      }
      await removeMany('files', vanished);
      await removeMany('blobs', vanished);

      lastScanAt = nowIso();
      folders.set(folderId, {
        ...stored,
        folder: { ...stored.folder, status: 'ok', problem: undefined, lastScanAt },
      });
      await put('folders', folders.get(folderId));

      log('indexed', `${stored.folder.name} scanned`, `${entries.length} files`, null);
      emit({ type: 'files-changed', reason: 'scan' });
      emit({ type: 'folders-changed' });
      notice('info', `${stored.folder.name}: ${entries.length} files indexed in this browser.`);
      void notify('AfterImage', `${stored.folder.name} is indexed — ${entries.length} files.`);
    } finally {
      walking = false;
      currentFolderName = null;
      emit({ type: 'index-status', status: status() });
    }
  }

  // -------------------------------------------------------------------------
  // Derived views
  // -------------------------------------------------------------------------

  function allFiles(): ArchiveFile[] {
    return [...files.values()].map((entry) => entry.file);
  }

  function refreshCollectionCounts(): void {
    for (const collection of collections.values()) {
      collection.fileCount = 0;
      collection.sizeBytes = 0;
      collection.preview = [];
    }
    for (const entry of files.values()) {
      for (const id of entry.file.collectionIds) {
        const collection = collections.get(id);
        if (!collection) continue;
        collection.fileCount += 1;
        collection.sizeBytes += entry.file.bytes;
        if (collection.preview.length < 4 && entry.file.thumbPath) {
          collection.preview.push(entry.file.thumbPath);
        }
      }
    }
  }

  function refreshTagCounts(): void {
    for (const tag of tags.values()) tag.count = 0;
    for (const entry of files.values()) {
      for (const id of entry.file.tagIds) {
        const tag = tags.get(id);
        if (tag) tag.count += 1;
      }
    }
  }

  function totals(): ArchiveTotals {
    const byKind = { ...EMPTY_BY_KIND };
    const today = new Date().toISOString().slice(0, 10);
    let newToday = 0;
    for (const entry of files.values()) {
      byKind[entry.file.kind] = (byKind[entry.file.kind] ?? 0) + 1;
      if (entry.file.createdAt.slice(0, 10) === today) newToday += 1;
    }
    return { files: files.size, newToday, byKind };
  }

  async function storageStats(): Promise<StorageStats> {
    const byKind: Record<string, number> = {};
    let used = 0;
    for (const entry of files.values()) {
      used += entry.file.bytes;
      byKind[entry.file.kind] = (byKind[entry.file.kind] ?? 0) + entry.file.bytes;
    }

    // The browser will say how much room this origin has been given. That is the
    // only capacity figure a page is allowed to know, and it is the honest
    // denominator for "how much of my storage is this archive".
    let quota = 0;
    try {
      const estimate = await navigator.storage?.estimate?.();
      quota = estimate?.quota ?? 0;
    } catch {
      quota = 0;
    }

    return {
      usedBytes: used,
      totalBytes: quota,
      indexedFiles: files.size,
      pendingFiles: 0,
      failedFiles: 0,
      byKind,
    };
  }

  function addActivity(kind: ActivityEntry['kind'], label: string, detail: string | null, fileId: string | null): void {
    const entry: ActivityEntry = { id: `act-${uuidLike()}`, kind, label, at: nowIso() };
    if (detail) entry.detail = detail;
    if (fileId) entry.fileId = fileId;
    activity = [entry, ...activity].slice(0, 200);
    void put('activity', entry);
  }

  /** Written through as it happens: the archive in memory is not the durable one. */
  function log(kind: ActivityEntry['kind'], label: string, detail: string | null, fileId: string | null): void {
    addActivity(kind, label, detail, fileId);
    emit({ type: 'files-changed', reason: 'metadata' });
  }

  const persistFile = async (file: ArchiveFile) => {
    const held = files.get(file.id);
    files.set(file.id, { file, handle: held?.handle });
    await put('files', files.get(file.id));
  };

  const mutateFile = async (fileId: string, change: (file: ArchiveFile) => void) => {
    const held = files.get(fileId);
    const found = held?.file ?? allFiles().find((file) => file.id === fileId);
    if (!found) throw new Error('that file is not in this archive');
    const next = { ...found, tagIds: [...found.tagIds], collectionIds: [...found.collectionIds] };
    change(next);
    await persistFile(next);
    refreshCollectionCounts();
    refreshTagCounts();
    emit({ type: 'files-changed', reason: 'metadata' });
  };

  // -------------------------------------------------------------------------
  // Retrieval
  // -------------------------------------------------------------------------

  const TOKEN_SPLIT = /[^a-z0-9]+/;

  function normalise(value: string): string[] {
    return value
      .toLowerCase()
      .split(TOKEN_SPLIT)
      .filter((token) => token.length > 0);
  }

  interface ParsedQuery {
    phrases: string[][];
    terms: string[];
    kinds: FileKind[];
    tagNames: string[];
    sinceDays: number | null;
    favoritesOnly: boolean;
  }

  /**
   * The query language, parsed here rather than in Rust.
   *
   * Same surface as the desktop build — `kind:`, `tag:`, `favorite`, `since:7d`,
   * quoted phrases — because a syntax that worked in one build and not the other
   * would be a trap rather than a feature.
   */
  function parse(raw: string): ParsedQuery {
    const parsed: ParsedQuery = {
      phrases: [],
      terms: [],
      kinds: [],
      tagNames: [],
      sinceDays: null,
      favoritesOnly: false,
    };

    const matches = raw.match(/"[^"]*"|\S+/g) ?? [];
    for (const piece of matches) {
      if (piece.startsWith('"') && piece.endsWith('"') && piece.length > 2) {
        const inner = normalise(piece.slice(1, -1));
        if (inner.length > 0) parsed.phrases.push(inner);
        continue;
      }

      const [prefix, value] = piece.includes(':') ? piece.split(/:(.+)/) : ['', piece];
      const lower = prefix.toLowerCase();
      if (value && lower === 'kind') {
        const kind = value.toLowerCase() as FileKind;
        if (kind in EMPTY_BY_KIND) parsed.kinds.push(kind);
        continue;
      }
      if (value && lower === 'tag') {
        parsed.tagNames.push(value.toLowerCase());
        continue;
      }
      if (value && (lower === 'since' || lower === 'after')) {
        const days = Number.parseInt(value.replace(/\D+$/, ''), 10);
        if (Number.isFinite(days) && days > 0) parsed.sinceDays = days;
        continue;
      }
      if (lower === 'person' || lower === 'face') continue; // no faces in a browser
      if (piece.toLowerCase() === 'favorite' || piece.toLowerCase() === 'favourite') {
        parsed.favoritesOnly = true;
        continue;
      }

      parsed.terms.push(...normalise(piece));
    }

    return parsed;
  }

  function scoreOf(file: ArchiveFile, parsed: ParsedQuery): { score: number; match: SearchHit['match'] } | null {
    const haystacks: { text: string; weight: number; match: SearchHit['match'] }[] = [
      { text: file.name, weight: 6, match: 'filename' },
      { text: file.generatedTitle ?? '', weight: 4, match: 'filename' },
      { text: file.description ?? '', weight: 3, match: 'text' },
      { text: file.folderPath, weight: 2.5, match: 'folder' },
      { text: file.labels.join(' '), weight: 2, match: 'text' },
      { text: file.ext, weight: 1, match: 'filename' },
      {
        text: file.tagIds
          .map((id) => tags.get(id)?.name ?? '')
          .join(' '),
        weight: 3,
        match: 'tag',
      },
      {
        text: file.collectionIds
          .map((id) => collections.get(id)?.name ?? '')
          .join(' '),
        weight: 2,
        match: 'collection',
      },
    ];

    // A quoted phrase has to be in one field, in order — the whole point of
    // quoting it. Anything else is per-word.
    for (const phrase of parsed.phrases) {
      const joined = phrase.join(' ');
      const found = haystacks.some((entry) => normalise(entry.text).join(' ').includes(joined));
      if (!found) return null;
    }

    if (parsed.terms.length === 0) {
      // Filters on their own are a legitimate search.
      const best = haystacks.find((entry) => entry.text.length > 0);
      return { score: 1, match: best?.match ?? 'filename' };
    }

    let total = 0;
    let bestMatch: SearchHit['match'] = 'filename';
    let hitAny = false;

    for (const term of parsed.terms) {
      let termScore = 0;
      for (const entry of haystacks) {
        if (!entry.text) continue;
        const tokens = normalise(entry.text);
        const exact = tokens.includes(term);
        // Prefixes, so a search works while it is still being typed.
        const prefix = !exact && tokens.some((token) => token.startsWith(term));
        if (exact) termScore = Math.max(termScore, entry.weight * 2);
        else if (prefix) termScore = Math.max(termScore, entry.weight);
        else if (term.length >= 3 && normalise(entry.text).join(' ').includes(term)) {
          termScore = Math.max(termScore, entry.weight * 0.4);
        }
        if (termScore > 0) bestMatch = entry.match;
      }
      if (termScore === 0) continue;
      hitAny = true;
      total += termScore;
    }

    if (!hitAny) return null;

    // Newer is better when the text says nothing to choose between two files.
    const age = Date.now() - Date.parse(file.createdAt || file.modifiedAt);
    const recency = Number.isFinite(age) ? Math.max(0, 0.6 - age / (1000 * 60 * 60 * 24 * 365 * 4)) : 0;
    return { score: total + recency, match: bestMatch };
  }

  async function search(query: SearchQuery): Promise<SearchResponse> {
    await load();
    const parsed = parse(query.raw ?? '');
    const kinds = query.kind ? [query.kind] : parsed.kinds;
    const tagIds = new Set(query.tagIds ?? []);
    const since = query.sinceDays ?? parsed.sinceDays;
    const cutoff = since ? Date.now() - since * 86_400_000 : null;

    const hits: SearchHit[] = [];
    for (const file of allFiles()) {
      if (kinds.length > 0 && !kinds.includes(file.kind)) continue;
      if (query.collectionId && !file.collectionIds.includes(query.collectionId)) continue;
      if (query.projectId && file.projectId !== query.projectId) continue;
      if (query.folderId && file.folderId !== query.folderId) continue;
      if (query.favoritesOnly || parsed.favoritesOnly) {
        if (!file.favorite) continue;
      }
      if (tagIds.size > 0 && !file.tagIds.some((id) => tagIds.has(id))) continue;
      if (parsed.tagNames.length > 0) {
        const names = file.tagIds.map((id) => (tags.get(id)?.name ?? '').toLowerCase());
        if (!parsed.tagNames.every((wanted) => names.some((name) => name.startsWith(wanted)))) continue;
      }
      if (cutoff && Date.parse(file.createdAt) < cutoff) continue;

      const scored = scoreOf(file, parsed);
      if (!scored) continue;
      hits.push({ file, score: scored.score, match: scored.match, semantic: false });
    }

    hits.sort((a, b) => b.score - a.score || b.file.createdAt.localeCompare(a.file.createdAt));

    const interpretation: QueryInterpretation = {
      terms: parsed.terms,
      kinds,
      tags: parsed.tagNames,
      summary: summarise(parsed, hits.length),
      refinedByModel: false,
    };
    if (since) interpretation.sinceDays = since;
    if (parsed.favoritesOnly) interpretation.favoritesOnly = true;

    return {
      hits: hits.slice(0, 200),
      total: hits.length,
      interpretation,
      semanticAvailable: false,
      error: null,
    };
  }

  function summarise(parsed: ParsedQuery, found: number): string {
    const parts: string[] = [];
    if (parsed.terms.length > 0) parts.push(parsed.terms.join(' '));
    if (parsed.phrases.length > 0) parts.push(parsed.phrases.map((phrase) => `"${phrase.join(' ')}"`).join(' '));
    if (parsed.kinds.length > 0) parts.push(`kind: ${parsed.kinds.join(', ')}`);
    if (parsed.tagNames.length > 0) parts.push(`tagged ${parsed.tagNames.join(', ')}`);
    if (parsed.sinceDays) parts.push(`in the last ${parsed.sinceDays} days`);
    if (parsed.favoritesOnly) parts.push('favourites only');
    if (parts.length === 0) return `${found} files in this browser's archive`;
    return `${found} for ${parts.join(' · ')}`;
  }

  // -------------------------------------------------------------------------
  // The host
  // -------------------------------------------------------------------------

  return {
    name: 'web',
    capabilities: CAPABILITIES,

    async snapshot(): Promise<ArchiveSnapshot> {
      await load();
      refreshCollectionCounts();
      refreshTagCounts();
      const all = allFiles();
      return {
        folders: [...folders.values()].map((entry) => ({
          ...entry.folder,
          fileCount: all.filter((file) => file.folderId === entry.folder.id).length,
          sizeBytes: all
            .filter((file) => file.folderId === entry.folder.id)
            .reduce((total, file) => total + file.bytes, 0),
        })),
        totals: totals(),
        storage: await storageStats(),
        tags: [...tags.values()].sort((a, b) => a.name.localeCompare(b.name)),
        collections: [...collections.values()].sort((a, b) => a.name.localeCompare(b.name)),
        projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)),
        activity: activity.slice(0, 40),
        recent: all
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 24),
        index: status(),
      };
    },

    async heroImage(): Promise<ArchiveFile | null> {
      await load();
      const candidates = allFiles()
        .filter((file) => RENDERABLE.includes(file.kind) && file.previewPath)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return candidates[0] ?? null;
    },

    /** A page never learns who the operating system says the user is. */
    identity: async () => null,

    async files(query: FileQuery): Promise<FilePage> {
      await load();
      let matched = allFiles();

      if (query.kinds && query.kinds.length > 0) {
        matched = matched.filter((file) => query.kinds?.includes(file.kind));
      }
      if (query.folderId) matched = matched.filter((file) => file.folderId === query.folderId);
      if (query.collectionId) {
        const collectionId = query.collectionId;
        matched = matched.filter((file) => file.collectionIds.includes(collectionId));
      }
      if (query.tagId) matched = matched.filter((file) => file.tagIds.includes(query.tagId as string));
      if (query.projectId) matched = matched.filter((file) => file.projectId === query.projectId);
      if (query.favoritesOnly) matched = matched.filter((file) => file.favorite);
      if (query.sinceDays) {
        const cutoff = Date.now() - query.sinceDays * 86_400_000;
        matched = matched.filter((file) => Date.parse(file.createdAt) >= cutoff);
      }

      const sort = query.sort ?? 'recent';
      matched.sort((a, b) => {
        switch (sort) {
          case 'oldest':
            return a.createdAt.localeCompare(b.createdAt);
          case 'name':
            return a.name.localeCompare(b.name, undefined, { numeric: true });
          case 'size':
            return b.bytes - a.bytes;
          case 'kind':
            return a.kind.localeCompare(b.kind) || b.createdAt.localeCompare(a.createdAt);
          case 'recent':
          default:
            return b.createdAt.localeCompare(a.createdAt);
        }
      });

      const offset = query.offset ?? 0;
      const limit = query.limit ?? 120;
      const page = matched.slice(offset, offset + limit);
      return { files: page, total: matched.length, hasMore: offset + page.length < matched.length };
    },

    async filesByIds(ids: string[]): Promise<ArchiveFile[]> {
      await load();
      return ids.map((id) => files.get(id)?.file).filter((file): file is ArchiveFile => Boolean(file));
    },

    storageStats,

    async indexStatus(): Promise<IndexStatus> {
      return status();
    },

    async addFolder(): Promise<ArchiveFolder | null> {
      return pickAndIndex();
    },

    async chooseFolders(): Promise<string[]> {
      const picked = await pickAndIndex();
      if (!picked) return [];
      // The onboarding flow passes these back to `addFolderPath`, which finds
      // them here rather than walking a path it was never given.
      pending.set(picked.name, picked);
      return [picked.name];
    },

    async addFolderPath(path: string): Promise<ArchiveFolder | null> {
      await load();
      const held = pending.get(path);
      if (held) {
        pending.delete(path);
        return held;
      }
      // A folder might already be registered under this name — a reload, or a
      // second visit — in which case asking for permission again is the work.
      const existing = [...folders.values()].find((entry) => entry.folder.name === path);
      if (existing) {
        void indexFolder(existing.folder.id);
        return existing.folder;
      }

      notice(
        'warn',
        'A web page cannot open a folder by typing its path — use the folder picker, or drop the folder onto the window.',
      );
      return null;
    },

    async removeFolder(folderId: string): Promise<void> {
      await load();
      const stored = folders.get(folderId);
      folders.delete(folderId);
      await remove('folders', folderId);

      const doomed = [...files.values()]
        .filter((entry) => entry.file.folderId === folderId)
        .map((entry) => entry.file.id);
      for (const id of doomed) {
        files.delete(id);
        blobs.delete(id);
        releaseUrl(thumbKey(id));
        releaseUrl(previewKey(id));
      }
      await removeMany('files', doomed);
      await removeMany('blobs', doomed);

      if (stored) log('folder-removed', 'Folder removed from the archive', stored.folder.path, null);
      emit({ type: 'folders-changed' });
      emit({ type: 'files-changed', reason: 'delete' });
    },

    async rescanFolder(folderId: string): Promise<void> {
      await load();
      // Called from a click, which is the gesture the permission prompt needs.
      await indexFolder(folderId);
    },

    async updatePreferences(next: HostPreferences): Promise<void> {
      preferences = { ...preferences, ...next };
      await put('meta', preferences, 'preferences');
    },

    async pauseIndexing(): Promise<void> {
      paused = true;
      emit({ type: 'index-status', status: status() });
    },

    async resumeIndexing(): Promise<void> {
      paused = false;
      emit({ type: 'index-status', status: status() });
    },

    /** Nothing queues here, so there is nothing to clear. */
    clearFailures: async (): Promise<void> => undefined,

    // ---- people --------------------------------------------------------- //
    // Face grouping runs the local models in the desktop build's indexer. A
    // browser has no such model, and inventing groups of faces would be worse
    // than saying so.
    people: async (): Promise<PeopleSnapshot> => ({
      people: [],
      stats: { people: 0, faces: 0, unnamed: 0, photos: 0 },
      available: false,
      reason: 'Face grouping needs the desktop build, where the models run on your own photographs.',
    }),

    person: async (): Promise<Person | null> => null,
    fileFaces: async (): Promise<FileFace[]> => [],
    renamePerson: () => refuse('Naming people'),
    mergePeople: () => refuse('Merging people'),
    setPersonHidden: () => refuse('Hiding people'),
    forgetPerson: () => refuse('Deleting a person'),
    regroupPeople: () => refuse('Regrouping faces'),
    scanFaces: () => refuse('Looking for faces'),

    modelStatus: async (): Promise<ModelStatus> => ({
      bundles: [],
      available: false,
      missingMegabytes: 0,
      reason: 'The local models and the indexing service live in the desktop build.',
      canStart: false,
      onBattery: false,
    }),

    installModels: () => refuse('Downloading models'),
    startService: () => refuse('Starting the indexer'),
    // Tags and context are derived in the browser build too — from the filename,
    // the file's own bytes and any text pulled out of it — so this is a real
    // count rather than a stub. What a browser cannot do is run the vision
    // models, and the settings screen says so.
    analyzeLibrary: async () => 0,
    analysisStatus: async (): Promise<AnalysisStatus> => ({
      analysed: 0,
      total: 0,
      remaining: 0,
      tags: 0,
    }),
    mediaPages: () =>
      refuse('Laying out document pages — the browser build has no PDF renderer'),

    async buildInfo(): Promise<BuildInfo> {
      const records = await footprint();
      return {
        version: __BUILD_VERSION__,
        builtAt: __BUILD_TIME__,
        dataDir: 'this browser\\u2019s storage (IndexedDB)',
        thumbnailsDir: 'this browser\\u2019s storage (IndexedDB)',
        database: `IndexedDB · ${records.records} records`,
        bundledIndexer: false,
        onBattery: false,
      };
    },

    /**
     * Hand the viewer the file itself.
     *
     * Images, video, audio and PDFs all render from a blob URL the page owns, so
     * a video plays and a PDF is laid out with no server and no copy.
     */
    async grantFileAccess(fileId: string): Promise<string> {
      await load();
      const held = files.get(fileId);
      if (!held?.handle) throw new Error('That file is not in this browser\u2019s archive.');
      const file = await held.handle.getFile();
      return rememberUrl(originalKey(fileId), file);
    },

    async imageDna(fileId: string): Promise<ImageDna> {
      await load();
      const held = files.get(fileId);
      if (!held) throw new Error('That file is not in this browser\u2019s archive.');
      const file = held.file;

      const dna: ImageDna = {
        fileId,
        format: (file.ext || 'file').toUpperCase(),
        bytes: file.bytes,
        createdAt: file.createdAt,
        modifiedAt: file.modifiedAt,
        decoded: false,
        palette: [],
        objects: [],
      };
      if (file.width && file.height) dna.width = file.width;
      if (file.height) dna.height = file.height;
      if (file.width && file.height) {
        dna.aspect = Math.round((file.width / file.height) * 100) / 100;
        dna.orientation =
          file.width > file.height ? 'landscape' : file.width < file.height ? 'portrait' : 'square';
      }

      // The measurements come from the pixels the thumbnail was made from, which
      // this browser already holds — measuring the original again would decode a
      // 12 megapixel file to learn the same palette.
      const preview = blobs.get(fileId)?.preview;
      if (!preview) {
        dna.reason = IMAGE_EXTS.includes(file.ext)
          ? 'This picture could not be decoded in this browser'
          : 'Image DNA is measured from pictures';
        return dna;
      }

      const analysis = await analyse(preview);
      if (!analysis) {
        dna.reason = 'This picture could not be decoded in this browser';
        return dna;
      }

      dna.decoded = true;
      dna.palette = analysis.palette;
      dna.brightness = analysis.brightness;
      dna.contrast = analysis.contrast;
      dna.sharpness = analysis.sharpness;
      dna.saturation = analysis.saturation;
      dna.temperatureShift = analysis.temperatureShift;
      dna.temperature = analysis.temperature;
      return dna;
    },

    versions: async (fileId: string): Promise<FileVersion[]> => {
      await load();
      return (kept.get(fileId) ?? [])
        .slice()
        .sort((a, b) => b.contentAt.localeCompare(a.contentAt))
        .map(({ blob: _blob, ...record }) => record);
    },

    /**
     * Keep what the file looks like now.
     *
     * This is the browser's equivalent of the pipeline noticing an edit: the
     * archive cannot see the disk change, so the user says "this is the before"
     * and the comparison has something real to divide.
     */
    async captureVersion(fileId: string): Promise<FileVersion> {
      await load();
      const held = files.get(fileId);
      if (!held) throw new Error('That file is not in this browser\u2019s archive.');
      const source = blobs.get(fileId)?.preview ?? blobs.get(fileId)?.thumb;
      if (!source) throw new Error('There is nothing to keep a copy of for this file yet.');

      const versionId = `ver-${uuidLike()}`;
      const record: FileVersion = {
        id: versionId,
        fileId,
        path: versionKey(versionId),
        bytes: source.size,
        width: held.file.width,
        height: held.file.height,
        capturedAt: nowIso(),
        contentAt: held.file.modifiedAt,
        source: 'manual',
      };
      rememberUrl(record.path, source);
      const stored: StoredVersion = { ...record, blob: source };
      const list = kept.get(fileId) ?? [];
      list.push(stored);
      kept.set(fileId, list);
      await put('versions', stored);
      log('indexed', 'Kept a copy to compare against', held.file.name, fileId);
      return record;
    },

    async deleteVersion(versionId: string): Promise<void> {
      await load();
      for (const [fileId, list] of kept) {
        const found = list.find((entry) => entry.id === versionId);
        if (!found) continue;
        kept.set(
          fileId,
          list.filter((entry) => entry.id !== versionId),
        );
        releaseUrl(found.path);
        await remove('versions', versionId);
        emit({ type: 'files-changed', reason: 'metadata' });
        return;
      }
    },

    search,

    similar: async (): Promise<SearchHit[]> => [],
    related: async (fileId: string, limit = 12): Promise<SearchHit[]> => {
      await load();
      const held = files.get(fileId);
      if (!held) return [];
      const source = held.file;
      const scored: SearchHit[] = [];

      for (const entry of files.values()) {
        const file = entry.file;
        if (file.id === fileId) continue;
        let score = 0;
        const sharedTags = file.tagIds.filter((id) => source.tagIds.includes(id)).length;
        score += sharedTags * 2;
        if (file.collectionIds.some((id) => source.collectionIds.includes(id))) score += 1.5;
        if (file.folderId === source.folderId) score += 0.75;
        if (file.kind === source.kind) score += 0.4;
        if (score > 0) scored.push({ file, score, match: 'tag', semantic: false });
      }

      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    },

    // ---- metadata ------------------------------------------------------- //
    setFavorite: (fileId, value) =>
      mutateFile(fileId, (file) => {
        file.favorite = value;
      }),

    async addTag(fileId, name): Promise<Tag> {
      await load();
      const clean = name.trim();
      if (!clean) throw new Error('a tag needs a name');
      let tag = [...tags.values()].find((entry) => entry.name.toLowerCase() === clean.toLowerCase());
      if (!tag) {
        tag = { id: `tag-${slug(clean) || uuidLike()}`, name: clean, count: 0 };
        tags.set(tag.id, tag);
        await put('tags', tag);
      }
      await mutateFile(fileId, (file) => {
        if (!file.tagIds.includes(tag?.id as string)) file.tagIds.push(tag?.id as string);
      });
      refreshTagCounts();
      log('tagged', `Tagged with ${clean}`, null, fileId);
      return tags.get(tag.id) as Tag;
    },

    async removeTag(fileId, tagId): Promise<void> {
      await load();
      await mutateFile(fileId, (file) => {
        file.tagIds = file.tagIds.filter((id) => id !== tagId);
      });
      refreshTagCounts();
    },

    async createCollection(name): Promise<ArchiveCollection> {
      await load();
      const clean = name.trim();
      if (!clean) throw new Error('a collection needs a name');
      if ([...collections.values()].some((entry) => entry.name.toLowerCase() === clean.toLowerCase())) {
        throw new Error(`${clean} already exists`);
      }
      const collection: ArchiveCollection = {
        id: `col-${uuidLike()}`,
        name: clean,
        kind: 'manual',
        fileCount: 0,
        sizeBytes: 0,
        surface: SURFACES[collections.size % SURFACES.length],
        icon: 'Layers',
        preview: [],
      };
      collections.set(collection.id, collection);
      await put('collections', collection);
      log('collection', `Collection created: ${clean}`, null, null);
      return collection;
    },

    async renameCollection(collectionId, name): Promise<void> {
      await load();
      const clean = name.trim();
      if (!clean) throw new Error('a collection needs a name');
      const collection = collections.get(collectionId);
      if (!collection) throw new Error('that collection is not here');
      if (
        [...collections.values()].some(
          (entry) => entry.id !== collectionId && entry.name.toLowerCase() === clean.toLowerCase(),
        )
      ) {
        throw new Error(`${clean} already exists`);
      }
      collection.name = clean;
      await put('collections', collection);
      log('collection', `Collection renamed to ${clean}`, null, null);
    },

    async deleteCollection(collectionId): Promise<void> {
      await load();
      const collection = collections.get(collectionId);
      collections.delete(collectionId);
      await remove('collections', collectionId);
      for (const entry of files.values()) {
        if (!entry.file.collectionIds.includes(collectionId)) continue;
        const next = { ...entry.file, collectionIds: entry.file.collectionIds.filter((id) => id !== collectionId) };
        files.set(entry.file.id, { ...entry, file: next });
        await put('files', files.get(entry.file.id));
      }
      refreshCollectionCounts();
      if (collection) log('collection', `Collection deleted: ${collection.name}`, null, null);
    },

    async addToCollection(fileId, collectionId): Promise<void> {
      await load();
      await mutateFile(fileId, (file) => {
        if (!file.collectionIds.includes(collectionId)) file.collectionIds.push(collectionId);
      });
      const collection = collections.get(collectionId);
      if (collection) log('collection', `Added to ${collection.name}`, null, fileId);
    },

    async removeFromCollection(fileId, collectionId): Promise<void> {
      await load();
      await mutateFile(fileId, (file) => {
        file.collectionIds = file.collectionIds.filter((id) => id !== collectionId);
      });
    },

    async createProject(name): Promise<Project> {
      await load();
      const clean = name.trim();
      if (!clean) throw new Error('a project needs a name');
      const project: Project = {
        id: `prj-${uuidLike()}`,
        name: clean,
        fileCount: 0,
        color: 'var(--af-blue-ink)',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      projects.set(project.id, project);
      await put('projects', project);
      log('project', `Project created: ${clean}`, null, null);
      return project;
    },

    async deleteProject(projectId): Promise<void> {
      await load();
      projects.delete(projectId);
      await remove('projects', projectId);
      for (const entry of files.values()) {
        if (entry.file.projectId !== projectId) continue;
        const next = { ...entry.file, projectId: null };
        files.set(entry.file.id, { ...entry, file: next });
        await put('files', files.get(entry.file.id));
      }
    },

    async setFileProject(fileId, projectId): Promise<void> {
      await load();
      await mutateFile(fileId, (file) => {
        file.projectId = projectId;
      });
    },

    tags: async (): Promise<Tag[]> => {
      await load();
      refreshTagCounts();
      return [...tags.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    collections: async (): Promise<ArchiveCollection[]> => {
      await load();
      refreshCollectionCounts();
      return [...collections.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    projects: async (): Promise<Project[]> => {
      await load();
      return [...projects.values()].sort((a, b) => a.name.localeCompare(b.name));
    },

    activity: async (limit = 40): Promise<ActivityEntry[]> => {
      await load();
      return activity.slice(0, limit);
    },

    // ---- what only the desktop build can do ------------------------------ //
    openFile: () => refuse('Opening files'),
    openWith: () => refuse('Opening files with another app'),
    revealFile: () => refuse('Revealing files in the file manager'),
    moveToTrash: () => refuse('Deleting files'),
    renameFile: () => refuse('Renaming files on disk'),

    pickOrganizeDestination: () => refuse('Choosing a folder to file files into'),

    async organizePlan(): Promise<OrganizePlan> {
      await load();
      // The plan is genuinely empty rather than refused: a browser can compute
      // where files would go, it just cannot move them, and showing an empty
      // plan is more honest than an error about a feature that is not here.
      return { root: '', moves: [], skipped: [], settled: 0, folders: [], totalBytes: 0 };
    },

    organizeApply: () => refuse('Reorganizing files on disk'),

    assetUrl(path: string): string {
      if (!path) return '';
      // A blob URL is already the final address; so is a data URL.
      if (path.startsWith('blob:') || path.startsWith('data:')) return path;
      return urlFor(path) ?? '';
    },

    notify,

    subscribe(listener: HostListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      listeners.clear();
    },
  };

  // -------------------------------------------------------------------------
  // Folder pickers
  // -------------------------------------------------------------------------

  /**
   * Ask for a folder, register it, and start reading it.
   *
   * The picker has to be called from a click — browsers require the gesture —
   * which is why this is only ever reached from a button.
   */
  async function pickAndIndex(): Promise<ArchiveFolder | null> {
    await load();
    const picker = (
      window as unknown as {
        showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker) {
      notice(
        'warn',
        'This browser cannot open folders from a page. Chrome, Edge or another Chromium browser can.',
      );
      return null;
    }

    let handle: FileSystemDirectoryHandle;
    try {
      handle = await picker({ id: 'afterimage-archive', mode: 'read' });
    } catch {
      return null; // the user closed the picker
    }

    const existing = [...folders.values()].find((entry) => entry.folder.name === handle.name);
    const folder: ArchiveFolder = existing
      ? { ...existing.folder, status: 'ok' }
      : {
          id: `fld-${uuidLike()}`,
          path: handle.name,
          name: handle.name,
          watched: true,
          fileCount: 0,
          sizeBytes: 0,
          lastScanAt: null,
          status: 'ok',
        };

    folders.set(folder.id, { folder, handle });
    await put('folders', folders.get(folder.id));
    emit({ type: 'folders-changed' });
    addActivity('folder-added', 'Folder added to this browser\u2019s archive', handle.name, null);

    // Index in the background: a folder of ten thousand photographs must not
    // freeze the window that just asked for it.
    void indexFolder(folder.id);
    return folder;
  }
}

/**
 * Measure an already-generated copy.
 *
 * Image DNA asks for pixels; the archive already holds a 1600px presentation
 * copy of every picture it indexed, so that is what gets measured. Decoding the
 * original again would cost a second of CPU to learn the same palette.
 */
async function analyse(blob: Blob): Promise<
  | (Analysis & { temperature: 'warm' | 'neutral' | 'cool' })
  | null
> {
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return null;

  try {
    const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const analysis = measurePixels(context.getImageData(0, 0, width, height));
    if (!analysis) return null;
    return { ...analysis, temperature: temperatureOf(analysis.temperatureShift) };
  } finally {
    bitmap.close();
  }
}

/** Wipe everything this browser stored: records, thumbnails, kept copies. */
export async function clearWebArchive(): Promise<void> {
  await clearAll();
  releaseAll();
}
