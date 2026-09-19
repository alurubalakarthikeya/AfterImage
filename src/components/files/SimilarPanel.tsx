import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { useSimilarFiles } from '@/hooks/useFileInsights';
import { formatCount, formatResolution } from '@/utils/format';
import { Modal } from '@/components/common/Overlay';
import { Icon } from '@/components/common/Icon';
import { IconButton } from '@/components/common/IconButton';
import { FileThumb } from '@/components/common/FileThumb';

/**
 * "Find similar" — visual search over the user's own images.
 *
 * The subject is a file already in the index; Rust asks the local embedding
 * service for its neighbours and scores them by cosine distance. Nothing is
 * uploaded, and when the model is not installed the panel says exactly that
 * rather than showing unrelated pictures.
 */
export function SimilarPanel() {
  const subjectId = useUIStore((state) => state.similarFor);
  const setSimilarFor = useUIStore((state) => state.setSimilarFor);
  const selectFile = useUIStore((state) => state.selectFile);
  const setQuickLookOpen = useUIStore((state) => state.setQuickLookOpen);
  const known = useArchiveStore((state) => state.known);

  const { hits, loading, error } = useSimilarFiles(subjectId, 24);
  const subject = subjectId ? known[subjectId] : undefined;

  return (
    <Modal
      open={Boolean(subjectId)}
      onClose={() => setSimilarFor(null)}
      align="top"
      className="max-w-[860px]"
    >
      <div className="flex flex-col">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-accent-softer text-accent-ink">
            <Icon name="Layers" size={15} strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-card font-semibold text-ink">Visually similar files</h2>
            <p className="truncate text-2xs text-ink-3">
              {subject
                ? `Like ${subject.generatedTitle ?? subject.name} · compared on this device`
                : 'Comparing image embeddings…'}
            </p>
          </div>
          {hits.length > 0 && (
            <span className="shrink-0 text-2xs tabular-nums text-ink-3">
              {formatCount(hits.length)}
            </span>
          )}
          <IconButton size="sm" label="Close" onClick={() => setSimilarFor(null)}>
            <Icon name="X" size={15} strokeWidth={2} />
          </IconButton>
        </div>

        <div className="@container max-h-[520px] overflow-y-auto p-4">
          {loading && (
            <p className="py-10 text-center text-meta text-ink-3">Comparing embeddings…</p>
          )}

          {!loading && hits.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-2 text-ink-3">
                <Icon name={error ? 'AlertTriangle' : 'Layers'} size={19} strokeWidth={1.7} />
              </span>
              <p className="text-body font-medium text-ink">No similar images</p>
              <p className="max-w-[420px] text-meta leading-relaxed text-ink-2">
                {error ??
                  'No image in this archive is close enough to count as similar. Embeddings are generated in the background — try again once indexing settles.'}
              </p>
            </div>
          )}

          {hits.length > 0 && (
            <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
              {hits.map((hit) => (
                <button
                  key={hit.file.id}
                  type="button"
                  onClick={() => {
                    selectFile(hit.file.id);
                    setSimilarFor(null);
                    setQuickLookOpen(true);
                  }}
                  className="group flex flex-col gap-1.5 text-left"
                >
                  <FileThumb
                    file={hit.file}
                    aspect={1}
                    rounded="rounded-[12px]"
                    className="border border-line transition-transform duration-150 group-hover:-translate-y-px"
                  />
                  <span className="truncate text-2xs font-medium text-ink-2">
                    {hit.file.generatedTitle ?? hit.file.name}
                  </span>
                  <span className="truncate text-2xs text-ink-3">
                    {formatResolution(hit.file.width, hit.file.height)}
                    {hit.score > 0 ? ` · ${Math.round(hit.score * 100)}% match` : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
