import { useEffect, useRef, useState } from 'react';
import type { SortKey } from '@/stores/selectors';
import { cn } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

const OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: 'recent', label: 'Newest first' },
  { id: 'name', label: 'Name' },
  { id: 'size', label: 'Largest first' },
  { id: 'kind', label: 'Type' },
];

/** Compact sort control that reads as a menu, not a form field. */
export function SortMenu({ value, onChange }: { value: SortKey; onChange: (key: SortKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = OPTIONS.find((option) => option.id === value) ?? OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 text-meta text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink"
      >
        <Icon name="ArrowDownUp" size={13} strokeWidth={2} />
        {active.label}
        <Icon name="ChevronDown" size={12} strokeWidth={2.2} className="text-ink-3" />
      </button>

      {open && (
        <div
          className="glass-float absolute right-0 top-[calc(100%+6px)] z-40 min-w-[168px] rounded-[14px] border border-line p-1"
          style={{ boxShadow: 'var(--af-shadow-float)' }}
          role="menu"
        >
          {OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              onClick={() => {
                onChange(option.id);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center justify-between rounded-[9px] px-2.5 py-[7px] text-left text-body transition-colors duration-100',
                option.id === value ? 'text-accent-ink' : 'text-ink hover:bg-surface-3',
              )}
            >
              {option.label}
              {option.id === value && <Icon name="Check" size={13} strokeWidth={2.4} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
