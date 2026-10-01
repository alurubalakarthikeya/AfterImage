/*
 * AfterImage's offline shell.
 *
 * An installed application that shows a browser's "you are offline" page is not
 * an installed application. This is the whole of what stands between the two:
 * it keeps a copy of the shell — the document, and the JavaScript, CSS, fonts
 * and icons it needs — and serves it when the network is not there.
 *
 * Deliberately small and deliberately not a framework's generated worker:
 *
 *   - It is registered only by a browser, never inside the Tauri webview, and
 *     only from a production bundle (`src/services/pwa.ts`). A service worker
 *     over a development server is a cache full of yesterday's modules.
 *
 *   - Navigation is network-first. A stale shell would pin the installed app to
 *     the asset hashes of whichever build happened to be cached first, so the
 *     network wins whenever it is reachable and the cache is only the fallback.
 *
 *   - Everything else is stale-while-revalidate: the copy answers immediately
 *     and the fresh one is fetched behind it. Assets are content-hashed, so a
 *     changed file is a different URL and the stale copy is never the wrong
 *     copy.
 *
 *   - Only same-origin GETs for a known set of static types are touched. Video
 *     and audio are excluded, and so is any request with a `Range` header: a
 *     seek is a request for part of a file, and answering it from a cache that
 *     holds the whole one is how a video stops playing at the first scrub.
 *     Writes are never intercepted — the archive's own data lives in IndexedDB,
 *     which does not go through here at all.
 *
 * Bump CACHE_VERSION when the shell changes shape. The worker file itself is
 * served unfetched from the build, so the browser re-reads it and this constant
 * is the signal that the old cache should go.
 */

const CACHE_VERSION = 'v1';
const CACHE_NAME = `afterimage-shell-${CACHE_VERSION}`;

/** The document to serve when there is no network. Resolved from the scope. */
const SHELL_URL = new URL('./', self.registration.scope).href;

/** Files worth keeping. Anything else falls through to the network untouched. */
const CACHEABLE = /\.(?:js|mjs|css|html|json|webmanifest|png|jpe?g|webp|avif|svg|ico|woff2?|ttf)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Individually, not `addAll`: one missing file would reject the whole
      // install, and an icon is not a reason to have no offline shell.
      await Promise.all(
        [SHELL_URL, new URL('./manifest.webmanifest', SHELL_URL).href].map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('afterimage-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
      // Take over the tabs that are already open, so the first visit is also
      // the visit that becomes offline-capable.
      await self.clients.claim();
    })(),
  );
});

function wanted(request, url) {
  if (request.method !== 'GET') return false;
  // `blob:` and `data:` URLs are the interface's own objects — an original being
  // shown, a thumbnail read out of the index — and never came from the network.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.origin !== self.location.origin) return false;
  if (request.headers.has('range')) return false;
  if (request.destination === 'video' || request.destination === 'audio') return false;
  // A bare origin or directory request is the document itself.
  return url.pathname.endsWith('/') || CACHEABLE.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!wanted(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(SHELL_URL, fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await caches.match(SHELL_URL, { cacheName: CACHE_NAME });
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          // `basic` keeps opaque cross-origin responses out of the cache: they
          // are unreadable, so caching one caches a blank.
          if (response.ok && response.type === 'basic') {
            void cache.put(request, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) return cached;
      return (await network) ?? Response.error();
    })(),
  );
});
