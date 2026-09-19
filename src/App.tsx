import { useEffect } from 'react';
import { useAppearance } from '@/hooks/useAppearance';
import { useDropImport } from '@/hooks/useDropImport';
import { useHostBridge } from '@/hooks/useHostBridge';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { getHost, isTauri } from '@/services/host';
import { useArchiveStore } from '@/stores/archive';
import { AppShell } from '@/components/layout/AppShell';
import { NoticeHost } from '@/components/layout/NoticeHost';
import { ShortcutsSheet } from '@/components/layout/ShortcutsSheet';
import { FileContextMenu } from '@/components/files/FileContextMenu';
import { QuickLook } from '@/components/files/QuickLook';
import { CommandPalette } from '@/components/search/CommandPalette';
import { LogoMark } from '@/components/common/Logo';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';

/** Shown for the handful of milliseconds before the first index read lands. */
function BootScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <div className="af-pulse-slow">
        <LogoMark size={40} />
      </div>
      <div className="text-center">
        <p className="text-body font-medium text-ink">AfterImage</p>
        <p className="mt-0.5 text-meta text-ink-3">Opening your local archive…</p>
      </div>
    </div>
  );
}

function LoadFailure({ message }: { message: string }) {
  const load = useArchiveStore((state) => state.load);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-critical">
        <Icon name="AlertTriangle" size={20} strokeWidth={1.9} />
      </span>
      <div>
        <p className="text-[15px] font-semibold text-ink">The archive could not be opened</p>
        <p className="mt-1 max-w-[420px] text-meta text-ink-2">{message}</p>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          icon="RefreshCw"
          onClick={() => {
            useArchiveStore.setState({ status: 'idle', error: null });
            void load();
          }}
        >
          Try again
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (isTauri()) return;
            localStorage.clear();
            window.location.reload();
          }}
        >
          Reset local data
        </Button>
      </div>
      <p className="mt-2 text-2xs text-ink-3">
        Host: {getHost().name} · your files were never moved or modified
      </p>
    </div>
  );
}

/**
 * Application root.
 *
 * Global behaviour only: appearance, host events, drag-and-drop, shortcuts and
 * the overlays that must exist exactly once. Everything else lives in the shell.
 */
export default function App() {
  useAppearance();
  useHostBridge();
  useDropImport();
  useKeyboardShortcuts();

  const status = useArchiveStore((state) => state.status);
  const error = useArchiveStore((state) => state.error);
  const load = useArchiveStore((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  if (status === 'error' && error) return <LoadFailure message={error} />;
  if (status === 'idle' || status === 'loading') return <BootScreen />;

  return (
    <>
      <AppShell />
      <FileContextMenu />
      <CommandPalette />
      <QuickLook />
      <ShortcutsSheet />
      <NoticeHost />
    </>
  );
}
