import type {
  ActivityEntry,
  AnalysisStatus,
  ArchiveCollection,
  ArchiveFile,
  ArchiveFolder,
  ArchiveTotals,
  BuildInfo,
  FileFace,
  MediaPages,
  FileKind,
  FileVersion,
  ImageDna,
  IndexStatus,
  ModelStatus,
  OrganizePlan,
  OrganizeReport,
  PeopleSnapshot,
  Person,
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

export type HostName = 'tauri' | 'web' | 'development';

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
  /** Only files in which this person's face was found. */
  personId?: string;
  tagId?: string;
  collectionId?: string;
  projectId?: string;
  favoritesOnly?: boolean;
  /** Rolling window in days, measured from the file's creation date. */
  sinceDays?: number;
  /**
   * One calendar day, `YYYY-MM-DD` in the machine's own zone.
   *
   * Narrower than `sinceDays` and not interchangeable with it: the timeline's
   * day headers ask this question, which is "everything from the 14th" rather
   * than "everything from the last fourteen days".
   */
  day?: string;
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
  /** The master switch for OCR, labels, embeddings and faces. */
  localProcessing?: boolean;
  /** Whether a change on disk is enough to start indexing on its own. */
  autoIndex?: boolean;
  /** Whether the queue may run while the machine is on battery power. */
  indexOnBattery?: boolean;
  /** Let the local model interpret search queries. */
  llmEnabled?: boolean;
  /** Which local model to use, when one is enabled. */
  llmModel?: string;
}

export type HostEvent =
  | { type: 'files-changed'; reason: 'watch' | 'scan' | 'delete' | 'index' | 'metadata' }
  | { type: 'index-status'; status: IndexStatus }
  | { type: 'folders-changed' }
  /** A model download finished, so what the machine can do has changed. */
  | { type: 'models-changed' }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string };

export type HostListener = (event: HostEvent) => void;

/** Who is using this machine, as the operating system reports it. */
export interface LocalIdentity {
  userName: string | null;
  homeDir: string | null;
}

export interface ArchiveHost {
  readonly name: HostName;
  readonly capabilities: HostCapabilities;

  /** One read that covers the whole shell: folders, counts, recent files. */
  snapshot(): Promise<ArchiveSnapshot>;
  /**
   * A photograph from the user's own library, for the Home hero. `null` when the
   * archive holds nothing suitable — which is a valid answer, not an error.
   */
  heroImage(): Promise<ArchiveFile | null>;
  /**
   * The local account this app is running as. Used to greet the person actually
   * at the machine; `null` where the platform will not say.
   */
  identity(): Promise<LocalIdentity | null>;
  files(query: FileQuery): Promise<FilePage>;
  filesByIds(ids: string[]): Promise<ArchiveFile[]>;
  storageStats(): Promise<StorageStats>;
  indexStatus(): Promise<IndexStatus>;

  // ---- folders ---------------------------------------------------------- //
  /** Opens the native picker. Resolves to null when the user cancels. */
  addFolder(): Promise<ArchiveFolder | null>;
  /**
   * Opens the native picker for *several* folders at once — this is what
   * onboarding offers, so the whole archive can be granted in one gesture.
   * Resolves to an empty array when the user cancels.
   */
  chooseFolders(): Promise<string[]>;
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

  // ---- people ----------------------------------------------------------- //
  /** Every group of faces, with the numbers behind them. */
  people(): Promise<PeopleSnapshot>;
  person(personId: string): Promise<Person | null>;
  /** Every face in one file, for the inspector. */
  fileFaces(fileId: string): Promise<FileFace[]>;
  /** "" clears the name; the group goes back to being unnamed. */
  renamePerson(personId: string, label: string | null): Promise<void>;
  /** Fold one group into another — the correction for a wrong merge. */
  mergePeople(fromId: string, intoId: string): Promise<void>;
  setPersonHidden(personId: string, hidden: boolean): Promise<void>;
  /**
   * Delete a group and the faces behind it, for the clusters that were never a
   * person at all. Answers with how many faces went with it. No photograph is
   * touched, and the group cannot reassemble itself on the next pass.
   */
  forgetPerson(personId: string): Promise<number>;
  /** Regroup the whole library. Answers with the number of groups. */
  regroupPeople(): Promise<number>;
  /** Look for faces in everything already indexed. Answers with files queued. */
  scanFaces(): Promise<number>;
  /** What the local model store holds, and what completing it would cost. */
  modelStatus(): Promise<ModelStatus>;
  /** Fetch model bundles. Returns once the download is under way. */
  installModels(bundles: string[]): Promise<void>;
  /**
   * Start the local indexing service now.
   *
   * It is started in the background at launch, but that can lose a race on a
   * slow machine — and a person looking at "not running" deserves a button.
   * Resolves with what happened; rejects with the reason it could not start.
   */
  startService(): Promise<string>;
  /**
   * Queue the files the models have not looked at yet.
   *
   * The answer to "I installed the models after importing 8,000 files": nothing
   * is re-imported, and the pass runs through the ordinary background queue with
   * the ordinary progress reporting. Answers with the number of files queued.
   */
  analyzeLibrary(): Promise<number>;
  /** How much of the archive the models have been through. */
  analysisStatus(): Promise<AnalysisStatus>;
  /**
   * The pages of a document, rendered on this machine.
   *
   * Rendered rather than handed over as a PDF, because whether a webview can
   * display a local PDF depends on a viewer plugin being installed and willing.
   */
  mediaPages(fileId: string): Promise<MediaPages>;

  // ---- the build -------------------------------------------------------- //
  /** Which build this is, and where it keeps its files. */
  buildInfo(): Promise<BuildInfo>;

  /**
   * Let the webview read one original file, returning its path.
   *
   * Photographs are served from the pipeline's previews; a video has to be
   * streamed and a PDF has to be laid out, and only the original will do. Access
   * is granted for that one file, for that one reason.
   */
  grantFileAccess(fileId: string): Promise<string>;

  // ---- image dna -------------------------------------------------------- //
  /**
   * What this machine can say about one picture: its own facts, plus the
   * palette, tone and detail measured from its pixels locally. Measured on
   * demand and cached in the backend, so opening the inspector twice costs one
   * decode.
   */
  imageDna(fileId: string): Promise<ImageDna>;

  // ---- organizing ------------------------------------------------------- //
  /**
   * Ask for the folder the archive should file everything into.
   *
   * Not `addFolder`: the answer is a destination rather than an indexed folder,
   * and registering it is something the organizer does when it writes into it.
   */
  pickOrganizeDestination(): Promise<string | null>;
  /**
   * Where every indexed file would go if the archive filed the disk its own way.
   *
   * Read-only, and the only thing the interface needs before it offers to move
   * anything: a move writes to the user's own folders.
   */
  organizePlan(destination: string): Promise<OrganizePlan>;
  /**
   * Move the files. The destination becomes part of the archive, so what was
   * filed stays indexed.
   */
  organizeApply(destination: string): Promise<OrganizeReport>;

  // ---- kept versions ---------------------------------------------------- //
  /** Every kept copy of one file, newest content first. */
  versions(fileId: string): Promise<FileVersion[]>;
  /** Keep the file's current presentation as a version to compare against. */
  captureVersion(fileId: string): Promise<FileVersion>;
  deleteVersion(versionId: string): Promise<void>;

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
  /** Renames a collection. A collection is a view, so no file is touched. */
  renameCollection(collectionId: string, name: string): Promise<void>;
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
  /** Hands the file to the OS "open with" chooser. */
  openWith(path: string): Promise<void>;
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

/**
 * True when this browser can grant a page access to a real folder.
 *
 * The File System Access API is what makes the web build an archive rather than
 * a mock-up: without it a page cannot read the user's files at all, and the
 * interface says so instead of offering a picker that would do nothing.
 */
export function canReadLocalFolders(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}

let cached: ArchiveHost | null = null;

/**
 * The host for this runtime, created once and shared.
 *
 * Three runtimes, one interface: the desktop build talks to Rust, a browser that
 * can be granted folders keeps its archive in IndexedDB, and a browser that
 * cannot says so honestly rather than inventing an archive.
 */
export function getHost(): ArchiveHost {
  if (!cached) {
    if (isTauri()) cached = createNativeHost();
    else if (canReadLocalFolders()) cached = createWebHost();
    else cached = createDevelopmentHost();
  }
  return cached;
}

/**
 * Loaded lazily so the browser bundle never pulls Tauri internals into its
 * initial chunk, and so importing this module stays side-effect free.
 */
import { createNativeHost } from './nativeHost';
import { createWebHost } from './webHost';
import { createDevelopmentHost, clearDevelopmentState } from './developmentHost';

/** Clears anything the development host kept in local storage. */
export { clearDevelopmentState };
export { clearWebArchive } from './webHost';

/**
 * Forget the local preview state, in whichever browser storage holds it.
 *
 * Both are cleared rather than the one that is in use: they are both this
 * origin's data, they cost nothing to drop, and leaving a stale one behind is
 * how "clear" turns out not to have cleared anything.
 */
export async function clearBrowserArchive(): Promise<void> {
  clearDevelopmentState();
  if (canReadLocalFolders()) {
    const { clearWebArchive } = await import('./webHost');
    await clearWebArchive();
  }
}
