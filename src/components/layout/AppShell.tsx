import type { RouteId } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/utils/format';
import { Home } from '@/pages/Home';
import { AllFiles } from '@/pages/AllFiles';
import { Photos } from '@/pages/Photos';
import { Screenshots } from '@/pages/Screenshots';
import { Documents } from '@/pages/Documents';
import { Videos } from '@/pages/Videos';
import { People } from '@/pages/People';
import { PersonDetail } from '@/pages/PersonDetail';
import { Projects } from '@/pages/Projects';
import { Collections } from '@/pages/Collections';
import { SearchPage } from '@/pages/SearchPage';
import { Settings } from '@/pages/Settings';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { FirstRun } from './FirstRun';
import { Sidebar } from './Sidebar';
import { MobileDock } from './MobileDock';
import { TopBar } from './TopBar';
import { StatusBar } from './StatusBar';
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
    case 'people':
      return <People />;
    case 'person':
      return <PersonDetail />;
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
 * Three bands stacked to the edges of the frame: the title bar, the working
 * area, the status bar. The middle band is a CSS grid — sidebar | workspace |
 * inspector — so the search field in the title bar lines up with the first
 * column of cards and the toolbar lines up with the inspector. Below 1280px the
 * inspector steps out of the way rather than crushing the workspace.
 *
 * Below 768px — a phone — the grid is one column: the sidebar leaves the
 * layout entirely and reappears as the pill dock at the bottom of the window
 * (`MobileDock`), which buys the workspace everything the rail used to hold and
 * puts the navigation where a thumb already is. The desktop layout above that
 * line is the same pixels it has always been.
 */
export function AppShell() {
  const route = useUIStore((state) => state.route);
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  const inspectorOpen = useUIStore((state) => state.inspectorOpen);
  const selectedFileId = useUIStore((state) => state.selectedFileId);
  const roomForInspector = useMediaQuery('(min-width: 1280px)');
  const roomForSidebar = useMediaQuery('(min-width: 768px)');
  const folders = useArchiveStore((state) => state.folders);
  const status = useArchiveStore((state) => state.status);

  /**
   * Nothing has been granted access yet, so there is no archive to browse. The
   * shell still renders around it — the sidebar, the status line and Settings
   * stay reachable — but the workspace asks for the one thing it needs.
   */
  const needsSetup = status === 'ready' && folders.length === 0 && route !== 'settings';

  /**
   * The inspector follows its toggle everywhere, Settings included.
   *
   * It belongs to the archive rather than to a page — what is indexed, how much
   * of it there is, which folders are being watched — and while the user is
   * changing what the pipeline does, that is exactly the column worth having
   * open beside them. `needsSetup` still wins: with nothing granted yet there is
   * no archive for it to describe.
   */
  const showInspector = inspectorOpen && roomForInspector && !needsSetup;
  const sidebarWidth = sidebarCollapsed ? SIDEBAR_NARROW : SIDEBAR_WIDE;

  // One column on a phone — no rail, no inspector — and the desktop's two (or
  // three) above the line, byte for byte as before.
  const columns = `${
    roomForSidebar ? `${sidebarWidth}px ` : ''
  }minmax(0, 1fr)${showInspector ? ` ${INSPECTOR_WIDTH}px` : ''}`;

  return (
    // `af-ambient` paints faint neutral fields under the whole window. It is not
    // decoration: it is what the glass panels above it refract, and without it a
    // blurred surface is just a grey rectangle. The fields carry no hue — the
    // canvas is pure white or pure black and every step between is greyscale.
    <div className="af-ambient flex h-full min-h-0 flex-col bg-canvas">
      <TopBar sidebarWidth={sidebarWidth} />

      {/* The window's own inset: 12px against every edge, including under the
          title bar, so the frame reads as a frame and the content as content.
          On a phone the inset answers for two more things: a little more air
          under the top bar, and the dock + status bar the bottom edge now
          carries — without it the last row of every page would sit under the
          navigation. The desktop values below 768px's line are untouched. */}
      <div
        className={cn(
          'grid min-h-0 flex-1 gap-3 px-3',
          roomForSidebar ? 'pt-3 pb-3' : 'pt-4 pb-[72px]',
        )}
        style={{ gridTemplateColumns: columns }}
      >
        {roomForSidebar && <Sidebar />}
        <main
          className="min-h-0 overflow-y-auto overflow-x-hidden"
          aria-label="Workspace"
          key={route}
        >
          {/* Keyed by route: navigating away is itself a retry, and boundaries
              are per region so one failed panel never blanks the window. */}
          <ErrorBoundary region="workspace" key={route}>
            <div className="af-route-enter h-full p-1">
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

      <StatusBar />
      {!roomForSidebar && <MobileDock />}
      <DropOverlay />
    </div>
  );
}
