import { forwardRef, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cn } from '@/utils/format';

type Size = 'xs' | 'sm' | 'md' | 'lg';
type Variant = 'ghost' | 'soft' | 'solid' | 'outline';

const SIZES: Record<Size, string> = {
  xs: 'h-6 w-6 rounded-lg',
  sm: 'h-8 w-8 rounded-[10px]',
  md: 'h-[36px] w-[36px] rounded-[10px]',
  lg: 'h-10 w-10 rounded-xl',
};

const VARIANTS: Record<Variant, string> = {
  ghost: 'text-ink-2 hover:bg-surface-3 hover:text-ink',
  soft: 'bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink border border-line',
  solid: 'bg-accent text-white hover:bg-accent-strong',
  outline: 'border border-line text-ink-2 hover:border-line-strong hover:text-ink',
};

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: Size;
  variant?: Variant;
  /** Selected state uses the soft accent fill, never a saturated block. */
  active?: boolean;
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef(function IconButton(
  { size = 'md', variant = 'ghost', active = false, label, className, children, ...rest }: IconButtonProps,
  ref: Ref<HTMLButtonElement>,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center transition-[background-color,color,transform,box-shadow] duration-150 tap-highlight-none',
        'disabled:pointer-events-none disabled:opacity-40',
        SIZES[size],
        VARIANTS[variant],
        active && 'bg-accent-soft text-accent-ink hover:bg-accent-soft hover:text-accent-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/** A group of icon buttons that reads as one segmented control. */
export function IconButtonGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-xl border border-line bg-surface-2 p-0.5',
        className,
      )}
    >
      {children}
    </div>
  );
}
