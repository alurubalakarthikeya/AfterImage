import { useUIStore } from '@/stores/ui';
import { Modal } from '@/components/common/Overlay';
import { Icon } from '@/components/common/Icon';

const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Search',
    rows: [
      ['Command palette', 'Ctrl K'],
      ['Search the archive', 'Ctrl F'],
      ['Focus search', '/'],
      ['Clear search', 'Esc'],
    ],
  },
  {
    title: 'Files',
    rows: [
      ['Import files', 'Ctrl O'],
      ['Open selection', 'Enter'],
      ['Quick look', 'Space'],
      ['Favourite', 'F'],
      ['Open location', 'R'],
      ['Move to trash', 'Delete'],
      ['Select all', 'Ctrl A'],
      ['Extend selection', 'Shift ← ↑ ↓ →'],
    ],
  },
  {
    title: 'Workspace',
    rows: [
      ['Toggle inspector', 'Ctrl I'],
      ['Jump to section', 'Ctrl 1–8'],
      ['Dismiss overlay', 'Esc'],
      ['Toggle this sheet', 'Ctrl /'],
    ],
  },
];

/** The shortcut sheet. Cheaper than documentation and always current. */
export function ShortcutsSheet() {
  const open = useUIStore((state) => state.shortcutsOpen);
  const setOpen = useUIStore((state) => state.setShortcutsOpen);

  return (
    <Modal open={open} onClose={() => setOpen(false)} className="max-w-[620px]">
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-surface-2 text-ink-2">
            <Icon name="Keyboard" size={15} strokeWidth={1.9} />
          </span>
          <h2 className="text-card font-semibold text-ink">Keyboard shortcuts</h2>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="text-ink-3 transition-colors hover:text-ink"
        >
          <Icon name="X" size={16} strokeWidth={2} />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-3">
        {GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-2">
            <h3 className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
              {group.title}
            </h3>
            {group.rows.map(([label, keys]) => (
              <div key={label} className="flex items-center justify-between gap-3">
                <span className="text-meta text-ink-2">{label}</span>
                <kbd className="rounded-[6px] border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-[10px] text-ink-3">
                  {keys}
                </kbd>
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="border-t border-line px-5 py-2.5 text-2xs text-ink-3">
        Shortcuts follow the platform convention — Ctrl on Windows and Linux, ⌘ on macOS.
      </div>
    </Modal>
  );
}
