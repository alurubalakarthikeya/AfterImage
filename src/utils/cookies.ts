/**
 * Cookies, as a second memory.
 *
 * The archive's preferences have always lived in `localStorage`, and that is
 * still the primary copy — it is synchronous, which is what lets the theme be
 * resolved before the first paint. But `localStorage` is fragile in exactly the
 * ways that make an application feel like it forgot you: it is evicted under
 * storage pressure, it is emptied when a browser decides site data is stale, and
 * in private windows it never survives the session at all. A cookie rides along
 * with every request and outlives all three, so the fallback costs one write per
 * change and means "come back in a week" and "come back after clearing
 * browsing data" are the same answer.
 *
 * Nothing here is tracking. There is no third party, no expiry that outstays
 * the year, no identifier beyond the preferences the user can already read in
 * Settings — and `SameSite=Lax` keeps it off cross-site requests entirely.
 *
 * Sizes are guarded because the platform is not forgiving: a browser drops any
 * cookie over 4096 bytes without warning, and a silently discarded preference
 * looks exactly like a preference that was never saved.
 */

const YEAR_DAYS = 365;

/** The most this application will put in one cookie, in bytes. */
const COOKIE_BUDGET = 3800;

function encode(value: string): string {
  // `encodeURIComponent` leaves `'`, `(`, `)` and `!` alone, and some parsers
  // have opinions about those in cookie values. Escape them too.
  return encodeURIComponent(value).replace(
    /['()!]/g,
    (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
  );
}

/**
 * Store a value, or refuse.
 *
 * Returns false when it would not fit, so the caller can drop the least
 * important field and try again rather than writing something the browser will
 * quietly throw away.
 */
export function writeCookie(name: string, value: string, days = YEAR_DAYS): boolean {
  if (typeof document === 'undefined') return false;
  const base = `${name}=${encode(value)}; Path=/; Max-Age=${days * 86_400}; SameSite=Lax`;
  // Secure only over https: set with it on http and the cookie is discarded,
  // which would break the local dev server and any plain-http deployment.
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  const candidate = `${base}${secure}`;
  if (candidate.length > COOKIE_BUDGET) return false;
  document.cookie = candidate;
  return true;
}

/** The value for a name, or null when there is none. */
export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const entry = part.trim();
    if (entry.startsWith(prefix)) {
      try {
        return decodeURIComponent(entry.slice(prefix.length));
      } catch {
        // A value written by something else entirely is not worth failing over.
        return null;
      }
    }
  }
  return null;
}

export function clearCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Read a JSON blob from a cookie, tolerating the shape it was stored in.
 *
 * Returns null for anything unreadable, because a corrupt cookie must degrade
 * to "no remembered preference" rather than to an application that will not
 * start.
 */
export function readCookieJson<T>(name: string): T | null {
  const raw = readCookie(name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? null : (parsed as T);
  } catch {
    return null;
  }
}
