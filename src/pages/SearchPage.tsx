import { useState } from 'react';
import { QUERY_HELP } from '@/services/search/query';
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
  'kind:screenshot #react',
  'kind:video size:>100mb',
  'invoice after:2024-01-01',
  'is:favorite design',
  'tall dark blurry',
  'wide colourful photo',
];

/**
 * What the search box accepts.
 *
 * The list comes from the parser itself (`QUERY_HELP`), so this panel cannot
 * describe a syntax the code does not implement — which is the only kind of
 * help text worth having in a product where the parser is testable and the
 * prose is not.
 */
function SyntaxHelp({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="inline-flex w-fit items-center gap-1.5 text-2xs font-medium text-ink-2 transition-colors duration-150 hover:text-ink"
      >
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={12} strokeWidth={2.2} />
        What you can type
      </button>

      {open && (
        <div className="flex flex-col gap-1.5 rounded-card border border-line bg-surface-2 p-3">
          {QUERY_HELP.map((entry) => (
            <div key={entry.syntax} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <span className="shrink-0 font-mono text-2xs text-ink">{entry.syntax}</span>
              <span className="min-w-0 flex-1 text-2xs leading-relaxed text-ink-2">{entry.what}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [helpOpen, setHelpOpen] = useState(false);

  if (!submitted) {
    return (
      <Page>
        <PageHeader
          title="Search"
          subtitle="Names, text, tags, folders and projects — and, for a picture, what its pixels look like"
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
                  : 'Press Ctrl K anywhere, or use the field in the toolbar. Names, text and structure are searched; a picture can also be described — try “dark wide screenshot”.'}
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
              <SyntaxHelp open={helpOpen} onToggle={() => setHelpOpen((open) => !open)} />
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
  const describedHits = hits.filter((hit) => hit.match === 'described').length;

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
          <div className="flex items-start gap-2 border-t border-line pt-3 text-2xs leading-relaxed text-ink-3">
            <Icon name="Info" size={12} className="mt-px shrink-0" />
            <span>
              {semanticAvailable
                ? 'Ranking combines exact matches on names, text, tags and folders with similarity matches from the local embedding model.'
                : 'Ranking reads names, extracted text, tags, folders, collections and projects — and, for a picture, the shape, tone, colour and detail measured from its own pixels, so a description finds a file whose name says nothing.'}
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
              {describedHits > 0 && <span>{describedHits} found from their description</span>}
              {semanticHits > 0 && <span>{semanticHits} from similar meaning</span>}
            </div>
          )}
          <SearchResults onOpen={(fileId) => void openFile(fileId)} />
        </div>
      </div>
    </Page>
  );
}
