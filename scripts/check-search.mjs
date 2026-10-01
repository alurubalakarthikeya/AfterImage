#!/usr/bin/env node
/**
 * The search language, checked against a fixed little archive.
 *
 *   npm run check:search
 *
 * A query language is the one part of this application whose behaviour is
 * entirely invisible code: the parser decides what a word means and the ranking
 * decides what comes back, and neither has a screen anybody can look at. So it
 * is checked here instead — every clause of the syntax, and the description
 * matching that reads a picture's own measurements, against five invented files
 * with nothing else in the way.
 *
 * The files are made up on purpose. A check that needed a real archive would
 * only run on one machine; these are shapes, sizes and dates, and they assert
 * what the language promises rather than what a folder happens to contain.
 *
 * Needs Node 22.6 or newer: it runs the real module by stripping its types,
 * which is why there is no build step and no copy of the logic here to drift.
 */

import {
  buildCriteria,
  describedReasons,
  parseQuery,
  scoreFile,
  summarise,
} from '../src/services/search/query.ts';

const NOW = Date.parse('2026-10-01T12:00:00Z');

const tags = new Map([
  ['t1', 'holiday'],
  ['t2', 'react'],
]);
const collections = new Map([['c1', 'Design work']]);
const projects = new Map([['p1', 'Website']]);

function file(overrides) {
  return {
    id: overrides.id ?? 'f1',
    name: overrides.name ?? 'IMG_0001.jpg',
    path: overrides.path ?? 'Pictures/IMG_0001.jpg',
    kind: overrides.kind ?? 'photo',
    ext: overrides.ext ?? 'jpg',
    mime: 'image/jpeg',
    bytes: overrides.bytes ?? 1_200_000,
    width: overrides.width ?? 1000,
    height: overrides.height ?? 1000,
    folderId: 'fo1',
    folderPath: overrides.folderPath ?? 'Pictures',
    createdAt: overrides.createdAt ?? '2026-09-01T00:00:00Z',
    modifiedAt: overrides.modifiedAt ?? '2026-09-01T00:00:00Z',
    indexedAt: '2026-09-01T00:00:00Z',
    favorite: overrides.favorite ?? false,
    tagIds: overrides.tagIds ?? [],
    machineTagIds: [],
    collectionIds: overrides.collectionIds ?? [],
    projectId: overrides.projectId ?? null,
    thumbPath: null,
    generatedTitle: overrides.generatedTitle ?? null,
    description: overrides.description ?? null,
    labels: overrides.labels ?? [],
    context: overrides.context ?? null,
    ocrText: overrides.ocrText ?? undefined,
    ocrState: 'none',
    indexState: 'indexed',
    hash: null,
  };
}

const signatures = new Map();

const context = {
  tagName: (id) => tags.get(id) ?? '',
  collectionName: (id) => collections.get(id) ?? '',
  projectName: (id) => projects.get(id) ?? '',
  signature: (id) => signatures.get(id),
  now: NOW,
};

const portrait = file({ id: 'portrait', name: 'IMG_1.jpg', width: 900, height: 1600 });
const wide = file({ id: 'wide', name: 'IMG_2.jpg', width: 3000, height: 1200 });
signatures.set('wide', {
  brightness: 0.2,
  contrast: 0.3,
  sharpness: 0.6,
  saturation: 0.5,
  temperatureShift: -0.1,
  palette: [
    { hex: '#1030A0', red: 16, green: 48, blue: 160, share: 0.5 },
    { hex: '#101010', red: 16, green: 16, blue: 16, share: 0.3 },
  ],
});
signatures.set('portrait', {
  brightness: 0.8,
  contrast: 0.05,
  sharpness: 0.05,
  saturation: 0.02,
  temperatureShift: 0.12,
  palette: [{ hex: '#E0C090', red: 224, green: 192, blue: 144, share: 0.7 }],
});

const screenshot = file({
  id: 'shot',
  name: 'Screenshot 2026-09-30 at 11.02.11.png',
  kind: 'screenshot',
  ext: 'png',
  bytes: 8_000_000,
  width: 2560,
  height: 1440,
  tagIds: ['t2'],
  folderPath: 'Pictures/Screenshots',
  ocrText: 'TypeError: cannot read properties of undefined',
  createdAt: '2026-09-30T09:00:00Z',
});
const holiday = file({
  id: 'holiday',
  name: 'beach.jpg',
  width: 4000,
  height: 3000,
  tagIds: ['t1'],
  collectionIds: ['c1'],
  folderPath: 'Pictures/Holiday 2024',
  createdAt: '2024-07-04T00:00:00Z',
  favorite: true,
  bytes: 6_000_000,
});
const video = file({ id: 'video', name: 'trip.mp4', kind: 'video', ext: 'mp4', bytes: 900_000_000 });

const files = [portrait, wide, screenshot, holiday, video];

function run(query, options = {}) {
  const criteria = buildCriteria(query, options.filters ?? {}, NOW);
  const results = [];
  for (const f of files) {
    const scored = scoreFile(f, criteria, context);
    if (scored) results.push({ id: f.id, score: Math.round(scored.score * 100) / 100, match: scored.match, reasons: scored.reasons });
  }
  results.sort((a, b) => b.score - a.score);
  return { results, summary: summarise(criteria, results.length), described: describedReasons(results) };
}

const checks = [];
function check(name, condition, detail) {
  checks.push({ name, pass: Boolean(condition), detail });
}

const tall = run('tall');
check('tall finds the portrait by shape alone', tall.results.some((r) => r.id === 'portrait'), JSON.stringify(tall.results));
check('tall does not claim the wide one', !tall.results.some((r) => r.id === 'wide'));

const shut = run('kind:screenshot');
check('kind: filters', shut.results.length === 1 && shut.results[0].id === 'shot', JSON.stringify(shut.results));

const bare = run('screenshot');
check('a bare "screenshot" is a file type', bare.results.length === 1 && bare.results[0].id === 'shot', JSON.stringify(bare.results));

const bareVideo = run('video');
check('a bare "video" is a file type', bareVideo.results.length === 1 && bareVideo.results[0].id === 'video', JSON.stringify(bareVideo.results));

const darkWide = run('dark wide');
check('a description finds a file whose name says nothing', darkWide.results[0] && darkWide.results[0].id === 'wide', JSON.stringify(darkWide.results));
check('the reason is reported', darkWide.described.includes('dark') && darkWide.described.includes('wide'), JSON.stringify(darkWide.described));
check('the hit is labelled as described', darkWide.results[0].match === 'described', darkWide.results[0]?.match);

const blue = run('blue');
check('colour comes from the palette', blue.results.some((r) => r.id === 'wide'), JSON.stringify(blue.results));

const blurry = run('blurry');
check('sharpness: the soft one matches, the crisp one does not', blurry.results.some((r) => r.id === 'portrait') && !blurry.results.some((r) => r.id === 'wide'), JSON.stringify(blurry.results));

const warm = run('warm');
check('temperature', warm.results.some((r) => r.id === 'portrait') && !warm.results.some((r) => r.id === 'wide'), JSON.stringify(warm.results));

const negated = run('photo -portrait');
check('negation excludes', !negated.results.some((r) => r.id === 'portrait'), JSON.stringify(negated.results));

const big = run('size:>100mb');
check('size comparison', big.results.length === 1 && big.results[0].id === 'video', JSON.stringify(big.results));

const huge = run('kind:video size:>1mb');
check('two clauses both hold', huge.results.length === 1 && huge.results[0].id === 'video', JSON.stringify(huge.results));

const tag = run('#holiday');
check('#tag', tag.results.length === 1 && tag.results[0].id === 'holiday', JSON.stringify(tag.results));

const tagClause = run('tag:holiday');
check('tag:', tagClause.results.length === 1, JSON.stringify(tagClause.results));

const fav = run('is:favorite');
check('is:favorite', fav.results.length === 1 && fav.results[0].id === 'holiday', JSON.stringify(fav.results));

const favLong = run('is:fav blurry');
check('is:fav is the same clause', favLong.results.length === 0, JSON.stringify(favLong.results));

const phrase = run('"cannot read properties"');
check('a quoted phrase searches extracted text', phrase.results.some((r) => r.id === 'shot'), JSON.stringify(phrase.results));

const phraseFail = run('"properties read cannot"');
check('a phrase is in order', phraseFail.results.length === 0, JSON.stringify(phraseFail.results));

const either = run('kind:video OR kind:screenshot');
check('OR gives either', either.results.length === 2, JSON.stringify(either.results));

const folder = run('in:Screenshots');
check('in: matches the folder path', folder.results.length === 1 && folder.results[0].id === 'shot', JSON.stringify(folder.results));

const coll = run('collection:design');
check('collection:', coll.results.length === 1 && coll.results[0].id === 'holiday', JSON.stringify(coll.results));

const since = run('since:7d');
check('since: is a window on creation', since.results.length === 1 && since.results[0].id === 'shot', JSON.stringify(since.results));

const afterAll = run('after:2024-01-01');
check('after: keeps everything newer', afterAll.results.length === 5, JSON.stringify(afterAll.results));

const after = run('after:2025-01-01');
check('after: is a date floor', after.results.length === 4 && !after.results.some((r) => r.id === 'holiday'), JSON.stringify(after.results));

const before = run('before:2025-01-01');
check('before: is a date ceiling', before.results.length === 1 && before.results[0].id === 'holiday', JSON.stringify(before.results));

const dims = run('w:>2000');
check('w: compares a dimension', dims.results.some((r) => r.id === 'shot') && !dims.results.some((r) => r.id === 'portrait'), JSON.stringify(dims.results));

const extension = run('ext:mp4');
check('ext:', extension.results.length === 1 && extension.results[0].id === 'video', JSON.stringify(extension.results));

const nameClause = run('name:screenshot');
check('name:', nameClause.results.length === 1 && nameClause.results[0].id === 'shot', JSON.stringify(nameClause.results));

const filters = run('', { filters: { kind: 'photo', favoritesOnly: true } });
check('filter-only search still works', filters.results.length === 1 && filters.results[0].id === 'holiday', JSON.stringify(filters.results));

const nonsense = run('kind:photo zzzzqqq');
check('a word nothing matches excludes the file', nonsense.results.length === 0, JSON.stringify(nonsense.results));

const url = run('https://example.com/page');
check('an unknown key is still a word', Array.isArray(url.results), 'no throw');

const empty = parseQuery('', NOW);
check('an empty query parses to no groups', empty.groups.length === 0 && empty.all.length === 0);

const trailing = parseQuery('photo OR', NOW);
check('a trailing OR is not a second group', trailing.groups.length === 1);

const summary = run('kind:screenshot #react').summary;
check('the summary names what was understood', summary.includes('kind: screenshot') && summary.includes('tagged react'), summary);

for (const entry of checks) {
  console.log(`${entry.pass ? 'PASS' : 'FAIL'}  ${entry.name}${entry.pass ? '' : `  → ${entry.detail}`}`);
}
const failed = checks.filter((entry) => !entry.pass).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
