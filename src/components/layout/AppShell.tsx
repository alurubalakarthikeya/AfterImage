import type { RouteId } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUIStore } from '@/stores/ui';
import { Home } from '@/pages/Home';
import { AllFiles } from '@/pages/AllFiles';
import { Photos } from '@/pages/Photos';
import { Screenshots } from '@/pages/Screenshots';
import { Documents } from '@/pages/Documents';
import { Videos } from '@/pages/Videos';
import { Projects } from '@/pages/Projects';
import { Collections } from '@/pages/Collections';
import { SearchPage } from '@/pages/SearchPage';
import { Settings } from '@/pages/Settings';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { FirstRun } from './FirstRun';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { Inspector } from './Inspector';
import { DropOverlay } from './DropOverlay';

const SIDEBAR_WIDE = 224;
const SIDEBAR_NARROW = 68;
const INSPECTOR_WIDTH = 320;

function RouteView({ route }: { route: RouteId }) {
  switch (route) {
    case 'home':
      return <Home />;
    case 'all':
      return <AllFiles />;
    case 'photos':
      return <Photos />;
    case 'screenshots':
      return <Screenshots />;
    case 'documents':
      return <Documents />;
    case 'videos':
      return <Videos />;
    case 'projects':
      return <Projects />;
    case 'collections':
      return <Collections />;
    case 'search':
      return <SearchPage />;
    case 'settings':
      return <Settings />;
    default:
      return <Home />;
  }
}

/**
 * The window.
 *
 * A CSS grid, not fixed positioning: sidebar | workspace | inspector, with the
 * top bar spanning the grid so the search field lines up with the workspace and
 * the controls line up with the inspector. Below 1280px the inspector steps
 * out of the way rather than crushing the workspace.
 */
export function AppShell() {
  const route = useUIStore((state) => state.route);
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  const inspectorOpen = useUIStore((state) => state.inspectorOpen);
  const selectedFileId = useUIStore((state) => state.selectedFileId);
  const roomForInspector = useMediaQuery('(min-width: 1280px)');
  const folders = useArchiveStore((state) => state.folders);
  const status = useArchiveStore((state) => state.status);

  /**
   * Nothing has been granted access yet, so there is no archive to browse. The
   * shell still renders around it — the sidebar, the status line and Settings
   * stay reachable — but the workspace asks for the one thing it needs.
   */
  const needsSetup = status === 'ready' && folders.length === 0 && route !== 'settings';

  const showInspector = inspectorOpen && roomForInspector && !needsSetup;
  const sidebarWidth = sidebarCollapsed ? SIDEBAR_NARROW : SIDEBAR_WIDE;

  const columns = showInspector
    ? `${sidebarWidth}px minmax(0, 1fr) ${INSPECTOR_WIDTH}px`
    : `${sidebarWidth}px minmax(0, 1fr)`;
  const topBarColumns = showInspector
    ? `${sidebarWidth}px minmax(0, 1fr) ${INSPECTOR_WIDTH}px`
    : `${sidebarWidth}px minmax(0, 1fr) auto`;

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pb-4">
      <TopBar columns={topBarColumns} />

      <div className="grid min-h-0 flex-1 gap-4" style={{ gridTemplateColumns: columns }}>
        <Sidebar />
        <main
          className="min-h-0 overflow-y-auto overflow-x-hidden pr-0.5"
          aria-label="Workspace"
          key={route}
        >
          {/* Keyed by route: navigating away is itself a retry, and boundaries
              are per region so one failed panel never blanks the window. */}
          <ErrorBoundary region="workspace" key={route}>
            <div className="af-route-enter h-full">
              {needsSetup ? <FirstRun /> : <RouteView route={route} />}
            </div>
          </ErrorBoundary>
        </main>
        {showInspector && (
          <ErrorBoundary region="inspector" key={`inspector-${selectedFileId ?? 'none'}`}>
            <Inspector />
          </ErrorBoundary>
        )}
      </div>

      <DropOverlay />
    </div>
  );
}
