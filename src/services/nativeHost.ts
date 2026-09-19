import type {
  ActivityEntry,
  ArchiveCollection,
  ArchiveFile,
  ArchiveFolder,
  IndexStatus,
  Project,
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
  HostCapabilities,
  HostEvent,
  HostListener,
} from './host';

/**
 * Desktop host — the real one.
 *
 * Every call maps to a Rust command. Rust owns SQLite, the file watcher and the
 * indexing queue; the Python service is only ever spoken to by Rust, never by
 * the renderer, so the webview has no path to a model or a file it was not
 * granted. Tauri APIs are imported lazily so this module stays safe to bundle
 * for the browser build.
 */

const CAPABILITIES: HostCapabilities = {
  nativeDialogs: true,
  fileWatch: true,
  notifications: true,
  reveal: true,
  trash: true,
  sqlite: true,
  appearance: true,
  realPaths: true,
  indexing: true,
  thumbnails: true,
};

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(command, args);
}

export function createNativeHost(): ArchiveHost {
  const listeners = new Set<HostListener>();
  const unlisten: Array<() => void> = [];
  let disposed = false;

  const emit = (event: HostEvent) => {
    for (const listener of listeners) listener(event);
  };

  // Rust pushes these; the UI never polls.
  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      if (disposed) return;

      unlisten.push(
        await listen<string>('archive://changed', (event) => {
          const reason = event.payload;
          emit({
            type: 'files-changed',
            reason:
              reason === 'scan' || reason === 'delete' || reason === 'metadata' || reason === 'index'
                ? reason
                : 'watch',
          });
        }),
      );

      unlisten.push(
        await listen<IndexStatus>('archive://index', (event) => {
          emit({ type: 'index-status', status: event.payload });
        }),
      );

      unlisten.push(
        await listen<void>('archive://folders', () => {
          emit({ type: 'folders-changed' });
        }),
      );

      unlisten.push(
        await listen<string>('archive://notice', (event) => {
          const [level, ...rest] = (event.payload ?? '').split('|');
          emit({
            type: 'notice',
            level: level === 'error' || level === 'warn' ? level : 'info',
            message: rest.join('|'),
          });
        }),
      );
    } catch (error) {
      emit({
        type: 'notice',
        level: 'warn',
        message: `Could not attach to the indexing service: ${String(error)}`,
      });
    }
  })();

  const pickFolderDialog = async (): Promise<string | null> => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Choose a folder to index',
    });
    return typeof selected === 'string' ? selected : null;
  };

  return {
    name: 'tauri',
    capabilities: CAPABILITIES,

    snapshot: () => invoke<ArchiveSnapshot>('archive_snapshot'),
    files: (query) => invoke<FilePage>('list_files', { query }),
    filesByIds: (ids) => invoke<ArchiveFile[]>('files_by_ids', { ids }),
    storageStats: () => invoke<StorageStats>('storage_stats'),
    indexStatus: () => invoke<IndexStatus>('index_status'),

    async addFolder() {
      const path = await pickFolderDialog();
      if (!path) return null;
      return invoke<ArchiveFolder | null>('add_folder', { path });
    },

    addFolderPath: (path) => invoke<ArchiveFolder | null>('add_folder', { path }),
    removeFolder: (folderId) => invoke<void>('remove_folder', { folderId }),
    rescanFolder: (folderId) => invoke<void>('rescan_folder', { folderId }),

    updatePreferences: (preferences) => invoke<void>('save_settings', { patch: preferences }),

    pauseIndexing: () => invoke<void>('pause_indexing'),
    resumeIndexing: () => invoke<void>('resume_indexing'),
    clearFailures: () => invoke<void>('clear_failures'),

    search: (query: SearchQuery) => invoke<SearchResponse>('search_archive', { query }),
    similar: (fileId, limit) => invoke<SearchHit[]>('similar_files', { fileId, limit }),
    related: (fileId, limit) => invoke<SearchHit[]>('related_files', { fileId, limit }),

    setFavorite: (fileId, value) => invoke<void>('set_favorite', { fileId, value }),
    addTag: (fileId, name) => invoke<Tag>('add_tag', { fileId, name }),
    removeTag: (fileId, tagId) => invoke<void>('remove_tag', { fileId, tagId }),

    createCollection: (name) => invoke<ArchiveCollection>('create_collection', { name }),
    deleteCollection: (collectionId) => invoke<void>('delete_collection', { collectionId }),
    addToCollection: (fileId, collectionId) =>
      invoke<void>('add_to_collection', { fileId, collectionId }),
    removeFromCollection: (fileId, collectionId) =>
      invoke<void>('remove_from_collection', { fileId, collectionId }),

    createProject: (name) => invoke<Project>('create_project', { name }),
    deleteProject: (projectId) => invoke<void>('delete_project', { projectId }),
    setFileProject: (fileId, projectId) => invoke<void>('set_file_project', { fileId, projectId }),

    tags: () => invoke<Tag[]>('list_tags'),
    collections: () => invoke<ArchiveCollection[]>('list_collections'),
    projects: () => invoke<Project[]>('list_projects'),
    activity: (limit) => invoke<ActivityEntry[]>('list_activity', { limit }),

    openFile: (path) => invoke<void>('open_path', { path }),
    revealFile: (path) => invoke<void>('reveal_path', { path }),
    moveToTrash: (fileIds) => invoke<void>('trash_files', { fileIds }),
    renameFile: (fileId, name) => invoke<void>('rename_file', { fileId, name }),

    /**
     * Tauri's asset protocol turns a local path into a URL the webview may
     * load. That scope is limited to thumbnails in `tauri.conf.json`, so the
     * renderer still cannot fetch arbitrary files off the disk.
     */
    assetUrl: (path: string) => {
      if (!path) return '';
      const internals = window.__TAURI_INTERNALS__ as
        | { convertFileSrc?: (value: string, protocol?: string) => string }
        | undefined;
      if (internals?.convertFileSrc) return internals.convertFileSrc(path, 'asset');
      return path;
    },

    async notify(title, body) {
      try {
        const { isPermissionGranted, requestPermission, sendNotification } = await import(
          '@tauri-apps/plugin-notification'
        );
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === 'granted';
        if (granted) sendNotification({ title, body });
      } catch {
        /* notifications are a courtesy, never a requirement */
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      disposed = true;
      for (const off of unlisten) off();
      unlisten.length = 0;
      listeners.clear();
    },
  };
}
