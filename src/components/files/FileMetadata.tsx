import type { ArchiveFile } from '@/types';
import { KIND_SINGULAR } from '@/stores/selectors';
import { useArchiveStore } from '@/stores/archive';
import { cn, formatAbsolute, formatBytes, formatCount, formatResolution } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

interface Row {
  icon: string;
  label: string;
  value: string;
  title?: string;
  copy?: boolean;
  mono?: boolean;
}

/** Dense, scannable metadata. No giant cards, no wasted vertical space. */
export function FileMetadata({ file, className }: { file: ArchiveFile; className?: string }) {
  const copyPath = useArchiveStore((state) => state.copyPath);

  const rows: Row[] = [
    { icon: 'Calendar', label: 'Date', value: formatAbsolute(file.createdAt) },
    {
      icon: 'Maximize2',
      label: 'Size',
      value: formatResolution(file.width, file.height) ?? '—',
    },
    { icon: 'HardDrive', label: 'Bytes', value: formatBytes(file.bytes) },
    { icon: file.kind === 'video' ? 'Film' : 'File', label: 'Type', value: `${KIND_SINGULAR[file.kind]} · .${file.ext}` },
  ];

  if (file.pages) {
    rows.push({ icon: 'FileText', label: 'Pages', value: formatCount(file.pages) });
  }
  if (file.ocrConfidence) {
    rows.push({
      icon: 'ScanText',
      label: 'OCR',
      value: `${Math.round(file.ocrConfidence * 100)}% confidence`,
    });
  }

  rows.push({
    icon: 'Folder',
    label: 'Folder',
    value: file.folderPath,
    title: file.folderPath,
    copy: true,
    mono: true,
  });
  rows.push({
    icon: 'Hash',
    label: 'Path',
    value: file.path,
    title: file.path,
    copy: true,
    mono: true,
  });

  return (
    <div className={cn('flex flex-col', className)}>
      {rows.map((row) => (
        <div
          key={row.label}
          className="group/meta flex items-center gap-2.5 border-b border-line py-[7px] last:border-b-0"
        >
          <span className="flex w-3.5 shrink-0 items-center justify-center text-ink-3">
            <Icon name={row.icon} size={14} strokeWidth={1.8} />
          </span>
          <span className="w-[52px] shrink-0 text-2xs text-ink-3">{row.label}</span>
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-meta text-ink',
              row.mono && 'font-mono text-[11.5px] text-ink-2',
            )}
            title={row.title ?? row.value}
            data-selectable
          >
            {row.value}
          </span>
          {row.copy && (
            <button
              type="button"
              aria-label={`Copy ${row.label}`}
              onClick={() => void copyPath(file.id)}
              className="shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 hover:text-ink group-hover/meta:opacity-100"
            >
              <Icon name="Copy" size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
