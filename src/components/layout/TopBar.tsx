import { useState } from 'react';
import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { useSettingsStore } from '@/stores/settings';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn, formatRelativeTime } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { IconButton, IconButtonGroup } from '@/components/common/IconButton';
import { Tooltip } from '@/components/common/Tooltip';
import { StatusDot } from '@/components/common/Badge';
import { Avatar } from '@/components/common/Avatar';
import { Logo } from '@/components/common/Logo';
import { SearchBar } from '@/components/search/SearchBar';
import { ThemeControl } from './ThemeControl';
import { TitleBar } from './TitleBar';

/**
 * How much room the wordmark is given, whatever the sidebar is doing.
 *
 * Measured from the rendered mark rather than guessed: at `compact`/`sm` the
 * name is set at 14px semibold with the tracking the component applies, so this
 * is the width it occupies plus the leading inset.
 */
const BRAND_WIDTH = 148;

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
            className="glass-float absolute right-0 top-[calc(100%+8px)] z-50 w-[320px] overflow-hidden rounded-card border border-line"
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
              className="w-full border-t border-line py-2.5 text-meta font-medium text-accent-ink transition-colors duration-150 hover:bg-surface-2"
            >
              Open activity
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The title bar.
 *
 * Left third is the sidebar's width so the brand sits exactly over the column
 * it belongs to and the search field starts on the same line as the workspace.
 */
export function TopBar({ sidebarWidth }: { sidebarWidth: number }) {
  const viewMode = useUIStore((state) => state.viewMode);
  const setViewMode = useUIStore((state) => state.setViewMode);
  const navigate = useUIStore((state) => state.navigate);
  const inspectorOpen = useUIStore((state) => state.inspectorOpen);
  const toggleInspector = useUIStore((state) => state.toggleInspector);
  const addFolder = useArchiveStore((state) => state.addFolder);
  const userName = useSettingsStore((state) => state.userName);
  const accountLabel = useSettingsStore((state) => state.accountLabel);

  // Below 768px the right-hand cluster keeps only what cannot be reached
  // elsewhere: importing a folder and the account. The view switcher lives on
  // the command palette, notifications on Home, the theme and the inspector in
  // Settings — and the inspector has no column of its own at this width anyway.
  // The search field needs the room more than four icons do, and everything
  // above this line renders exactly as it always has.
  const roomy = useMediaQuery('(min-width: 768px)');

  return (
    <TitleBar
      left={
        <div
          data-tauri-drag-region
          className="flex shrink-0 items-center pl-3.5"
          style={{ width: roomy ? Math.max(sidebarWidth, BRAND_WIDTH) : 40 }}
        >
          {/* The wordmark never collapses — on the desktop build.

              It used to be the sidebar's width and disappear with it, which
              meant the application lost its own name the moment the user
              reclaimed 150 pixels of a small window. The block is now at least
              as wide as the name, so the column it aligns with when expanded is
              a preference and the identity is not. On a phone the trade flips:
              the mark alone carries the identity and the 100 pixels it frees
              belong to the search field, which is the one control everybody
              reaches for first. */}
          {roomy ? <Logo compact size="sm" /> : <Logo markOnly size="sm" />}
        </div>
      }
      center={<SearchBar />}
      right={
        <>
          {/* AfterImage has no import step: the archive grows by watching folders. */}
          <Tooltip label="Add a folder to index" shortcut="Ctrl O" side="bottom">
            <IconButton label="Add folder" onClick={() => void addFolder()}>
              <Icon name="FolderPlus" size={17} strokeWidth={1.9} />
            </IconButton>
          </Tooltip>

          {roomy && (
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
          )}

          {roomy && <NotificationBell />}

          {roomy && <ThemeControl />}

          {roomy && (
            <Tooltip label={inspectorOpen ? 'Hide inspector' : 'Show inspector'} side="bottom">
              <IconButton label="Toggle inspector" active={inspectorOpen} onClick={toggleInspector}>
                <Icon name="PanelRight" size={17} strokeWidth={1.9} />
              </IconButton>
            </Tooltip>
          )}

          <Tooltip label={`${userName || 'You'} · ${accountLabel}`} side="bottom">
            <button
              type="button"
              onClick={() => navigate('settings')}
              className={cn('ml-0.5 rounded-full transition-transform duration-150 hover:scale-[1.03]')}
              aria-label="Account and settings"
            >
              <Avatar name={userName} size={28} />
            </button>
          </Tooltip>
          <span className="w-1" aria-hidden="true" />
        </>
      }
    />
  );
}
