import { useEffect } from 'react';
import { useArchiveStore } from '@/stores/archive';
import { useSearchStore } from '@/stores/search';
import { useUIStore } from '@/stores/ui';

/**
 * Desktop key handling.
 *
 * Ctrl/Cmd+K  command palette      Enter   open selection
 * Ctrl/Cmd+F  focus search         Space   quick look
 * Ctrl/Cmd+O  add a folder         ← → ↑ ↓ move selection
 * Ctrl/Cmd+I  toggle inspector     Delete  move to trash
 * Ctrl/Cmd+1…9 jump to a section   Esc     dismiss, then deselect
 */

const ROUTE_ORDER = [
  'home',
  'all',
  'photos',
  'screenshots',
  'documents',
  'videos',
  'collections',
  'projects',
  'settings',
] as const;

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT' ||
    element.isContentEditable
  );
}

function focusSearch(): void {
  const input = document.querySelector<HTMLInputElement>('[data-search-input]');
  if (input) {
    input.focus();
    input.select();
  }
}

function fileNodes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-file-id]'));
}

/** Move the selection the way a native file browser would. */
function moveSelection(direction: 'up' | 'down' | 'left' | 'right'): void {
  const nodes = fileNodes();
  if (nodes.length === 0) return;
  const ui = useUIStore.getState();
  const index = nodes.findIndex((node) => node.dataset.fileId === ui.selectedFileId);

  if (index === -1) {
    const first = nodes[0];
    if (first?.dataset.fileId) ui.selectFile(first.dataset.fileId);
    return;
  }

  let target: HTMLElement | undefined;

  if (direction === 'left' || direction === 'right') {
    target = nodes[index + (direction === 'right' ? 1 : -1)];
  } else {
    const rect = nodes[index].getBoundingClientRect();
    const candidates = nodes
      .filter((node) => {
        const other = node.getBoundingClientRect();
        return direction === 'down' ? other.top > rect.top + 4 : other.bottom < rect.bottom - 4;
      })
      .map((node) => ({ node, rect: node.getBoundingClientRect() }));

    // Nearest in the next row: horizontal distance decides, edge gaps absorb.
    target = candidates.sort(
      (a, b) =>
        Math.abs(a.rect.left - rect.left) - Math.abs(b.rect.left - rect.left) +
        (direction === 'down' ? a.rect.top - b.rect.top : b.rect.bottom - a.rect.bottom) * 0.001,
    )[0]?.node;
  }

  if (target?.dataset.fileId) {
    useUIStore.getState().selectFile(target.dataset.fileId);
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const ui = useUIStore.getState();
      const archive = useArchiveStore.getState();
      const search = useSearchStore.getState();
      const mod = event.metaKey || event.ctrlKey;
      const typing = isTypingTarget(event.target);
      const key = event.key.toLowerCase();

      if (event.key === 'Escape') {
        if (ui.paletteOpen) {
          event.preventDefault();
          // Clearing the palette should also clear a running query.
          if (search.submitted) search.clear();
          ui.setPaletteOpen(false);
          return;
        }
        if (ui.dismissTop()) event.preventDefault();
        return;
      }

      if (mod && key === 'k') {
        event.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }
      if (mod && key === 'f') {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (mod && key === 'o') {
        // AfterImage indexes folders rather than importing files.
        event.preventDefault();
        void archive.addFolder();
        return;
      }
      if (mod && key === 'i') {
        event.preventDefault();
        ui.toggleInspector();
        return;
      }
      if (mod && event.key === '/') {
        event.preventDefault();
        ui.setShortcutsOpen(!ui.shortcutsOpen);
        return;
      }
      if (mod && key === 'a' && !typing) {
        event.preventDefault();
        const ids = fileNodes()
          .map((node) => node.dataset.fileId)
          .filter((id): id is string => Boolean(id));
        ui.selectMany(ids);
        return;
      }
      if (mod && /^[1-9]$/.test(event.key)) {
        const route = ROUTE_ORDER[Number(event.key) - 1];
        if (route) {
          event.preventDefault();
          ui.navigate(route);
        }
        return;
      }

      if (typing) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (ui.selectedFileIds.length > 0) {
          event.preventDefault();
          archive.deleteFiles(ui.selectedFileIds);
        }
        return;
      }
      if (event.key === 'Enter') {
        if (ui.selectedFileId) {
          event.preventDefault();
          void archive.openFile(ui.selectedFileId);
        }
        return;
      }
      if (event.key === ' ') {
        if (ui.selectedFileId) {
          event.preventDefault();
          ui.setQuickLookOpen(!ui.quickLookOpen);
        }
        return;
      }
      if (key === 'f' && !mod && ui.selectedFileId) {
        event.preventDefault();
        archive.toggleFavorite(ui.selectedFileId);
        return;
      }
      if (key === 'r' && !mod && ui.selectedFileId) {
        event.preventDefault();
        void archive.revealFile(ui.selectedFileId);
        return;
      }
      if (key === '/') {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (event.key.startsWith('Arrow')) {
        const map = {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right',
        } as const;
        const direction = map[event.key as keyof typeof map];
        if (direction) {
          event.preventDefault();
          moveSelection(direction);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
