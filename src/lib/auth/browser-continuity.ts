"use client";

import {
  BROKER_CONTINUITY_COOKIE,
  CONTINUITY_LOCK_NAME,
  CONTINUITY_STORAGE_KEY,
} from "@/lib/auth/broker/types";

const PROTOCOL_VERSION = 2 as const;
const ANCHOR_BYTES = 32;
const GESTURE_NONCE_KEY = "velora:wp01a:gesture_nonce:v1";

export type ContinuityOk = { ok: true; protocolVersion: typeof PROTOCOL_VERSION; requestNonce: string };
export type ContinuityFail = {
  ok: false;
  code: "CONTINUITY_UNAVAILABLE" | "CONTINUITY_RECOVERY_REQUIRED";
};

type ContinuityRecord = {
  v: typeof PROTOCOL_VERSION;
  anchor: string;
};

type StoredParse =
  | { kind: "absent" }
  | { kind: "malformed" }
  | { kind: "ok"; record: ContinuityRecord };

function bytesToB64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Distinguish absent vs malformed persistent record (R4-F03 / C07). */
function classifyStored(raw: string | null): StoredParse {
  if (raw == null || raw === "") return { kind: "absent" };
  try {
    const o = JSON.parse(raw) as { v?: unknown; anchor?: unknown };
    if (o.v !== PROTOCOL_VERSION || typeof o.anchor !== "string" || o.anchor.length < 40) {
      return { kind: "malformed" };
    }
    return { kind: "ok", record: { v: PROTOCOL_VERSION, anchor: o.anchor } };
  } catch {
    return { kind: "malformed" };
  }
}

function readMirror(): string | null {
  if (typeof document === "undefined") return null;
  const parts = document.cookie.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(`${BROKER_CONTINUITY_COOKIE}=`)) {
      const v = decodeURIComponent(p.slice(BROKER_CONTINUITY_COOKIE.length + 1));
      return v.length >= 40 ? v : null;
    }
  }
  return null;
}

function writeMirror(anchor: string): void {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    `${BROKER_CONTINUITY_COOKIE}=${encodeURIComponent(anchor)}; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`;
}

async function continuityStatus(): Promise<{ hasArtifacts: boolean } | null> {
  try {
    const res = await fetch("/auth/broker/continuity", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok?: unknown;
      hasArtifacts?: unknown;
      protocolVersion?: unknown;
    };
    // Exact shape required (R4-F03 / C09) — missing hasArtifacts is not false.
    if (
      body.ok !== true
      || body.protocolVersion !== PROTOCOL_VERSION
      || typeof body.hasArtifacts !== "boolean"
    ) {
      return null;
    }
    return { hasArtifacts: body.hasArtifacts };
  } catch {
    return null;
  }
}

async function enrollContinuity(anchor: string): Promise<boolean> {
  try {
    const res = await fetch("/auth/broker/continuity", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ anchor, protocolVersion: PROTOCOL_VERSION }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

function locksAvailable(): boolean {
  return (
    typeof navigator !== "undefined"
    && typeof navigator.locks?.request === "function"
    && typeof crypto?.getRandomValues === "function"
    && typeof localStorage !== "undefined"
  );
}

/** Preserve one pending gesture across uncertain transport, scoped to Auth purpose. */
export function takeAuthGestureNonce(purpose = "auth", options?: { fresh?: boolean }): string {
  try {
    if (!options?.fresh) {
      const prior = JSON.parse(sessionStorage.getItem(GESTURE_NONCE_KEY) ?? "null");
      if (prior?.purpose === purpose && typeof prior.nonce === "string" && prior.nonce.length >= 16
        && Number.isFinite(prior.createdAt) && Date.now() >= prior.createdAt && Date.now()-prior.createdAt < 600000) {
        return prior.nonce;
      }
    }
  } catch { /* Storage is optional; server still enforces nonce ownership. */ }
  const bytes = new Uint8Array(16);
  const nonce = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : (crypto.getRandomValues(bytes),bytesToB64url(bytes));
  try { sessionStorage.setItem(GESTURE_NONCE_KEY,JSON.stringify({purpose,nonce,createdAt:Date.now()})); } catch { /* Optional retry persistence. */ }
  return nonce;
}
export function peekAuthGestureNonce(): string | null {
  try { const value=JSON.parse(sessionStorage.getItem(GESTURE_NONCE_KEY) ?? "null");return typeof value?.nonce === "string" ? value.nonce : null; } catch { return null; }
}
export function clearAuthGestureNonce(nonce: string): void {
  try { if (peekAuthGestureNonce() === nonce) sessionStorage.removeItem(GESTURE_NONCE_KEY); } catch { /* Optional retry persistence. */ }
}

export async function ensureBrowserContinuity(purpose = "auth"): Promise<ContinuityOk | ContinuityFail> {
  if (typeof window === "undefined" || !locksAvailable()) {
    return { ok: false, code: "CONTINUITY_UNAVAILABLE" };
  }
  // Require first-party top-level secure context (or localhost).
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    return { ok: false, code: "CONTINUITY_UNAVAILABLE" };
  }
  try {
    if (window.top !== window.self) {
      return { ok: false, code: "CONTINUITY_UNAVAILABLE" };
    }
  } catch {
    return { ok: false, code: "CONTINUITY_UNAVAILABLE" };
  }

  try {
    return await navigator.locks.request(CONTINUITY_LOCK_NAME, { mode: "exclusive" }, async () => {
      let raw: string | null;
      try {
        raw = localStorage.getItem(CONTINUITY_STORAGE_KEY);
      } catch {
        return { ok: false, code: "CONTINUITY_UNAVAILABLE" as const };
      }
      const stored = classifyStored(raw);
      if (stored.kind === "malformed") {
        return { ok: false, code: "CONTINUITY_RECOVERY_REQUIRED" as const };
      }
      const mirror = readMirror();
      const status = await continuityStatus();
      if (!status) return { ok: false, code: "CONTINUITY_UNAVAILABLE" as const };

      if (stored.kind === "absent" && (mirror || status.hasArtifacts)) {
        return { ok: false, code: "CONTINUITY_RECOVERY_REQUIRED" as const };
      }
      if (stored.kind === "ok" && mirror && stored.record.anchor !== mirror) {
        return { ok: false, code: "CONTINUITY_RECOVERY_REQUIRED" as const };
      }
      if (stored.kind === "ok" && !mirror) {
        writeMirror(stored.record.anchor);
        if (readMirror() !== stored.record.anchor) {
          return { ok: false, code: "CONTINUITY_UNAVAILABLE" as const };
        }
        const enrolled = await enrollContinuity(stored.record.anchor);
        if (!enrolled) return { ok: false, code: "CONTINUITY_UNAVAILABLE" as const };
        return {
          ok: true as const,
          protocolVersion: PROTOCOL_VERSION,
          requestNonce: takeAuthGestureNonce(purpose),
        };
      }
      if (stored.kind === "ok" && mirror === stored.record.anchor) {
        const enrolled = await enrollContinuity(stored.record.anchor);
        if (!enrolled) return { ok: false, code: "CONTINUITY_UNAVAILABLE" as const };
        return {
          ok: true as const,
          protocolVersion: PROTOCOL_VERSION,
          requestNonce: takeAuthGestureNonce(purpose),
        };
      }

      // Genuinely empty enrollment.
      if (status.hasArtifacts) {
        return { ok: false, code: "CONTINUITY_RECOVERY_REQUIRED" as const };
      }
      const bytes = new Uint8Array(ANCHOR_BYTES);
      crypto.getRandomValues(bytes);
      const anchor = bytesToB64url(bytes);
      const record: ContinuityRecord = { v: PROTOCOL_VERSION, anchor };
      try {
        localStorage.setItem(CONTINUITY_STORAGE_KEY, JSON.stringify(record));
      } catch {
        return { ok: false, code: "CONTINUITY_UNAVAILABLE" as const };
      }
      const readBack = classifyStored(localStorage.getItem(CONTINUITY_STORAGE_KEY));
      if (readBack.kind !== "ok" || readBack.record.anchor !== anchor) {
        return { ok: false, code: "CONTINUITY_UNAVAILABLE" as const };
      }
      writeMirror(anchor);
      if (readMirror() !== anchor) {
        return { ok: false, code: "CONTINUITY_UNAVAILABLE" as const };
      }
      const enrolled = await enrollContinuity(anchor);
      if (!enrolled) return { ok: false, code: "CONTINUITY_UNAVAILABLE" as const };
      return {
        ok: true as const,
        protocolVersion: PROTOCOL_VERSION,
        requestNonce: takeAuthGestureNonce(purpose),
      };
    });
  } catch {
    return { ok: false, code: "CONTINUITY_UNAVAILABLE" };
  }
}
