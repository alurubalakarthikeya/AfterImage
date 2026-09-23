import { useMemo, useState } from 'react';
import type { ArchiveFile } from '@/types';
import { EMPTY_TERMS, useSearchStore } from '@/stores/search';
import { useUIStore } from '@/stores/ui';
import { highlight } from '@/utils/highlight';
import { cn } from '@/utils/format';
import { Icon } from '@/components/common/Icon';
import { Tooltip } from '@/components/common/Tooltip';

/**
 * Extracted text.
 *
 * This is where OCR becomes visible without shouting about it: a monospaced
 * block, search terms highlighted, a copy affordance. If nothing was extracted
 * we say so plainly rather than showing an empty box pretending otherwise.
 */
/** What to say for each extraction outcome. Never "AI is thinking". */
const TEXT_STATE_COPY: Record<ArchiveFile['ocrState'], string> = {
  none: 'This file type has no text to extract.',
  pending: 'Text not extracted yet.',
  extracted: 'No readable text found in this file.',
  unavailable: 'OCR unavailable on this machine.',
  failed: 'Text extraction failed for this file.',
};

const TEXT_STATE_ICON: Record<ArchiveFile['ocrState'], string> = {
  none: 'FileText',
  pending: 'Clock',
  extracted: 'ScanText',
  unavailable: 'AlertTriangle',
  failed: 'AlertTriangle',
};

export function ExtractedText({
  file,
  maxHeight = 190,
  className,
  expanded: initialExpanded = false,
}: {
  file: ArchiveFile;
  maxHeight?: number;
  className?: string;
  expanded?: boolean;
}) {
  const pushNotice = useUIStore((state) => state.pushNotice);
  const terms = useSearchStore((state) => state.terms) ?? EMPTY_TERMS;
  const [expanded, setExpanded] = useState(initialExpanded);
  const [copied, setCopied] = useState(false);

  const segments = useMemo(
    () => (file.ocrText ? highlight(file.ocrText, terms, expanded ? 4000 : 1200) : []),
    [file.ocrText, terms, expanded],
  );

  const lineCount = file.ocrText ? file.ocrText.split('\n').length : 0;

  if (!file.ocrText) {
    return (
      <div className={cn('rounded-panel border border-dashed border-line-strong p-3', className)}>
        <div className="flex items-center gap-2 text-meta text-ink-3">
          <Icon name={TEXT_STATE_ICON[file.ocrState]} size={14} strokeWidth={1.8} />
          <span>{TEXT_STATE_COPY[file.ocrState]}</span>
        </div>
        <div className="mt-1.5 text-2xs text-ink-3">
          {file.ocrState === 'pending'
            ? 'Recognition runs locally and needs no network. This file is still in the queue.'
            : 'Text is never invented — an empty result means no readable text was found.'}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="overflow-hidden rounded-panel" style={{ backgroundColor: 'var(--af-code-bg)' }}>
        <div
          className="flex items-center justify-between border-b px-3 py-1.5"
          style={{ borderColor: 'var(--af-code-line)' }}
        >
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-code-dim">
            <Icon name="ScanText" size={11} strokeWidth={2} />
            ocr · {lineCount} lines
          </span>
          <Tooltip label={copied ? 'Copied' : 'Copy text'} side="left">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(file.ocrText ?? '')
                  .then(() => {
                    setCopied(true);
                    pushNotice({ level: 'success', message: 'Extracted text copied' });
                    setTimeout(() => setCopied(false), 1600);
                  })
                  .catch(() => undefined);
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-code-dim transition-colors duration-150 hover:bg-ink/8 hover:text-code-ink"
            >
              <Icon name={copied ? 'Check' : 'Copy'} size={11} strokeWidth={2.2} />
              {copied ? 'copied' : 'copy'}
            </button>
          </Tooltip>
        </div>

        <pre
          data-selectable
          className="overflow-auto px-3 py-2.5 font-mono text-[11px] leading-[1.55] text-code-ink"
          style={{ maxHeight: expanded ? undefined : maxHeight }}
        >
          <code className="whitespace-pre-wrap break-words">
            {segments.map((segment, index) =>
              segment.hit ? (
                <mark
                  key={index}
                  className="rounded-[3px] bg-code-accent/25 px-0.5 text-code-accent"
                >
                  {segment.text}
                </mark>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}
          </code>
        </pre>

        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center justify-center gap-1 border-t py-1.5 font-mono text-[10px] text-code-dim transition-colors duration-150 hover:text-code-ink"
          style={{ borderColor: 'var(--af-code-line)' }}
        >
          <Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} size={11} />
          {expanded ? 'collapse' : 'expand'}
        </button>
      </div>
    </div>
  );
}
