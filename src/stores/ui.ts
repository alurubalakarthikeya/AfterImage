import { create } from 'zustand';
import type { RouteId, ViewMode } from '@/types';

export interface Notice {
  id: number;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  /** Optional action rendered as a link-style button. */
  action?: { label: string; run: () => void };
}

export interface ContextMenuState {
  x: number;
  y: number;
  fileId: string | null;
}

/**
 * Ephemeral interface state.
 *
 * Nothing here is persisted or needs to survive a restart: routing, what is
 * selected, which overlay is open. Keeping it separate from the archive store
 * means a re-render caused by selection can never touch the file list.
 */
export interface UIState {
  route: RouteId;
  viewMode: ViewMode;
  selectedFileId: string | null;
  selectedFileIds: string[];
  inspectorOpen: boolean;
  sidebarCollapsed: boolean;
  paletteOpen: boolean;
  quickLookOpen: boolean;
  appearanceOpen: boolean;
  shortcutsOpen: boolean;
  /** The indexing panel: queue detail, speed, pause/resume. */
  indexingOpen: boolean;
  dropActive: boolean;
  /** Route the user came from, so Esc can return. */
  previousRoute: RouteId;
  notice: Notice | null;
  contextMenu: ContextMenuState | null;
  activeCollectionId: string | null;
  activeProjectId: string | null;
  /** File whose "find similar" results should be shown in the inspector. */
  similarFor: string | null;

  navigate: (route: RouteId) => void;
  selectFile: (fileId: string, options?: { additive?: boolean; open?: boolean }) => void;
  selectMany: (fileIds: string[]) => void;
  clearSelection: () => void;
  setViewMode: (mode: ViewMode) => void;
  toggleInspector: () => void;
  setInspectorOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setPaletteOpen: (open: boolean) => void;
  setQuickLookOpen: (open: boolean) => void;
  setAppearanceOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setIndexingOpen: (open: boolean) => void;
  setDropActive: (active: boolean) => void;
  pushNotice: (notice: Omit<Notice, 'id'>) => void;
  dismissNotice: () => void;
  openContextMenu: (x: number, y: number, fileId: string | null) => void;
  closeContextMenu: () => void;
  setActiveCollection: (collectionId: string | null) => void;
  setActiveProject: (projectId: string | null) => void;
  setSimilarFor: (fileId: string | null) => void;
  /** Close whatever overlay is open; returns true when something was closed. */
  dismissTop: () => boolean;
}

let noticeId = 0;

export const useUIStore = create<UIState>()((set, get) => ({
  route: 'home',
  viewMode: 'grid',
  selectedFileId: null,
  selectedFileIds: [],
  inspectorOpen: true,
  sidebarCollapsed: false,
  paletteOpen: false,
  quickLookOpen: false,
  appearanceOpen: false,
  shortcutsOpen: false,
  indexingOpen: false,
  dropActive: false,
  previousRoute: 'home',
  notice: null,
  contextMenu: null,
  activeCollectionId: null,
  activeProjectId: null,
  similarFor: null,

  navigate: (route) => {
    const current = get().route;
    if (current === route) return;
    set({ route, previousRoute: current, contextMenu: null });
  },

  selectFile: (fileId, options) =>
    set((state) => {
      const additive = options?.additive ?? false;
      const alreadySelected = state.selectedFileIds.includes(fileId);
      const selectedFileIds = additive
        ? alreadySelected
          ? state.selectedFileIds.filter((id) => id !== fileId)
          : [...state.selectedFileIds, fileId]
        : [fileId];
      return {
        selectedFileId: additive && alreadySelected ? null : fileId,
        selectedFileIds,
        inspectorOpen: true,
        contextMenu: null,
        // Selecting a different file leaves "find similar" mode.
        similarFor: state.similarFor === fileId ? state.similarFor : null,
      };
    }),

  selectMany: (fileIds) =>
    set({ selectedFileIds: fileIds, selectedFileId: fileIds[0] ?? null, inspectorOpen: fileIds.length > 0 }),

  clearSelection: () => set({ selectedFileId: null, selectedFileIds: [], quickLookOpen: false }),

  setViewMode: (viewMode) => set({ viewMode }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  setInspectorOpen: (inspectorOpen) => set({ inspectorOpen }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setQuickLookOpen: (quickLookOpen) => set({ quickLookOpen }),
  setAppearanceOpen: (appearanceOpen) => set({ appearanceOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setIndexingOpen: (indexingOpen) => set({ indexingOpen }),
  setDropActive: (dropActive) => set({ dropActive }),

  pushNotice: (notice) => set({ notice: { ...notice, id: (noticeId += 1) } }),
  dismissNotice: () => set({ notice: null }),

  openContextMenu: (x, y, fileId) =>
    set((state) => {
      // Right-clicking an unselected card selects it first, like Finder.
      const shouldSelect = fileId !== null && !state.selectedFileIds.includes(fileId);
      return {
        contextMenu: { x, y, fileId },
        ...(shouldSelect ? { selectedFileId: fileId, selectedFileIds: [fileId] } : {}),
      };
    }),

  closeContextMenu: () => set({ contextMenu: null }),
  setActiveCollection: (activeCollectionId) => set({ activeCollectionId }),
  setActiveProject: (activeProjectId) => set({ activeProjectId }),
  setSimilarFor: (similarFor) => set({ similarFor }),

  dismissTop: () => {
    const state = get();
    if (state.contextMenu) {
      set({ contextMenu: null });
      return true;
    }
    if (state.paletteOpen) {
      set({ paletteOpen: false });
      return true;
    }
    if (state.quickLookOpen) {
      set({ quickLookOpen: false });
      return true;
    }
    if (state.appearanceOpen) {
      set({ appearanceOpen: false });
      return true;
    }
    if (state.shortcutsOpen) {
      set({ shortcutsOpen: false });
      return true;
    }
    if (state.indexingOpen) {
      set({ indexingOpen: false });
      return true;
    }
    if (state.selectedFileId) {
      set({ selectedFileId: null, selectedFileIds: [] });
      return true;
    }
    return false;
  },
}));
