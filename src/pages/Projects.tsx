import { useEffect, useRef, useState } from 'react';
import { useArchiveStore } from '@/stores/archive';
import { useUIStore } from '@/stores/ui';
import { useFileQuery } from '@/hooks/useFileQuery';
import { cn, formatCount, formatRelativeTime } from '@/utils/format';
import { Page } from '@/components/common/Page';
import { PageHeader } from '@/components/common/PageHeader';
import { Card } from '@/components/common/Card';
import { Button } from '@/components/common/Button';
import { Icon } from '@/components/common/Icon';
import { EmptyState } from '@/components/common/EmptyState';
import { FileViews } from '@/components/files/FileViews';

/**
 * Projects.
 *
 * A project is the one piece of structure the user creates by hand; everything
 * else AfterImage infers. Selecting one filters the workspace below it instead
 * of navigating away, so cross-project browsing stays cheap. The counts and the
 * timestamps are the database's, and an empty archive shows an empty project
 * list rather than a showcase of invented ones.
 */
export function Projects() {
  const projects = useArchiveStore((state) => state.projects);
  const createProject = useArchiveStore((state) => state.createProject);
  const activeId = useUIStore((state) => state.activeProjectId);
  const setActiveProject = useUIStore((state) => state.setActiveProject);

  const [drafting, setDrafting] = useState(false);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (drafting) inputRef.current?.focus();
  }, [drafting]);

  const active = projects.find((project) => project.id === activeId) ?? null;
  const result = useFileQuery(active ? { projectId: active.id, sort: 'recent' } : null);

  const submit = async () => {
    const value = name.trim();
    if (!value) {
      setDrafting(false);
      return;
    }
    const project = await createProject(value);
    setName('');
    setDrafting(false);
    if (project) setActiveProject(project.id);
  };

  return (
    <Page>
      <PageHeader
        title="Projects"
        subtitle="Groups of work you filed deliberately — AfterImage never invents one"
      >
        {drafting ? (
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
              if (event.key === 'Escape') {
                setName('');
                setDrafting(false);
              }
            }}
            onBlur={() => void submit()}
            placeholder="Project name"
            className="h-8 w-[180px] rounded-[10px] border border-line-strong bg-surface px-3 text-meta text-ink outline-none placeholder:text-ink-3"
          />
        ) : (
          <Button variant="secondary" size="sm" icon="Plus" onClick={() => setDrafting(true)}>
            New project
          </Button>
        )}
      </PageHeader>

      {projects.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            compact
            icon="FolderKanban"
            title="No projects yet"
            description="Projects are optional. Create one for work you want to keep together, then file files into it from any file's context menu."
            actionLabel="New project"
            onAction={() => setDrafting(true)}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {projects.map((project) => {
            const selected = project.id === activeId;
            return (
              <button
                key={project.id}
                type="button"
                onClick={() => setActiveProject(selected ? null : project.id)}
                className={cn(
                  'flex flex-col gap-3 rounded-card border p-4 text-left transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-px',
                  selected ? 'border-line-strong bg-surface-2' : 'border-line bg-surface',
                )}
                style={{ boxShadow: 'var(--af-shadow-soft)' }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: project.color }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate text-card font-semibold text-ink">
                    {project.name}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-2xs text-ink-3">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon name="Files" size={12} strokeWidth={1.9} />
                    <span className="tabular-nums">
                      {formatCount(project.fileCount)}{' '}
                      {project.fileCount === 1 ? 'file' : 'files'}
                    </span>
                  </span>
                  {project.updatedAt && (
                    <span>Updated {formatRelativeTime(project.updatedAt)}</span>
                  )}
                </div>

                <div className="mt-auto flex items-center justify-end text-2xs">
                  <span
                    className={cn(
                      'inline-flex items-center gap-1',
                      selected ? 'text-accent-ink' : 'text-ink-3',
                    )}
                  >
                    {selected ? 'Filtering' : 'View files'}
                    <Icon name={selected ? 'Check' : 'ArrowRight'} size={12} strokeWidth={2.2} />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {active && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-ink">{active.name}</h2>
            <span className="text-meta tabular-nums text-ink-3">
              {formatCount(result.total)} files
            </span>
          </div>
          <FileViews
            result={result}
            emptyTitle="No files filed here yet"
            emptyDescription="Add files to this project from any file's context menu or the inspector."
          />
        </div>
      )}
    </Page>
  );
}
