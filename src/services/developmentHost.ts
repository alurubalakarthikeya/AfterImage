import type {
  ActivityEntry,
  ArchiveCollection,
  ArchiveFile,
  ArchiveFolder,
  ArchiveTotals,
  FileFace,
  FileKind,
  IndexStatus,
  ModelStatus,
  PeopleSnapshot,
  Person,
  Project,
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
} from './host';

/**
 * Development host.
 *
 * What the renderer talks to in a plain browser: `npm run dev` without the
 * Tauri shell, and any future headless test.
 *
 * It has no filesystem, no SQLite and no watcher, and it does not pretend
 * otherwise. Every read returns an empty archive and every write reports why it
 * cannot succeed, so the interface shows its first-run and empty states instead
 * of inventing files. An archive application that invents files is worse than
 * useless: it is misleading about the user's own data.
 */

const CAPABILITIES: HostCapabilities = {
  nativeDialogs: false,
  fileWatch: false,
  notifications: typeof Notification !== 'undefined',
  reveal: false,
  trash: false,
  sqlite: false,
  appearance: true,
  realPaths: false,
  indexing: false,
  thumbnails: false,
};

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

/** The one sentence that explains the state the user is looking at. */
export const DESKTOP_REQUIRED =
  'This is the browser preview of the interface. Indexing watches, OCR and search ' +
  'need the desktop build, where Rust reads your folders and SQLite stores the index.';

/**
 * The browser has no filesystem, so there is no photograph to show and no
 * account to greet. `null` is the truthful answer to both, and the interface
 * renders its neutral variants rather than a stand-in picture or a made-up name.
 */
const EMPTY_TOTALS: ArchiveTotals = { files: 0, newToday: 0, byKind: EMPTY_BY_KIND };

const EMPTY_STORAGE: StorageStats = {
  usedBytes: 0,
  totalBytes: 0,
  indexedFiles: 0,
  pendingFiles: 0,
  failedFiles: 0,
  byKind: {},
};

const EMPTY_INDEX: IndexStatus = {
  state: 'idle',
  pending: 0,
  processing: 0,
  done: 0,
  failed: 0,
  total: 0,
  perMinute: 0,
  currentFile: null,
  currentFolder: null,
  lastScanAt: null,
  problem: DESKTOP_REQUIRED,
};

function unsupported(what: string): Error {
  return new Error(`${what} needs the desktop build. ${DESKTOP_REQUIRED}`);
}

export function createDevelopmentHost(): ArchiveHost {
  const listeners = new Set<HostListener>();

  const emit = (event: HostEvent) => {
    for (const listener of listeners) listener(event);
  };

  const refuse = async (what: string): Promise<never> => {
    emit({ type: 'notice', level: 'warn', message: `${what} needs the desktop build.` });
    throw unsupported(what);
  };

  return {
    name: 'development',
    capabilities: CAPABILITIES,

    snapshot: async (): Promise<ArchiveSnapshot> => ({
      folders: [],
      totals: EMPTY_TOTALS,
      storage: EMPTY_STORAGE,
      tags: [],
      collections: [],
      projects: [],
      activity: [],
      recent: [],
      index: EMPTY_INDEX,
    }),

    heroImage: async (): Promise<ArchiveFile | null> => null,

    identity: async () => null,

    files: async (_query: FileQuery): Promise<FilePage> => ({
      files: [],
      total: 0,
      hasMore: false,
    }),

    filesByIds: async (_ids: string[]): Promise<ArchiveFile[]> => [],

    storageStats: async (): Promise<StorageStats> => EMPTY_STORAGE,

    indexStatus: async (): Promise<IndexStatus> => EMPTY_INDEX,

    addFolder: async (): Promise<ArchiveFolder | null> => {
      emit({ type: 'notice', level: 'warn', message: DESKTOP_REQUIRED });
      return null;
    },

    addFolderPath: async (): Promise<ArchiveFolder | null> => {
      emit({ type: 'notice', level: 'warn', message: DESKTOP_REQUIRED });
      return null;
    },

    chooseFolders: async (): Promise<string[]> => {
      emit({ type: 'notice', level: 'warn', message: DESKTOP_REQUIRED });
      return [];
    },

    /** Nothing to persist in the browser build; the preference still sticks
     * locally, it just has no pipeline to configure. */
    updatePreferences: async (): Promise<void> => undefined,

    removeFolder: () => refuse('Removing a folder'),
    forgetPerson: () => refuse('Deleting a person'),
    rescanFolder: () => refuse('Scanning'),
    pauseIndexing: () => refuse('Pausing the indexer'),
    resumeIndexing: () => refuse('Resuming the indexer'),
    clearFailures: () => refuse('Clearing failures'),

    // ---- people --------------------------------------------------------- //
    // The browser has no filesystem, so there are no photographs to look at and
    // no faces to find. Reporting an empty, unavailable archive is the honest
    // answer; the page then explains what the desktop build adds.
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
    regroupPeople: () => refuse('Regrouping faces'),
    scanFaces: () => refuse('Looking for faces'),

    modelStatus: async (): Promise<ModelStatus> => ({
      bundles: [],
      available: false,
      missingMegabytes: 0,
      reason: 'The model store lives in the desktop build.',
    }),

    installModels: () => refuse('Downloading models'),

    search: async (query: SearchQuery): Promise<SearchResponse> => ({
      hits: [],
      total: 0,
      interpretation: {
        terms: query.raw.trim().length > 0 ? [query.raw.trim()] : [],
        kinds: [],
        tags: [],
        summary: 'Search needs the desktop build',
        refinedByModel: false,
      },
      semanticAvailable: false,
      error: DESKTOP_REQUIRED,
    }),

    similar: () => refuse('Similar image search'),
    related: () => refuse('Related files'),

    setFavorite: () => refuse('Saving metadata'),
    addTag: () => refuse('Tagging'),
    removeTag: () => refuse('Tagging'),
    createCollection: () => refuse('Creating collections'),
    deleteCollection: () => refuse('Deleting collections'),
    addToCollection: () => refuse('Saving metadata'),
    removeFromCollection: () => refuse('Saving metadata'),
    createProject: () => refuse('Creating projects'),
    deleteProject: () => refuse('Deleting projects'),
    setFileProject: () => refuse('Saving metadata'),

    tags: async (): Promise<Tag[]> => [],
    collections: async (): Promise<ArchiveCollection[]> => [],
    projects: async (): Promise<Project[]> => [],
    activity: async (_limit?: number): Promise<ActivityEntry[]> => [],

    openFile: () => refuse('Opening files'),
    openWith: () => refuse('Opening files with another app'),
    revealFile: () => refuse('Revealing files'),
    moveToTrash: () => refuse('Deleting files'),
    renameFile: () => refuse('Renaming files'),

    /** No asset protocol in a browser, and no thumbnails to point at. */
    assetUrl: () => '',

    notify: async (title, body) => {
      if (typeof Notification === 'undefined') return;
      try {
        if (Notification.permission === 'granted') new Notification(title, { body });
      } catch {
        /* notifications are a courtesy, never a requirement */
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose() {
      listeners.clear();
    },
  };
}

/** Nothing is persisted in the browser build, so this only exists for parity. */
export function clearDevelopmentState(): void {
  try {
    localStorage.removeItem('afterimage.journal.v2');
    localStorage.removeItem('afterimage.search-history.v1');
  } catch {
    /* storage disabled */
  }
}
