import { AnimatePresence, motion } from 'framer-motion';
import { useUIStore } from '@/stores/ui';
import { Icon } from '@/components/common/Icon';

/** Full-window target shown while files are dragged over the app. */
export function DropOverlay() {
  const active = useUIStore((state) => state.dropActive);

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="pointer-events-none fixed inset-0 z-[70] p-4"
        >
          <div
            className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-card-lg border-2 border-dashed"
            style={{
              borderColor: 'var(--af-accent)',
              backgroundColor: 'color-mix(in srgb, var(--af-surface) 82%, transparent)',
              backdropFilter: 'blur(6px)',
            }}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-3 text-ink">
              <Icon name="FolderPlus" size={22} strokeWidth={1.9} />
            </span>
            <div className="text-center">
              <p className="text-[15px] font-semibold text-ink">Drop folders to index</p>
              <p className="mt-1 text-meta text-ink-2">
                Dropped folders are watched from then on. Nothing is copied, moved or renamed.
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
