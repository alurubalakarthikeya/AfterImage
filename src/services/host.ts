import type {
  ActivityEntry,
  ArchiveCollection,
  ArchiveFile,
  ArchiveFolder,
  ArchiveTotals,
  FileKind,
  IndexStatus,
  Project,
  SearchHit,
  SearchQuery,
  SearchResponse,
  StorageStats,
  Tag,
} from '@/types';

/**
 * The host boundary.
 *
 * Everything platform-specific sits behind this interface: the renderer never
 * touches `invoke`, the filesystem or the indexing service directly. The
 * desktop host talks to Rust, which owns SQLite, the watcher and the pipeline;
 * the development host answers honestly that it cannot index anything.
 *
 * There is deliberately no in-process archive. A previous version carried a
 * generated sample archive so the shell could be reviewed in a browser; that is
 * gone, because a memory application that shows invented files is worse than
 * one that shows an empty state.
 */

export type HostName = 'tauri' | 'development';

/** What this host can actually do. The UI adapts rather than guessing. */
export interface HostCapabilities {
  /** Native folder picker. Without it there is no way to grant access. */
  nativeDialogs: boolean;
  fileWatch: boolean;
  notifications: boolean;
  reveal: boolean;
  trash: boolean;
  sqlite: boolean;
  appearance: boolean;
  /** Real filesystem paths are available (as opposed to bare filenames). */
  realPaths: boolean;
  /** Background indexing pipeline. */
  indexing: boolean;
  thumbnails: boolean;
}

/** A page request over the indexed files. */
export interface FileQuery {
  kinds?: FileKind[];
  folderId?: string;
  tagId?: string;
  collectionId?: string;
  projectId?: string;
  favoritesOnly?: boolean;
  /** Rolling window in days, measured from the file's creation date. */
  sinceDays?: number;
  sort?: 'recent' | 'oldest' | 'name' | 'size' | 'kind';
  limit?: number;
  offset?: number;
}

export interface FilePage {
  files: ArchiveFile[];
  /** Rows matching the query, not the size of this page. */
  total: number;
  hasMore: boolean;
}

/** Everything the shell needs to render itself once, at boot. */
export interface ArchiveSnapshot {
  folders: ArchiveFolder[];
  totals: ArchiveTotals;
  storage: StorageStats;
  tags: Tag[];
  collections: ArchiveCollection[];
  projects: Project[];
  activity: ActivityEntry[];
  /** Newest files across the whole archive. */
  recent: ArchiveFile[];
  index: IndexStatus;
}

/**
 * Preferences the backend must know about.
 *
 * These are not cosmetic: they decide whether the pipeline calls the local model
 * at all. Keeping them in the host contract means the settings screen changes
 * real behaviour instead of only localStorage.
 */
export interface HostPreferences {
  semanticSearch?: boolean;
  servicePort?: number;
  localProcessing?: boolean;
}

export type HostEvent =
  | { type: 'files-changed'; reason: 'watch' | 'scan' | 'delete' | 'index' | 'metadata' }
  | { type: 'index-status'; status: IndexStatus }
  | { type: 'folders-changed' }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string };

export type HostListener = (event: HostEvent) => void;

export interface ArchiveHost {
  readonly name: HostName;
  readonly capabilities: HostCapabilities;

  /** One read that covers the whole shell: folders, counts, recent files. */
  snapshot(): Promise<ArchiveSnapshot>;
  files(query: FileQuery): Promise<FilePage>;
  filesByIds(ids: string[]): Promise<ArchiveFile[]>;
  storageStats(): Promise<StorageStats>;
  indexStatus(): Promise<IndexStatus>;

  // ---- folders ---------------------------------------------------------- //
  /** Opens the native picker. Resolves to null when the user cancels. */
  addFolder(): Promise<ArchiveFolder | null>;
  /** Registers a path directly (drag and drop, or a remembered folder). */
  addFolderPath(path: string): Promise<ArchiveFolder | null>;
  removeFolder(folderId: string): Promise<void>;
  /** Force a full rescan of one folder, ignoring cached hashes. */
  rescanFolder(folderId: string): Promise<void>;

  /** Persist behaviour preferences into the archive's own settings store. */
  updatePreferences(preferences: HostPreferences): Promise<void>;

  // ---- pipeline --------------------------------------------------------- //
  pauseIndexing(): Promise<void>;
  resumeIndexing(): Promise<void>;
  /** Give up on files that failed, so the queue can drain. */
  clearFailures(): Promise<void>;

  // ---- retrieval -------------------------------------------------------- //
  search(query: SearchQuery): Promise<SearchResponse>;
  /** Visually similar files, by image embedding. */
  similar(fileId: string, limit?: number): Promise<SearchHit[]>;
  /** Related files, from shared tags, text terms, folders, projects, time. */
  related(fileId: string, limit?: number): Promise<SearchHit[]>;

  // ---- metadata mutations ----------------------------------------------- //
  setFavorite(fileId: string, value: boolean): Promise<void>;
  addTag(fileId: string, name: string): Promise<Tag>;
  removeTag(fileId: string, tagId: string): Promise<void>;
  createCollection(name: string): Promise<ArchiveCollection>;
  deleteCollection(collectionId: string): Promise<void>;
  addToCollection(fileId: string, collectionId: string): Promise<void>;
  removeFromCollection(fileId: string, collectionId: string): Promise<void>;
  createProject(name: string): Promise<Project>;
  deleteProject(projectId: string): Promise<void>;
  setFileProject(fileId: string, projectId: string | null): Promise<void>;
  tags(): Promise<Tag[]>;
  collections(): Promise<ArchiveCollection[]>;
  projects(): Promise<Project[]>;
  activity(limit?: number): Promise<ActivityEntry[]>;

  // ---- file actions ----------------------------------------------------- //
  openFile(path: string): Promise<void>;
  revealFile(path: string): Promise<void>;
  /** Moves files to the OS trash; the originals are never deleted outright. */
  moveToTrash(fileIds: string[]): Promise<void>;
  renameFile(fileId: string, name: string): Promise<void>;

  /**
   * Turns an absolute path from the index into something an `<img>` can load.
   * Tauri registers a scoped asset protocol for exactly this.
   */
  assetUrl(path: string): string;

  notify(title: string, body: string): Promise<void>;

  subscribe(listener: HostListener): () => void;
  dispose(): void;
}

/** True when the renderer is running inside the Tauri webview. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ === 'object';
}

let cached: ArchiveHost | null = null;

/** The host for this runtime, created once and shared. */
export function getHost(): ArchiveHost {
  if (!cached) {
    cached = isTauri() ? createNativeHost() : createDevelopmentHost();
  }
  return cached;
}

/**
 * Loaded lazily so the browser bundle never pulls Tauri internals into its
 * initial chunk, and so importing this module stays side-effect free.
 */
import { createNativeHost } from './nativeHost';
import { createDevelopmentHost } from './developmentHost';

/** Clears anything the development host kept in local storage. */
export { clearDevelopmentState } from './developmentHost';
