import type { ReactNode } from 'react';
import { cn } from '@/utils/format';
import { Icon } from './Icon';

/**
 * A label, in one of five meanings: nothing in particular, the brand accent, or
 * one of the three states software actually has (ok, watch out, broken).
 *
 * There are deliberately no pastel tones. Colouring a badge by file type taught
 * the eye that colour means category, which is the opposite of what colour is
 * for here — a red row must mean something is wrong, not that the file is a PDF.
 */
type Tone = 'neutral' | 'accent' | 'positive' | 'caution' | 'critical';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  accent: 'bg-accent-soft text-accent-ink',
  positive: 'bg-positive/12 text-positive',
  caution: 'bg-caution/12 text-caution',
  critical: 'bg-critical/12 text-critical',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
  icon,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  icon?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-2xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon && <Icon name={icon} size={11} strokeWidth={2.2} />}
      {children}
    </span>
  );
}

/** Tags: 12px text, 5px/9px padding, fully rounded. */
export function TagPill({
  label,
  onRemove,
  onClick,
  active = false,
  className,
}: {
  label: string;
  onRemove?: () => void;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'group/tag inline-flex items-center gap-1 rounded-pill py-[5px] pl-[9px] text-meta transition-colors duration-150',
        onRemove ? 'pr-1.5' : 'pr-[9px]',
        active
          ? 'bg-accent-soft text-accent-ink'
          : 'bg-surface-3 text-ink-2 hover:bg-sunken hover:text-ink',
        onClick && 'cursor-pointer',
        className,
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-3 transition-colors duration-150 hover:bg-black/8 hover:text-ink"
        >
          <Icon name="X" size={10} strokeWidth={2.6} />
        </button>
      )}
    </span>
  );
}

/**
 * The dot in front of a log entry.
 *
 * Only three of these carry colour: something arrived, something failed, or
 * something was removed. Everything else is a neutral tick, because a feed in
 * which every row has its own colour communicates nothing at all.
 */
const DOT_TONES: Record<string, string> = {
  added: 'bg-accent',
  imported: 'bg-accent',
  indexed: 'bg-ink-3',
  deleted: 'bg-critical',
  failed: 'bg-critical',
  tagged: 'bg-ink-3',
  project: 'bg-ink-3',
  collection: 'bg-ink-3',
};

export function StatusDot({
  kind = 'added',
  className,
  ring = true,
}: {
  kind?: string;
  className?: string;
  ring?: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
        DOT_TONES[kind] ?? 'bg-ink-3',
        ring && 'ring-4 ring-surface',
        className,
      )}
    />
  );
}

/** Small keyboard hint used in menus and the palette. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-line bg-surface-2 px-1',
        'font-sans text-[10px] font-medium text-ink-3',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
