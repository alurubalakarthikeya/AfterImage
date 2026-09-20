import { useState, type ReactNode } from 'react';
import type { ArchiveFile } from '@/types';
import { reportImage } from '@/boot';
import { getHost } from '@/services/host';
import { cn } from '@/utils/format';
import { KIND_ICON } from '@/stores/selectors';
import { Icon } from './Icon';

/**
 * Natural aspect ratio for a file, clamped so nothing becomes a sliver.
 *
 * Taken from the file's real pixel dimensions — the index reads them during
 * scanning. When dimensions are unknown (a text file, a video the platform
 * could not open) the caller decides, or the thumbnail's own ratio is used.
 */
export function aspectForFile(file: ArchiveFile): number | undefined {
  if (file.width && file.height) return Math.min(2.4, Math.max(0.68, file.width / file.height));
  return undefined;
}

/**
 * A file's thumbnail.
 *
 * The image comes from disk: Rust writes a JPEG next to the index and exposes
 * it through Tauri's asset protocol, which is scoped to the thumbnail folder
 * alone. When a file has no thumbnail yet — still queued, an unsupported
 * format, or a type that simply has none — we draw a neutral placeholder rather
 * than substitute invented artwork. A placeholder says "not generated yet"; a
 * fake image would say something false about the user's own file.
 */
export function FileThumb({
  file,
  aspect,
  className,
  rounded = 'rounded-thumb',
  children,
  overlay,
  eager = false,
  fill = false,
}: {
  file: ArchiveFile;
  /** Override the natural ratio (used by the masonry grid). */
  aspect?: number;
  className?: string;
  rounded?: string;
  children?: ReactNode;
  overlay?: ReactNode;
  eager?: boolean;
  fill?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  const ratio = fill ? undefined : (aspect ?? aspectForFile(file));
  const src = file.thumbPath ? getHost().assetUrl(file.thumbPath) : '';

  if (!src || failed) {
    return (
      <div
        className={cn('relative overflow-hidden', rounded, className)}
        style={ratio ? { aspectRatio: String(ratio) } : undefined}
      >
        <FilePlaceholder file={file} />
        {overlay}
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn('relative overflow-hidden bg-surface-2', rounded, className)}
      style={ratio ? { aspectRatio: String(ratio) } : undefined}
    >
      <img
        src={src}
        alt={file.generatedTitle ?? file.name}
        draggable={false}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => {
          setLoaded(true);
          reportImage(true, file.name);
        }}
        onError={() => {
          setFailed(true);
          reportImage(false, `${file.name} → ${src.slice(0, 120)}`);
        }}
        className={cn(
          'h-full w-full object-cover transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
      {/* Hairline inside the crop keeps images from bleeding into the card. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{ boxShadow: 'inset 0 0 0 1px rgba(20,33,36,0.06)' }}
      />
      {overlay}
      {children}
    </div>
  );
}

/**
 * The stand-in for a file with no thumbnail.
 *
 * Deliberately not decorative: a kind icon, the extension, and the file's
 * status when it has one worth showing.
 */
export function FilePlaceholder({ file, className }: { file: ArchiveFile; className?: string }) {
  const showsStatus = file.indexState === 'failed' || file.indexState === 'missing';

  return (
    <div
      data-placeholder={file.kind}
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-2 px-3 text-center',
        className,
      )}
    >
      <Icon
        name={KIND_ICON[file.kind] ?? 'File'}
        size={22}
        strokeWidth={1.6}
        className="text-ink-3"
      />
      <span className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wide text-ink-3">
        {file.ext.replace(/^\./, '') || 'file'}
      </span>
      {showsStatus && (
        <span className="text-[10px] text-caution">
          {file.indexState === 'missing' ? 'not found on disk' : 'could not be indexed'}
        </span>
      )}
    </div>
  );
}

/** Duration / page-count chip that sits on a thumbnail corner. */
export function ThumbChip({
  children,
  className,
  icon,
}: {
  children: ReactNode;
  className?: string;
  icon?: string;
}) {
  return (
    <span
      className={cn(
        'pointer-events-none inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-white',
        className,
      )}
      style={{ backgroundColor: 'rgba(15,21,20,0.62)' }}
    >
      {icon && <Icon name={icon} size={10} strokeWidth={2.2} />}
      {children}
    </span>
  );
}
