import type { ArchiveFile } from '@/types';
import { KIND_SINGULAR } from '@/stores/selectors';
import { useArchiveStore } from '@/stores/archive';
import { cn, formatAbsolute, formatBytes, formatCount, formatResolution } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

interface Row {
  label: string;
  value: string;
  title?: string;
  copy?: string;
  mono?: boolean;
  problem?: boolean;
}

/**
 * File information.
 *
 * An inspector table: uppercase label column, value column, hairlines between
 * rows. Icons are gone from it — a calendar glyph in front of every date, a
 * folder glyph in front of every path, was decoration repeated eight times in a
 * 320px column, and it cost 60px of a panel that needs the width for paths.
 */
export function FileMetadata({ file, className }: { file: ArchiveFile; className?: string }) {
  const copyPath = useArchiveStore((state) => state.copyPath);

  const rows: Row[] = [
    { label: 'Type', value: `${KIND_SINGULAR[file.kind]} · ${file.ext.replace(/^\./, '').toUpperCase() || 'FILE'}` },
    { label: 'Size', value: formatBytes(file.bytes) },
  ];

  const resolution = formatResolution(file.width, file.height);
  if (resolution) rows.push({ label: 'Dimensions', value: resolution });
  if (file.durationSec !== undefined) {
    rows.push({ label: 'Duration', value: `${Math.round(file.durationSec)}s` });
  }
  if (file.pages !== undefined && file.pages > 0) {
    rows.push({ label: 'Pages', value: formatCount(file.pages) });
  }

  rows.push({ label: 'Added', value: formatAbsolute(file.createdAt) });
  rows.push({ label: 'Modified', value: formatAbsolute(file.modifiedAt) });

  if (file.ocrText) {
    rows.push({
      label: 'Text',
      value: file.ocrConfidence
        ? `Extracted · ${Math.round(file.ocrConfidence * 100)}% confidence`
        : 'Extracted',
    });
  } else if (file.ocrState === 'unavailable') {
    rows.push({ label: 'Text', value: 'Extraction unavailable', problem: true });
  } else if (file.ocrState === 'none') {
    rows.push({ label: 'Text', value: 'Not a text format' });
  }

  if (file.indexState !== 'indexed') {
    rows.push({
      label: 'Index',
      value:
        file.indexState === 'missing'
          ? 'Not on disk any more'
          : file.indexState === 'failed'
            ? 'Could not be processed'
            : `Waiting (${file.indexState})`,
      problem: file.indexState === 'failed' || file.indexState === 'missing',
    });
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <dl className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.label}
            className="group/meta flex items-baseline gap-3 border-b border-line py-1.5 last:border-b-0"
          >
            <dt className="w-[76px] shrink-0 text-[10.5px] uppercase tracking-[0.07em] text-ink-3">
              {row.label}
            </dt>
            <dd
              className={cn(
                'min-w-0 flex-1 text-meta',
                row.problem ? 'text-critical' : 'text-ink-2',
              )}
              title={row.title ?? row.value}
              data-selectable
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Paths get their own block: they are long, copyable, and the one piece of
          metadata a person routinely needs in full. */}
      <div className="mt-3 flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[10.5px] uppercase tracking-[0.07em] text-ink-3">Location</span>
          <button
            type="button"
            onClick={() => void copyPath(file.id)}
            className="ml-auto inline-flex items-center gap-1 text-2xs text-ink-3 transition-colors duration-150 hover:text-ink"
          >
            <Icon name="Copy" size={11} strokeWidth={1.9} />
            Copy
          </button>
        </div>
        <p
          className="break-all font-mono text-[11px] leading-relaxed text-ink-2"
          title={file.path}
          data-selectable
        >
          {file.path}
        </p>
      </div>
    </div>
  );
}
