import type { RouteId } from '@/types';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

/**
 * The phone's navigation: the sidebar, folded into a pill at the bottom.
 *
 * Same seven destinations as the sidebar's nav, in the same order — a dock is
 * a sidebar whose labels lost their room, not a second information
 * architecture. Icons only, 36 pixel targets, one active pill, no scroll: on a
 * touch device the navigation must sit where the thumb already is, which is
 * the bottom edge, not the left one.
 *
 * It floats above the status bar rather than replacing it, so the index state
 * stays readable at the glance it has always had. The desktop build never
 * renders this — the sidebar owns that job there.
 */
const ITEMS: Array<{ id: RouteId; label: string; icon: string }> = [
  { id: 'home', label: 'Home', icon: 'Home' },
  { id: 'all', label: 'All Files', icon: 'Files' },
  { id: 'photos', label: 'Photos', icon: 'Image' },
  { id: 'screenshots', label: 'Screenshots', icon: 'MonitorSmartphone' },
  { id: 'documents', label: 'Documents', icon: 'FileText' },
  { id: 'videos', label: 'Videos', icon: 'Film' },
  { id: 'people', label: 'People', icon: 'Users' },
];

export function MobileDock() {
  const route = useUIStore((state) => state.route);
  const navigate = useUIStore((state) => state.navigate);

  return (
    <nav
      aria-label="Primary"
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4"
      // 28px of status bar, 8px of air above it, plus whatever the home
      // indicator eats on a notched phone — measured from the viewport because
      // the dock is fixed and the status bar is not.
      style={{ bottom: 'calc(36px + env(safe-area-inset-bottom, 0px))' }}
    >
      <div
        className="glass-float pointer-events-auto flex items-center gap-0.5 rounded-pill border border-line p-1.5"
        style={{ boxShadow: 'var(--af-shadow-float)' }}
      >
        {ITEMS.map((item) => {
          // One person's page is still the People section, same as the sidebar.
          const active = route === item.id || (item.id === 'people' && route === 'person');
          return (
            <button
              key={item.id}
              type="button"
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.id)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-150',
                active ? 'bg-surface-3 text-ink' : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
              )}
            >
              <Icon name={item.icon} size={17} strokeWidth={1.9} />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
