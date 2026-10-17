"use client";

/**
 * WP01A: browser Supabase Auth persistence is retired.
 * Session authority is the server broker + opaque handle cookies.
 * Callers must use Server Actions (signIn/signOut/status), not browser tokens.
 */
export function createClient(): never {
  throw new Error("BROWSER_SUPABASE_AUTH_DISABLED");
}

/** Optional observers must not crash public pages; Auth observers are retired. */
export function tryCreateClient(): null {
  return null;
}
