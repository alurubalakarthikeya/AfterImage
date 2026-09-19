import { useEffect, useState } from 'react';
import { isTauri } from '@/services/host';
import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { cn, formatRelativeTime } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { IconButton, IconButtonGroup } from '@/components/common/IconButton';
import { Tooltip } from '@/components/common/Tooltip';
import { StatusDot } from '@/components/common/Badge';
import { Avatar } from '@/components/common/Avatar';
import { useSettingsStore } from '@/stores/settings';
import { SearchBar } from '@/components/search/SearchBar';
import { AppearanceMenu } from './AppearanceMenu';
import { IndexStatus } from './IndexStatus';
import { LogoMark } from '@/components/common/Logo';

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const activity = useArchiveStore((state) => state.activity);
  const navigate = useUIStore((state) => state.navigate);
  const unread = activity.slice(0, 4).length;

  return (
    <div className="relative">
      <Tooltip label="Notifications" side="bottom">
        <IconButton label="Notifications" active={open} onClick={() => setOpen((value) => !value)}>
          <Icon name="Bell" size={17} strokeWidth={1.9} />
          {unread > 0 && (
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-surface" />
          )}
        </IconButton>
      </Tooltip>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-[calc(100%+8px)] z-50 w-[320px] overflow-hidden rounded-card border border-line bg-surface"
            style={{ boxShadow: 'var(--af-shadow-float)' }}
            role="dialog"
            aria-label="Notifications"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-body font-semibold text-ink">Notifications</span>
              <span className="text-2xs text-ink-3">Local only</span>
            </div>
            <div className="max-h-[280px] overflow-y-auto p-1.5">
              {activity.slice(0, 6).map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate('home');
                  }}
                  className="flex w-full items-start gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors duration-100 hover:bg-surface-3"
                >
                  <span className="mt-1.5">
                    <StatusDot kind={entry.kind} ring={false} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">{entry.label}</span>
                    <span className="block truncate text-2xs text-ink-3">{entry.detail}</span>
                  </span>
                  <span className="shrink-0 text-2xs text-ink-3">{formatRelativeTime(entry.at)}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate('home');
              }}
              className="w-full border-t border-line py-2.5 text-meta font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-softer"
            >
              Open activity
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Native window buttons. Rendered only inside the Tauri webview. */
function WindowControls() {
  const [native, setNative] = useState(false);
  useEffect(() => setNative(isTauri()), []);

  if (!native) return null;

  const control = async (action: 'minimize' | 'toggleMaximize' | 'close') => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow()[action]();
    } catch {
      /* the window API is unavailable outside Tauri */
    }
  };

  return (
    <div className="no-drag ml-1 flex items-center gap-0.5">
      <IconButton size="sm" label="Minimize" onClick={() => void control('minimize')}>
        <Icon name="Minus" size={15} strokeWidth={2} />
      </IconButton>
      <IconButton size="sm" label="Maximize" onClick={() => void control('toggleMaximize')}>
        <Icon name="Square" size={13} strokeWidth={2} />
      </IconButton>
      <IconButton size="sm" label="Close" onClick={() => void control('close')}>
        <Icon name="X" size={15} strokeWidth={2} />
      </IconButton>
    </div>
  );
}

export function TopBar({ columns }: { columns: string }) {
  const viewMode = useUIStore((state) => state.viewMode);
  const setViewMode = useUIStore((state) => state.setViewMode);
  const navigate = useUIStore((state) => state.navigate);
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed);
  const inspectorOpen = useUIStore((state) => state.inspectorOpen);
  const toggleInspector = useUIStore((state) => state.toggleInspector);
  const appearanceOpen = useUIStore((state) => state.appearanceOpen);
  const setAppearanceOpen = useUIStore((state) => state.setAppearanceOpen);
  const addFolder = useArchiveStore((state) => state.addFolder);
  const userName = useSettingsStore((state) => state.userName);

  return (
    <header
      className="grid h-16 shrink-0 items-center gap-4"
      style={{ gridTemplateColumns: columns }}
      data-tauri-drag-region
    >
      <div className="drag-region flex min-w-0 items-center gap-2.5 pl-1">
        {sidebarCollapsed && <LogoMark size={22} />}
        <IndexStatus />
      </div>

      {/* Indented to the workspace's own inset, so the search field starts on the
          same vertical line as the first card of every page. */}
      <div className="flex min-w-0 items-center gap-3 pl-2">
        <SearchBar />
      </div>

      <div className="no-drag flex items-center justify-end gap-1">
        {/* AfterImage has no import step: the archive grows by watching folders. */}
        <Tooltip label="Add a folder to index" shortcut="Ctrl O" side="bottom">
          <IconButton label="Add folder" onClick={() => void addFolder()}>
            <Icon name="FolderPlus" size={17} strokeWidth={1.9} />
          </IconButton>
        </Tooltip>

        <IconButtonGroup>
          <Tooltip label="Grid view" side="bottom">
            <IconButton
              size="sm"
              label="Grid view"
              active={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
            >
              <Icon name="LayoutGrid" size={15} strokeWidth={2} />
            </IconButton>
          </Tooltip>
          <Tooltip label="List view" side="bottom">
            <IconButton
              size="sm"
              label="List view"
              active={viewMode === 'list'}
              onClick={() => setViewMode('list')}
            >
              <Icon name="List" size={15} strokeWidth={2} />
            </IconButton>
          </Tooltip>
          <Tooltip label="Timeline view" side="bottom">
            <IconButton
              size="sm"
              label="Timeline view"
              active={viewMode === 'timeline'}
              onClick={() => setViewMode('timeline')}
            >
              <Icon name="Rows3" size={15} strokeWidth={2} />
            </IconButton>
          </Tooltip>
        </IconButtonGroup>

        <NotificationBell />

        <div className="relative">
          <Tooltip label="Appearance" side="bottom">
            <IconButton
              label="Appearance"
              active={appearanceOpen}
              onClick={() => setAppearanceOpen(!appearanceOpen)}
            >
              <Icon name="Sun" size={17} strokeWidth={1.9} />
            </IconButton>
          </Tooltip>
          <AppearanceMenu />
        </div>

        <Tooltip label={inspectorOpen ? 'Hide inspector' : 'Show inspector'} side="bottom">
          <IconButton label="Toggle inspector" active={inspectorOpen} onClick={toggleInspector}>
            <Icon name="PanelRight" size={17} strokeWidth={1.9} />
          </IconButton>
        </Tooltip>

        <Tooltip label={`${userName} — local account`} side="bottom">
          <button
            type="button"
            onClick={() => navigate('settings')}
            className={cn('ml-1 rounded-full transition-transform duration-150 hover:scale-[1.03]')}
            aria-label="Account and settings"
          >
            <Avatar name={userName} size={30} />
          </button>
        </Tooltip>

        <WindowControls />
      </div>
    </header>
  );
}
