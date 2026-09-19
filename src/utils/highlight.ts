/**
 * Snippet and highlight helpers.
 *
 * Retrieval happens in Rust, which returns the matched terms with each result.
 * Turning those terms into a readable excerpt and a marked-up span is a
 * presentation concern, so it lives here rather than crossing the IPC boundary
 * as HTML.
 */

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

const ESCAPE = /[.*+?^${}()|[\]\\]/g;

function patternFor(terms: string[]): RegExp | null {
  const usable = terms.map((term) => term.trim()).filter((term) => term.length > 1);
  if (usable.length === 0) return null;
  return new RegExp(`(${usable.map((term) => term.replace(ESCAPE, '\\$&')).join('|')})`, 'gi');
}

/**
 * The excerpt shown under a search result: the first place a term appears, with
 * a little context either side. Returns undefined when nothing matched, so the
 * caller can fall back to the file's description instead of printing noise.
 */
export function snippetFor(
  text: string | undefined,
  terms: string[],
  radius = 90,
): string | undefined {
  if (!text) return undefined;
  const pattern = patternFor(terms);
  if (!pattern) return undefined;

  const match = pattern.exec(text);
  if (!match) return undefined;

  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

/** Split text into plain and matched segments for rendering. */
export function highlight(text: string, terms: string[], limit = 400): HighlightSegment[] {
  const visible = text.length > limit ? `${text.slice(0, limit)}…` : text;
  const pattern = patternFor(terms);
  if (!pattern) return [{ text: visible, hit: false }];

  const segments: HighlightSegment[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(visible)) !== null) {
    if (match.index > last) segments.push({ text: visible.slice(last, match.index), hit: false });
    segments.push({ text: match[0], hit: true });
    last = match.index + match[0].length;
    if (segments.length > 60) break;
    if (match[0].length === 0) pattern.lastIndex += 1;
  }
  if (last < visible.length) segments.push({ text: visible.slice(last), hit: false });
  return segments;
}
