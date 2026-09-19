import { useEffect } from 'react';
import { getHost, isTauri } from '@/services/host';
import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';

/**
 * Drag a folder onto the window to index it.
 *
 * Inside Tauri the webview reports native drops with absolute paths, which is
 * the only way to know where a file actually lives. Dropping loose files adds
 * the folder that contains them: AfterImage indexes folders it may watch, not
 * one-off files it would have to copy — nothing is ever moved or duplicated.
 *
 * In a browser there are no real paths, so the drop is refused with an
 * explanation rather than accepted and silently ignored.
 */
export function useDropImport(): void {
  useEffect(() => {
    const setDropActive = (active: boolean) => useUIStore.getState().setDropActive(active);

    if (isTauri()) {
      let unlisten: (() => void) | undefined;
      let disposed = false;

      const accept = async (paths: string[]) => {
        const archive = useArchiveStore.getState();
        if (paths.length === 0) return;
        const unique = [...new Set(paths)];
        for (const path of unique) {
          await archive.addFolderPath(path);
        }
        if (unique.length > 1) {
          useUIStore
            .getState()
            .pushNotice({ level: 'success', message: `${unique.length} folders added to the index` });
        }
      };

      void (async () => {
        try {
          const { getCurrentWebview } = await import('@tauri-apps/api/webview');
          if (disposed) return;
          unlisten = await getCurrentWebview().onDragDropEvent((event) => {
            const payload = event.payload;
            if (payload.type === 'over' || payload.type === 'enter') setDropActive(true);
            else if (payload.type === 'leave') setDropActive(false);
            else if (payload.type === 'drop') {
              setDropActive(false);
              void accept(payload.paths);
            }
          });
        } catch {
          /* the overlay simply never appears; nothing else breaks */
        }
      })();

      return () => {
        disposed = true;
        unlisten?.();
      };
    }

    let depth = 0;

    const hasFiles = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDropActive(true);
    };

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropActive(false);
    };

    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDropActive(false);
      useUIStore.getState().pushNotice({
        level: 'warn',
        message: `Dropping folders needs the desktop build — ${getHost().name} cannot read this machine's filesystem.`,
      });
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);
}
