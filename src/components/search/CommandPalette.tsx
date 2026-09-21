import { useEffect, useMemo, useRef, useState } from 'react';
import type { RouteId } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useCollectionStore } from '@/stores/collections';
import { useSearchStore } from '@/stores/search';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { Scrim } from '@/components/common/Overlay';
import { Icon } from '@/components/common/Icon';
import { Kbd } from '@/components/common/Badge';
import { FileThumb } from '@/components/common/FileThumb';
import { cn, formatBytes } from '@/utils/format';

interface PaletteEntry {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: string;
  run: () => void;
  thumbFileId?: string;
}

const NAV_TARGETS: Array<{ id: RouteId; label: string; icon: string }> = [
  { id: 'home', label: 'Home', icon: 'Home' },
  { id: 'all', label: 'All Files', icon: 'Files' },
  { id: 'photos', label: 'Photos', icon: 'Image' },
  { id: 'screenshots', label: 'Screenshots', icon: 'MonitorSmartphone' },
  { id: 'documents', label: 'Documents', icon: 'FileText' },
  { id: 'videos', label: 'Videos', icon: 'Film' },
  { id: 'collections', label: 'Collections', icon: 'Folder' },
  { id: 'settings', label: 'Settings', icon: 'Settings' },
];

/**
 * The command palette.
 *
 * One input over three kinds of result: files from the local index, places to
 * go, and things to do. Filter prefixes (`kind:`, `#tag`, `is:fav`) work here
 * exactly as they do in the toolbar, because it is the same parser.
 */
export function CommandPalette() {
  const open = useUIStore((state) => state.paletteOpen);
  const setOpen = useUIStore((state) => state.setPaletteOpen);
  const navigate = useUIStore((state) => state.navigate);
  const selectFile = useUIStore((state) => state.selectFile);
  const setViewMode = useUIStore((state) => state.setViewMode);
  const toggleInspector = useUIStore((state) => state.toggleInspector);

  const draft = useSearchStore((state) => state.draft);
  const hits = useSearchStore((state) => state.hits);
  const interpretation = useSearchStore((state) => state.interpretation);
  const setDraft = useSearchStore((state) => state.setDraft);
  const submit = useSearchStore((state) => state.submit);
  const clear = useSearchStore((state) => state.clear);
  const history = useSearchStore((state) => state.history);

  const addFolder = useArchiveStore((state) => state.addFolder);
  const beginDraft = useCollectionStore((state) => state.beginDraft);
  const appearance = useSettingsStore((state) => state.appearance);
  const setAppearance = useSettingsStore((state) => state.setAppearance);

  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = draft.trim();
    if (!query) return;
    const timer = setTimeout(() => void submit(query, { navigate: false }), 180);
    return () => clearTimeout(timer);
  }, [open, draft, submit]);

  const close = () => {
    setOpen(false);
    clear();
  };

  const entries = useMemo<PaletteEntry[]>(() => {
    const query = draft.trim().toLowerCase();
    const list: PaletteEntry[] = [];

    if (query) {
      for (const hit of hits.slice(0, 6)) {
        list.push({
          id: `file-${hit.file.id}`,
          group: 'Files',
          label: hit.file.generatedTitle ?? hit.file.name,
          hint:
            hit.match === 'text'
              ? 'found in extracted text'
              : `${hit.file.kind} · ${formatBytes(hit.file.bytes)}`,
          run: () => {
            navigate('search');
            selectFile(hit.file.id);
          },
          thumbFileId: hit.file.id,
        });
      }
      list.push({
        id: 'search-all',
        group: 'Files',
        label: `Show all results for “${draft.trim()}”`,
        icon: 'Search',
        run: () => {
          void submit(draft);
          navigate('search');
        },
      });
    } else {
      for (const item of history.slice(0, 3)) {
        list.push({
          id: `history-${item}`,
          group: 'Recent searches',
          label: item,
          icon: 'Clock',
          run: () => {
            setDraft(item);
            void submit(item, { navigate: false });
          },
        });
      }
    }

    for (const target of NAV_TARGETS) {
      if (query && !target.label.toLowerCase().includes(query)) continue;
      list.push({
        id: `nav-${target.id}`,
        group: 'Go to',
        label: target.label,
        icon: target.icon,
        run: () => navigate(target.id),
      });
    }

    const actions: PaletteEntry[] = [
      {
        id: 'add-folder',
        group: 'Actions',
        label: 'Add a folder to index…',
        hint: 'Ctrl O',
        icon: 'FolderPlus',
        run: () => {
          close();
          void addFolder();
        },
      },
      {
        id: 'collection',
        group: 'Actions',
        label: 'New collection…',
        icon: 'FolderPlus',
        run: () => {
          close();
          beginDraft();
        },
      },
      {
        id: 'theme',
        group: 'Actions',
        label: `Switch to ${appearance === 'dark' ? 'light' : 'dark'} appearance`,
        icon: appearance === 'dark' ? 'Sun' : 'Moon',
        run: () => setAppearance(appearance === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'list',
        group: 'Actions',
        label: 'Switch to list view',
        icon: 'List',
        run: () => setViewMode('list'),
      },
      {
        id: 'density',
        group: 'Actions',
        label: 'Compact density',
        icon: 'Rows3',
        run: () => useSettingsStore.getState().setDensity('compact'),
      },
      {
        id: 'inspector',
        group: 'Actions',
        label: 'Toggle inspector',
        hint: 'Ctrl I',
        icon: 'PanelRight',
        run: () => toggleInspector(),
      },
    ];

    for (const action of actions) {
      if (query && !action.label.toLowerCase().includes(query)) continue;
      list.push(action);
    }

    return list;
  }, [
    draft,
    hits,
    history,
    appearance,
    setAppearance,
    setDraft,
    submit,
    navigate,
    selectFile,
    addFolder,
    beginDraft,
    setViewMode,
    toggleInspector,
  ]);

  useEffect(() => {
    setActiveIndex(0);
  }, [draft, open]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(entries.length - 1, index + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const entry = entries[activeIndex];
      if (entry) {
        entry.run();
        if (entry.group !== 'Actions' || entry.id !== 'theme') setOpen(false);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  if (!open) return null;

  let lastGroup = '';

  return (
    <>
      <Scrim onClick={close} />
      <div className="pointer-events-none fixed inset-0 z-50 flex justify-center px-6 pt-[10vh]">
        <div
          className="glass-float pointer-events-auto flex max-h-[560px] w-full max-w-[620px] flex-col overflow-hidden rounded-card-lg border border-line"
          style={{ boxShadow: 'var(--af-shadow-float)' }}
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <Icon name="Search" size={17} strokeWidth={2} className="shrink-0 text-ink-3" />
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search the archive or run a command…"
              spellCheck={false}
              className="h-6 min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-3"
            />
            <Kbd>Esc</Kbd>
          </div>

          {interpretation && (
            <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2 text-2xs text-ink-3">
              <Icon name="SlidersHorizontal" size={12} strokeWidth={2} />
              <span className="truncate">{interpretation.summary}</span>
            </div>
          )}

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2">
            {entries.length === 0 && (
              <div className="px-3 py-8 text-center text-meta text-ink-3">
                No matches. Try a tag, a file type, or “errors last week”.
              </div>
            )}

            {entries.map((entry, index) => {
              const showGroup = entry.group !== lastGroup;
              lastGroup = entry.group;
              const active = index === activeIndex;
              const thumbFile = entry.thumbFileId
                ? hits.find((hit) => hit.file.id === entry.thumbFileId)?.file
                : undefined;

              return (
                <div key={entry.id}>
                  {showGroup && (
                    <div className="px-2.5 pb-1 pt-2.5 text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                      {entry.group}
                    </div>
                  )}
                  <button
                    type="button"
                    data-index={index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      entry.run();
                      if (entry.id !== 'theme') setOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors duration-100',
                      active ? 'bg-surface-3' : 'hover:bg-surface-2',
                    )}
                  >
                    {thumbFile ? (
                      <FileThumb
                        file={thumbFile}
                        aspect={1}
                        rounded="rounded-[7px]"
                        className="h-7 w-7 shrink-0"
                      />
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-surface-2 text-ink-3">
                        <Icon name={entry.icon ?? 'Command'} size={14} strokeWidth={1.9} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body text-ink">{entry.label}</span>
                      {entry.hint && (
                        <span className="block truncate text-2xs text-ink-3">{entry.hint}</span>
                      )}
                    </span>
                    {active && <Icon name="CornerDownLeft" size={13} className="shrink-0 text-ink-3" />}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-4 border-t border-line bg-surface-2 px-4 py-2 text-2xs text-ink-3">
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> navigate
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↵</Kbd> open
            </span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              <Icon name="Shield" size={11} strokeWidth={2} />
              Runs locally
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
