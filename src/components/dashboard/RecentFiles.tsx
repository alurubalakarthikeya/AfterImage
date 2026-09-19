import { useMemo, useState } from 'react';
import type { ArchiveFile, FileKind } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { formatCount } from '@/utils/format';
import { useFileQuery } from '@/hooks/useFileQuery';
import { PillTabs } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { FileGrid } from '@/components/files/FileGrid';

const TABS: Array<{ id: string; label: string; kind?: FileKind }> = [
  { id: 'all', label: 'All' },
  { id: 'photo', label: 'Images', kind: 'photo' },
  { id: 'screenshot', label: 'Screenshots', kind: 'screenshot' },
  { id: 'document', label: 'Documents', kind: 'document' },
  { id: 'video', label: 'Videos', kind: 'video' },
];

/** Tiles the dashboard shows before the file browser takes over. */
const HOME_TILES = 8;

/**
 * Recently added.
 *
 * Deliberately not a card. The gallery is the content of the page, so it sits on
 * the page: one heading row with the filter and a route into the full browser,
 * then the tiles. Wrapping a gallery in a bordered panel added a frame around
 * the only thing the user came here to look at.
 */
export function RecentFiles({ className }: { className?: string }) {
  const [tab, setTab] = useState('all');
  const navigate = useUIStore((state) => state.navigate);
  const openFile = useArchiveStore((state) => state.openFile);
  const totals = useArchiveStore((state) => state.totals);
  const folders = useArchiveStore((state) => state.folders);
  const thumbnailSize = useSettingsStore((state) => state.thumbnailSize);

  const active = TABS.find((item) => item.id === tab) ?? TABS[0];
  const query = useMemo(
    () => ({ kinds: active.kind ? [active.kind] : undefined, sort: 'recent' as const, limit: HOME_TILES }),
    [active.kind],
  );
  const { files, total, loading } = useFileQuery(query);

  const countFor = (kind?: FileKind) => (kind ? (totals.byKind[kind] ?? 0) : totals.files);

  if (folders.length === 0) return null;

  const shown = query.kinds ? countFor(active.kind) : total;

  return (
    <section className={className} aria-label="Recently added files">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-section font-semibold tracking-[-0.01em] text-ink">Recently added</h2>
          <span className="text-2xs tabular-nums text-ink-3">
            {formatCount(shown)} {active.kind ? active.label.toLowerCase() : 'files'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <PillTabs
            tabs={TABS.map((item) => ({ id: item.id, label: item.label }))}
            value={tab}
            onChange={setTab}
            size="sm"
          />
          <button
            type="button"
            onClick={() => navigate('all')}
            className="inline-flex items-center gap-1 text-2xs font-medium text-accent-ink underline-offset-4 hover:underline"
          >
            Browse all
            <Icon name="ArrowRight" size={11} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <FileGrid
        files={files}
        loading={loading}
        minColumn={Math.max(150, thumbnailSize - 10)}
        className="mt-3"
        emptyTitle={active.kind ? `No ${active.label.toLowerCase()} indexed yet` : 'Nothing indexed yet'}
        emptyDescription={
          active.kind
            ? 'Once a folder containing these is watched, they appear here automatically.'
            : 'Add a folder from the sidebar to start building your archive.'
        }
        onOpen={(file: ArchiveFile) => void openFile(file.id)}
      />
    </section>
  );
}
