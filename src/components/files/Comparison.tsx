import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileVersion } from '@/types';
import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { useFileVersions } from '@/hooks/useFileVersions';
import { getHost } from '@/services/host';
import { cn, formatAbsolute } from '@/utils/format';
import { Modal } from '@/components/common/Overlay';
import { Icon } from '@/components/common/Icon';
import { IconButton } from '@/components/common/IconButton';
import { PillTabs } from '@/components/common/Button';
import { Badge, TagPill } from '@/components/common/Badge';
import { Tooltip } from '@/components/common/Tooltip';
import { aspectForFile } from '@/components/common/FileThumb';

/**
 * Before / after.
 *
 * The divider is the whole interface: drag it across the picture and the
 * original is revealed on the left, the state on disk now on the right. Both
 * sides are copies the archive already holds — the 1600px presentation copy it
 * kept before the last edit, and the one it holds now — so the comparison shows
 * the real change without keeping a second copy of anyone's originals.
 *
 * It is built out of the viewer's own parts: the same modal, the same sunken
 * backdrop, the same glass chrome on the controls. Nothing here is a new visual
 * language for one screen.
 */
export function Comparison() {
  const fileId = useUIStore((state) => state.comparisonFor);
  const setComparisonFor = useUIStore((state) => state.setComparisonFor);
  const known = useArchiveStore((state) => state.known);
  const file = fileId ? known[fileId] ?? null : null;

  const { versions, loading, capture, remove } = useFileVersions(fileId);
  const [beforeId, setBeforeId] = useState<string | null>(null);
  /** Share of the frame that shows the earlier copy, 0..100. */
  const [reveal, setReveal] = useState(50);

  const stage = useRef<HTMLDivElement>(null);
  /**
   * Whether a drag is in progress.
   *
   * A ref rather than state: the pointer moves faster than React renders, and a
   * move that arrives in the same tick as the press would be read against the
   * previous render and dropped — which is exactly the first, quickest flick of
   * a drag.
   */
  const dragging = useRef(false);
  /** The content state whose current copy has already been asked for. */
  const ensured = useRef<string | null>(null);

  // Each new state of the file is kept once, the first time this view sees it.
  // A version is a file on disk with its own URL, which is the only way to be
  // sure the webview is showing the picture as it is now rather than the one it
  // already had under the same path in its cache.
  useEffect(() => {
    if (!fileId || !file || loading) return;
    const key = `${fileId}@${file.modifiedAt}`;
    if (ensured.current === key) return;
    if (versions.some((version) => version.contentAt === file.modifiedAt)) {
      ensured.current = key;
      return;
    }
    // Nothing to keep when the pipeline never wrote a presentation copy.
    if (!file.previewPath) {
      ensured.current = key;
      return;
    }
    ensured.current = key;
    void capture();
  }, [fileId, file, loading, versions, capture]);

  // A different file is a different comparison, at the default position.
  useEffect(() => {
    setBeforeId(null);
    setReveal(50);
  }, [fileId]);

  const current = useMemo(
    () => versions.find((version) => version.contentAt === file?.modifiedAt) ?? versions[0] ?? null,
    [versions, file?.modifiedAt],
  );

  /** Everything that is not the state on disk now — what there is to compare. */
  const earlier = useMemo(
    () => versions.filter((version) => version.id !== current?.id),
    [versions, current?.id],
  );

  const before = useMemo(
    () => earlier.find((version) => version.id === beforeId) ?? earlier[0] ?? null,
    [earlier, beforeId],
  );

  // 'before' and 'after' are the divider pushed all the way to one side, so the
  // tabs and the drag share a single number rather than two that can disagree.
  const mode = reveal >= 99.5 ? 'before' : reveal <= 0.5 ? 'after' : 'split';

  const positionFrom = (clientX: number) => {
    const element = stage.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0) return;
    setReveal(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };

  const ratio = file ? Math.min(2.6, Math.max(0.5, aspectForFile(file) ?? 4 / 3)) : 4 / 3;
  const beforeUrl = before ? getHost().assetUrl(before.path) : '';
  const afterUrl = file?.previewPath ? getHost().assetUrl(file.previewPath) : '';

  return (
    <Modal
      open={Boolean(fileId && file)}
      onClose={() => setComparisonFor(null)}
      className="max-w-[1080px]"
    >
      {file && (
        <div className="flex flex-col">
          <header className="flex items-center gap-3 border-b border-line px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-semibold text-ink" data-selectable>
                {file.generatedTitle ?? file.name}
              </h2>
              <p className="mt-0.5 truncate text-2xs text-ink-3">
                Comparing the index's own presentation copies · your original files are untouched
              </p>
            </div>

            {/* Nothing to reveal means nothing to switch between: with one
                state on record the tabs would be two inert buttons. */}
            {before && (
              <PillTabs
                size="sm"
                value={mode}
                onChange={(next) => {
                  setReveal(next === 'before' ? 100 : next === 'after' ? 0 : 50);
                }}
                tabs={[
                  { id: 'before', label: 'Earlier' },
                  { id: 'split', label: 'Split' },
                  { id: 'after', label: 'Now' },
                ]}
              />
            )}

            <Tooltip label="Close comparison" side="bottom">
              <IconButton size="sm" label="Close comparison" onClick={() => setComparisonFor(null)}>
                <Icon name="X" size={15} strokeWidth={2.2} />
              </IconButton>
            </Tooltip>
          </header>

          <div
            className="relative flex items-center justify-center overflow-hidden p-4"
            style={{ backgroundColor: 'var(--af-surface-sunken)' }}
          >
            <div
              ref={stage}
              className={cn(
                'relative touch-none select-none overflow-hidden rounded-thumb border border-line',
                before && 'cursor-ew-resize',
              )}
              style={{ aspectRatio: String(ratio), width: `min(100%, calc(62vh * ${ratio}))` }}
              onPointerDown={(event) => {
                if (!before) return;
                dragging.current = true;
                // Capture keeps the divider following a pointer that leaves the
                // frame. Guarded: a pointer the browser no longer has throws
                // here, and losing the capture is not worth losing the drag.
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  /* the pointer is already gone */
                }
                positionFrom(event.clientX);
              }}
              onPointerMove={(event) => {
                if (!dragging.current) return;
                positionFrom(event.clientX);
              }}
              onPointerUp={(event) => {
                dragging.current = false;
                try {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                } catch {
                  /* already released */
                }
              }}
              onPointerCancel={() => {
                dragging.current = false;
              }}
            >
              {/* The earlier copy sits underneath, in full. */}
              {before && beforeUrl && (
                <img
                  src={beforeUrl}
                  alt={`Earlier version of ${file.name}`}
                  draggable={false}
                  decoding="async"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                />
              )}

              {/* The state on disk now is the same rectangle, clipped. */}
              {afterUrl ? (
                <img
                  src={afterUrl}
                  alt={`Current version of ${file.name}`}
                  draggable={false}
                  decoding="async"
                  className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                  style={{ clipPath: before ? `inset(0 0 0 ${reveal}%)` : undefined }}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-surface-2 text-2xs text-ink-3">
                  No presentation copy has been written for this file
                </div>
              )}

              {before && (
                <>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 w-px bg-white/90"
                    style={{ left: `${reveal}%`, boxShadow: '0 0 0 1px rgba(0,0,0,0.28)' }}
                  />
                  <div
                    className="absolute inset-y-0"
                    style={{ left: `clamp(18px, ${reveal}%, calc(100% - 18px))` }}
                  >
                    <button
                      type="button"
                      role="slider"
                      tabIndex={0}
                      aria-label="Comparison divider"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(reveal)}
                      aria-valuetext={`${Math.round(reveal)}% earlier version`}
                      onKeyDown={(event) => {
                        const step = event.shiftKey ? 10 : 2;
                        if (event.key === 'ArrowLeft') {
                          event.preventDefault();
                          setReveal((value) => Math.max(0, value - step));
                        } else if (event.key === 'ArrowRight') {
                          event.preventDefault();
                          setReveal((value) => Math.min(100, value + step));
                        } else if (event.key === 'Home') {
                          event.preventDefault();
                          setReveal(0);
                        } else if (event.key === 'End') {
                          event.preventDefault();
                          setReveal(100);
                        }
                      }}
                      className={cn(
                        'glass-chrome absolute top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2',
                        'items-center justify-center rounded-full border border-white/40 text-ink',
                        'transition-[transform,box-shadow] duration-150 hover:scale-105',
                        'focus-visible:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                      )}
                    >
                      <Icon name="ArrowLeftRight" size={15} strokeWidth={2} />
                    </button>
                  </div>
                </>
              )}

              {/* Which side is which, said once, where it cannot be ambiguous. */}
              <span className="glass-chrome pointer-events-none absolute left-2 top-2 rounded-lg border border-white/25 px-2 py-1 text-[10px] font-medium text-ink">
                {before ? `Before · ${shortDate(before)}` : 'Current state'}
              </span>
              {before && (
                <span className="glass-chrome pointer-events-none absolute right-2 top-2 rounded-lg border border-white/25 px-2 py-1 text-[10px] font-medium text-ink">
                  After · {shortDate(file.modifiedAt)}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3">
            <span className="text-[10.5px] uppercase tracking-[0.07em] text-ink-3">Earlier</span>

            {earlier.length === 0 ? (
              <span className="text-2xs text-ink-3">
                {loading
                  ? 'Reading kept versions…'
                  : 'None yet — one is kept automatically the first time this file changes on disk'}
              </span>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5">
                {earlier.map((version) => (
                  <TagPill
                    key={version.id}
                    label={shortDate(version)}
                    active={before?.id === version.id}
                    onClick={() => setBeforeId(version.id)}
                    onRemove={() => {
                      if (before?.id === version.id) setBeforeId(null);
                      void remove(version.id);
                    }}
                    className="cursor-pointer"
                  />
                ))}
              </div>
            )}

            <span className="ml-auto flex items-center gap-2">
              {current && (
                <Badge tone="neutral" icon="Clock">
                  Current · {shortDate(current)}
                </Badge>
              )}
              {before && (
                <span className="hidden items-center gap-1 text-[10px] text-ink-3 sm:inline-flex">
                  <Icon name="ArrowLeftRight" size={11} strokeWidth={2} />
                  drag, or ← → on the handle
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** "23 Sep" — as short as a chip allows, still unambiguous within a file. */
function shortDate(value: FileVersion | string): string {
  const iso = typeof value === 'string' ? value : value.contentAt;
  const absolute = formatAbsolute(iso);
  const [day, month] = absolute.split(' ');
  return `${day} ${month}`;
}
