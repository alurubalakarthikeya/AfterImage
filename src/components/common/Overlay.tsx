import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/utils/format';

const EASE = [0.2, 0.8, 0.2, 1] as const;

export function Scrim({
  onClick,
  className,
  blur = true,
}: {
  onClick?: () => void;
  className?: string;
  blur?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: EASE }}
      onClick={onClick}
      className={cn(
        'fixed inset-0 z-40',
        blur && 'backdrop-blur-[2px]',
        className,
      )}
      style={{ backgroundColor: 'rgba(15, 21, 20, 0.34)' }}
    />
  );
}

/** Centred dialog used by quick look, shortcuts and destructive confirms. */
export function Modal({
  open,
  onClose,
  children,
  className,
  align = 'center',
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  align?: 'center' | 'top';
  labelledBy?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <Scrim onClick={onClose} />
          <div
            className={cn(
              'pointer-events-none fixed inset-0 z-50 flex justify-center px-6',
              align === 'center' ? 'items-center' : 'items-start pt-[12vh]',
            )}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={labelledBy}
              initial={{ opacity: 0, scale: 0.985, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.99, y: 4 }}
              transition={{ duration: 0.18, ease: EASE }}
              onClick={(event) => event.stopPropagation()}
              className={cn(
                'pointer-events-auto w-full max-w-[560px] overflow-hidden rounded-card-lg border border-line bg-surface',
                className,
              )}
              style={{ boxShadow: 'var(--af-shadow-float)' }}
            >
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
