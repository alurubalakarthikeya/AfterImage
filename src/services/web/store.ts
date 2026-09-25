import type {
  ActivityEntry,
  ArchiveCollection,
  ArchiveFile,
  ArchiveFolder,
  FileVersion,
  Project,
  Tag,
} from '@/types';

/**
 * The browser's archive: IndexedDB, held open across sessions.
 *
 * The desktop build keeps a SQLite file, a watcher and a queue of workers. A web
 * page has none of that, but it does have somewhere to put things that survives a
 * reload, which is the whole requirement: everything the user sees is stored in
 * this browser, on this machine, and nothing is ever sent anywhere.
 *
 * Two layers, deliberately:
 *
 *   * **IndexedDB** is the durable one. It holds the records, the thumbnails and
 *     the file handles that grant access to what the user picked.
 *   * **The in-memory mirror** is what the interface actually queries. A grid, a
 *     search and a facet count all read the same few thousand records, and doing
 *     that in memory is both faster and simpler than teaching a renderer to write
 *     SQL.
 *
 * There is no server, no account and no network call in this module — searching
 * for one would be the bug.
 */

/** A folder the user granted, and the handle that keeps the grant alive. */
export interface StoredFolder {
  folder: ArchiveFolder;
  /**
   * Structured-cloneable and persistable: this is what makes the grant survive a
   * reload. The browser may still want the user to confirm it again, which is why
   * a folder can come back as `denied` rather than disappearing.
   */
  handle?: FileSystemDirectoryHandle;
}

export interface StoredFile {
  file: ArchiveFile;
  /** How the original is read back for a preview, a version or bigger pixels. */
  handle?: FileSystemFileHandle;
}

/** The pictures themselves, kept out of the records so a query never loads one. */
export interface StoredBlobs {
  fileId: string;
  thumb?: Blob;
  preview?: Blob;
}

/** A kept copy: the record plus the blob it points at. */
export interface StoredVersion extends FileVersion {
  blob: Blob;
}

const DB_NAME = 'afterimage.archive';
// v3: `files` is keyed by `file.id`.
//
// The store used to declare a flat `id` key while holding the record the way
// every other store holds one — the payload under its own property — so an
// IndexedDB evaluation of the key path found nothing and every write of a file
// was refused with a `DataError`. The archive kept working from memory and
// emptied itself on reload. A version bump is what makes an existing database
// drop the mis-keyed store and rebuild it: without one, the upgrade callback
// never runs and the old key path stays.
const DB_VERSION = 3;

type StoreName =
  | 'folders'
  | 'files'
  | 'blobs'
  | 'versions'
  | 'collections'
  | 'tags'
  | 'projects'
  | 'activity'
  | 'meta';

const STORES: StoreName[] = [
  'folders',
  'files',
  'blobs',
  'versions',
  'collections',
  'tags',
  'projects',
  'activity',
  'meta',
];

/**
 * What each store is keyed by.
 *
 * `folders` and `files` are keyed inside the record rather than on the record
 * itself, because both hold a payload (`folder`, `file`) beside its platform
 * side — the handle that grants access to it. IndexedDB understands a dotted
 * key path, and using one keeps the handle and the record in the same row:
 * there is no state where a grant exists without the record it belongs to.
 */
function keyPathFor(name: StoreName): string {
  if (name === 'meta') return 'key';
  if (name === 'blobs') return 'fileId';
  if (name === 'folders') return 'folder.id';
  if (name === 'files') return 'file.id';
  return 'id';
}

let connection: Promise<IDBDatabase> | null = null;

/** True when this browser has IndexedDB at all. Private modes sometimes do not. */
export function available(): boolean {
  return typeof indexedDB !== 'undefined';
}

function open(): Promise<IDBDatabase> {
  if (connection) return connection;

  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.transaction?.db ?? request.result;
      for (const name of STORES) {
        const wanted = keyPathFor(name);
        if (database.objectStoreNames.contains(name)) {
          const existing = request.transaction?.objectStore(name);
          // A store whose key changed cannot be altered in place, and the shape
          // of a store is not something a later write can fix — so it is dropped
          // and refilled from whatever the interface has in memory, exactly the
          // way a schema change is handled anywhere else in this project.
          if (existing && existing.keyPath !== wanted) {
            database.deleteObjectStore(name);
          }
        }
        if (!database.objectStoreNames.contains(name)) {
          database.createObjectStore(name, { keyPath: wanted });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('the local database could not open'));
  });

  return connection;
}

function transaction<T>(
  names: StoreName[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return open().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const tx = database.transaction(names, mode);
        let result: T;
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? new Error('the local database refused the write'));
        tx.onabort = () => reject(tx.error ?? new Error('the local database aborted the write'));
        Promise.resolve(run(tx)).then(
          (value) => {
            result = value;
          },
          (error) => {
            try {
              tx.abort();
            } catch {
              /* already finished */
            }
            reject(error);
          },
        );
      }),
  );
}

function request<T>(store: IDBObjectStore, key?: IDBValidKey): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const result = key === undefined ? store.getAll() : store.get(key);
    result.onsuccess = () => resolve(result.result as T);
    result.onerror = () => reject(result.error ?? new Error('a local read failed'));
  });
}

/** Everything in one store. */
export async function readAll<T>(name: StoreName): Promise<T[]> {
  return transaction([name], 'readonly', (tx) => request<T[]>(tx.objectStore(name)));
}

export async function readOne<T>(name: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return transaction([name], 'readonly', (tx) => request<T | undefined>(tx.objectStore(name), key));
}

/**
 * Write one record.
 *
 * Every store but `meta` is keyed by the record's own `id`, so the value is put
 * as it is; `meta` holds preferences and other single values, and is written as
 * a key/value pair under an explicit name.
 */
export async function put(name: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  return transaction([name], 'readwrite', (tx) => {
    const store = tx.objectStore(name);
    if (name === 'meta') {
      store.put({ key: key ?? String(Math.random()), value });
      return;
    }
    store.put(value);
  });
}

/** Read one `meta` entry by name. */
export async function meta<T>(key: string): Promise<T | undefined> {
  const entry = await readOne<{ key: string; value: T }>('meta', key);
  return entry?.value;
}

export async function putMany(name: StoreName, values: unknown[]): Promise<void> {
  if (values.length === 0) return;
  return transaction([name], 'readwrite', (tx) => {
    const store = tx.objectStore(name);
    for (const value of values) store.put(value);
  });
}

export async function remove(name: StoreName, key: IDBValidKey): Promise<void> {
  return transaction([name], 'readwrite', (tx) => {
    tx.objectStore(name).delete(key);
  });
}

export async function removeMany(name: StoreName, keys: IDBValidKey[]): Promise<void> {
  if (keys.length === 0) return;
  return transaction([name], 'readwrite', (tx) => {
    const store = tx.objectStore(name);
    for (const key of keys) store.delete(key);
  });
}

/** Empty every store: what "reset the local archive" in Settings means. */
export async function clearAll(): Promise<void> {
  return transaction(STORES, 'readwrite', (tx) => {
    for (const name of STORES) tx.objectStore(name).clear();
  });
}

/** Records the browser holds. Used by the storage readout. */
export async function footprint(): Promise<{ records: number; bytes: number }> {
  if (!available()) return { records: 0, bytes: 0 };
  try {
    const files = await readAll<StoredFile>('files');
    return {
      records: files.length,
      bytes: files.reduce((total, entry) => total + (entry.file.bytes ?? 0), 0),
    };
  } catch {
    return { records: 0, bytes: 0 };
  }
}

export type { ActivityEntry, ArchiveCollection, ArchiveFile, ArchiveFolder, FileVersion, Project, Tag };
