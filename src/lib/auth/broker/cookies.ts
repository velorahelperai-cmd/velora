import "server-only";
import {
  BROKER_COOKIE_PREFIX,
  BROKER_INTENT_COOKIE,
  BROKER_INTENT_COOKIE_PREFIX,
  MAX_BROKER_HANDLE_COOKIES,
} from "./types";
import { sha256Buffer } from "./crypto";

export type CookieReader = { getAll(): Array<{ name: string; value: string }> };
export type CookieWriter = {
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete?(name: string): void;
};

const HANDLE_NAME = new RegExp(`^${BROKER_COOKIE_PREFIX}[a-f0-9]{32}$`);
const INTENT_NAME = new RegExp(`^${BROKER_INTENT_COOKIE_PREFIX}[a-f0-9]{16}$`);

export function isBrokerHandleCookieName(name: string): boolean {
  return HANDLE_NAME.test(name);
}

export function brokerCookieOptions(maxAgeSeconds = 60 * 60 * 24 * 30) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function listHandleCookies(store: CookieReader): Array<{ name: string; value: string }> {
  return store.getAll().filter((c) => isBrokerHandleCookieName(c.name) && c.value.length >= 32);
}

/**
 * Cookie list is NOT an authority order (lexicographic generation is random).
 * Callers must resolve authority via server auth_ordinal — this only bounds count.
 */
export function selectCandidateHandles(store: CookieReader): Array<{ name: string; value: string }> | { failClosed: true } {
  const all = listHandleCookies(store);
  if (all.length > MAX_BROKER_HANDLE_COOKIES) return { failClosed: true };
  return all;
}

export function commitHandleCookie(
  writer: CookieWriter,
  cookieName: string,
  handle: string,
): void {
  if (!isBrokerHandleCookieName(cookieName)) {
    throw new Error("BROKER_COOKIE_NAME_INVALID");
  }
  writer.set(cookieName, handle, brokerCookieOptions());
}

export function expireHandleCookie(writer: CookieWriter, cookieName: string): void {
  if (!isBrokerHandleCookieName(cookieName)) return;
  writer.set(cookieName, "", { ...brokerCookieOptions(0), maxAge: 0 });
}

export function expireEnumeratedHandles(
  writer: CookieWriter,
  names: string[],
  preserve: Set<string>,
): void {
  for (const name of names) {
    if (preserve.has(name)) continue;
    expireHandleCookie(writer, name);
  }
}

export function intentCookieName(stateNonce: string): string {
  const fp = sha256Buffer(stateNonce).subarray(0, 8).toString("hex");
  return `${BROKER_INTENT_COOKIE_PREFIX}${fp}`;
}

export function commitIntentCookie(writer: CookieWriter, stateNonce: string, maxAge = 600): void {
  writer.set(intentCookieName(stateNonce), stateNonce, brokerCookieOptions(maxAge));
}

/** Read intent: prefer per-intent cookie matching optional state, else any vel_ai_* (not shared vel_ai). */
export function readIntentCookie(store: CookieReader, preferredState?: string | null): string | null {
  if (preferredState && preferredState.length >= 16) {
    const named = store.getAll().find((c) => c.name === intentCookieName(preferredState));
    if (named?.value === preferredState) return named.value;
  }
  const intents = store.getAll().filter((c) => INTENT_NAME.test(c.name) && c.value.length >= 16);
  if (intents.length === 1) return intents[0]!.value;
  // Ambiguous concurrent intents without preferred state → fail closed (caller supplies state).
  return null;
}

export function expireIntentCookie(writer: CookieWriter, stateNonce?: string | null): void {
  if (stateNonce) {
    writer.set(intentCookieName(stateNonce), "", { ...brokerCookieOptions(0), maxAge: 0 });
  }
  // Never wipe unrelated concurrent intent cookies; only clear legacy shared name if present.
  writer.set(BROKER_INTENT_COOKIE, "", { ...brokerCookieOptions(0), maxAge: 0 });
}
