import "server-only";
import type { CookieWriter } from "./cookies";

/** Generation-isolated cookie names — delayed Set-Cookie for A cannot overwrite B (C2-R6). */
export const AUTH_RETURN_COOKIE_PREFIX = "velora_ar_" as const;
export const WORKSPACE_COOKIE_PREFIX = "velora_ws_" as const;
/** Legacy shared names — expire only when matching generation ownership. */
export const AUTH_RETURN_COOKIE_LEGACY = "velora_auth_return_to" as const;
export const AUTH_RETURN_GEN_COOKIE_LEGACY = "velora_auth_return_gen" as const;
export const WORKSPACE_COOKIE_LEGACY = "velora_workspace_company" as const;

export type AncillaryCookieStore = {
  get(name: string): { value: string } | undefined;
  getAll?(): Array<{ name: string; value: string }>;
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete(name: string): void;
};

const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge,
});

export function authReturnCookieName(generation: string): string {
  return `${AUTH_RETURN_COOKIE_PREFIX}${generation}`;
}

export function workspaceCookieName(generation: string): string {
  return `${WORKSPACE_COOKIE_PREFIX}${generation}`;
}

export function commitAuthReturnForGeneration(
  store: AncillaryCookieStore | CookieWriter,
  generation: string,
  path: string,
): void {
  if (!generation || generation.length < 8 || !path) return;
  store.set(authReturnCookieName(generation), path, cookieOpts(7200));
}

/** Read return path for the current generation only. */
export function readAuthReturnForGeneration(
  store: Pick<AncillaryCookieStore, "get">,
  generation: string | null | undefined,
): string | null {
  if (!generation) return null;
  const v = store.get(authReturnCookieName(generation))?.value;
  return v && v.startsWith("/") ? v : null;
}

/**
 * Clear only this generation's return cookie name.
 * Never delete B's differently-named cookie via shared-name wipe.
 */
export function clearAuthReturnForGeneration(
  store: AncillaryCookieStore,
  generation: string,
): void {
  if (!generation) return;
  store.set(authReturnCookieName(generation), "", { ...cookieOpts(0), maxAge: 0 });
  store.delete(authReturnCookieName(generation));
  // Legacy shared pair: only when gen tag exactly matches this generation.
  // Never wipe when tag absent — that may be B's delayed return (C3-8).
  const legacyGen = store.get(AUTH_RETURN_GEN_COOKIE_LEGACY)?.value;
  if (legacyGen && legacyGen === generation) {
    store.delete(AUTH_RETURN_COOKIE_LEGACY);
    store.delete(AUTH_RETURN_GEN_COOKIE_LEGACY);
  }
}

export function commitWorkspaceForGeneration(
  store: AncillaryCookieStore | CookieWriter,
  generation: string,
  userId: string,
  companyId: string,
): void {
  store.set(
    workspaceCookieName(generation),
    `${userId}:${companyId}`,
    cookieOpts(60 * 60 * 24 * 30),
  );
}

export function readWorkspaceCompanyForGeneration(
  store: Pick<AncillaryCookieStore, "get">,
  generation: string | null | undefined,
  userId: string,
): string | null {
  if (!generation) return null;
  const v = store.get(workspaceCookieName(generation))?.value;
  if (!v?.startsWith(`${userId}:`)) return null;
  const companyId = v.slice(userId.length + 1);
  return companyId || null;
}

export function clearWorkspaceHintForGeneration(
  store: AncillaryCookieStore,
  _legacyCookieName: string,
  userId: string,
  generation: string,
): void {
  void userId;
  store.set(workspaceCookieName(generation), "", { ...cookieOpts(0), maxAge: 0 });
  store.delete(workspaceCookieName(generation));
  // Do not delete legacy shared workspace cookie — may belong to B under delayed write.
}

/** @deprecated — use commitWorkspaceForGeneration */
export function formatWorkspaceHint(userId: string, generation: string, companyId: string): string {
  return `${userId}:${generation}:${companyId}`;
}

/** @deprecated */
export function parseWorkspaceHint(
  value: string | undefined,
  userId: string,
  generation?: string | null,
): { companyId: string; generation: string | null; matchesGeneration: boolean } | null {
  if (!value || !value.startsWith(`${userId}:`)) return null;
  const rest = value.slice(userId.length + 1);
  const parts = rest.split(":");
  if (parts.length >= 2) {
    const gen = parts[0]!;
    const companyId = parts.slice(1).join(":");
    if (!companyId) return null;
    return { companyId, generation: gen, matchesGeneration: Boolean(generation) && gen === generation };
  }
  if (!rest) return null;
  return { companyId: rest, generation: null, matchesGeneration: false };
}

/** @deprecated */
export function stampAuthReturnGeneration(
  store: AncillaryCookieStore | CookieWriter,
  generation: string,
): void {
  if (!generation || generation.length < 8) return;
  store.set(AUTH_RETURN_GEN_COOKIE_LEGACY, generation, cookieOpts(7200));
}
