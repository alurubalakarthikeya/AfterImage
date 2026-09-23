import { useEffect, useState } from 'react';
import type { ArchiveFile } from '@/types';
import { getHost } from '@/services/host';
import { cn } from '@/utils/format';
import { Icon } from '@/components/common/Icon';

/**
 * The kinds of file this can render from the original.
 *
 * Images are deliberately absent: the pipeline already made a preview of every
 * photograph at the size the window can show, and re-reading the original to
 * display it would be slower, larger and no better looking. These three are the
 * ones a JPEG preview cannot stand in for.
 */
type Renderable = 'video' | 'audio' | 'pdf';

/** Extensions the webview will lay out as a document rather than offer to download. */
const DOCUMENT_EXTENSIONS = ['.pdf'];

function renderable(file: ArchiveFile): Renderable | null {
  if (file.kind === 'video') return 'video';
  if (file.kind === 'audio') return 'audio';
  if (
    file.kind === 'document' &&
    DOCUMENT_EXTENSIONS.some((extension) => file.ext.toLowerCase() === extension)
  ) {
    return 'pdf';
  }
  return null;
}

/**
 * True when this file is worth asking the host for the original at all.
 *
 * Used by the callers to decide between this component and the generated
 * preview, so the decision is made in one place rather than in each viewer.
 */
export function canRenderOriginal(file: ArchiveFile): boolean {
  return renderable(file) !== null;
}

/**
 * Play or lay out a file from disk, in the interface.
 *
 * The webview is only allowed to read the thumbnail folder, so the original is
 * requested one file at a time (`grantFileAccess`) and turned into an asset URL.
 * Three outcomes are kept apart, because they need three different sentences:
 * still asking, allowed, and refused — and a refusal falls back to whatever the
 * caller shows for a file with no preview rather than an error box.
 */
export function MediaViewer({
  file,
  className,
  poster,
  autoPlay = false,
}: {
  file: ArchiveFile;
  className?: string;
  /** Shown by a video until it starts playing — the pipeline's own frame. */
  poster?: string;
  autoPlay?: boolean;
}) {
  const kind = renderable(file);
  const [src, setSrc] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!kind) return;
    let cancelled = false;
    setSrc(null);
    setBlocked(false);

    void (async () => {
      try {
        const path = await getHost().grantFileAccess(file.id);
        if (cancelled) return;
        setSrc(getHost().assetUrl(path));
      } catch {
        // Not an error worth a dialog: the original may not be where the index
        // last saw it, and the preview beside it is still a real picture.
        if (!cancelled) setBlocked(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file.id, kind]);

  if (!kind || blocked) return null;

  if (!src) {
    // The wait, not a spinner on the file: a video's first frame takes as long
    // as the disk does, and a spinner over a poster would be a second animation
    // competing with the thing being loaded.
    return (
      <div
        className={cn(
          'flex h-full w-full items-center justify-center bg-surface-sunken text-ink-3',
          className,
        )}
      >
        <Icon name="Loader2" size={18} className="animate-spin" />
      </div>
    );
  }

  if (kind === 'audio') {
    return (
      <div className={cn('flex w-full flex-col items-center justify-center gap-3 p-6', className)}>
        <Icon name="Music" size={30} strokeWidth={1.4} className="text-ink-3" />
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio src={src} controls autoPlay={autoPlay} className="w-full max-w-[420px]" />
      </div>
    );
  }

  if (kind === 'pdf') {
    return (
      <iframe
        // The webview's own document renderer: real pages, real text selection,
        // scrolling, printing — none of which a re-implementation would match.
        src={src}
        title={file.generatedTitle ?? file.name}
        className={cn('h-full w-full border-0 bg-surface-sunken', className)}
      />
    );
  }

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      src={src}
      poster={poster}
      controls
      autoPlay={autoPlay}
      playsInline
      preload="metadata"
      className={cn('max-h-full max-w-full bg-black object-contain', className)}
    />
  );
}
