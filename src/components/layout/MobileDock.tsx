import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { RouteId } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { cn, formatCount } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { IconButton } from '@/components/common/IconButton';
import { Scrim } from '@/components/common/Overlay';

const EASE = [0.2, 0.8, 0.2, 1] as const;

/**
 * The phone's navigation: four destinations and a sheet.
 *
 * The sidebar holds seven sections because a 224-pixel column costs a desktop
 * nothing and a section one click away is a section people use. The bottom edge
 * of a phone is the opposite trade. Four or five targets is the widest row a
 * thumb can hit without looking, and every icon past that turns a tap into a
 * miss — which is what the old seven-icon pill asked of it. So the four
 * sections a phone is actually opened for keep a tab, and the rest of the
 * sidebar moves into the sheet behind "More".
 *
 * Nothing was dropped in the move. Every route the desktop nav offers is still
 * reachable here — which is the point: the reduced row had to buy its clarity
 * without making a section unreachable, and the kinds a tab cannot hold are one
 * tap away instead of none.
 */
const TABS: Array<{ id: RouteId; label: string; icon: string }> = [
  { id: 'home', label: 'Home', icon: 'Home' },
  { id: 'all', label: 'Files', icon: 'Files' },
  { id: 'photos', label: 'Photos', icon: 'Image' },
  { id: 'people', label: 'People', icon: 'Users' },
];

/** The sections that did not earn a tab, in the sidebar's own order. */
const MORE_ITEMS: Array<{ id: RouteId; label: string; icon: string }> = [
  { id: 'screenshots', label: 'Screenshots', icon: 'MonitorSmartphone' },
  { id: 'documents', label: 'Documents', icon: 'FileText' },
  { id: 'videos', label: 'Videos', icon: 'Film' },
  { id: 'projects', label: 'Projects', icon: 'FolderKanban' },
  { id: 'collections', label: 'Collections', icon: 'Layers' },
  { id: 'settings', label: 'Settings', icon: 'Settings' },
];

/**
 * Routes the sheet is responsible for, so "More" lights up while one of them is
 * on screen. Search is in the list but not in the sheet: the field that opens it
 * is already in the top bar, and a tab bar with nothing lit would read as a bug.
 */
const MORE_ROUTES: RouteId[] = [...MORE_ITEMS.map((item) => item.id), 'search'];

/**
 * One tab.
 *
 * Icon over label, both inside the target, which is the shape every phone
 * application uses because it is the one that still works with a thumb and
 * without a hover state to explain it. The active tab is a neutral fill and
 * darker ink rather than a saturated block: selection is a state of the
 * surface, and the accent stays the one thing on screen that means "this one
 * action".
 */
function Tab({
  label,
  icon,
  active,
  expanded,
  onClick,
}: {
  label: string;
  icon: string;
  active: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-expanded={expanded}
      aria-haspopup={expanded === undefined ? undefined : 'dialog'}
      className={cn(
        'tap-highlight-none flex min-w-0 flex-1 flex-col items-center gap-1 pb-2.5 pt-3 transition-colors duration-150',
        active ? 'text-ink' : 'text-ink-3 active:text-ink-2',
      )}
    >
      <span
        className={cn(
          'flex h-7 w-14 items-center justify-center rounded-pill transition-colors duration-150',
          active && 'bg-surface-3',
        )}
      >
        <Icon name={icon} size={19} strokeWidth={active ? 2.1 : 1.8} />
      </span>
      <span
        className={cn(
          'max-w-full truncate text-[10px] leading-none',
          active ? 'font-semibold' : 'font-medium',
        )}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * The bottom bar.
 *
 * It is a band of the window's own chrome rather than a floating pill: it sits
 * flush against the bottom edge, edge to edge, above the status line — the
 * arrangement every phone application uses, and the reason the content no
 * longer needs a 72-pixel void reserved under it. The desktop build never
 * renders this. The sidebar owns that job there, and the two never coexist.
 *
 * The row carries real air — 12px above the icons, 10px under the labels, and
 * a 2px gutter down each side — because the target that is easiest to hit is
 * not the one that is merely large enough: a tab whose glyph sits against the
 * glass edge reads as chrome the user is squeezing past, and this one is meant
 * to feel like the bottom of an application.
 */
export function MobileDock() {
  const route = useUIStore((state) => state.route);
  const navigate = useUIStore((state) => state.navigate);
  const totals = useArchiveStore((state) => state.totals);
  const collections = useArchiveStore((state) => state.collections);
  const [moreOpen, setMoreOpen] = useState(false);

  // Escape closes the sheet for the keyboards that exist: a tablet with a case,
  // a hardware keyboard, or the desktop build narrowed to this width.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  // Counts are the sidebar's, read from the same totals: a kind with nothing in
  // it shows no number rather than "0", because a zero beside a section is not
  // a fact worth a line.
  const counts: Partial<Record<RouteId, number>> = {
    screenshots: totals.byKind.screenshot,
    documents: totals.byKind.document,
    videos: totals.byKind.video,
    collections: collections.length,
  };

  const go = (id: RouteId) => {
    setMoreOpen(false);
    navigate(id);
  };

  return (
    <>
      <nav aria-label="Primary" className="glass relative z-30 shrink-0 border-t border-line">
        <div className="flex items-stretch gap-0.5 px-2">
          {TABS.map((tab) => (
            <Tab
              key={tab.id}
              label={tab.label}
              icon={tab.icon}
              // One person's page is still the People section, same as the
              // sidebar: the tab stays lit while the user is inside a group.
              active={route === tab.id || (tab.id === 'people' && route === 'person')}
              onClick={() => navigate(tab.id)}
            />
          ))}
          <Tab
            label="More"
            icon="MoreHorizontal"
            active={MORE_ROUTES.includes(route)}
            expanded={moreOpen}
            onClick={() => setMoreOpen((open) => !open)}
          />
        </div>
      </nav>

      {/*
        The sheet.

        A bottom sheet rather than a centred dialog, because the hand is already
        at the bottom of the screen when the tab was tapped and a menu that
        arrives under the thumb is the one that gets used. It is fixed, so it
        clears the home indicator itself — the body's inset padding cannot reach
        a fixed element.
      */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <Scrim onClick={() => setMoreOpen(false)} />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="All sections"
              initial={{ y: '104%' }}
              animate={{ y: 0 }}
              exit={{ y: '104%' }}
              transition={{ duration: 0.24, ease: EASE }}
              className="glass-float fixed inset-x-0 bottom-0 z-50 rounded-t-card-lg border-t border-line"
              style={{
                boxShadow: 'var(--af-shadow-float)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              }}
            >
              {/* The grabber. It is not draggable — it is the shape that says
                  "this panel came from the bottom and returns to it". */}
              <span
                className="mx-auto mt-2.5 block h-1 w-10 rounded-pill bg-line-strong"
                aria-hidden="true"
              />

              <div className="flex items-center justify-between pb-1 pl-4 pr-2 pt-2">
                <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                  All sections
                </span>
                <IconButton size="sm" label="Close" onClick={() => setMoreOpen(false)}>
                  <Icon name="X" size={16} strokeWidth={2} />
                </IconButton>
              </div>

              <div className="grid grid-cols-2 gap-1.5 px-3 pb-4 pt-1">
                {MORE_ITEMS.map((item) => {
                  const active = route === item.id;
                  const count = counts[item.id];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => go(item.id)}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'tap-highlight-none flex items-center gap-2.5 rounded-card border border-line px-2.5 py-2.5 text-left transition-colors duration-150',
                        active ? 'bg-surface-3' : 'bg-surface active:bg-surface-3',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]',
                          active ? 'bg-surface text-ink' : 'bg-surface-2 text-ink-2',
                        )}
                      >
                        <Icon name={item.icon} size={16} strokeWidth={1.9} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body text-ink">{item.label}</span>
                        {count !== undefined && count > 0 && (
                          <span className="block text-2xs tabular-nums text-ink-3">
                            {formatCount(count)}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
