/** Session flag for login↔signup lock morph across separate routes. Hard loads omit it. */
export const AUTH_ENTRY_MORPH_KEY = "velora.auth.entry.morph";

export const AUTH_ENTRY_MORPH_MS = 580;

export function markAuthEntryMorph(): void {
  try {
    sessionStorage.setItem(AUTH_ENTRY_MORPH_KEY, "1");
  } catch {
    /* private mode / blocked storage — morph becomes instant swap */
  }
}

/** Returns true once when the previous in-app switch requested a morph reveal. */
export function consumeAuthEntryMorph(): boolean {
  try {
    const value = sessionStorage.getItem(AUTH_ENTRY_MORPH_KEY);
    if (value) sessionStorage.removeItem(AUTH_ENTRY_MORPH_KEY);
    return value === "1";
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
