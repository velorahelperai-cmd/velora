/** Session flag for login↔signup lock morph across separate routes. Hard loads omit it. */
export const AUTH_ENTRY_MORPH_KEY = "velora.auth.entry.morph";

export const AUTH_ENTRY_MORPH_MS = 580;

type AuthEntryMorphGeometry = { height: number };

export function markAuthEntryMorph(geometry?: AuthEntryMorphGeometry): void {
  try {
    sessionStorage.setItem(AUTH_ENTRY_MORPH_KEY, geometry ? JSON.stringify(geometry) : "1");
  } catch {
    /* private mode / blocked storage — morph becomes instant swap */
  }
}

/** Returns true once when the previous in-app switch requested a morph reveal. */
export function consumeAuthEntryMorph(): boolean | AuthEntryMorphGeometry {
  try {
    const value = sessionStorage.getItem(AUTH_ENTRY_MORPH_KEY);
    if (value) sessionStorage.removeItem(AUTH_ENTRY_MORPH_KEY);
    if (value === "1") return true;
    if (!value) return false;
    const geometry = JSON.parse(value);
    return geometry && Number.isFinite(geometry.height) && geometry.height > 0 && geometry.height < 10000
      ? { height: geometry.height } : false;
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
