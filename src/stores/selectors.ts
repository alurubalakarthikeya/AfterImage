import type {
  ActivityEntry,
  ArchiveFile,
  ArchiveTotals,
  FileKind,
  RouteId,
  Tag,
} from '@/types';
import type { FileQuery } from '@/services/host';
import { dayKey } from '@/utils/format';

/** Pure derivations shared by pages. Kept out of stores so they stay testable. */

export type SortKey = 'recent' | 'name' | 'size' | 'kind';

export const KIND_LABEL: Record<FileKind, string> = {
  photo: 'Photos',
  screenshot: 'Screenshots',
  document: 'Documents',
  video: 'Videos',
  audio: 'Audio',
  design: 'Design',
  archive: 'Archives',
  other: 'Other',
};

export const KIND_SINGULAR: Record<FileKind, string> = {
  photo: 'Photo',
  screenshot: 'Screenshot',
  document: 'Document',
  video: 'Video',
  audio: 'Audio',
  design: 'Design',
  archive: 'Archive',
  other: 'File',
};

/** Lucide icon per kind, used by the placeholder when there is no thumbnail. */
export const KIND_ICON: Record<FileKind, string> = {
  photo: 'Image',
  screenshot: 'MonitorSmartphone',
  document: 'FileText',
  video: 'Film',
  audio: 'Music',
  design: 'Palette',
  archive: 'Archive',
  other: 'File',
};

/** Empty-state copy per kind, so every page says something specific. */
export const KIND_EMPTY: Record<FileKind, { title: string; detail: string }> = {
  photo: {
    title: 'No photos found',
    detail: 'Add a folder that holds images and AfterImage will index them automatically.',
  },
  screenshot: {
    title: 'No screenshots found',
    detail: 'Screenshots are recognised by name and capture folder — watch your screenshots folder to see them here.',
  },
  document: {
    title: 'No documents found',
    detail: 'PDF, Markdown and text files are read and made searchable, including their text layer.',
  },
  video: {
    title: 'No videos found',
    detail: 'Video files are indexed with a frame thumbnail and their metadata.',
  },
  audio: { title: 'No audio found', detail: 'Audio files are indexed with their metadata.' },
  design: { title: 'No design files found', detail: 'Figma, Sketch and export files land here.' },
  archive: { title: 'No archives found', detail: 'Archive files are indexed by name and metadata.' },
  other: { title: 'No files found', detail: 'Add a watched folder to start building your archive.' },
};

/**
 * The query each route sends to the index.
 *
 * Filtering, sorting and paging all happen in SQL — the renderer never filters
 * a list it received, because it only ever holds one page.
 */
export function routeFileQuery(
  route: RouteId,
  options: {
    collectionId?: string | null;
    projectId?: string | null;
    sort?: SortKey;
    /** One calendar day, `YYYY-MM-DD`, set by the timeline's day headers. */
    day?: string | null;
  } = {},
): FileQuery | null {
  const sort = options.sort ?? 'recent';
  // A day narrows whatever the route already means: "the 14th" on the photos
  // page is photographs from the 14th, not every file from the 14th.
  const day = options.day ? { day: options.day } : {};
  switch (route) {
    case 'photos':
      return { kinds: ['photo'], sort, ...day };
    case 'screenshots':
      return { kinds: ['screenshot'], sort, ...day };
    case 'documents':
      return { kinds: ['document'], sort, ...day };
    case 'videos':
      return { kinds: ['video'], sort, ...day };
    case 'projects':
      // Nothing is filed until the user picks a project, so there is no page to
      // fetch and no reason to read the whole archive to render an empty state.
      return options.projectId ? { projectId: options.projectId, sort, ...day } : null;
    case 'collections':
      return options.collectionId
        ? { collectionId: options.collectionId, sort, ...day }
        : null;
    case 'all':
      return { sort, ...day };
    default:
      return null;
  }
}

export interface StatTile {
  label: string;
  value: number;
  kind: FileKind;
  icon: string;
}

/** The four counts a photo archive is actually measured in. */
export function statTiles(totals: ArchiveTotals): StatTile[] {
  return [
    { label: 'Images', value: totals.byKind.photo, kind: 'photo', icon: 'Image' },
    { label: 'Screenshots', value: totals.byKind.screenshot, kind: 'screenshot', icon: 'MonitorSmartphone' },
    { label: 'Documents', value: totals.byKind.document, kind: 'document', icon: 'FileText' },
    { label: 'Videos', value: totals.byKind.video, kind: 'video', icon: 'Film' },
  ];
}

/** Tags by weight, pinned first. Counts come from the index itself. */
export function topTags(tags: Tag[], limit = 12): Tag[] {
  return [...tags]
    .sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.count - a.count)
    .slice(0, limit);
}

/** Group files by calendar day for the timeline view. */
/**
 * Files grouped by the local calendar day they were added on.
 *
 * The key is `YYYY-MM-DD` rather than a formatted date, because the header is a
 * control: pressing a day asks the index for that day, and an index cannot be
 * asked a question phrased as "Thu Sep 24 2026".
 */
export function groupByDay(files: ArchiveFile[]): Array<{ key: string; files: ArchiveFile[] }> {
  const buckets = new Map<string, ArchiveFile[]>();
  for (const file of files) {
    const key = dayKey(file.createdAt);
    const bucket = buckets.get(key) ?? [];
    bucket.push(file);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => ({ key, files: bucket }))
    .sort((a, b) => Date.parse(b.files[0].createdAt) - Date.parse(a.files[0].createdAt));
}

export function activityByKind(activity: ActivityEntry[]): ActivityEntry[] {
  return [...activity].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
