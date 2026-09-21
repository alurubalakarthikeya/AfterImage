import { useMemo } from 'react';
import type { SearchHit } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useSearchStore } from '@/stores/search';
import { useUIStore } from '@/stores/ui';
import { KIND_SINGULAR } from '@/stores/selectors';
import { highlight } from '@/utils/highlight';
import { cn, formatBytes, formatRelativeTime, formatResolution, splitExtension } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { EmptyState } from '@/components/common/EmptyState';
import { SkeletonRows } from '@/components/common/Skeleton';
import { FileThumb } from '@/components/common/FileThumb';

const MATCH_COPY: Record<SearchHit['match'], { label: string; icon: string }> = {
  filename: { label: 'Filename', icon: 'File' },
  text: { label: 'Extracted text', icon: 'ScanText' },
  tag: { label: 'Tag', icon: 'Tag' },
  folder: { label: 'Folder', icon: 'Folder' },
  project: { label: 'Project', icon: 'FolderKanban' },
  collection: { label: 'Collection', icon: 'Layers' },
  // "Similar meaning" is described, not branded: no sparkle, no "AI match".
  semantic: { label: 'Similar meaning', icon: 'Search' },
};

function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
  const segments = useMemo(() => highlight(text, terms, 240), [text, terms]);
  return (
    <>
      {segments.map((segment, index) =>
        segment.hit ? (
          <mark key={index} className="rounded-[3px] bg-highlight px-0.5 text-highlight-ink">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/**
 * Three dots of relevance.
 *
 * A number would imply precision the ranking does not have; three steps is
 * enough to tell "this is the file" from "this is related".
 */
function Relevance({ score }: { score: number }) {
  const filled = score >= 0.75 ? 3 : score >= 0.45 ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-[3px]" title={`Relevance ${Math.round(score * 100)}%`}>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          className={cn(
            'h-[5px] w-[5px] rounded-full',
            index < filled ? 'bg-accent' : 'bg-line-strong',
          )}
        />
      ))}
    </span>
  );
}

/**
 * Search results.
 *
 * Ranked by the retrieval layer, which fuses full-text matches with vector
 * similarity; each row says *why* it matched, because that single badge is what
 * makes local search feel trustworthy instead of mysterious.
 */
export function SearchResults({ onOpen }: { onOpen?: (fileId: string) => void }) {
  const status = useSearchStore((state) => state.status);
  const hits = useSearchStore((state) => state.hits);
  const terms = useSearchStore((state) => state.terms);
  const submitted = useSearchStore((state) => state.submitted);
  const error = useSearchStore((state) => state.error);
  const semanticAvailable = useSearchStore((state) => state.semanticAvailable);
  const selectedIds = useUIStore((state) => state.selectedFileIds);
  const selectFile = useUIStore((state) => state.selectFile);
  const openFile = useArchiveStore((state) => state.openFile);
  const folderCount = useArchiveStore((state) => state.folders.length);

  if (status === 'error' && error) {
    return (
      <EmptyState
        icon="AlertTriangle"
        title="Search is unavailable"
        description={error}
      />
    );
  }

  if (status === 'searching' && hits.length === 0) {
    return <SkeletonRows rows={6} className="px-1 py-2" />;
  }

  if (hits.length === 0) {
    return (
      <EmptyState
        icon="Search"
        title={submitted ? `No matches for “${submitted}”` : 'Search the archive'}
        description={
          folderCount === 0
            ? 'Nothing is indexed yet. Add a folder and AfterImage will read it in the background.'
            : submitted
              ? semanticAvailable
                ? 'Try a tag, a file type, or a looser phrase — full text and meaning are both searched.'
                : 'Try a tag, a file type, or a looser phrase. Install the local embedding model in settings to search by meaning as well.'
              : 'Search filenames, extracted text, tags, folders, collections and projects — all on this machine.'
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {hits.map((hit) => {
        const { stem, ext } = splitExtension(hit.file.name);
        const match = MATCH_COPY[hit.match] ?? MATCH_COPY.filename;
        const selected = selectedIds.includes(hit.file.id);
        const resolution = formatResolution(hit.file.width, hit.file.height);

        return (
          <div
            key={hit.file.id}
            data-file-id={hit.file.id}
            role="option"
            aria-selected={selected}
            tabIndex={-1}
            onClick={(event) =>
              selectFile(hit.file.id, { additive: event.metaKey || event.ctrlKey || event.shiftKey })
            }
            onDoubleClick={() => {
              if (onOpen) onOpen(hit.file.id);
              else void openFile(hit.file.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              useUIStore.getState().openContextMenu(event.clientX, event.clientY, hit.file.id);
            }}
            className={cn(
              'flex cursor-default items-start gap-3 rounded-card border px-3 py-2.5 transition-colors duration-150',
              selected
                ? 'border-line-strong bg-surface-2'
                : 'border-transparent hover:border-line hover:bg-surface',
            )}
          >
            <FileThumb
              file={hit.file}
              aspect={1.2}
              rounded="rounded-[9px]"
              className="h-12 w-14 shrink-0"
            />

            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 truncate text-body font-medium text-ink" title={hit.file.name}>
                  <HighlightedText text={stem} terms={terms} />
                  <span className="text-ink-3">{ext}</span>
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2 text-2xs tabular-nums text-ink-3">
                  <Relevance score={hit.score} />
                  {formatBytes(hit.file.bytes)}
                </span>
              </div>

              {hit.file.generatedTitle && (
                <p className="mt-0.5 truncate text-meta text-ink-2">{hit.file.generatedTitle}</p>
              )}

              <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xs text-ink-3">
                <span className="inline-flex items-center gap-1 rounded-pill bg-surface-2 px-1.5 py-px text-ink-2">
                  <Icon name={match.icon} size={10} strokeWidth={2.2} />
                  {match.label}
                </span>
                <span>{KIND_SINGULAR[hit.file.kind]}</span>
                <span>{formatRelativeTime(hit.file.createdAt)}</span>
                {resolution && <span>{resolution}</span>}
                <span className="truncate font-mono">{hit.file.folderPath}</span>
              </div>

              {hit.snippet && (
                <p className="mt-1.5 line-clamp-2 font-mono text-[11px] leading-relaxed text-ink-2">
                  <HighlightedText text={hit.snippet} terms={terms} />
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
