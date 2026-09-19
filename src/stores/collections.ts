import { create } from 'zustand';
import type { ArchiveCollection } from '@/types';
import { useArchiveStore } from './archive';
import { useUIStore } from './ui';

/**
 * Collection interactions.
 *
 * The collections themselves are rows in SQLite and live in the archive store;
 * this store owns the interaction state around them: the inline "new collection"
 * draft, which one is open, and the membership toggle the sidebar and inspector
 * both use. Every action lands in the database before the UI is told it worked.
 */
export interface CollectionStoreState {
  draftOpen: boolean;
  draftName: string;
  /** Collections created this session, newest first — shown first in the list. */
  recentIds: string[];

  beginDraft: () => void;
  cancelDraft: () => void;
  setDraftName: (name: string) => void;
  submitDraft: () => Promise<ArchiveCollection | null>;

  open: (collectionId: string) => void;
  toggleFile: (fileId: string, collectionId: string) => Promise<void>;
}

export const useCollectionStore = create<CollectionStoreState>()((set, get) => ({
  draftOpen: false,
  draftName: '',
  recentIds: [],

  beginDraft: () => set({ draftOpen: true, draftName: '' }),
  cancelDraft: () => set({ draftOpen: false, draftName: '' }),
  setDraftName: (draftName) => set({ draftName }),

  async submitDraft() {
    const name = get().draftName.trim();
    set({ draftOpen: false, draftName: '' });
    if (!name) return null;

    const collection = await useArchiveStore.getState().createCollection(name);
    if (!collection) return null;

    set((state) => ({ recentIds: [collection.id, ...state.recentIds] }));
    useUIStore
      .getState()
      .pushNotice({ level: 'success', message: `Collection “${collection.name}” created` });
    return collection;
  },

  open: (collectionId) => {
    const ui = useUIStore.getState();
    ui.setActiveCollection(collectionId);
    ui.navigate('collections');
  },

  async toggleFile(fileId, collectionId) {
    const archive = useArchiveStore.getState();
    const file = archive.fileById(fileId);
    const attached = file?.collectionIds.includes(collectionId) ?? false;
    await archive.toggleCollection(fileId, collectionId);
    const collection = useArchiveStore
      .getState()
      .collections.find((item) => item.id === collectionId);
    useUIStore.getState().pushNotice({
      level: 'info',
      message: `${attached ? 'Removed from' : 'Added to'} “${collection?.name ?? 'collection'}”`,
    });
  },
}));
