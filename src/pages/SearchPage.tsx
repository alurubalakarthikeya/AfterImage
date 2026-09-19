import { useArchiveStore } from '@/stores/archive';
import { useSearchStore } from '@/stores/search';
import { useUIStore } from '@/stores/ui';
import { formatCount } from '@/utils/format';
import { Page } from '@/components/common/Page';
import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { SearchFilters } from '@/components/search/SearchFilters';
import { SearchResults } from '@/components/search/SearchResults';

const EXAMPLES = [
  'errors last week',
  'kind:screenshot #react',
  'invoice this month',
  'is:fav design',
  'receipt 280.00',
];

/**
 * Search.
 *
 * Filters sit beside results rather than above them: the query is the primary
 * control, and a filter is a refinement of intent the parser already knows how
 * to express in text. The header line reports what the retrieval layer actually
 * understood, including whether the vector index contributed anything — the one
 * place local search would otherwise be a black box.
 */
export function SearchPage() {
  const submitted = useSearchStore((state) => state.submitted);
  const hits = useSearchStore((state) => state.hits);
  const total = useSearchStore((state) => state.total);
  const interpretation = useSearchStore((state) => state.interpretation);
  const semanticAvailable = useSearchStore((state) => state.semanticAvailable);
  const history = useSearchStore((state) => state.history);
  const useHistory = useSearchStore((state) => state.useHistory);
  const setDraft = useSearchStore((state) => state.setDraft);
  const submit = useSearchStore((state) => state.submit);
  const clear = useSearchStore((state) => state.clear);
  const openFile = useArchiveStore((state) => state.openFile);
  const folders = useArchiveStore((state) => state.folders);
  const pushNotice = useUIStore((state) => state.pushNotice);

  if (!submitted) {
    return (
      <Page>
        <PageHeader
          title="Search"
          subtitle="Filename, extracted text, tags, folders, collections and projects — all local"
        />
        <div
          className="rounded-card border border-line bg-surface p-5"
          style={{ boxShadow: 'var(--af-shadow-soft)' }}
        >
          <div className="flex items-start gap-2.5 text-ink-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2">
              <Icon name="Search" size={17} strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <h2 className="text-card font-semibold text-ink">Search the whole archive</h2>
              <p className="mt-0.5 text-meta leading-relaxed text-ink-2">
                {folders.length === 0
                  ? 'Nothing is indexed yet. Add a folder and everything inside it becomes searchable as it is read.'
                  : 'Press Ctrl K anywhere, or use the field in the toolbar. Filters can be typed: kind:, #tag, is:fav, since:7.'}
              </p>
            </div>
          </div>

          {folders.length > 0 && (
            <div className="mt-5 flex flex-col gap-2">
              <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                Try
              </span>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      setDraft(example);
                      void submit(example);
                    }}
                    className="rounded-pill bg-surface-2 px-2.5 py-1 font-mono text-2xs text-ink-2 transition-colors duration-150 hover:bg-surface-3 hover:text-ink"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="mt-6 flex flex-col gap-1">
              <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                Recent
              </span>
              {history.slice(0, 5).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => useHistory(item)}
                  className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-body text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
                >
                  <Icon name="Clock" size={13} className="text-ink-3" />
                  <span className="truncate font-mono text-meta">{item}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </Page>
    );
  }

  const fromText = hits.filter((hit) => hit.match === 'text').length;
  const semanticHits = hits.filter((hit) => hit.semantic).length;

  return (
    <Page container>
      <PageHeader
        title={`Results for “${submitted}”`}
        subtitle={interpretation ? `Understood as ${interpretation.summary}` : undefined}
        count={total}
      >
        <Button
          variant="ghost"
          size="sm"
          icon="X"
          onClick={() => {
            clear();
            pushNotice({ level: 'info', message: 'Search cleared' });
          }}
        >
          Clear
        </Button>
      </PageHeader>

      <div className="grid gap-4 @3xl:grid-cols-[210px_minmax(0,1fr)]">
        <aside
          className="flex flex-col gap-5 rounded-card border border-line bg-surface p-4 @3xl:sticky @3xl:top-0 @3xl:self-start"
          style={{ boxShadow: 'var(--af-shadow-soft)' }}
        >
          <SearchFilters />
          <div className="flex items-start gap-2 rounded-thumb bg-surface-2 p-2.5 text-2xs leading-relaxed text-ink-3">
            <Icon name={semanticAvailable ? 'Sparkle' : 'Info'} size={12} className="mt-px shrink-0" />
            <span>
              {semanticAvailable
                ? 'Semantic search is on: results include vector matches from the local model.'
                : 'Ranking uses the local full-text index over filenames, extracted text, tags and folders. Enable the local embedding model in settings to add similarity matches.'}
            </span>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-2">
          {hits.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-2xs text-ink-3">
              <span>
                {formatCount(total)} matches, ranked by relevance then recency
              </span>
              {fromText > 0 && <span>{fromText} from extracted text</span>}
              {semanticHits > 0 && <span>{semanticHits} from similar meaning</span>}
            </div>
          )}
          <SearchResults onOpen={(fileId) => void openFile(fileId)} />
        </div>
      </div>
    </Page>
  );
}
