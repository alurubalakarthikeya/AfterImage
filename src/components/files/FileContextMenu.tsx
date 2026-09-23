import { useMemo, useState } from 'react';
import type { ContextMenuItem } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useCollectionStore } from '@/stores/collections';
import { topTags } from '@/stores/selectors';
import { useUIStore } from '@/stores/ui';
import { cn, splitExtension } from '@/utils/format';
import { ContextMenu } from '@/components/common/ContextMenu';
import { Modal } from '@/components/common/Overlay';
import { PromptDialog } from '@/components/common/PromptDialog';
import { Icon } from '@/components/common/Icon';
import { Button } from '@/components/common/Button';
import { TagPill } from '@/components/common/Badge';

/**
 * One context menu instance for the whole app.
 *
 * Cards, list rows and the inspector all just publish coordinates to the UI
 * store, so the menu behaves identically everywhere and the item list lives in
 * exactly one place.
 */
export function FileContextMenu() {
  const contextMenu = useUIStore((state) => state.contextMenu);
  const closeMenu = useUIStore((state) => state.closeContextMenu);
  const clearSelection = useUIStore((state) => state.clearSelection);
  const known = useArchiveStore((state) => state.known);
  const tags = useArchiveStore((state) => state.tags);
  const collections = useArchiveStore((state) => state.collections);
  const openFile = useArchiveStore((state) => state.openFile);
  const revealFile = useArchiveStore((state) => state.revealFile);
  const copyPath = useArchiveStore((state) => state.copyPath);
  const toggleFavorite = useArchiveStore((state) => state.toggleFavorite);
  const renameFile = useArchiveStore((state) => state.renameFile);
  const openWith = useArchiveStore((state) => state.openWith);
  const deleteFiles = useArchiveStore((state) => state.deleteFiles);
  const addTag = useArchiveStore((state) => state.addTag);
  const toggleCollection = useCollectionStore((state) => state.toggleFile);

  const setSimilarFor = useUIStore((state) => state.setSimilarFor);
  const setComparisonFor = useUIStore((state) => state.setComparisonFor);

  const [renameOpen, setRenameOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);

  const file = useMemo(
    () => (contextMenu?.fileId ? known[contextMenu.fileId] ?? null : null),
    [known, contextMenu?.fileId],
  );

  const suggestions = useMemo(() => topTags(tags, 8), [tags]);

  const items: ContextMenuItem[] = useMemo(() => {
    if (!file) {
      // Empty-space menu: the archive has no import step, only folders it may watch.
      return [
        { id: 'add-folder', label: 'Add a folder…', icon: 'FolderPlus', shortcut: 'Ctrl O' },
        { id: 'refresh', label: 'Refresh index', icon: 'RefreshCw', separatorBefore: true },
      ];
    }
    return [
      { id: 'open', label: 'Open', icon: 'ExternalLink', shortcut: '↵' },
      { id: 'open-with', label: 'Open with…', icon: 'AppWindow' },
      { id: 'reveal', label: 'Show in folder', icon: 'FolderOpen', shortcut: 'R' },
      {
        id: 'collections',
        label: 'Add to collection',
        icon: 'FolderPlus',
        separatorBefore: true,
        submenu: collections.slice(0, 9).map((collection) => ({
          id: `collection:${collection.id}`,
          label: file.collectionIds.includes(collection.id)
            ? `${collection.name} ✓`
            : collection.name,
          icon: collection.icon,
        })),
      },
      { id: 'tag', label: 'Add tag…', icon: 'Tag' },
      // A comparison needs two states of the same picture, so a file with no
      // presentation copy has nothing to put side by side.
      {
        id: 'compare',
        label: 'Compare before and after…',
        icon: 'Columns2',
        disabled: !file.previewPath,
      },
      { id: 'similar', label: 'Find similar', icon: 'Layers', disabled: !file.embeddingState || file.embeddingState === 'unavailable' },
      {
        id: 'favorite',
        label: file.favorite ? 'Remove from favourites' : 'Favourite',
        icon: 'Star',
        shortcut: 'F',
      },
      { id: 'copy', label: 'Copy path', icon: 'Copy', separatorBefore: true },
      { id: 'rename', label: 'Rename…', icon: 'Pencil' },
      { id: 'delete', label: 'Move to trash', icon: 'Trash2', danger: true, separatorBefore: true },
    ];
  }, [file, collections]);

  const onCommand = (id: string) => {
    if (!file) {
      if (id === 'add-folder') void useArchiveStore.getState().addFolder();
      if (id === 'refresh') void useArchiveStore.getState().refresh();
      return;
    }
    if (id.startsWith('collection:')) {
      toggleCollection(file.id, id.slice('collection:'.length));
      return;
    }
    switch (id) {
      case 'open':
        void openFile(file.id);
        break;
      case 'open-with':
        void openWith(file.id);
        break;
      case 'reveal':
        void revealFile(file.id);
        break;
      case 'copy':
        void copyPath(file.id);
        break;
      case 'favorite':
        toggleFavorite(file.id);
        break;
      case 'rename':
        setRenameOpen(true);
        break;
      case 'tag':
        setTagOpen(true);
        break;
      case 'compare':
        setComparisonFor(file.id);
        break;
      case 'similar':
        setSimilarFor(file.id);
        break;
      case 'delete':
        deleteFiles([file.id]);
        clearSelection();
        break;
      default:
        break;
    }
  };

  const { stem } = file ? splitExtension(file.name) : { stem: '' };

  return (
    <>
      {contextMenu && (
        <ContextMenu
          items={items}
          x={contextMenu.x}
          y={contextMenu.y}
          onCommand={onCommand}
          onClose={closeMenu}
        />
      )}

      <PromptDialog
        open={renameOpen}
        title="Rename file"
        description="Renames the file on disk and updates the index. AfterImage never renames anything on its own."
        initialValue={stem}
        placeholder="New name"
        confirmLabel="Rename"
        onConfirm={(value) => file && renameFile(file.id, value)}
        onClose={() => setRenameOpen(false)}
      />

      <Modal open={tagOpen} onClose={() => setTagOpen(false)} className="max-w-[440px]">
        <div className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">Add tag</h2>
          <p className="mt-1 text-meta text-ink-2">
            Tags drive smart collections and search filters.
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {suggestions
              .filter((tag) => !file?.tagIds.includes(tag.id))
              .slice(0, 8)
              .map((tag) => (
                <TagPill
                  key={tag.id}
                  label={`# ${tag.name}`}
                  className={cn('cursor-pointer')}
                  onClick={() => {
                    if (file) addTag(file.id, tag.name);
                  }}
                />
              ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem('tag') as HTMLInputElement | null;
              if (input?.value && file) addTag(file.id, input.value);
              setTagOpen(false);
            }}
            className="mt-4 flex items-center gap-2"
          >
            <input
              name="tag"
              autoFocus
              placeholder="New tag name"
              className="h-10 flex-1 rounded-input border border-line-strong bg-surface px-3 text-body text-ink outline-none transition-colors focus:border-line-strong"
            />
            <Button type="submit" variant="primary" size="sm" icon="Plus">
              Add
            </Button>
          </form>
          <div className="mt-5 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-2xs text-ink-3">
              <Icon name="Lock" size={12} />
              Tags stay on this machine
            </span>
            <Button variant="ghost" size="sm" onClick={() => setTagOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
