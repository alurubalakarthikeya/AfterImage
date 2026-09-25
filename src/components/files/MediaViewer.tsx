import { useEffect, useState } from 'react';
import type { ArchiveFile } from '@/types';
import { getHost } from '@/services/host';
import { cn, formatCount } from '@/utils/format';
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

/** Extensions the browser will lay out as a document rather than offer to download. */
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
 * True when this file is worth opening in the viewer at all.
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
 * Three outcomes are kept apart, because they need three different sentences:
 * still asking, allowed, and refused — and a refusal falls back to whatever the
 * caller shows for a file with no preview rather than an error box.
 *
 * Documents are the case worth stating plainly. A webview *can* be handed a PDF
 * and will usually display it — by handing it to a browser plugin that may or
 * may not be installed. Instead the pages are rendered on this machine by the
 * same PyMuPDF build that reads the PDF's text layer, written beside the
 * thumbnails, and shown here. It is the same picture everywhere, it needs no
 * plugin, and it looks like the rest of the archive. The original PDF is still
 * one click away for text selection and printing.
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
  const [pages, setPages] = useState<string[]>([]);
  const [embedded, setEmbedded] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [playbackFailed, setPlaybackFailed] = useState(false);

  // The original, granted one file at a time.
  useEffect(() => {
    if (!kind || kind === 'pdf') return;
    let cancelled = false;
    setSrc(null);
    setBlocked(false);
    setPlaybackFailed(false);

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

  // A document is rendered, not fetched: the pages are already on disk from the
  // pipeline's own pass, or written on demand the first time it is opened.
  useEffect(() => {
    if (kind !== 'pdf') return;
    let cancelled = false;
    setPages([]);
    setTotalPages(0);
    setPageIndex(0);
    setEmbedded(null);
    setBlocked(false);

    void (async () => {
      try {
        const rendered = await getHost().mediaPages(file.id);
        if (cancelled) return;
        setPages(rendered.paths.map((path) => getHost().assetUrl(path)));
        setTotalPages(rendered.total);
      } catch {
        // No rendered pages — which is what a browser says, because it has no
        // rasteriser. It does have a PDF viewer of its own, though: handing the
        // original to that renders the document here, offline, exactly like the
        // desktop pages would — so that is the next answer rather than silence.
        try {
          const path = await getHost().grantFileAccess(file.id);
          if (!cancelled) setEmbedded(getHost().assetUrl(path));
        } catch {
          if (!cancelled) setBlocked(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file.id, kind]);

  if (!kind) return null;

  if (kind === 'audio') {
    if (blocked) return null;
    if (!src) {
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
    return (
      <div className={cn('flex w-full flex-col items-center justify-center gap-3 p-6', className)}>
        <Icon name="Music" size={30} strokeWidth={1.4} className="text-ink-3" />
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio src={src} controls autoPlay={autoPlay} className="w-full max-w-[420px]" />
      </div>
    );
  }

  if (kind === 'pdf') {
    if (blocked) return null;
    if (embedded) {
      return (
        <div className={cn('relative flex h-full w-full bg-surface-sunken', className)}>
          <iframe
            src={embedded}
            title={`Preview of ${file.generatedTitle ?? file.name}`}
            className="h-full w-full border-0"
          />
        </div>
      );
    }
    if (pages.length === 0) {
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

    const shown = pages[Math.min(pageIndex, pages.length - 1)];
    return (
      <div className={cn('relative flex h-full w-full flex-col bg-surface-sunken', className)}>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <img
            src={shown}
            alt={`Page ${pageIndex + 1} of ${file.generatedTitle ?? file.name}`}
            className="mx-auto block w-full max-w-[860px] bg-white"
            draggable={false}
          />
        </div>

        {pages.length > 1 && (
          <div className="flex items-center justify-center gap-2 border-t border-line bg-surface px-3 py-2">
            <button
              type="button"
              onClick={() => setPageIndex((value) => Math.max(0, value - 1))}
              disabled={pageIndex === 0}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
              aria-label="Previous page"
            >
              <Icon name="ChevronLeft" size={15} strokeWidth={2} />
            </button>
            <span className="text-2xs tabular-nums text-ink-3">
              {pageIndex + 1} / {pages.length}
              {/* A long document is laid out up to a limit, and saying so is
                  better than letting the reader think the file ends here. */}
              {totalPages > pages.length ? ` of ${formatCount(totalPages)}` : ''}
            </span>
            <button
              type="button"
              onClick={() => setPageIndex((value) => Math.min(pages.length - 1, value + 1))}
              disabled={pageIndex >= pages.length - 1}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink disabled:pointer-events-none disabled:opacity-40"
              aria-label="Next page"
            >
              <Icon name="ChevronRight" size={15} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    );
  }

  // Video. When the frame it was rendered from is available it is shown until
  // playback starts, and if playback never starts it is what the user is left
  // with — a real frame of the video rather than a black rectangle or a broken
  // player, which is what "video previews do not work" looked like.
  if (blocked || playbackFailed) {
    if (!poster) return null;
    return (
      <div className={cn('relative flex h-full w-full items-center justify-center', className)}>
        <img src={poster} alt="" className="max-h-full max-w-full object-contain" draggable={false} />
        <span className="absolute bottom-2 left-2 rounded-pill bg-black/60 px-2 py-0.5 text-2xs text-white">
          Still frame — open to play
        </span>
      </div>
    );
  }

  if (!src) {
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

  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video
      src={src}
      poster={poster}
      controls
      autoPlay={autoPlay}
      playsInline
      preload="metadata"
      onError={() => setPlaybackFailed(true)}
      className={cn('max-h-full max-w-full bg-black object-contain', className)}
    />
  );
}
