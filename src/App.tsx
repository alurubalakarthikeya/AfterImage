import { useEffect, useState } from 'react';
import { dismissSplash, report } from '@/boot';
import { Landing } from '@/pages/Landing';
import { useAppearance } from '@/hooks/useAppearance';
import { useDropImport } from '@/hooks/useDropImport';
import { useHostBridge } from '@/hooks/useHostBridge';
import { useInstalledHistory } from '@/hooks/useInstalledHistory';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useLocalIdentity } from '@/hooks/useLocalIdentity';
import { getHost, isTauri } from '@/services/host';
import { useArchiveStore } from '@/stores/archive';
import { useSettingsStore } from '@/stores/settings';
import { watchInstallability } from '@/stores/pwa';
import { Onboarding } from '@/components/onboarding/Onboarding';
import { AppShell } from '@/components/layout/AppShell';
import { TitleBar } from '@/components/layout/TitleBar';
import { NoticeHost } from '@/components/layout/NoticeHost';
import { ShortcutsSheet } from '@/components/layout/ShortcutsSheet';
import { FileContextMenu } from '@/components/files/FileContextMenu';
import { QuickLook } from '@/components/files/QuickLook';
import { SimilarPanel } from '@/components/files/SimilarPanel';
import { Comparison } from '@/components/files/Comparison';
import { CommandPalette } from '@/components/search/CommandPalette';
import { Logo } from '@/components/common/Logo';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';

/**
 * A window before the archive exists.
 *
 * The title bar is part of it even here: the app is frameless, so a screen that
 * omitted the chrome would be a rectangle the user could not move or close.
 */
function StartupFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <TitleBar
        left={
          <div data-tauri-drag-region className="flex shrink-0 items-center pl-6 pr-4">
            <Logo compact size="sm" className="pl-0" />
          </div>
        }
      />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Shown between the splash and the first index read.
 *
 * The same two things the splash shows — the name and a moving bar — because it
 * is the same wait, and a second, differently-shaped loading screen would make
 * opening the application feel like two events instead of one. What is slow is
 * reported in the status bar, which is the place that already says what the
 * pipeline is doing; this screen stays quiet.
 */
function BootScreen({ slow }: { slow: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4" role="status">
      <p className="text-[16px] font-semibold tracking-[-0.02em] text-ink">AfterImage</p>
      <span
        className="af-loading-track"
        aria-hidden="true"
        data-slow={slow ? 'true' : undefined}
      />
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
 * Whether to mount the archive in a browser for a design review.
 *
 * `npm run dev` opens the download page, which is what a visitor should get in
 * a browser. Adding `?shell` to that URL mounts the window instead — with
 * whatever host the browser can offer — so the chrome, the glass and the empty
 * states can be looked at without a Rust build. Development only: the published
 * bundle ignores the flag and always answers with the download page.
 */
function devShellPreview(): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(window.location.search).has('shell');
}

/**
 * Application root.
 *
 * Two programs behind one bundle, decided once, at the top. In a browser the
 * page is the download: the archive needs a process that can read folders, keep
 * a database and run the models, and a web page has none of those — so the page
 * offers the program that does rather than imitating the parts it can reach.
 * Inside the installed application it is the archive, and nothing here is ever
 * rendered there.
 */
export default function App() {
  // The splash is markup in `index.html`, so it covers the page until React has
  // painted — on both routes. Dismissing it only in the archive left the
  // download page sitting underneath the loading mark for good.
  useEffect(() => {
    dismissSplash();
  }, []);

  if (!isTauri() && !devShellPreview()) {
    return (
      <>
        <Landing />
        <NoticeHost />
      </>
    );
  }
  return <Archive />;
}

/**
 * The archive.
 *
 * Global behaviour only: appearance, host events, drag-and-drop, shortcuts and
 * the overlays that must exist exactly once. Everything else lives in the shell.
 */
function Archive() {
  useAppearance();
  useHostBridge();
  useDropImport();
  useKeyboardShortcuts();
  useLocalIdentity();
  useInstalledHistory();

  // Whether this device can install the app, and whether it already has. The
  // platform answers asynchronously — Chromium raises its install prompt on a
  // schedule of its own — so the answer lives in a store that Settings reads
  // rather than in a hook that only one component gets to use.
  useEffect(() => watchInstallability(), []);

  const status = useArchiveStore((state) => state.status);
  const error = useArchiveStore((state) => state.error);
  const load = useArchiveStore((state) => state.load);
  const onboarded = useSettingsStore((state) => state.onboarded);
  // A design review wants the window, not the wizard that precedes it.
  const preview = devShellPreview();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  // One line in the application log for the moment the archive is usable. It is
  // the difference between "the window opened" and "the window works", which is
  // exactly the distinction that was missing while the boot screen was stuck.
  useEffect(() => {
    if (status === 'ready') report('boot: archive ready');
  }, [status]);

  // A load that never resolves must not look like a load that is working.
  useEffect(() => {
    if (status !== 'loading' && status !== 'idle') {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const loading = status === 'idle' || status === 'loading';

  const fallback =
    status === 'error' && error ? (
      <LoadFailure message={error} />
    ) : loading ? (
      <BootScreen slow={slow} />
    ) : null;

  if (fallback) {
    return (
      <>
        <StartupFrame>{fallback}</StartupFrame>
        <NoticeHost />
      </>
    );
  }

  // The wizard comes before the shell, once. It brings its own title bar so the
  // window keeps its controls while the user is answering it.
  if (!onboarded && !preview) {
    return (
      <>
        <Onboarding />
        <NoticeHost />
      </>
    );
  }

  return (
    <>
      <AppShell />
      <FileContextMenu />
      <CommandPalette />
      <QuickLook />
      <SimilarPanel />
      <Comparison />
      <ShortcutsSheet />
      <NoticeHost />
    </>
  );
}
