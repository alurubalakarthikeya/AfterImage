import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileKind } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useSearchStore } from '@/stores/search';
import { useUIStore } from '@/stores/ui';
import { topTags } from '@/stores/selectors';
import { cn, formatCount } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { Kbd } from '@/components/common/Badge';
import { FileThumb } from '@/components/common/FileThumb';

const QUICK_KINDS: Array<{ kind: FileKind; label: string; icon: string }> = [
  { kind: 'screenshot', label: 'Screenshots', icon: 'MonitorSmartphone' },
  { kind: 'photo', label: 'Photos', icon: 'Image' },
  { kind: 'document', label: 'Documents', icon: 'FileText' },
  { kind: 'video', label: 'Videos', icon: 'Film' },
];

/**
 * The main search field.
 *
 * Ordinary on purpose: no "Ask AI", no sparkle, no chat affordance. Typing runs
 * the local index as you go and the dropdown previews the top matches; Enter
 * commits to the search route, Ctrl/Cmd+K opens the full palette.
 */
export function SearchBar({ className }: { className?: string }) {
  const draft = useSearchStore((state) => state.draft);
  const hits = useSearchStore((state) => state.hits);
  const total = useSearchStore((state) => state.total);
  const status = useSearchStore((state) => state.status);
  const history = useSearchStore((state) => state.history);
  const interpretation = useSearchStore((state) => state.interpretation);
  const setDraft = useSearchStore((state) => state.setDraft);
  const submit = useSearchStore((state) => state.submit);
  const clear = useSearchStore((state) => state.clear);
  const useHistory = useSearchStore((state) => state.useHistory);

  const tags = useArchiveStore((state) => state.tags);
  const folderCount = useArchiveStore((state) => state.folders.length);
  const navigate = useUIStore((state) => state.navigate);
  const selectFile = useUIStore((state) => state.selectFile);

  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced preview. The store replaces results wholesale, so a slow request
  // cannot overwrite a newer one.
  useEffect(() => {
    if (!draft.trim()) return;
    const timer = setTimeout(() => {
      void submit(draft, { navigate: false });
    }, 220);
    return () => clearTimeout(timer);
  }, [draft, submit]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setFocused(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, []);

  const showSuggestions = focused && (draft.trim().length > 0 || history.length > 0);
  const preview = hits.slice(0, 5);
  const suggestions = useMemo(() => topTags(tags, 6), [tags]);

  return (
    <div ref={containerRef} className={cn('relative w-full max-w-[720px]', className)}>
      <div
        className={cn(
          'flex h-[42px] items-center gap-2.5 rounded-[14px] border bg-surface px-3.5 transition-[border-color,box-shadow] duration-150',
          focused ? 'border-accent/45' : 'border-line',
        )}
        style={{ boxShadow: 'var(--af-shadow-soft)' }}
      >
        <Icon name="Search" size={16} strokeWidth={2} className="shrink-0 text-ink-3" />
        <input
          ref={inputRef}
          data-search-input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (!event.target.value) clear();
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (!draft.trim()) return;
              void submit(draft);
              setFocused(false);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              clear();
              inputRef.current?.blur();
              setFocused(false);
            }
          }}
          placeholder={
            folderCount === 0
              ? 'Add a folder to start searching your archive…'
              : "Search files, text, tags, folders, or describe what you're looking for…"
          }
          aria-label="Search the archive"
          className="h-full min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-3"
          spellCheck={false}
          autoComplete="off"
        />
        {draft ? (
          <button
            type="button"
            onClick={() => {
              clear();
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
          >
            <Icon name="X" size={13} strokeWidth={2.4} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => useUIStore.getState().setPaletteOpen(true)}
          className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-line px-1.5 py-0.5 text-ink-3 transition-colors duration-150 hover:border-line-strong hover:text-ink-2 sm:inline-flex"
          aria-label="Open command palette"
        >
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </button>
      </div>

      <AnimatePresence>
        {showSuggestions && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14, ease: [0.2, 0.8, 0.2, 1] }}
            className="glass-float absolute left-0 right-0 top-[calc(100%+8px)] z-40 overflow-hidden rounded-card border border-line"
            style={{ boxShadow: 'var(--af-shadow-float)' }}
          >
            {draft.trim() && interpretation && (
              <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-2xs text-ink-3">
                <Icon name="SlidersHorizontal" size={12} strokeWidth={2} />
                <span className="truncate">Understood: {interpretation.summary}</span>
              </div>
            )}

            {preview.length > 0 && (
              <div className="p-1.5">
                {preview.map((hit) => (
                  <button
                    key={hit.file.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      selectFile(hit.file.id);
                      navigate('search');
                      setFocused(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-left transition-colors duration-100 hover:bg-surface-3"
                  >
                    <FileThumb
                      file={hit.file}
                      aspect={1}
                      rounded="rounded-md"
                      className="h-8 w-8 shrink-0"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">
                        {hit.file.generatedTitle ?? hit.file.name}
                      </span>
                      <span className="block truncate text-2xs text-ink-3">
                        {MATCH_LABEL[hit.match]} · {hit.file.folderPath}
                      </span>
                    </span>
                    <Icon name="ArrowUpRight" size={13} className="shrink-0 text-ink-3" />
                  </button>
                ))}
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    void submit(draft);
                    setFocused(false);
                  }}
                  className="mt-1 flex w-full items-center justify-between rounded-[10px] px-2.5 py-2 text-meta font-medium text-accent-ink transition-colors duration-150 hover:bg-surface-2"
                >
                  <span>Show all {formatCount(total)} results</span>
                  <Icon name="CornerDownLeft" size={13} />
                </button>
              </div>
            )}

            {draft.trim() && preview.length === 0 && status === 'empty' && (
              <p className="px-3.5 py-3 text-meta text-ink-3">
                Nothing indexed matches “{draft.trim()}” yet.
              </p>
            )}

            {!draft.trim() && history.length > 0 && (
              <div className="p-1.5">
                <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                  Recent searches
                </div>
                {history.slice(0, 5).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      useHistory(item);
                      navigate('search');
                      setFocused(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-body text-ink-2 transition-colors duration-100 hover:bg-surface-3 hover:text-ink"
                  >
                    <Icon name="Clock" size={13} className="text-ink-3" />
                    <span className="truncate">{item}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2.5">
              {QUICK_KINDS.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setDraft(`kind:${option.kind} `);
                    inputRef.current?.focus();
                  }}
                  className="inline-flex items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 py-1 text-2xs text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
                >
                  <Icon name={option.icon} size={11} strokeWidth={2} />
                  {option.label}
                </button>
              ))}
              {suggestions.slice(0, 3).map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setDraft(`${draft} #${tag.name}`.trim());
                    inputRef.current?.focus();
                  }}
                  className="inline-flex items-center gap-1 rounded-pill bg-surface-2 px-2.5 py-1 text-2xs text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
                >
                  # {tag.name}
                </button>
              ))}
              {status === 'searching' && (
                <span className="ml-auto text-2xs text-ink-3">Searching…</span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Where a hit was found, in the words the results list uses. */
export const MATCH_LABEL: Record<string, string> = {
  filename: 'Filename',
  text: 'Extracted text',
  tag: 'Tag',
  folder: 'Folder',
  project: 'Project',
  collection: 'Collection',
  semantic: 'Similar meaning',
};
