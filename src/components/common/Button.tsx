import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/utils/format';
import { Icon } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  // The primary action is a neutral block, not a coloured one: on GitHub and
  // Vercel the only saturated thing on a page is a link or a state, and the
  // button you are meant to press reads as the darkest thing on the surface.
  primary:
    'bg-ink text-canvas hover:bg-ink-2 shadow-soft border border-transparent',
  secondary:
    'bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2 shadow-soft',
  ghost: 'text-ink-2 hover:bg-surface-3 hover:text-ink border border-transparent',
  subtle: 'bg-surface-3 text-ink border border-transparent hover:bg-sunken',
  danger: 'bg-critical text-white border border-transparent hover:opacity-90',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-3 text-meta gap-1.5 rounded-[10px]',
  md: 'h-10 px-4 text-body gap-2 rounded-btn',
  lg: 'h-11 px-5 text-body gap-2 rounded-btn',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: string;
  iconRight?: string;
  /** Swaps the leading icon for a spinner and blocks the click. */
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150',
        'active:translate-y-px disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Icon name="Loader2" size={size === 'sm' ? 14 : 16} strokeWidth={2} className="animate-spin" />
      ) : (
        icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} strokeWidth={2} />
      )}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 14 : 16} strokeWidth={2} />}
    </button>
  );
}

/** The small "Section →" affordance used on every card header. */
export function LinkButton({
  children,
  onClick,
  className,
  icon = 'ArrowRight',
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  icon?: string | null;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group/link inline-flex items-center gap-1 text-meta font-medium text-ink-2 transition-colors duration-150 hover:text-accent-ink',
        className,
      )}
    >
      {children}
      {icon && (
        <Icon
          name={icon}
          size={13}
          className="transition-transform duration-150 group-hover/link:translate-x-0.5"
        />
      )}
    </button>
  );
}

export interface PillTab {
  id: string;
  label: string;
  count?: number;
}

/** Rounded tab row. Selected uses the deep accent, exactly as specified. */
export function PillTabs({
  tabs,
  value,
  onChange,
  className,
  size = 'md',
}: {
  tabs: PillTab[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={cn('flex items-center gap-1.5', className)} role="tablist">
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-pill font-medium transition-colors duration-150',
              size === 'sm' ? 'h-7 px-2.5 text-2xs' : 'h-8 px-[13px] text-meta',
              selected
                ? 'bg-accent-strong text-white'
                : 'bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink',
            )}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={cn('tabular-nums', selected ? 'text-white/70' : 'text-ink-3')}>
                {tab.count.toLocaleString('en-US')}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
