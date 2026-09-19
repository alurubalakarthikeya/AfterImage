import { create } from 'zustand';
import type { FileKind, QueryInterpretation, SearchHit } from '@/types';
import { getHost } from '@/services/host';
import { useArchiveStore } from './archive';
import { useUIStore } from './ui';

export interface SearchFilters {
  kind?: FileKind;
  tagIds: string[];
  favoritesOnly: boolean;
  sinceDays?: number;
}

export type SearchStatus = 'idle' | 'typing' | 'searching' | 'ready' | 'empty' | 'error';

const HISTORY_KEY = 'afterimage.search-history.v1';

/** Fallback for callers that need a stable empty list. */
export const EMPTY_TERMS: string[] = [];

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as string[]).slice(0, 24) : [];
  } catch {
    return [];
  }
}

function writeHistory(history: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 24)));
  } catch {
    /* ignore quota errors */
  }
}

export interface SearchState {
  /** What is in the input right now. */
  draft: string;
  /** The query that produced the current results. */
  submitted: string;
  filters: SearchFilters;
  hits: SearchHit[];
  total: number;
  status: SearchStatus;
  interpretation: QueryInterpretation | null;
  semanticAvailable: boolean;
  /** Set when retrieval failed, so the UI can explain rather than say "no results". */
  error: string | null;
  history: string[];
  /** Search terms echoed by the index, used to highlight excerpts. */
  terms: string[];

  setDraft: (draft: string) => void;
  setFilter: (patch: Partial<SearchFilters>) => void;
  clearFilters: () => void;
  submit: (value?: string, options?: { navigate?: boolean }) => Promise<void>;
  rerun: () => Promise<void>;
  clear: () => void;
  removeHistory: (value: string) => void;
  useHistory: (value: string) => void;
}

export const useSearchStore = create<SearchState>()((set, get) => ({
  draft: '',
  submitted: '',
  filters: { tagIds: [], favoritesOnly: false },
  hits: [],
  total: 0,
  status: 'idle',
  interpretation: null,
  semanticAvailable: false,
  error: null,
  history: readHistory(),
  terms: EMPTY_TERMS,

  setDraft: (draft) => set({ draft, status: draft.trim() ? 'typing' : 'idle' }),

  setFilter: (patch) =>
    set((state) => {
      const filters = { ...state.filters, ...patch };
      if (state.submitted) void get().rerun();
      return { filters };
    }),

  clearFilters: () => {
    set({ filters: { tagIds: [], favoritesOnly: false } });
    if (get().submitted) void get().rerun();
  },

  async submit(value, options) {
    const raw = (value ?? get().draft).trim();
    const navigate = options?.navigate ?? true;
    if (raw.length === 0) {
      set({ status: 'idle', hits: [], total: 0, interpretation: null, error: null, terms: EMPTY_TERMS });
      return;
    }

    set({ status: 'searching', submitted: raw, draft: raw, error: null });
    if (navigate) useUIStore.getState().navigate('search');

    const { filters } = get();
    try {
      const response = await getHost().search({
        raw,
        kind: filters.kind,
        tagIds: filters.tagIds.length > 0 ? filters.tagIds : undefined,
        favoritesOnly: filters.favoritesOnly || undefined,
        sinceDays: filters.sinceDays,
      });

      if (response.error) {
        set({
          status: 'error',
          error: response.error,
          hits: [],
          total: 0,
          interpretation: response.interpretation,
          semanticAvailable: response.semanticAvailable,
          terms: response.interpretation.terms,
        });
      } else {
        set({
          status: response.hits.length > 0 ? 'ready' : 'empty',
          error: null,
          hits: response.hits,
          total: response.total,
          interpretation: response.interpretation,
          semanticAvailable: response.semanticAvailable,
          terms: response.interpretation.terms,
        });
      }

      useArchiveStoreRemember(response.hits);

      const history = [raw, ...get().history.filter((item) => item !== raw)].slice(0, 24);
      writeHistory(history);
      set({ history });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        hits: [],
        total: 0,
        terms: EMPTY_TERMS,
      });
    }
  },

  async rerun() {
    const { submitted } = get();
    if (submitted) await get().submit(submitted, { navigate: false });
  },

  clear: () =>
    set({
      draft: '',
      submitted: '',
      hits: [],
      total: 0,
      status: 'idle',
      interpretation: null,
      error: null,
      terms: EMPTY_TERMS,
    }),

  removeHistory: (value) => {
    const history = get().history.filter((item) => item !== value);
    writeHistory(history);
    set({ history });
  },

  useHistory: (value) => {
    set({ draft: value });
    void get().submit(value);
  },
}));

/**
 * Search results carry whole records, so they are handed to the archive store's
 * session cache. That is what lets the inspector, quick look and the context
 * menu work on a hit that is not in the page the grid happens to be showing.
 */
function useArchiveStoreRemember(hits: SearchHit[]): void {
  if (hits.length === 0) return;
  useArchiveStore.getState().remember(hits.map((hit) => hit.file));
}
