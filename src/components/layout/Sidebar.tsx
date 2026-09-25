import { useEffect, useRef, useState } from 'react';
import type { ArchiveCollection, ContextMenuItem, RouteId } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useCollectionStore } from '@/stores/collections';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { usePeopleStore } from '@/stores/people';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { cn, formatStorage } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { ProgressBar } from '@/components/common/ProgressBar';
import { Tooltip } from '@/components/common/Tooltip';
import { Avatar } from '@/components/common/Avatar';
import { IconButton } from '@/components/common/IconButton';
import { ContextMenu } from '@/components/common/ContextMenu';
import { Modal } from '@/components/common/Overlay';
import { PromptDialog } from '@/components/common/PromptDialog';
import { Button } from '@/components/common/Button';

interface NavItem {
  id: RouteId;
  label: string;
  icon: string;
  count?: number;
}

function Row({
  icon,
  label,
  count,
  active,
  collapsed,
  onClick,
  onContextMenu,
  dim,
  trailing,
}: {
  icon: string;
  label: string;
  count?: number;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  dim?: boolean;
  trailing?: React.ReactNode;
}) {
  const content = (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group/row relative flex h-10 w-full items-center rounded-[10px] transition-[background-color,color] duration-150',
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-3',
        active
          ? 'bg-surface-3 text-ink'
          : cn('text-ink-2 hover:bg-surface-3 hover:text-ink', dim && 'text-ink-3'),
      )}
    >
      <Icon name={icon} size={18} strokeWidth={1.9} className="shrink-0" />
      {!collapsed && (
        <>
          <span className={cn('min-w-0 flex-1 truncate text-left text-body', active && 'font-medium')}>
            {label}
          </span>
          {trailing}
          {count !== undefined && (
            <span className="shrink-0 text-2xs tabular-nums text-ink-3">
              {count > 99999 ? `${Math.round(count / 1000)}k` : count.toLocaleString('en-US')}
            </span>
          )}
        </>
      )}
    </button>
  );

  return collapsed ? (
    <Tooltip label={label} side="right" className="w-full">
      {content}
    </Tooltip>
  ) : (
    content
  );
}

export function Sidebar() {
  const storedCollapsed = useUIStore((state) => state.sidebarCollapsed);
  const roomForLabels = useMediaQuery('(min-width: 768px)');
  // On a phone the rail is always collapsed. The preference itself is left
  // alone — widening the window restores exactly the sidebar that was chosen.
  const collapsed = roomForLabels ? storedCollapsed : true;
  const route = useUIStore((state) => state.route);
  const navigate = useUIStore((state) => state.navigate);
  const activeCollectionId = useUIStore((state) => state.activeCollectionId);
  const toggleSidebar = useUIStore((state) => state.toggleSidebar);
  const setActiveCollection = useUIStore((state) => state.setActiveCollection);

  const totals = useArchiveStore((state) => state.totals);
  const peopleCount = usePeopleStore((state) => state.stats.people);
  const storage = useArchiveStore((state) => state.storage);
  const collections = useArchiveStore((state) => state.collections);

  const draftOpen = useCollectionStore((state) => state.draftOpen);
  const draftName = useCollectionStore((state) => state.draftName);
  const beginDraft = useCollectionStore((state) => state.beginDraft);
  const cancelDraft = useCollectionStore((state) => state.cancelDraft);
  const setDraftName = useCollectionStore((state) => state.setDraftName);
  const submitDraft = useCollectionStore((state) => state.submitDraft);
  const openCollection = useCollectionStore((state) => state.open);
  const recentIds = useCollectionStore((state) => state.recentIds);

  const renameCollection = useArchiveStore((state) => state.renameCollection);
  const deleteCollection = useArchiveStore((state) => state.deleteCollection);

  // Renaming, confirming a delete and the row the menu belongs to. The menu is
  // rendered here rather than in the page so a collection can be managed from
  // the navigation it lives in, which is where the user is looking at it.
  const [menu, setMenu] = useState<{ x: number; y: number; collection: ArchiveCollection } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<ArchiveCollection | null>(null);
  const [doomed, setDoomed] = useState<ArchiveCollection | null>(null);

  const userName = useSettingsStore((state) => state.userName);
  const accountLabel = useSettingsStore((state) => state.accountLabel);
  const draftRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (draftOpen) draftRef.current?.focus();
  }, [draftOpen]);

  const nav: NavItem[] = [
    { id: 'home', label: 'Home', icon: 'Home' },
    { id: 'all', label: 'All Files', icon: 'Files', count: totals.files },
    { id: 'photos', label: 'Photos', icon: 'Image', count: totals.byKind.photo },
    { id: 'screenshots', label: 'Screenshots', icon: 'MonitorSmartphone', count: totals.byKind.screenshot },
    { id: 'documents', label: 'Documents', icon: 'FileText', count: totals.byKind.document },
    { id: 'videos', label: 'Videos', icon: 'Film', count: totals.byKind.video },
    { id: 'people', label: 'People', icon: 'Users', count: peopleCount },
  ];

  // Collections created this session float to the top; the rest keep the
  // order the index returned them in.
  const orderedCollections = [
    ...recentIds
      .map((id) => collections.find((collection) => collection.id === id))
      .filter((collection): collection is (typeof collections)[number] => Boolean(collection)),
    ...collections.filter((collection) => !recentIds.includes(collection.id)),
  ];

  // Where the platform cannot report volume capacity the widget says what is
  // indexed instead of inventing a fraction of a disk it never measured.
  const capacityKnown = storage.totalBytes > 0;
  const usedPercent = capacityKnown ? storage.usedBytes / storage.totalBytes : 0;

  const sidebar = (
    <aside
      className={cn(
        // `relative z-20` is what keeps this column's own content above the
        // workspace beside it. The rows are unpositioned, so without a stacking
        // context of its own a hovered label or an open tooltip — both of which
        // paint outside the column — were composited under the workspace and
        // arrived half-covered. The window bars keep the higher z they already
        // had (status 30, title 40), which is the order they should sit in.
        'glass relative z-20 flex min-h-0 flex-col rounded-panel border border-line p-2',
        collapsed ? 'gap-2' : 'gap-1',
      )}
      aria-label="Primary"
    >
      {/* The brand lives in the title bar, where the window's identity belongs.
          What is left here is the control that resizes the column — and on a
          phone there is nothing to resize: the rail is already the whole
          column, so the control would promise an expansion that cannot fit. */}
      {roomForLabels && (
        <div
          className={cn(
            'flex items-center pb-2',
            collapsed ? 'justify-center px-0' : 'justify-end px-0.5',
          )}
        >
          <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
            <IconButton
              size="sm"
              label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={toggleSidebar}
            >
              <Icon name="PanelLeft" size={15} strokeWidth={1.9} />
            </IconButton>
          </Tooltip>
        </div>
      )}

      <nav className="flex flex-col gap-0.5">
        {nav.map((item) => (
          <Row
            key={item.id}
            icon={item.icon}
            label={item.label}
            count={item.id === 'home' ? undefined : item.count}
            collapsed={collapsed}
            // One person's page is still the People section, so the row stays lit
            // while the user is inside a group.
            active={route === item.id || (item.id === 'people' && route === 'person')}
            onClick={() => navigate(item.id)}
          />
        ))}
      </nav>

      <div className="my-3 h-px bg-line" />

      {/* Collections */}
      <div className={cn('flex items-center pb-1', collapsed ? 'justify-center' : 'px-3')}>
        {!collapsed && (
          <span className="flex-1 text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
            Collections
          </span>
        )}
        <Tooltip label="New collection" side={collapsed ? 'right' : 'bottom'}>
          <IconButton size="xs" label="New collection" onClick={beginDraft}>
            <Icon name="Plus" size={14} strokeWidth={2.2} />
          </IconButton>
        </Tooltip>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pb-2">
        {orderedCollections.length === 0 && !collapsed && !draftOpen && (
          <p className="px-3 py-2 text-2xs leading-relaxed text-ink-3">
            No collections yet. Group files by hand, or save a rule that keeps itself up to date.
          </p>
        )}
        {orderedCollections.map((collection) => (
          <Row
            key={collection.id}
            icon={collection.icon}
            label={collection.name}
            count={collection.fileCount}
            collapsed={collapsed}
            active={route === 'collections' && activeCollectionId === collection.id}
            onClick={() => openCollection(collection.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ x: event.clientX, y: event.clientY, collection });
            }}
            trailing={
              collection.kind === 'smart' ? (
                <Icon name="Layers" size={11} strokeWidth={1.9} className="text-ink-3/70" />
              ) : undefined
            }
          />
        ))}

        {!collapsed && (
          <div className="mt-1 px-1">
            {draftOpen ? (
              <input
                ref={draftRef}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitDraft();
                  if (event.key === 'Escape') cancelDraft();
                }}
                onBlur={() => (draftName.trim() ? void submitDraft() : cancelDraft())}
                placeholder="Collection name"
                className="h-9 w-full rounded-[10px] border border-line-strong bg-surface px-3 text-body text-ink outline-none placeholder:text-ink-3"
              />
            ) : (
              <button
                type="button"
                onClick={beginDraft}
                className="flex h-9 w-full items-center gap-2 rounded-[10px] px-3 text-meta text-ink-3 transition-colors duration-150 hover:bg-surface-3 hover:text-ink-2"
              >
                <Icon name="Plus" size={14} strokeWidth={2.2} />
                New Collection
              </button>
            )}
          </div>
        )}
      </div>

      {/* Storage — present, quiet, never the focus. */}
      {!collapsed && (
        <div className="mt-2 rounded-card border border-line bg-surface p-3" style={{ boxShadow: 'var(--af-shadow-soft)' }}>
          <div className="flex items-baseline justify-between">
            <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
              Local Storage
            </span>
            <span className="text-2xs tabular-nums text-ink-3">
              {capacityKnown ? `${Math.round(usedPercent * 100)}%` : `${storage.indexedFiles}`}
            </span>
          </div>
          <div className="mt-1.5 text-meta text-ink-2">
            <span className="font-medium text-ink">{formatStorage(storage.usedBytes)}</span>{' '}
            {capacityKnown ? `of ${formatStorage(storage.totalBytes)} used` : 'indexed'}
          </div>
          <ProgressBar
            value={storage.usedBytes}
            max={capacityKnown ? storage.totalBytes : Math.max(1, storage.usedBytes)}
            className="mt-2"
            height={3}
          />
          {(storage.pendingFiles > 0 || storage.failedFiles > 0) && (
            <div className="mt-1.5 text-[10px] text-ink-3">
              {storage.pendingFiles > 0 ? `${storage.pendingFiles} queued` : null}
              {storage.pendingFiles > 0 && storage.failedFiles > 0 ? ' · ' : null}
              {storage.failedFiles > 0 ? `${storage.failedFiles} failed` : null}
            </div>
          )}
        </div>
      )}

      {/* Account */}
      <div
        className={cn(
          'mt-2 flex items-center gap-2.5',
          collapsed ? 'justify-center' : 'rounded-card px-1 py-1',
        )}
      >
        <Avatar name={userName} size={collapsed ? 28 : 32} />
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1">
              <div className="truncate text-body font-medium leading-tight text-ink">{userName}</div>
              <div className="truncate text-2xs leading-tight text-ink-3">{accountLabel}</div>
            </div>
            <Tooltip label="Settings" side="top">
              <IconButton size="sm" label="Settings" onClick={() => navigate('settings')}>
                <Icon name="Settings" size={16} strokeWidth={1.9} />
              </IconButton>
            </Tooltip>
          </>
        )}
      </div>
    </aside>
  );

  const menuItems: ContextMenuItem[] = menu
    ? [
        { id: 'open', label: 'Open', icon: 'Layers' },
        { id: 'rename', label: 'Rename…', icon: 'Pencil' },
        { id: 'delete', label: 'Delete collection', icon: 'Trash2', danger: true, separatorBefore: true },
      ]
    : [];

  return (
    <>
      {sidebar}

      {menu && (
        <ContextMenu
          items={menuItems}
          x={menu.x}
          y={menu.y}
          onCommand={(id) => {
            const collection = menu.collection;
            if (id === 'open') openCollection(collection.id);
            if (id === 'rename') setRenaming(collection);
            if (id === 'delete') setDoomed(collection);
          }}
          onClose={() => setMenu(null)}
        />
      )}

      <PromptDialog
        open={renaming !== null}
        title="Rename collection"
        description="Only the name changes — the files inside keep their names, paths and tags."
        initialValue={renaming?.name ?? ''}
        placeholder="Collection name"
        confirmLabel="Rename"
        onConfirm={(name) => {
          if (renaming) void renameCollection(renaming.id, name);
        }}
        onClose={() => setRenaming(null)}
      />

      <Modal open={doomed !== null} onClose={() => setDoomed(null)} className="max-w-[440px]">
        <div className="p-5">
          <h2 className="text-section font-semibold text-ink">Delete {doomed?.name}?</h2>
          <p className="mt-2 text-meta leading-relaxed text-ink-2">
            The collection is removed. The {doomed?.fileCount ?? 0} files inside it stay exactly
            where they are — nothing on disk is moved, renamed or deleted.
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setDoomed(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon="Trash2"
              onClick={() => {
                const collection = doomed;
                setDoomed(null);
                if (!collection) return;
                if (collection.id === activeCollectionId) setActiveCollection(null);
                void deleteCollection(collection.id);
              }}
            >
              Delete collection
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
