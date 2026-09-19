import { useMemo } from 'react';
import type { ArchiveFile } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useCollectionStore } from '@/stores/collections';
import { KIND_LABEL, KIND_SINGULAR } from '@/stores/selectors';
import { useUIStore } from '@/stores/ui';
import { cn, formatBytes, formatCount, formatStorage } from '@/utils/format';
import { Card } from '@/components/common/Card';
import { Icon } from '@/components/common/Icon';
import { IconButton } from '@/components/common/IconButton';
import { Tooltip } from '@/components/common/Tooltip';
import { Button } from '@/components/common/Button';
import { ProgressBar } from '@/components/common/ProgressBar';
import { PromoCard } from '@/components/dashboard/PromoCard';
import { ActivityTimeline } from '@/components/dashboard/ActivityTimeline';
import { FilePreview } from '@/components/files/FilePreview';
import { FileMetadata } from '@/components/files/FileMetadata';
import { TagEditor } from '@/components/files/TagEditor';
import { ExtractedText } from '@/components/files/ExtractedText';
import { RelatedFiles } from '@/components/files/RelatedFiles';

function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** What the inspector shows when nothing is selected: philosophy + system state. */
function IdleInspector() {
  const storage = useArchiveStore((state) => state.storage);
  const folders = useArchiveStore((state) => state.folders);
  const totals = useArchiveStore((state) => state.totals);
  const navigate = useUIStore((state) => state.navigate);

  const watched = folders.filter((folder) => folder.watched);

  return (
    <>
      <PromoCard />

      <Card className="p-4">
        <Section title="Local Index">
          <div className="flex items-baseline justify-between">
            <span className="text-[19px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
              {formatCount(totals.files)}
            </span>
            <span className="text-2xs text-ink-3">files indexed</span>
          </div>
          {/* Where volume capacity is unknown the bar shows composition
              instead of a fraction, which is still a true statement. */}
          <ProgressBar
            value={storage.usedBytes}
            max={storage.totalBytes > 0 ? storage.totalBytes : Math.max(1, storage.usedBytes)}
            className="mt-3"
            height={4}
            segments={[
              { value: storage.byKind.screenshot ?? 0, className: 'bg-accent' },
              { value: storage.byKind.photo ?? 0, className: 'bg-accent/70' },
              { value: storage.byKind.video ?? 0, className: 'bg-accent/45' },
              { value: storage.byKind.document ?? 0, className: 'bg-accent/28' },
            ]}
          />
          <div className="mt-2 flex items-center justify-between text-2xs text-ink-3">
            <span>
              <span className="text-ink-2">{formatStorage(storage.usedBytes)}</span>{' '}
              {storage.totalBytes > 0
                ? `of ${formatStorage(storage.totalBytes)}`
                : 'indexed on this device'}
            </span>
            <span>{storage.failedFiles} failed</span>
          </div>

          <div className="mt-4 flex flex-col gap-1.5">
            {watched.slice(0, 4).map((folder) => (
              <div key={folder.id} className="flex items-center gap-2 text-2xs">
                <Icon name="Folder" size={12} strokeWidth={1.9} className="shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1 truncate font-mono text-ink-2">{folder.path}</span>
                <span className="shrink-0 tabular-nums text-ink-3">
                  {formatCount(folder.fileCount)}
                </span>
              </div>
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            icon="Plus"
            className="mt-3 w-full justify-center"
            onClick={() => navigate('settings')}
          >
            Manage watch folders
          </Button>
        </Section>
      </Card>

      <ActivityTimeline limit={4} />

      <Card className="p-4">
        <Section title="Tip">
          <p className="text-meta leading-relaxed text-ink-2">
            Select a file to inspect its metadata and extracted text. Press{' '}
            <span className="font-mono text-[11px] text-ink">Ctrl K</span> to search the index, or
            drop a folder onto the window to watch it.
          </p>
        </Section>
      </Card>
    </>
  );
}

function MultiSelection({ files }: { files: ArchiveFile[] }) {
  const deleteFiles = useArchiveStore((state) => state.deleteFiles);
  const toggleFavorite = useArchiveStore((state) => state.toggleFavorite);
  const collections = useArchiveStore((state) => state.collections);
  const toggleFile = useCollectionStore((state) => state.toggleFile);
  const clearSelection = useUIStore((state) => state.clearSelection);

  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const kinds = useMemo(() => {
    const map = new Map<string, number>();
    for (const file of files) map.set(file.kind, (map.get(file.kind) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [files]);

  return (
    <>
      <Card className="p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[19px] font-semibold tabular-nums tracking-[-0.02em] text-ink">
            {formatCount(files.length)}
          </span>
          <span className="text-2xs text-ink-3">files selected</span>
        </div>
        <div className="mt-1 text-meta text-ink-2">{formatBytes(totalBytes)} total</div>

        <div className="mt-4 flex flex-col gap-1.5">
          {kinds.map(([kind, count]) => (
            <div key={kind} className="flex items-center gap-2 text-2xs">
              <span className="flex-1 text-ink-2">{KIND_LABEL[kind as keyof typeof KIND_LABEL]}</span>
              <span className="tabular-nums text-ink-3">{count}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon="Star"
            onClick={() => files.forEach((file) => toggleFavorite(file.id))}
          >
            Favourite
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon="Trash2"
            onClick={() => deleteFiles(files.map((file) => file.id))}
          >
            Trash
          </Button>
        </div>
      </Card>

      <Card className="p-4">
        <Section title="Add to collection">
          <div className="flex flex-wrap gap-1.5">
            {collections.slice(0, 8).map((collection) => (
              <button
                key={collection.id}
                type="button"
                onClick={() => files.forEach((file) => toggleFile(file.id, collection.id))}
                className="inline-flex items-center gap-1.5 rounded-pill bg-surface-2 px-2.5 py-1 text-2xs text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
              >
                <Icon name={collection.icon} size={11} strokeWidth={2} />
                {collection.name}
              </button>
            ))}
          </div>
        </Section>
      </Card>

      <Card className="p-4">
        <Section
          title={`${files.length} files`}
          action={
            <button
              type="button"
              onClick={clearSelection}
              className="text-2xs text-ink-3 transition-colors hover:text-ink"
            >
              Clear
            </button>
          }
        >
          <div className="flex max-h-[260px] flex-col gap-1 overflow-y-auto">
            {files.slice(0, 40).map((file) => (
              <span key={file.id} className="truncate text-2xs text-ink-2">
                {file.name}
              </span>
            ))}
          </div>
        </Section>
      </Card>
    </>
  );
}

function SingleFileInspector({ file }: { file: ArchiveFile }) {
  const openFile = useArchiveStore((state) => state.openFile);
  const revealFile = useArchiveStore((state) => state.revealFile);
  const toggleFavorite = useArchiveStore((state) => state.toggleFavorite);
  const projects = useArchiveStore((state) => state.projects);
  const setProject = useArchiveStore((state) => state.setProject);
  const setQuickLookOpen = useUIStore((state) => state.setQuickLookOpen);
  const clearSelection = useUIStore((state) => state.clearSelection);

  const project = projects.find((item) => item.id === file.projectId) ?? null;

  return (
    <>
      <FilePreview file={file} />

      <div className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-card font-semibold leading-snug text-ink" data-selectable title={file.name}>
              {file.name}
            </h2>
            <p className="mt-0.5 text-2xs text-ink-3">
              {KIND_SINGULAR[file.kind]}
              {project ? ` · ${project.name}` : ''}
              {file.indexState !== 'indexed' ? ` · ${file.indexState}` : ''}
            </p>
          </div>
          <Tooltip label="Close inspector" side="left">
            <IconButton size="sm" label="Clear selection" onClick={clearSelection}>
              <Icon name="X" size={15} />
            </IconButton>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            variant="primary"
            size="sm"
            icon="ExternalLink"
            className="flex-1 justify-center"
            onClick={() => void openFile(file.id)}
          >
            Open
          </Button>
          <Tooltip label="Open location" side="top">
            <IconButton
              size="md"
              variant="soft"
              label="Open location"
              onClick={() => void revealFile(file.id)}
            >
              <Icon name="FolderOpen" size={16} strokeWidth={1.9} />
            </IconButton>
          </Tooltip>
          <Tooltip label={file.favorite ? 'Remove favourite' : 'Favourite'} side="top">
            <IconButton
              size="md"
              variant="soft"
              label="Favourite"
              active={file.favorite}
              onClick={() => toggleFavorite(file.id)}
            >
              <Icon
                name="Star"
                size={16}
                strokeWidth={1.9}
                fill={file.favorite ? 'currentColor' : 'none'}
              />
            </IconButton>
          </Tooltip>
          <Tooltip label="Quick look" shortcut="Space" side="top">
            <IconButton
              size="md"
              variant="soft"
              label="Quick look"
              onClick={() => setQuickLookOpen(true)}
            >
              <Icon name="Eye" size={16} strokeWidth={1.9} />
            </IconButton>
          </Tooltip>
        </div>
      </div>

      <Card className="p-4">
        <Section title="Details">
          <FileMetadata file={file} />
        </Section>
      </Card>

      <Card className="p-4">
        <Section title="Tags">
          <TagEditor file={file} />
        </Section>
      </Card>

      <Card className="p-4">
        <Section
          title="Project"
          action={
            project && (
              <button
                type="button"
                onClick={() => setProject(file.id, null)}
                className="text-2xs text-ink-3 transition-colors hover:text-ink"
              >
                Remove
              </button>
            )
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {projects.slice(0, 5).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setProject(file.id, item.id === file.projectId ? null : item.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-2xs transition-colors duration-150',
                  item.id === file.projectId
                    ? 'bg-accent-soft text-accent-ink'
                    : 'bg-surface-2 text-ink-2 hover:bg-surface-3 hover:text-ink',
                )}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: item.color }}
                  aria-hidden="true"
                />
                {item.name}
              </button>
            ))}
          </div>
        </Section>
      </Card>

      <Card className="p-4">
        <Section
          title="Extracted Text"
          action={
            file.ocrText ? (
              <span className="text-2xs text-ink-3">OCR · on device</span>
            ) : undefined
          }
        >
          <ExtractedText file={file} />
        </Section>
      </Card>

      <Card className="p-4">
        <Section
          title="Related Files"
          action={<span className="text-2xs text-ink-3">by tags &amp; project</span>}
        >
          <RelatedFiles file={file} />
        </Section>
      </Card>
    </>
  );
}

/**
 * The right column.
 *
 * Dense, scrollable, and never competing with the workspace: it answers "what
 * is this file?" and nothing else.
 */
export function Inspector() {
  // Selection is resolved against every record this session has seen, not the
  // current page: a search result, a related file and a grid tile all have to
  // open the inspector even though only one of them is in the working set.
  const known = useArchiveStore((state) => state.known);
  const selectedIds = useUIStore((state) => state.selectedFileIds);

  const selected = useMemo(
    () => selectedIds.map((id) => known[id]).filter((file): file is ArchiveFile => Boolean(file)),
    [known, selectedIds],
  );

  return (
    // `[&>*]:shrink-0` matters: without it the column's children are allowed to
    // compress, and a fixed-height card (the promo panel) collapses to a strip.
    <aside
      className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1 [&>*]:shrink-0"
      aria-label="Inspector"
    >
      {selected.length === 0 && <IdleInspector />}
      {selected.length === 1 && <SingleFileInspector file={selected[0]} />}
      {selected.length > 1 && <MultiSelection files={selected} />}
    </aside>
  );
}
