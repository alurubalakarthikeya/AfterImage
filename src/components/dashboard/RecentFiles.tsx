import { useMemo, useState } from 'react';
import type { ArchiveFile, FileKind } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useSettingsStore } from '@/stores/settings';
import { useUIStore } from '@/stores/ui';
import { formatCount } from '@/utils/format';
import { useFileQuery } from '@/hooks/useFileQuery';
import { Card, SectionHeader } from '@/components/common/Card';
import { PillTabs } from '@/components/common/Button';
import { FileGrid } from '@/components/files/FileGrid';

const TABS: Array<{ id: string; label: string; kind?: FileKind }> = [
  { id: 'all', label: 'All' },
  { id: 'photo', label: 'Images', kind: 'photo' },
  { id: 'screenshot', label: 'Screenshots', kind: 'screenshot' },
  { id: 'document', label: 'Documents', kind: 'document' },
  { id: 'video', label: 'Videos', kind: 'video' },
];

/** Tiles the dashboard shows before "View all" takes over. */
const HOME_TILES = 8;

/**
 * Recent files.
 *
 * The masonry grid is the point: a screenshot next to a portrait next to a
 * document, sized by what they actually are. The rows come from the index,
 * ordered by creation date, filtered by the tab — nothing here is a local slice
 * of a cached list, so a file indexed a second ago can appear in it.
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

  const countFor = (kind?: FileKind) => {
    if (!kind) return totals.files;
    return totals.byKind[kind] ?? 0;
  };

  if (folders.length === 0) return null;

  return (
    <Card className={className ? `p-4 ${className}` : 'p-4'}>
      <SectionHeader
        title="Recent Files"
        subtitle={`${formatCount(query.kinds ? countFor(active.kind) : total)} ${
          query.kinds ? `${active.label.toLowerCase()} ` : ''
        }indexed`}
        actionLabel="View all"
        onAction={() => navigate('all')}
      >
        <PillTabs
          tabs={TABS.map((item) => ({
            id: item.id,
            label: item.label,
            count: item.kind ? countFor(item.kind) : undefined,
          }))}
          value={tab}
          onChange={setTab}
          className="mr-2 hidden xl:flex"
        />
      </SectionHeader>

      <PillTabs
        tabs={TABS.map((item) => ({ id: item.id, label: item.label }))}
        value={tab}
        onChange={setTab}
        size="sm"
        className="mt-3 xl:hidden"
      />

      <FileGrid
        files={files}
        loading={loading}
        minColumn={Math.max(150, thumbnailSize - 10)}
        className="mt-4"
        emptyTitle={active.kind ? `No ${active.label.toLowerCase()} indexed yet` : 'Nothing indexed yet'}
        emptyDescription={
          active.kind
            ? 'Once a folder containing these is watched, they appear here automatically.'
            : 'Add a folder from the sidebar to start building your archive.'
        }
        onOpen={(file: ArchiveFile) => void openFile(file.id)}
      />
    </Card>
  );
}
