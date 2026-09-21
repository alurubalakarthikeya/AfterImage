import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ContextMenuItem } from '@/types';
import { cn } from '@/utils/format';
import { Icon } from './Icon';

/**
 * Native-feeling context menu.
 *
 * Rendered in-place rather than in a portal: the shell is a fixed full-window
 * grid, so no ancestor clips it, and keeping it in the tree means the same
 * click-outside handling as everything else. Position is clamped after
 * measurement so a right-click near an edge still opens fully on screen.
 */
export function ContextMenu({
  items,
  x,
  y,
  onCommand,
  onClose,
}: {
  items: ContextMenuItem[];
  x: number;
  y: number;
  onCommand: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const margin = 8;
    setPosition({
      x: Math.min(x, window.innerWidth - width - margin),
      y: Math.min(y, window.innerHeight - height - margin),
    });
  }, [x, y, items.length]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.12, ease: [0.2, 0.8, 0.2, 1] }}
      className="glass-float fixed z-[60] min-w-[218px] overflow-visible rounded-[14px] border border-line p-1"
      style={{ left: position.x, top: position.y, boxShadow: 'var(--af-shadow-float)' }}
      role="menu"
    >
      {items.map((item) => (
        <div key={item.id} className="relative">
          {item.separatorBefore && <div className="my-1 h-px bg-line" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onMouseEnter={() => setOpenSubmenu(item.submenu ? item.id : null)}
            onClick={() => {
              if (item.submenu) {
                setOpenSubmenu(openSubmenu === item.id ? null : item.id);
                return;
              }
              onCommand(item.id);
              onClose();
            }}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-left text-body transition-colors duration-100',
              'disabled:pointer-events-none disabled:opacity-40',
              item.danger ? 'text-critical hover:bg-critical/10' : 'text-ink hover:bg-surface-3',
              openSubmenu === item.id && 'bg-surface-3',
            )}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-3">
              {item.icon && <Icon name={item.icon} size={14} strokeWidth={1.9} />}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && <span className="text-2xs text-ink-3">{item.shortcut}</span>}
            {item.submenu && <Icon name="ChevronRight" size={13} className="text-ink-3" />}
          </button>

          <AnimatePresence>
            {item.submenu && openSubmenu === item.id && (
              <motion.div
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="glass-float absolute left-[calc(100%-2px)] top-0 z-[61] min-w-[196px] rounded-[14px] border border-line p-1"
                style={{ boxShadow: 'var(--af-shadow-float)' }}
              >
                {item.submenu.length === 0 ? (
                  <div className="px-2.5 py-2 text-meta text-ink-3">Nothing available</div>
                ) : (
                  item.submenu.map((child) => (
                    <button
                      key={child.id}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onCommand(child.id);
                        onClose();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-left text-body text-ink transition-colors duration-100 hover:bg-surface-3"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-3">
                        {child.icon && <Icon name={child.icon} size={14} strokeWidth={1.9} />}
                      </span>
                      <span className="flex-1 truncate">{child.label}</span>
                    </button>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </motion.div>
  );
}
