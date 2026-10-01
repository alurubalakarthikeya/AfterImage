import type { ArchiveFile, DnaColor, FileKind, SearchHit } from '@/types';

/**
 * The query language, and what a description is worth.
 *
 * Two jobs in one place, because they are the same job. A query is a set of
 * claims about a file — "a screenshot", "tagged holiday", "larger than 4MB",
 * "dark and tall" — and answering it means checking each claim against the facts
 * the archive actually holds.
 *
 * The first half is the syntax: field clauses, comparisons, date windows,
 * negation, `OR`. The second half is the interesting one. When somebody types
 * `tall dark blue photo`, none of those words are in the file's name, and no
 * amount of string matching will find it. What the archive *does* know about a
 * photograph is what it measured from the photograph: its orientation, its
 * brightness, the colours that cover it, how much detail survived. Every
 * descriptive word is therefore read as a claim about those facts — `dark` is
 * "the picture is dark", `tall` is "it is taller than it is wide" — and each
 * claim that holds is recorded, so a result can say why it is there.
 *
 * This is not a language model and does not pretend to be one. It cannot find
 * "a dog on a beach" from the pixels: that needs the local vision model, which
 * the desktop build installs and this browser build does not have. What it can
 * do is answer every question the archive has measured an answer to, honestly
 * and instantly, and say which of them it answered.
 *
 * Pure by design: no store, no host, no DOM. Everything it needs is passed in.
 */

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Words a file type can be asked for by. `kind:` and these do the same thing. */
const KIND_WORDS: Record<string, FileKind> = {
  photo: 'photo',
  photos: 'photo',
  photograph: 'photo',
  photographs: 'photo',
  image: 'photo',
  images: 'photo',
  picture: 'photo',
  pictures: 'photo',
  pic: 'photo',
  pics: 'photo',
  screenshot: 'screenshot',
  screenshots: 'screenshot',
  screengrab: 'screenshot',
  document: 'document',
  documents: 'document',
  doc: 'document',
  docs: 'document',
  pdf: 'document',
  video: 'video',
  videos: 'video',
  clip: 'video',
  clips: 'video',
  movie: 'video',
  footage: 'video',
  audio: 'audio',
  sound: 'audio',
  sounds: 'audio',
  music: 'audio',
  song: 'audio',
  songs: 'audio',
  recording: 'audio',
  design: 'design',
  designs: 'design',
  mockup: 'design',
  sketch: 'design',
  archive: 'archive',
  archives: 'archive',
  zip: 'archive',
};

const FAVORITE_WORDS = new Set(['favorite', 'favorites', 'favourite', 'favourites', 'fav', 'favs', 'starred', 'liked']);

/** The words `is:` accepts for a file type, so `is:video` works like `kind:video`. */
function isWordToKind(value: string): FileKind | null {
  if (FAVORITE_WORDS.has(value)) return null;
  return KIND_WORDS[value] ?? null;
}

const DURATION_UNITS: Record<string, number> = { d: 1, w: 7, m: 30, y: 365 };
const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  tb: 1024 * 1024 * 1024 * 1024,
};

const DAY_MS = 86_400_000;

const TOKEN_SPLIT = /[^a-z0-9]+/;

export function normalise(value: string): string[] {
  return value
    .toLowerCase()
    .split(TOKEN_SPLIT)
    .filter((token) => token.length > 0);
}

function parseDurationDays(value: string): number | null {
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([dwmy]?)$/);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount * (DURATION_UNITS[match[2] || 'd'] ?? 1);
}

function parseBytes(value: string): number | null {
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?$/);
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;
  return amount * (SIZE_UNITS[match[2] ?? 'b'] ?? 1);
}

function parseCount(value: string): number | null {
  const match = value.trim().match(/^\d+$/);
  return match ? Number.parseInt(match[0], 10) : null;
}

/**
 * A size or a dimension comparison.
 *
 * `>` and `>=` are the same bound, and so are `<` and `<=`. At the scale these
 * are used at — megabytes and pixels — the difference between 4MB and 4MB and
 * one byte is not a distinction any wording in the interface could explain.
 */
interface Bound {
  min: number | null;
  max: number | null;
}

function parseBound(value: string, parse: (raw: string) => number | null): Bound | null {
  const match = value.trim().match(/^(>=|<=|>|<|=)?\s*(.+)$/);
  if (!match) return null;
  const amount = parse(match[2]);
  if (amount === null) return null;
  const operator = match[1] ?? '>=';
  if (operator === '>' || operator === '>=') return { min: amount, max: null };
  if (operator === '<' || operator === '<=') return { min: null, max: amount };
  return { min: amount, max: amount * 1.02 };
}

/** `2024`, `2024-06`, `2024-06-01`, or a duration counting back from now. */
function parseDate(value: string, now: number): number | null {
  const text = value.trim().toLowerCase();
  const duration = parseDurationDays(text);
  if (duration !== null) return now - duration * DAY_MS;
  const match = text.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) - 1 : 0;
  const day = match[3] ? Number(match[3]) : 1;
  const stamp = new Date(year, month, day).getTime();
  return Number.isFinite(stamp) ? stamp : null;
}

function startOfDay(now: number, daysAgo = 0): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime() - daysAgo * DAY_MS;
}

// ---------------------------------------------------------------------------
// The parsed query
// ---------------------------------------------------------------------------

/** Clauses that must all hold for a file to be considered. */
interface Group {
  words: string[];
  phrases: string[][];
  kinds: FileKind[];
  tagNames: string[];
  extensions: string[];
  names: string[];
  texts: string[];
  folders: string[];
  collections: string[];
  projects: string[];
  sinceDays: number | null;
  after: number | null;
  before: number | null;
  size: Bound | null;
  width: Bound | null;
  height: Bound | null;
  favoritesOnly: boolean;
}

/**
 * What a leading `-` rules out.
 *
 * Read the opposite way round from a group. A word in a group is a claim a file
 * has to satisfy; a word here only has to be *possible* of the file. `-dark` is
 * not "not exactly dark" — it is "not a dark picture", which is a question the
 * measurements answer, so an exclusion is checked against the description too
 * and not only against the text.
 */
export interface Exclusion {
  words: string[];
  kinds: FileKind[];
  tags: string[];
}

export interface SearchFilters {
  kind?: FileKind;
  tagIds?: string[];
  collectionId?: string;
  projectId?: string;
  folderId?: string;
  favoritesOnly?: boolean;
  sinceDays?: number;
}

export interface Criteria {
  filters: SearchFilters;
  groups: Group[];
  exclude: Exclusion;
  all: string[];
}

function emptyExclusion(): Exclusion {
  return { words: [], kinds: [], tags: [] };
}

/**
 * True when a group asks for anything at all.
 *
 * Every clause counts, which is the whole point: `size:>100mb` and `is:favorite`
 * are searches, and a sweep that only noticed words would quietly turn them into
 * "show me everything".
 */
function hasClause(group: Group): boolean {
  return (
    group.words.length > 0 ||
    group.phrases.length > 0 ||
    group.kinds.length > 0 ||
    group.tagNames.length > 0 ||
    group.extensions.length > 0 ||
    group.names.length > 0 ||
    group.texts.length > 0 ||
    group.folders.length > 0 ||
    group.collections.length > 0 ||
    group.projects.length > 0 ||
    group.sinceDays !== null ||
    group.after !== null ||
    group.before !== null ||
    group.size !== null ||
    group.width !== null ||
    group.height !== null ||
    group.favoritesOnly
  );
}

function emptyGroup(): Group {
  return {
    words: [],
    phrases: [],
    kinds: [],
    tagNames: [],
    extensions: [],
    names: [],
    texts: [],
    folders: [],
    collections: [],
    projects: [],
    sinceDays: null,
    after: null,
    before: null,
    size: null,
    width: null,
    height: null,
    favoritesOnly: false,
  };
}

function addKind(group: Group, value: string): boolean {
  const kind = beginKind(value);
  if (!kind) return false;
  if (!group.kinds.includes(kind)) group.kinds.push(kind);
  return true;
}

/** A file type from either its own name or a word that means it, or nothing. */
function beginKind(value: string): FileKind | null {
  const kind = (KIND_WORDS[value.toLowerCase()] ?? value.toLowerCase()) as FileKind;
  return isKind(kind) ? kind : null;
}

const KNOWN_KINDS: FileKind[] = [
  'photo',
  'screenshot',
  'document',
  'video',
  'audio',
  'design',
  'archive',
  'other',
];

function isKind(value: string): value is FileKind {
  return (KNOWN_KINDS as string[]).includes(value);
}

/**
 * One clause.
 *
 * Returns nothing when the piece was consumed as a field, so the caller knows
 * not to also treat it as a word. Anything unrecognised falls through to the
 * text terms: a query containing `http://example.com` must not lose half of
 * itself to a parser that thought it saw a field it did not know.
 */
function readClause(group: Group, key: string, value: string, now: number): boolean {
  const raw = value.trim();
  if (raw.length === 0) return false;
  const lower = raw.toLowerCase();

  if (key === 'kind' || key === 'type' || key === 'is') {
    if (key === 'is' && FAVORITE_WORDS.has(lower)) {
      group.favoritesOnly = true;
      return true;
    }
    const handled = raw
      .split(',')
      .map((piece) => piece.trim())
      .filter(Boolean)
      .map((piece) => (key === 'is' ? isWordToKind(piece.toLowerCase()) ?? '' : piece))
      .filter(Boolean)
      .some((piece) => addKind(group, piece));
    return handled;
  }

  if (key === 'tag' || key === '#') {
    for (const piece of splitList(raw)) group.tagNames.push(piece.toLowerCase());
    return true;
  }

  if (key === 'ext' || key === 'extension' || key === 'filetype') {
    for (const piece of splitList(raw)) group.extensions.push(piece.replace(/^\./, '').toLowerCase());
    return true;
  }

  if (key === 'name' || key === 'filename') {
    group.names.push(lower);
    return true;
  }

  if (key === 'text' || key === 'content' || key === 'contains') {
    group.texts.push(lower);
    return true;
  }

  if (key === 'in' || key === 'folder') {
    for (const piece of splitList(raw)) group.folders.push(piece.toLowerCase());
    return true;
  }

  if (key === 'collection') {
    for (const piece of splitList(raw)) group.collections.push(piece.toLowerCase());
    return true;
  }

  if (key === 'project') {
    for (const piece of splitList(raw)) group.projects.push(piece.toLowerCase());
    return true;
  }

  if (key === 'since') {
    const days = parseDurationDays(raw);
    if (days !== null) group.sinceDays = days;
    return true;
  }

  if (key === 'after' || key === 'before') {
    const stamp = parseDate(raw, now);
    if (stamp !== null) {
      if (key === 'after') group.after = stamp;
      else group.before = stamp;
    }
    return true;
  }

  if (key === 'size' || key === 'bytes') {
    group.size = parseBound(raw, parseBytes);
    return true;
  }

  if (key === 'w' || key === 'width') {
    group.width = parseBound(raw, parseCount);
    return true;
  }

  if (key === 'h' || key === 'height') {
    group.height = parseBound(raw, parseCount);
    return true;
  }

  // Faces are not detected in a browser, and a sentence about one is not a
  // search the archive can answer. Ignoring the clause is better than matching
  // the word "person" against filenames and pretending.
  if (key === 'person' || key === 'face' || key === 'people') return true;

  return false;
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((piece) => piece.trim())
    .filter((piece) => piece.length > 0);
}

/**
 * Turn what the user typed into groups of clauses.
 *
 * `OR` separates groups and everything else is `AND`, which is the reading
 * everybody arrives with: two words typed together mean both, and the only
 * way to say "either" is to say it.
 */
export function parseQuery(raw: string, now: number): ParsedQuery {
  const pieces = raw.match(/"[^"]*"|\S+/g) ?? [];
  const groups: Group[] = [emptyGroup()];
  const exclude = emptyExclusion();
  const all: string[] = [];

  for (const piece of pieces) {
    if (piece === 'OR' || piece === 'or' || piece === '|') {
      // A trailing `OR` is a half-finished thought, not a second group.
      if (groups[groups.length - 1].words.length > 0) groups.push(emptyGroup());
      continue;
    }

    const negated = piece.startsWith('-') && piece.length > 1;
    const body = negated ? piece.slice(1) : piece;
    const group = groups[groups.length - 1];

    if (body.startsWith('"') && body.endsWith('"') && body.length > 2) {
      const inner = normalise(body.slice(1, -1));
      if (inner.length === 0) continue;
      if (negated) exclude.words.push(...inner);
      else group.phrases.push(inner);
      all.push(...inner);
      continue;
    }

    if (body.startsWith('#') && body.length > 1) {
      // `#holiday` is a tag, the way it is written everywhere else.
      const name = body.slice(1).toLowerCase();
      if (negated) exclude.tags.push(name);
      else group.tagNames.push(name);
      all.push(name);
      continue;
    }

    const colon = body.indexOf(':');
    if (colon > 0 && colon < body.length - 1) {
      const key = body.slice(0, colon).toLowerCase();
      const value = body.slice(colon + 1);

      if (negated) {
        // A negated type or tag rules that type or tag out. Any other negated
        // field is read as its value — `-in:Downloads` is asking for files that
        // are not in Downloads — because that is the question a person means
        // when they put a minus in front of one.
        if (key === 'kind' || key === 'type' || key === 'is') {
          for (const piece of splitList(value)) {
            const named = beginKind(piece.toLowerCase());
            if (named) exclude.kinds.push(named);
          }
        } else if (key === 'tag') {
          for (const piece of splitList(value)) exclude.tags.push(piece.toLowerCase());
        } else {
          exclude.words.push(...normalise(value));
        }
        all.push(...normalise(value));
        continue;
      }

      if (readClause(group, key, value, now)) {
        all.push(...normalise(value));
        continue;
      }
    }

    const words = normalise(body);
    const kind = words.length === 1 ? KIND_WORDS[body.toLowerCase()] : undefined;
    if (negated) {
      if (kind) exclude.kinds.push(kind);
      else exclude.words.push(...words);
    } else if (kind) {
      // A bare "screenshot" is a file type, the same as `kind:screenshot`.
      // Someone asking for screenshots is not asking for files whose names
      // happen to contain the word.
      addKind(group, kind);
    } else {
      group.words.push(...words);
    }
    all.push(...words);
  }

  return { groups: groups.filter(hasClause), exclude, all };
}

export function buildCriteria(raw: string, filters: SearchFilters, now: number): Criteria {
  const parsed = parseQuery(raw ?? '', now);
  return { filters: filters ?? {}, groups: parsed.groups, exclude: parsed.exclude, all: parsed.all };
}

// ---------------------------------------------------------------------------
// What the archive measured
// ---------------------------------------------------------------------------

/**
 * A picture's own numbers, kept beside its record.
 *
 * The desktop build stores the full Image DNA in its database; the browser
 * build measures the same things while it makes the thumbnail and keeps them
 * here, so a description can be answered without decoding anything again.
 */
export interface MeasuredSignature {
  brightness: number;
  contrast: number;
  sharpness: number;
  saturation: number;
  temperatureShift: number;
  /** The colours that cover it, most-covered first. */
  palette: DnaColor[];
}

export interface QueryContext {
  tagName: (id: string) => string;
  collectionName: (id: string) => string;
  projectName: (id: string) => string;
  /** Absent for a build that does not measure pixels, and for records made before it could. */
  signature?: (fileId: string) => MeasuredSignature | undefined;
  now: number;
}

export interface Scored {
  score: number;
  match: SearchHit['match'];
  /** The descriptive claims that held, in the words the user used to ask. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Description: what a word is a claim about
// ---------------------------------------------------------------------------

type ColourName =
  | 'black'
  | 'white'
  | 'grey'
  | 'brown'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink';

interface Descriptor {
  /** Every wording that asks for this. */
  words: string[];
  /** What the result is allowed to say matched, in the archive's own voice. */
  says: string;
  test: (subject: Subject) => number;
}

interface Subject {
  file: ArchiveFile;
  signature?: MeasuredSignature;
  now: number;
}

function hueName(red: number, green: number, blue: number): ColourName {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  if (lightness < 0.13) return 'black';
  if (lightness > 0.9 && saturation < 0.18) return 'white';
  if (saturation < 0.13) return 'grey';

  let hue = 0;
  if (delta !== 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 45) return lightness < 0.45 ? 'brown' : 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 200) return 'teal';
  if (hue < 255) return 'blue';
  if (hue < 290) return 'purple';
  return 'pink';
}

function shareOf(subject: Subject, name: ColourName): number {
  const palette = subject.signature?.palette ?? [];
  let share = 0;
  for (const colour of palette) {
    if (hueName(colour.red, colour.green, colour.blue) === name) share += colour.share;
  }
  return share;
}

/** Share of the picture a colour covers, saturating at a third of it. */
function colourDescriptor(name: ColourName, extraWords: string[]): Descriptor {
  return {
    words: [name, ...extraWords],
    says: name,
    test: (subject) => {
      const share = shareOf(subject, name);
      return share <= 0 ? 0 : Math.min(1, share / 0.33);
    },
  };
}

/** The word the measured description uses for the tone, when there is no signature. */
function descriptionTone(file: ArchiveFile): 'dark' | 'bright' | 'even' | null {
  const text = file.description ?? '';
  if (!text) return null;
  if (/dark/i.test(text)) return 'dark';
  if (/bright/i.test(text)) return 'bright';
  if (/evenly lit/i.test(text)) return 'even';
  return null;
}

function descriptionContrast(file: ArchiveFile): 'high' | 'low' | 'soft' | null {
  const text = file.description ?? '';
  if (!text) return null;
  if (/high contrast/i.test(text)) return 'high';
  if (/low contrast/i.test(text)) return 'low';
  if (/soft/i.test(text)) return 'soft';
  return null;
}

function aspect(file: ArchiveFile): number | null {
  if (!file.width || !file.height) return null;
  return file.width / file.height;
}

function within(subject: Subject, from: number, to?: number): number {
  const stamp = Date.parse(subject.file.createdAt || subject.file.modifiedAt);
  if (!Number.isFinite(stamp)) return 0;
  if (stamp < from) return 0;
  if (to !== undefined && stamp >= to) return 0;
  return 1;
}

const DESCRIPTORS: Descriptor[] = [
  {
    words: ['dark', 'dim', 'darkened', 'night', 'nighttime', 'moody', 'shadowy', 'underexposed'],
    says: 'dark',
    test: (subject) =>
      subject.signature
        ? subject.signature.brightness < 0.32
          ? 1
          : subject.signature.brightness < 0.42
            ? 0.5
            : 0
        : descriptionTone(subject.file) === 'dark'
          ? 0.8
          : 0,
  },
  {
    words: ['bright', 'brightly', 'sunny', 'luminous', 'overexposed'],
    says: 'bright',
    test: (subject) =>
      subject.signature
        ? subject.signature.brightness > 0.62
          ? 1
          : subject.signature.brightness > 0.52
            ? 0.5
            : 0
        : descriptionTone(subject.file) === 'bright'
          ? 0.8
          : 0,
  },
  {
    words: ['colourful', 'colorful', 'vibrant', 'saturated', 'neon', 'bold'],
    says: 'colourful',
    test: (subject) => (subject.signature ? Math.min(1, subject.signature.saturation / 0.45) : 0),
  },
  {
    words: ['muted', 'desaturated', 'monochrome', 'greyscale', 'grayscale', 'muted', 'washed'],
    says: 'muted',
    test: (subject) =>
      subject.signature ? Math.max(0, Math.min(1, (0.2 - subject.signature.saturation) / 0.2)) : 0,
  },
  {
    words: ['warm', 'golden', 'amber', 'cosy', 'cozy'],
    says: 'warm',
    test: (subject) => (subject.signature ? Math.min(1, subject.signature.temperatureShift / 0.08) : 0),
  },
  {
    words: ['cool', 'cold', 'icy', 'frosty', 'wintry'],
    says: 'cool',
    test: (subject) => (subject.signature ? Math.min(1, -subject.signature.temperatureShift / 0.08) : 0),
  },
  {
    words: ['contrasty', 'contrast', 'dramatic', 'punchy'],
    says: 'high contrast',
    test: (subject) =>
      subject.signature
        ? subject.signature.contrast > 0.24
          ? 1
          : subject.signature.contrast > 0.16
            ? 0.5
            : 0
        : descriptionContrast(subject.file) === 'high'
          ? 0.8
          : 0,
  },
  {
    words: ['flat', 'faded', 'pale', 'hazy'],
    says: 'low contrast',
    test: (subject) =>
      subject.signature
        ? subject.signature.contrast < 0.1
          ? 1
          : 0
        : descriptionContrast(subject.file) === 'low'
          ? 0.8
          : 0,
  },
  {
    words: ['sharp', 'crisp', 'detailed', 'detail', 'tacksharp'],
    says: 'detailed',
    test: (subject) => (subject.signature ? Math.min(1, subject.signature.sharpness / 0.5) : 0),
  },
  {
    words: ['blurry', 'blurred', 'soft', 'unfocused', 'outoffocus', 'smudged'],
    says: 'soft',
    test: (subject) =>
      subject.signature ? Math.max(0, Math.min(1, (0.2 - subject.signature.sharpness) / 0.2)) : 0,
  },
  {
    words: ['wide', 'landscape', 'panorama', 'panoramic', 'horizontal', 'widescreen'],
    says: 'wide',
    test: (subject) => {
      const ratio = aspect(subject.file);
      if (ratio === null) return 0;
      if (ratio >= 1.6) return 1;
      return ratio >= 1.2 ? 0.6 : 0;
    },
  },
  {
    words: ['tall', 'portrait', 'vertical', 'upright'],
    says: 'tall',
    test: (subject) => {
      const ratio = aspect(subject.file);
      if (ratio === null) return 0;
      if (ratio <= 0.62) return 1;
      return ratio <= 0.85 ? 0.6 : 0;
    },
  },
  {
    words: ['square'],
    says: 'square',
    test: (subject) => {
      const ratio = aspect(subject.file);
      return ratio !== null && ratio > 0.92 && ratio < 1.08 ? 1 : 0;
    },
  },
  {
    words: ['huge', 'big', 'large', 'giant', 'massive', 'enormous'],
    says: 'large',
    test: (subject) => {
      const megapixels = (subject.file.width ?? 0) * (subject.file.height ?? 0);
      if (megapixels > 8_000_000) return 1;
      if (subject.file.bytes > 8 * 1024 * 1024) return 0.8;
      if (subject.file.bytes > 2 * 1024 * 1024) return 0.4;
      return 0;
    },
  },
  {
    words: ['tiny', 'small', 'little', 'thumbnail'],
    says: 'small',
    test: (subject) =>
      subject.file.bytes < 150 * 1024 ? 1 : subject.file.bytes < 400 * 1024 ? 0.5 : 0,
  },
  {
    words: ['today'],
    says: 'from today',
    test: (subject) => within(subject, startOfDay(subject.now)),
  },
  {
    words: ['yesterday'],
    says: 'from yesterday',
    test: (subject) => within(subject, startOfDay(subject.now, 1), startOfDay(subject.now)),
  },
  colourDescriptor('blue', ['bluish', 'navy', 'azure']),
  colourDescriptor('red', ['reddish', 'crimson', 'scarlet']),
  colourDescriptor('green', ['greenish', 'emerald']),
  colourDescriptor('yellow', ['yellowish', 'gold', 'golden']),
  colourDescriptor('orange', ['orangey', 'amber']),
  colourDescriptor('purple', ['purpley', 'violet', 'indigo', 'lavender']),
  colourDescriptor('pink', ['pinkish', 'magenta', 'rose']),
  colourDescriptor('teal', ['turquoise', 'cyan', 'aqua']),
  colourDescriptor('brown', ['brownish', 'tan', 'beige', 'sepia']),
  colourDescriptor('black', ['blackish']),
  colourDescriptor('white', ['whiteish', 'whitish']),
  colourDescriptor('grey', ['gray', 'greyish', 'grayish', 'silver']),
];

/** Word → the claims it makes. Built once; a word can make more than one. */
const DESCRIPTOR_INDEX = ((): Map<string, Descriptor[]> => {
  const index = new Map<string, Descriptor[]>();
  for (const descriptor of DESCRIPTORS) {
    for (const word of new Set(descriptor.words)) {
      const held = index.get(word);
      if (held) held.push(descriptor);
      else index.set(word, [descriptor]);
    }
  }
  return index;
})();

/** Every word that means something about a picture rather than about its name. */
export function descriptorWords(): string[] {
  return [...DESCRIPTOR_INDEX.keys()].sort();
}

/**
 * The syntax, written once.
 *
 * The search page renders this list rather than describing the language in its
 * own words, so the help and the parser cannot disagree about what `after:`
 * does — the failure mode of documentation nobody can test.
 */
export const QUERY_HELP: { syntax: string; what: string }[] = [
  { syntax: 'kind:photo', what: 'One file type. Also screenshot, document, video, audio, design, archive.' },
  { syntax: '#holiday', what: 'Tagged with a tag whose name starts with this.' },
  { syntax: 'is:favorite', what: 'Only files you starred.' },
  { syntax: 'since:7d', what: 'Created in the last 7 days — also 3w, 2m, 1y.' },
  { syntax: 'after:2024-06-01', what: 'Created on or after a date. before: is the same, reversed.' },
  { syntax: 'size:>4mb', what: 'By size, with kb, mb, gb. Also w:>1920 and h:<1080.' },
  { syntax: 'in:Downloads', what: 'The folder path contains this. Also collection: and project:.' },
  { syntax: 'name:invoice', what: 'The filename contains this. text: searches the extracted text.' },
  { syntax: '"holiday 2023"', what: 'A phrase, in order, inside one field.' },
  { syntax: '-screenshot', what: 'Anything marked with a minus is excluded.' },
  { syntax: 'photo OR video', what: 'Either of two searches. Everything else is all of them.' },
  { syntax: 'tall dark blurry', what: 'Describe the picture: shape, tone, colour, detail and size, as measured.' },
];

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

interface Haystack {
  text: string;
  weight: number;
  match: SearchHit['match'];
}

function haystacks(file: ArchiveFile, context: QueryContext): Haystack[] {
  const tagNames = file.tagIds.map((id) => context.tagName(id)).join(' ');
  const collectionNames = file.collectionIds.map((id) => context.collectionName(id)).join(' ');
  return [
    { text: file.name, weight: 6, match: 'filename' },
    { text: file.generatedTitle ?? '', weight: 4, match: 'filename' },
    { text: file.description ?? '', weight: 3, match: 'text' },
    { text: file.context ?? '', weight: 2.5, match: 'text' },
    { text: file.folderPath, weight: 2.5, match: 'folder' },
    { text: file.labels.join(' '), weight: 2, match: 'text' },
    { text: file.ocrText ?? '', weight: 2, match: 'text' },
    { text: tagNames, weight: 3, match: 'tag' },
    { text: collectionNames, weight: 2, match: 'collection' },
    { text: context.projectName(file.projectId ?? ''), weight: 2, match: 'project' },
    { text: file.ext, weight: 1, match: 'filename' },
  ];
}

/**
 * One word against every field.
 *
 * Exact beats prefix beats containment, because that is the order in which a
 * person means them: `beach` in a filename is the beach, `bea` inside
 * "beautiful" is a search still being typed.
 */
function textScore(word: string, fields: Haystack[]): { score: number; match: SearchHit['match'] | null } {
  let best = 0;
  let match: SearchHit['match'] | null = null;
  for (const field of fields) {
    if (!field.text) continue;
    const tokens = normalise(field.text);
    if (tokens.length === 0) continue;
    let score = 0;
    if (tokens.includes(word)) score = field.weight * 2;
    else if (tokens.some((token) => token.startsWith(word))) score = field.weight;
    else if (word.length >= 3 && tokens.join(' ').includes(word)) score = field.weight * 0.4;
    if (score > best) {
      best = score;
      match = field.match;
    }
  }
  return { score: best, match };
}

function holds(value: number | null, bound: Bound | null): boolean {
  if (!bound) return true;
  const number = value ?? 0;
  if (bound.min !== null && number < bound.min) return false;
  if (bound.max !== null && number > bound.max) return false;
  return true;
}

function hardClausesHold(file: ArchiveFile, group: Group, context: QueryContext): boolean {
  if (group.kinds.length > 0 && !group.kinds.includes(file.kind)) return false;
  if (group.extensions.length > 0) {
    const ext = file.ext.replace(/^\./, '').toLowerCase();
    if (!group.extensions.includes(ext)) return false;
  }
  if (group.names.length > 0) {
    const name = file.name.toLowerCase();
    if (!group.names.every((wanted) => name.includes(wanted))) return false;
  }
  if (group.texts.length > 0) {
    const text = [file.ocrText, file.description, file.generatedTitle, file.name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!group.texts.every((wanted) => text.includes(wanted))) return false;
  }
  if (group.tagNames.length > 0) {
    const names = file.tagIds.map((id) => context.tagName(id).toLowerCase());
    if (!group.tagNames.every((wanted) => names.some((name) => name.startsWith(wanted)))) return false;
  }
  if (group.folders.length > 0) {
    const path = file.folderPath.toLowerCase();
    if (!group.folders.every((wanted) => path.includes(wanted))) return false;
  }
  if (group.collections.length > 0) {
    const names = file.collectionIds.map((id) => context.collectionName(id).toLowerCase());
    if (!group.collections.every((wanted) => names.some((name) => name.startsWith(wanted)))) return false;
  }
  if (group.projects.length > 0) {
    const name = context.projectName(file.projectId ?? '').toLowerCase();
    if (!group.projects.every((wanted) => name.startsWith(wanted))) return false;
  }
  if (group.favoritesOnly && !file.favorite) return false;

  const created = Date.parse(file.createdAt || file.modifiedAt);
  if (group.sinceDays !== null) {
    if (!Number.isFinite(created) || created < context.now - group.sinceDays * DAY_MS) return false;
  }
  if (group.after !== null && (!Number.isFinite(created) || created < group.after)) return false;
  if (group.before !== null && (!Number.isFinite(created) || created >= group.before)) return false;

  if (!holds(file.bytes, group.size)) return false;
  if (!holds(file.width ?? null, group.width)) return false;
  if (!holds(file.height ?? null, group.height)) return false;

  return true;
}

function excluded(file: ArchiveFile, exclusion: Exclusion, context: QueryContext): boolean {
  if (exclusion.kinds.includes(file.kind)) return true;

  if (exclusion.tags.length > 0) {
    const names = file.tagIds.map((id) => context.tagName(id).toLowerCase());
    if (exclusion.tags.some((wanted) => names.some((name) => name.startsWith(wanted)))) return true;
  }

  if (exclusion.words.length === 0) return false;

  const fields = haystacks(file, context);
  const subject: Subject = { file, signature: context.signature?.(file.id), now: context.now };
  return exclusion.words.some((word) => {
    if (textScore(word, fields).score > 0) return true;
    return (DESCRIPTOR_INDEX.get(word) ?? []).some((descriptor) => descriptor.test(subject) > 0);
  });
}

function scoreGroup(file: ArchiveFile, group: Group, context: QueryContext): Scored | null {
  if (!hardClausesHold(file, group, context)) return null;

  const fields = haystacks(file, context);
  const subject: Subject = { file, signature: context.signature?.(file.id), now: context.now };
  const reasons: string[] = [];

  let score = 0;
  let facets = 0;
  let match: SearchHit['match'] | null = null;
  let textHit = false;
  let described = false;

  // A quoted phrase is a demand, not a hint: it has to appear in one field, in
  // order, which is the only thing quoting a phrase does.
  for (const phrase of group.phrases) {
    const joined = phrase.join(' ');
    const found = fields.some((field) => normalise(field.text).join(' ').includes(joined));
    if (!found) return null;
    score += 5;
    facets += 1;
    textHit = true;
  }

  for (const word of group.words) {
    const text = textScore(word, fields);
    if (text.score > 0) {
      score += text.score;
      facets += 1;
      textHit = true;
      match = text.match ?? match;
    }
    for (const descriptor of DESCRIPTOR_INDEX.get(word) ?? []) {
      const confidence = descriptor.test(subject);
      if (confidence <= 0) continue;
      score += 2.4 * confidence;
      facets += 1;
      described = true;
      if (!reasons.includes(descriptor.says)) reasons.push(descriptor.says);
    }
  }

  // A query of nothing but clauses is a legitimate search: `kind:video` asks
  // for every video, and none of them has to match a word.
  const wordless = group.words.length === 0 && group.phrases.length === 0;
  if (!wordless && facets === 0) return null;
  if (wordless) score += 1;

  // Breadth is evidence. A file matching three of the four words is a better
  // answer than one matching a single word very well, and without this the
  // sum would let one exact filename match outrank it.
  if (facets > 1) score *= 1 + 0.15 * (facets - 1);

  // Newer is better when nothing in the text can choose between two files.
  const age = Date.now() - Date.parse(file.createdAt || file.modifiedAt);
  if (Number.isFinite(age)) {
    score += Math.max(0, 0.6 - age / (DAY_MS * 365 * 4));
  }

  return {
    score,
    match: textHit ? (match ?? 'filename') : described ? 'described' : 'filename',
    reasons,
  };
}

/**
 * One file against the whole query.
 *
 * `OR` groups are tried independently and the best reading wins, which is what
 * makes `kind:video OR kind:audio` behave the way it reads.
 */
export function scoreFile(file: ArchiveFile, criteria: Criteria, context: QueryContext): Scored | null {
  const { filters } = criteria;

  if (filters.kind && file.kind !== filters.kind) return null;
  if (filters.collectionId && !file.collectionIds.includes(filters.collectionId)) return null;
  if (filters.projectId && file.projectId !== filters.projectId) return null;
  if (filters.folderId && file.folderId !== filters.folderId) return null;
  if (filters.favoritesOnly && !file.favorite) return null;
  if (filters.tagIds && filters.tagIds.length > 0) {
    if (!file.tagIds.some((id) => filters.tagIds?.includes(id))) return null;
  }

  if (excluded(file, criteria.exclude, context)) return null;

  let best: Scored | null = null;
  for (const group of criteria.groups) {
    const scored = scoreGroup(file, group, context);
    if (scored && (!best || scored.score > best.score)) best = scored;
  }

  // Nothing was asked for — filters only, from the filter panel.
  if (!best) {
    if (criteria.groups.length > 0) return null;
    return { score: 1, match: 'filename', reasons: [] };
  }
  return best;
}

/**
 * The line under the results: what the retrieval layer understood.
 *
 * Written from the parse rather than from the results, so it stays true when
 * nothing matched — which is exactly when somebody needs to see what was asked.
 */
export function summarise(criteria: Criteria, found: number): string {
  const parts: string[] = [];
  if (criteria.all.length > 0) parts.push(criteria.all.join(' '));

  const kinds = new Set<FileKind>();
  const tags = new Set<string>();
  let sinceDays: number | null = null;
  let favoritesOnly = false;
  for (const group of criteria.groups) {
    for (const kind of group.kinds) kinds.add(kind);
    for (const tag of group.tagNames) tags.add(tag);
    if (group.sinceDays !== null) sinceDays = group.sinceDays;
    if (group.favoritesOnly) favoritesOnly = true;
  }

  if (criteria.filters.kind) kinds.add(criteria.filters.kind);
  if (kinds.size > 0) parts.push(`kind: ${[...kinds].join(', ')}`);
  if (tags.size > 0) parts.push(`tagged ${[...tags].join(', ')}`);
  if (sinceDays !== null) parts.push(`in the last ${sinceDays} days`);
  if (favoritesOnly || criteria.filters.favoritesOnly) parts.push('favourites only');

  if (parts.length === 0) return `${found} files in this archive`;
  return `${found} for ${parts.join(' · ')}`;
}

/** The words that matched as description, for the surface that reports them. */
export function describedReasons(results: Scored[]): string[] {
  const seen = new Set<string>();
  for (const result of results) for (const reason of result.reasons) seen.add(reason);
  return [...seen];
}
