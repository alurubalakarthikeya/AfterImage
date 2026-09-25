import { create } from 'zustand';
import type {
  ActivityEntry,
  ArchiveCollection,
  ArchiveFile,
  ArchiveFolder,
  ArchiveTotals,
  FileKind,
  IndexStatus,
  Project,
  StorageStats,
  Tag,
} from '@/types';
import { getHost, type FileQuery } from '@/services/host';
import { useUIStore } from './ui';

export type ArchiveStatus = 'idle' | 'loading' | 'ready' | 'error';

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

export const EMPTY_TOTALS: ArchiveTotals = { files: 0, newToday: 0, byKind: EMPTY_BY_KIND };

export const EMPTY_STORAGE: StorageStats = {
  usedBytes: 0,
  totalBytes: 0,
  indexedFiles: 0,
  pendingFiles: 0,
  failedFiles: 0,
  byKind: {},
};

export const IDLE_INDEX: IndexStatus = {
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
  problem: null,
};

export interface ArchiveStoreState {
  status: ArchiveStatus;
  error: string | null;

  folders: ArchiveFolder[];
  tags: Tag[];
  collections: ArchiveCollection[];
  projects: Project[];
  activity: ActivityEntry[];
  storage: StorageStats;
  totals: ArchiveTotals;
  index: IndexStatus;

  /** The working set for the route that is on screen. */
  files: ArchiveFile[];
  /** Rows the current working-set query matched, which may exceed `files`. */
  total: number;
  hasMore: boolean;
  loading: boolean;
  /** The query `files` currently answers. */
  activeQuery: FileQuery | null;
  /** Every record seen this session, so lookups work outside the working set. */
  known: Record<string, ArchiveFile>;

  load: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshStats: () => Promise<void>;

  loadFiles: (query: FileQuery, options?: { append?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  remember: (files: ArchiveFile[]) => void;
  fileById: (fileId: string) => ArchiveFile | null;

  // folders
  addFolder: () => Promise<ArchiveFolder | null>;
  addFolderPath: (path: string) => Promise<ArchiveFolder | null>;
  removeFolder: (folderId: string) => Promise<void>;
  rescanFolder: (folderId: string) => Promise<void>;

  // pipeline
  pauseIndexing: () => Promise<void>;
  resumeIndexing: () => Promise<void>;
  clearFailures: () => Promise<void>;

  // metadata
  toggleFavorite: (fileId: string) => Promise<void>;
  addTag: (fileId: string, label: string) => Promise<void>;
  removeTag: (fileId: string, tagId: string) => Promise<void>;
  renameFile: (fileId: string, name: string) => Promise<void>;
  deleteFiles: (fileIds: string[]) => Promise<void>;
  setProject: (fileId: string, projectId: string | null) => Promise<void>;
  toggleCollection: (fileId: string, collectionId: string) => Promise<void>;
  createCollection: (name: string) => Promise<ArchiveCollection | null>;
  renameCollection: (collectionId: string, name: string) => Promise<void>;
  deleteCollection: (collectionId: string) => Promise<void>;
  createProject: (name: string) => Promise<Project | null>;
  deleteProject: (projectId: string) => Promise<void>;

  // file actions
  openFile: (fileId: string) => Promise<void>;
  openWith: (fileId: string) => Promise<void>;
  revealFile: (fileId: string) => Promise<void>;
  copyPath: (fileId: string) => Promise<void>;
}

/** How many files a route pulls in at a time. */
export const PAGE_SIZE = 120;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function notice(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
  useUIStore.getState().pushNotice({ level, message });
}

/**
 * The archive.
 *
 * Every field here is read from the backend, which reads it from SQLite, which
 * was filled by walking folders the user chose. There are no baselines, no
 * demo records and no synthesised statistics: if the database is empty, this
 * store is empty, and the interface says so.
 */
export const useArchiveStore = create<ArchiveStoreState>()((set, get) => {
  const remember = (files: ArchiveFile[]) => {
    if (files.length === 0) return;
    set((state) => {
      const known = { ...state.known };
      for (const file of files) known[file.id] = file;
      return { known };
    });
  };

  /** Replaces one record everywhere it is held, after a metadata change. */
  const patchFile = (file: ArchiveFile) => {
    set((state) => ({
      known: { ...state.known, [file.id]: file },
      files: state.files.map((item) => (item.id === file.id ? file : item)),
    }));
  };

  const syncTags = async () => {
    const tags = await getHost()
      .tags()
      .catch(() => get().tags);
    set({ tags });
  };

  const refreshCollections = async () => {
    const collections = await getHost()
      .collections()
      .catch(() => get().collections);
    set({ collections });
  };

  const refreshActivity = async () => {
    const activity = await getHost()
      .activity(30)
      .catch(() => get().activity);
    set({ activity });
  };

  /** Reloads the working set with the query currently on screen. */
  const reloadWorkingSet = async () => {
    const { activeQuery } = get();
    if (!activeQuery) return;
    await get().loadFiles(activeQuery);
  };

  return {
    status: 'idle',
    error: null,

    folders: [],
    tags: [],
    collections: [],
    projects: [],
    activity: [],
    storage: EMPTY_STORAGE,
    totals: EMPTY_TOTALS,
    index: IDLE_INDEX,

    files: [],
    total: 0,
    hasMore: false,
    loading: false,
    activeQuery: null,
    known: {},

    async load() {
      const { status } = get();
      if (status === 'loading' || status === 'ready') return;
      set({ status: 'loading', error: null });
      try {
        const snapshot = await getHost().snapshot();
        remember(snapshot.recent);
        set({
          folders: snapshot.folders,
          totals: snapshot.totals,
          storage: snapshot.storage,
          tags: snapshot.tags,
          collections: snapshot.collections,
          projects: snapshot.projects,
          activity: snapshot.activity,
          index: snapshot.index,
          status: 'ready',
        });
      } catch (error) {
        set({ status: 'error', error: errorMessage(error) });
      }
    },

    /** Pulls the counts, folder state and queue without touching the grid. */
    async refresh() {
      try {
        const snapshot = await getHost().snapshot();
        remember(snapshot.recent);
        set({
          folders: snapshot.folders,
          totals: snapshot.totals,
          storage: snapshot.storage,
          tags: snapshot.tags,
          collections: snapshot.collections,
          projects: snapshot.projects,
          activity: snapshot.activity,
          index: snapshot.index,
        });
        await reloadWorkingSet();
      } catch (error) {
        notice('error', `Could not refresh the index: ${errorMessage(error)}`);
      }
    },

    async refreshStats() {
      const host = getHost();
      const [storage, index] = await Promise.all([
        host.storageStats().catch(() => get().storage),
        host.indexStatus().catch(() => get().index),
      ]);
      set({ storage, index });
    },

    async loadFiles(query, options) {
      const append = options?.append ?? false;
      const host = getHost();
      set({ loading: true, activeQuery: query });
      try {
        const page = await host.files({
          ...query,
          limit: query.limit ?? PAGE_SIZE,
          offset: append ? (query.offset ?? 0) + get().files.length : (query.offset ?? 0),
        });
        remember(page.files);
        set((state) => ({
          files: append ? [...state.files, ...page.files] : page.files,
          total: page.total,
          hasMore: page.hasMore,
          loading: false,
        }));
      } catch (error) {
        set({ loading: false, files: append ? get().files : [], total: 0, hasMore: false });
        notice('error', `Could not read the index: ${errorMessage(error)}`);
      }
    },

    async loadMore() {
      const { activeQuery, hasMore, loading } = get();
      if (!activeQuery || !hasMore || loading) return;
      await get().loadFiles(activeQuery, { append: true });
    },

    remember,
    fileById: (fileId) => get().known[fileId] ?? null,

    async addFolder() {
      try {
        const folder = await getHost().addFolder();
        if (!folder) return null;
        set((state) => ({ folders: [...state.folders.filter((f) => f.id !== folder.id), folder] }));
        notice('success', `Indexing “${folder.name}”`);
        await get().refresh();
        return folder;
      } catch (error) {
        notice('error', errorMessage(error));
        return null;
      }
    },

    async addFolderPath(path) {
      try {
        const folder = await getHost().addFolderPath(path);
        if (!folder) return null;
        set((state) => ({ folders: [...state.folders.filter((f) => f.id !== folder.id), folder] }));
        notice('success', `Indexing “${folder.name}”`);
        await get().refresh();
        return folder;
      } catch (error) {
        notice('error', errorMessage(error));
        return null;
      }
    },

    async removeFolder(folderId) {
      const folder = get().folders.find((item) => item.id === folderId);
      try {
        await getHost().removeFolder(folderId);
        set((state) => ({ folders: state.folders.filter((item) => item.id !== folderId) }));
        notice('info', `Stopped watching “${folder?.name ?? 'folder'}” — the files themselves are untouched`);
        await get().refresh();
      } catch (error) {
        notice('error', errorMessage(error));
      }
    },

    async rescanFolder(folderId) {
      try {
        await getHost().rescanFolder(folderId);
        notice('info', 'Rescanning — unchanged files are skipped');
      } catch (error) {
        notice('error', errorMessage(error));
      }
    },

    async pauseIndexing() {
      try {
        await getHost().pauseIndexing();
        set((state) => ({ index: { ...state.index, state: 'paused' } }));
      } catch (error) {
        notice('error', errorMessage(error));
      }
    },

    async resumeIndexing() {
      try {
        await getHost().resumeIndexing();
        set((state) => ({ index: { ...state.index, state: 'indexing' } }));
      } catch (error) {
        notice('error', errorMessage(error));
      }
    },

    async clearFailures() {
      try {
        await getHost().clearFailures();
        await get().refresh();
      } catch (error) {
        notice('error', errorMessage(error));
      }
    },

    async toggleFavorite(fileId) {
      const file = get().fileById(fileId);
      if (!file) return;
      const value = !file.favorite;
      // Optimistic: the star should not lag behind the click.
      patchFile({ ...file, favorite: value });
      try {
        await getHost().setFavorite(fileId, value);
      } catch (error) {
        patchFile(file);
        notice('error', errorMessage(error));
      }
    },

    async addTag(fileId, label) {
      const clean = label.trim().replace(/^#/, '') || '';
      if (!clean) return;
      try {
        const tag = await getHost().addTag(fileId, clean);
        const file = get().fileById(fileId);
        if (file && !file.tagIds.includes(tag.id)) {
          patchFile({ ...file, tagIds: [...file.tagIds, tag.id] });
        }
        await syncTags();
      } catch (error) {
        notice('error', errorMessage(error));
      }
    },

    async removeTag(fileId, tagId) {
      const file = get().fileById(fileId);
      if (!file) return;
      patchFile({ ...file, tagIds: file.tagIds.filter((id) => id !== tagId) });
      try {
        await getHost().removeTag(fileId, tagId);
        await syncTags();
      } catch (error) {
        patchFile(file);
        notice('error', errorMessage(error));
      }
    },

    async renameFile(fileId, name) {
      const file = get().fileById(fileId);
      if (!file) return;
      try {
        await getHost().renameFile(fileId, name);
        notice('success', `Renamed to “${name}”`);
        await get().refresh();
      } catch (error) {
        notice('error', errorMessage(error));
      }
    },

    async deleteFiles(fileIds) {
      if (fileIds.length === 0) return;
      try {
        await getHost().moveToTrash(fileIds);
        set((state) => ({ files: state.files.filter((file) => !fileIds.includes(file.id)) }));
        const ui = useUIStore.getState();
        ui.selectMany(ui.selectedFileIds.filter((id) => !fileIds.includes(id)));
        // The desktop build moves files to the operating system's trash; a
        // browser can only lift them out of the archive, and saying "moved to
        // trash" about that would promise a bin that does not exist.
        const trashed = getHost().capabilities.trash;
        const count = fileIds.length;
        notice(
          'success',
          trashed
            ? count === 1
              ? 'Moved to trash'
              : `${count} files moved to trash`
            : count === 1
              ? 'Removed from the archive — the file itself is untouched on disk'
              : `${count} files removed from the archive — the files themselves are untouched on disk`,
        );
        await get().refresh();
      } catch (error) {
        notice('error', errorMessage(error));
      }
    },

    async setProject(fileId, projectId) {
      const file = get().fileById(fileId);
      if (!file) return;
      patchFile({ ...file, projectId });
      try {
        await getHost().setFileProject(fileId, projectId);
        const projects = await getHost().projects().catch(() => get().projects);
        set({ projects });
      } catch (error) {
        patchFile(file);
        notice('error', errorMessage(error));
      }
    },

    async toggleCollection(fileId, collectionId) {
      const file = get().fileById(fileId);
      if (!file) return;
      const attached = file.collectionIds.includes(collectionId);
      patchFile({
        ...file,
        collectionIds: attached
          ? file.collectionIds.filter((id) => id !== collectionId)
          : [...file.collectionIds, collectionId],
      });
      try {
        if (attached) await getHost().removeFromCollection(fileId, collectionId);
        else await getHost().addToCollection(fileId, collectionId);
        await refreshCollections();
      } catch (error) {
        patchFile(file);
        notice('error', errorMessage(error));
      }
    },

    async createCollection(name) {
      const clean = name.trim();
      if (!clean) return null;
      try {
        const collection = await getHost().createCollection(clean);
        await refreshCollections();
        await refreshActivity();
        return collection;
      } catch (error) {
        notice('error', errorMessage(error));
        return null;
      }
    },

    /**
     * Renames a collection.
     *
     * Only the label moves: the files inside keep their names, paths and tags,
     * because a collection is a view over the index rather than a place files
     * live. A name another collection already has comes back as a sentence.
     */
    async renameCollection(collectionId, name) {
      const clean = name.trim();
      const existing = get().collections.find((item) => item.id === collectionId);
      if (!clean || !existing || clean === existing.name) return;

      set((state) => ({
        collections: state.collections.map((item) =>
          item.id === collectionId ? { ...item, name: clean } : item,
        ),
      }));

      try {
        await getHost().renameCollection(collectionId, clean);
        await refreshCollections();
        notice('success', `Renamed to “${clean}”`);
      } catch (error) {
        await refreshCollections();
        notice('error', errorMessage(error));
      }
    },

    async deleteCollection(collectionId) {
      try {
        await getHost().deleteCollection(collectionId);
        await refreshCollections();
      } catch (error) {
        notice('error', errorMessage(error));
      }
    },

    async createProject(name) {
      const clean = name.trim();
      if (!clean) return null;
      try {
        const project = await getHost().createProject(clean);
        const projects = await getHost().projects().catch(() => get().projects);
        set({ projects });
        return project;
      } catch (error) {
        notice('error', errorMessage(error));
        return null;
      }
    },

    async deleteProject(projectId) {
      try {
        await getHost().deleteProject(projectId);
        const projects = await getHost().projects().catch(() => get().projects);
        set({ projects });
      } catch (error) {
        notice('error', errorMessage(error));
      }
    },

    async openFile(fileId) {
      const file = get().fileById(fileId);
      if (!file) return;
      try {
        await getHost().openFile(file.path);
      } catch (error) {
        notice('error', `Could not open the file: ${errorMessage(error)}`);
      }
    },

    async openWith(fileId) {
      const file = get().fileById(fileId);
      if (!file) return;
      try {
        await getHost().openWith(file.path);
      } catch (error) {
        notice('error', `Could not open the file with another app: ${errorMessage(error)}`);
      }
    },

    async revealFile(fileId) {
      const file = get().fileById(fileId);
      if (!file) return;
      try {
        await getHost().revealFile(file.path);
      } catch (error) {
        notice('error', `Could not open the location: ${errorMessage(error)}`);
      }
    },

    async copyPath(fileId) {
      const file = get().fileById(fileId);
      if (!file) return;
      try {
        await navigator.clipboard.writeText(file.path);
        notice('info', 'Path copied to clipboard');
      } catch {
        notice('warn', 'The clipboard is not available');
      }
    },
  };
});
