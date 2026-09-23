/**
 * Domain model for AfterImage.
 *
 * These shapes are the contract between the React renderer, the Tauri/Rust
 * layer and the local Python indexing service. Every field is serialisable, so
 * the same vocabulary travels across the IPC boundary unchanged — and every
 * one of them is derived from a real file on disk. Nothing here is sample data.
 */

/** Broad bucket a file falls into. Drives navigation, stats and thumbnailing. */
export type FileKind =
  | 'photo'
  | 'screenshot'
  | 'document'
  | 'video'
  | 'audio'
  | 'design'
  | 'archive'
  | 'other';

/** Where a file sits in the local processing pipeline. */
export type IndexState =
  | 'pending'
  | 'processing'
  | 'indexed'
  | 'failed'
  /** Format the archive index deliberately does not process. */
  | 'unsupported'
  /** The file was in the index but is no longer on disk. */
  | 'missing';

/** Outcome of the text-extraction step, tracked separately from indexing. */
export type TextState = 'none' | 'pending' | 'extracted' | 'unavailable' | 'failed';

/** A folder the user has granted AfterImage access to. */
export interface ArchiveFolder {
  id: string;
  path: string;
  name: string;
  /** Watched folders are rescanned continuously by the Rust watcher. */
  watched: boolean;
  fileCount: number;
  sizeBytes: number;
  lastScanAt: string | null;
  status: 'ok' | 'missing' | 'denied' | 'scanning';
  /** Why the folder is not usable, when it is not. */
  problem?: string;
}

export interface ArchiveFile {
  id: string;
  name: string;
  /** Absolute path on this machine. Never rewritten by AfterImage. */
  path: string;
  kind: FileKind;
  ext: string;
  mime: string;
  bytes: number;
  /** Pixels, for images and video. */
  width?: number;
  height?: number;
  /** Seconds, for video and audio. */
  durationSec?: number;
  /** Page count, for documents. */
  pages?: number;
  folderId: string;
  folderPath: string;
  createdAt: string;
  modifiedAt: string;
  indexedAt: string;
  favorite: boolean;
  tagIds: string[];
  collectionIds: string[];
  projectId: string | null;
  /** Absolute path to the generated thumbnail, when one exists. */
  thumbPath: string | null;
  /**
   * Larger derivative of the same picture, written for the hero panel. Only
   * image-like files have one; it is always generated from the user's own file.
   */
  previewPath?: string | null;
  /**
   * Title derived from the file's own content by the local vision model —
   * searchable metadata only. The file on disk keeps its original name.
   */
  generatedTitle: string | null;
  description: string | null;
  /** Visual labels with confidence above the configured floor. */
  labels: string[];
  /** Text recovered by OCR or a document text layer. */
  ocrText?: string;
  ocrConfidence?: number;
  ocrState: TextState;
  /** Which engine produced the text: "paddleocr", "pdf-text", … */
  ocrEngine?: string;
  indexState: IndexState;
  /** Content hash, used to skip reprocessing unchanged files. */
  hash: string | null;
  /** Set when the local models could not produce an embedding. */
  embeddingState?: 'none' | 'indexed' | 'unavailable' | 'failed';
}

export interface Tag {
  id: string;
  name: string;
  /** How many files carry the tag; kept on the tag for cheap rendering. */
  count: number;
  pinned?: boolean;
}

// ---------------------------------------------------------------------------
// Image DNA
// ---------------------------------------------------------------------------

/** One colour that actually covers part of a picture. */
export interface DnaColor {
  hex: string;
  red: number;
  green: number;
  blue: number;
  /** Share of the analysed pixels this colour accounts for, 0..1. */
  share: number;
}

/**
 * What this machine can say about one picture.
 *
 * The first group is what the scan read from the file; the second is what was
 * measured in the pixels on demand. A field that could not be determined is
 * absent, and the view omits the row rather than printing a plausible number.
 */
export interface ImageDna {
  fileId: string;
  width?: number;
  height?: number;
  /** Width ÷ height, to two decimals. */
  aspect?: number;
  orientation?: 'landscape' | 'portrait' | 'square';
  format: string;
  bytes: number;
  createdAt: string;
  modifiedAt: string;
  /** False when the pixels could not be read here. */
  decoded: boolean;
  /** Why the pixels are missing, or which picture they came from. */
  reason?: string;
  palette: DnaColor[];
  /** Mean luma, 0..1. */
  brightness?: number;
  /** Standard deviation of luma, 0..1. */
  contrast?: number;
  /** Edge energy, normalised 0..1. */
  sharpness?: number;
  /** Mean chroma, 0..1. */
  saturation?: number;
  temperature?: 'warm' | 'neutral' | 'cool';
  /** Red minus blue, -1..1. */
  temperatureShift?: number;
  /** Labels the local vision model put on the picture; empty without one. */
  objects: string[];
}

// ---------------------------------------------------------------------------
// Kept versions
// ---------------------------------------------------------------------------

/**
 * One kept copy of a picture, for before/after comparison.
 *
 * A version is the archive's own presentation copy, taken the moment the
 * pipeline notices the file on disk has changed — not a second copy of the
 * original photograph.
 */
export interface FileVersion {
  id: string;
  fileId: string;
  /** Absolute path inside the thumbnail directory, which is what the viewer may load. */
  path: string;
  bytes: number;
  width?: number;
  height?: number;
  /** When the copy was taken. */
  capturedAt: string;
  /** The modification time of the content this copy shows. */
  contentAt: string;
  /** `change` (the file changed on disk) or `manual`. */
  source: 'change' | 'manual';
}

/**
 * Filing the archive's own structure onto the disk.
 *
 * The plan is what makes this safe to offer: it says, file by file, where a
 * picture is now and where it would go, before anything moves. Skipped entries
 * carry the reason they are being left alone, which is always more useful than
 * a count.
 */
export interface OrganizeMove {
  fileId: string;
  name: string;
  from: string;
  to: string;
  kind: FileKind;
  /** The folder inside the kind folder: a collection, a person, or `Unfiled`. */
  group: string;
  /** How many collections the file is in, when more than the one chosen. */
  collections: number;
  bytes: number;
}

export interface OrganizeSkip {
  fileId: string;
  name: string;
  from: string;
  reason: string;
}

export interface OrganizePlan {
  root: string;
  moves: OrganizeMove[];
  skipped: OrganizeSkip[];
  /** Files already exactly where the plan would put them. */
  settled: number;
  /** Folders that will be created, relative to the destination. */
  folders: string[];
  totalBytes: number;
}

export interface OrganizeReport {
  moved: number;
  skipped: OrganizeSkip[];
  failed: OrganizeSkip[];
  folders: string[];
  plan: OrganizePlan;
}

export interface ArchiveCollection {
  id: string;
  name: string;
  /** Smart collections resolve their contents from a rule instead of a list. */
  kind: 'manual' | 'smart';
  fileCount: number;
  sizeBytes: number;
  surface: SurfaceTone;
  icon: string;
  rule?: CollectionRule;
  /** Real thumbnail paths for the collage, taken from the collection's files. */
  preview: string[];
}

export type SurfaceTone = 'mint' | 'lavender' | 'peach' | 'blue' | 'neutral';

export interface CollectionRule {
  query?: string;
  kinds?: FileKind[];
  tags?: string[];
  /** Rolling window in days. */
  days?: number;
  favoritesOnly?: boolean;
}

export interface Project {
  id: string;
  name: string;
  fileCount: number;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export type ActivityKind =
  | 'folder-added'
  | 'folder-removed'
  | 'folder-missing'
  | 'indexed'
  | 'tagged'
  | 'project'
  | 'collection'
  | 'favorite'
  | 'deleted'
  | 'failed'
  | 'text-extracted';

export interface ActivityEntry {
  id: string;
  kind: ActivityKind;
  label: string;
  detail?: string;
  at: string;
  fileId?: string;
}

export interface StorageStats {
  /** Bytes actually indexed, summed from the database. */
  usedBytes: number;
  /** Capacity of the volume holding the archive, from the OS. */
  totalBytes: number;
  indexedFiles: number;
  pendingFiles: number;
  failedFiles: number;
  /** Bytes per kind, used by the settings breakdown. */
  byKind: Record<string, number>;
}

export interface ArchiveTotals {
  files: number;
  newToday: number;
  byKind: Record<FileKind, number>;
}

/** Live state of the indexing queue, reported by the Rust pipeline. */
export interface IndexStatus {
  state: 'idle' | 'scanning' | 'indexing' | 'paused' | 'error';
  /** Files waiting to be processed. */
  pending: number;
  processing: number;
  done: number;
  failed: number;
  total: number;
  /** Files per minute, measured over the last window. */
  perMinute: number;
  currentFile: string | null;
  currentFolder: string | null;
  lastScanAt: string | null;
  /** Set when the pipeline stopped for a reason worth telling the user about. */
  problem: string | null;
}

/**
 * A parsed, structured search intent.
 *
 * Parsing happens in Rust so the retrieval path has one definition of what a
 * query means; the renderer sends the raw string plus any filters the user set
 * in the UI.
 */
export interface SearchQuery {
  raw: string;
  kind?: FileKind;
  tagIds?: string[];
  collectionId?: string;
  projectId?: string;
  favoritesOnly?: boolean;
  sinceDays?: number;
  folderId?: string;
}

/** What the retrieval layer understood, echoed back for the results header. */
export interface QueryInterpretation {
  terms: string[];
  kinds: FileKind[];
  tags: string[];
  sinceDays?: number;
  favoritesOnly?: boolean;
  /** Human-readable summary of the parsed intent. */
  summary: string;
  /** True when a local model rewrote the query rather than the rules parser. */
  refinedByModel: boolean;
}

export interface SearchHit {
  file: ArchiveFile;
  score: number;
  /** Which index produced the hit — surfaced subtly in the results list. */
  match: 'filename' | 'text' | 'tag' | 'folder' | 'project' | 'collection' | 'semantic';
  snippet?: string;
  /** True when only the vector index found it. */
  semantic: boolean;
}

export interface SearchResponse {
  hits: SearchHit[];
  /** Total rows the query matched, which may exceed the returned page. */
  total: number;
  interpretation: QueryInterpretation;
  /** False when no embedding model is installed. */
  semanticAvailable: boolean;
  /** Set when retrieval failed; the UI shows the reason instead of empty results. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * A group of faces the index believes is one person — believed, never asserted.
 *
 * `label` is whatever the user typed and nothing else. There is no generated
 * name here on purpose: a wrong name on a face is worse than a blank one,
 * because only one of the two is obviously wrong to look at.
 */
export interface Person {
  id: string;
  label?: string;
  /** Faces detected in this group. */
  faceCount: number;
  /** Distinct photographs containing them — the number worth showing. */
  fileCount: number;
  hidden: boolean;
  /** Absolute paths of up to four face crops, best first. */
  samples: string[];
  coverPath?: string;
  /**
   * When the newest photograph in this group was taken — the only date that
   * means anything for a person, and what the timeline view orders by.
   */
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** One detected face in one file. */
export interface FileFace {
  id: string;
  personId?: string;
  /** Pixels, in the image's own coordinates. */
  left: number;
  top: number;
  width: number;
  height: number;
  score: number;
  quality: number;
  cropPath?: string;
  label?: string;
  /** The group was hidden, so this face links nowhere. */
  personHidden: boolean;
}

export interface PeopleStats {
  people: number;
  faces: number;
  /** Groups nobody has named yet — the work the user actually has to do. */
  unnamed: number;
  photos: number;
}

export interface PeopleSnapshot {
  people: Person[];
  stats: PeopleStats;
  /** False when the face models are not installed; a supported way to run. */
  available: boolean;
  reason?: string;
}

/** One downloadable model bundle, with the cost of not having it. */
export interface ModelBundle {
  name: string;
  ready: boolean;
  megabytes: number;
}

export interface ModelStatus {
  bundles: ModelBundle[];
  /** False when the indexing service is not answering at all. */
  available: boolean;
  missingMegabytes: number;
  directory?: string;
  reason?: string;
  /**
   * True when an indexer exists on this machine but is not running yet — the
   * difference between something to start and something to install.
   */
  canStart: boolean;
  /** True while this machine is drawing from its battery. */
  onBattery: boolean;
}

/**
 * Which build is installed, read from the running binary.
 *
 * Two installers of AfterImage look identical in the window, so the only way to
 * answer "did my new build install?" is to have the application describe itself.
 */
export interface BuildInfo {
  version: string;
  /** When the executable was written, i.e. when this build was made. */
  builtAt?: string;
  executable?: string;
  dataDir: string;
  thumbnailsDir: string;
  database: string;
  /** True when the installer carried its own indexer rather than relying on a
   * Python environment that happens to be on this machine. */
  bundledIndexer: boolean;
  onBattery: boolean;
}

export type ViewMode = 'grid' | 'list' | 'timeline';

export type Appearance = 'light' | 'dark' | 'system';

export type Density = 'comfortable' | 'compact';

/** Every navigable destination in the shell. */
export type RouteId =
  | 'home'
  | 'all'
  | 'photos'
  | 'screenshots'
  | 'documents'
  | 'videos'
  /** Every group of faces, and the person route for one of them. */
  | 'people'
  | 'person'
  | 'projects'
  | 'collections'
  | 'search'
  | 'settings';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  submenu?: ContextMenuItem[];
}
