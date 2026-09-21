import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { useUIStore } from '@/stores/ui';
import { cn } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

const ICONS: Record<string, string> = {
  info: 'Info',
  warn: 'AlertTriangle',
  error: 'AlertTriangle',
  success: 'CheckCircle2',
};

const TONES: Record<string, string> = {
  info: 'text-ink-2',
  warn: 'text-caution',
  error: 'text-critical',
  success: 'text-positive',
};

/** Bottom-centre transient messages. Individually dismissed, never stacked. */
export function NoticeHost() {
  const notice = useUIStore((state) => state.notice);
  const dismiss = useUIStore((state) => state.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const timeout = notice.level === 'error' ? 7000 : 3600;
    const timer = setTimeout(dismiss, timeout);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-6">
      <AnimatePresence>
        {notice && (
          <motion.div
            key={notice.id}
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            className="glass-float pointer-events-auto flex max-w-[520px] items-center gap-3 rounded-card border border-line px-3.5 py-2.5"
            style={{ boxShadow: 'var(--af-shadow-float)' }}
            role="status"
          >
            <Icon
              name={ICONS[notice.level] ?? 'Info'}
              size={15}
              strokeWidth={2}
              className={cn('shrink-0', TONES[notice.level])}
            />
            <span className="min-w-0 flex-1 text-body text-ink">{notice.message}</span>
            {notice.action && (
              <button
                type="button"
                onClick={() => {
                  notice.action?.run();
                  dismiss();
                }}
                className="shrink-0 text-meta font-medium text-accent-ink transition-colors hover:text-accent"
              >
                {notice.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="shrink-0 text-ink-3 transition-colors hover:text-ink"
            >
              <Icon name="X" size={14} strokeWidth={2.2} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
