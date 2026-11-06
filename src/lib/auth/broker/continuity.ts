import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { BROKER_ATTEMPT_COOKIE, BROKER_CONTINUITY_COOKIE, BROKER_COOKIE_PREFIX, BROKER_INTENT_COOKIE_PREFIX, BROKER_LINEAGE_COOKIE } from "./types";
import type { CookieReader } from "./cookies";
import { brokerLog } from "./log";

const ANCHOR_B64URL = /^[A-Za-z0-9_-]{40,128}$/;

export function hashBootstrapAnchor(anchor: string): string {
  return createHash("sha256").update(`vel_bc:v1:${anchor}`).digest("hex");
}

export function readContinuityMirror(store: CookieReader): string | null {
  const raw = store.getAll().find((c) => c.name === BROKER_CONTINUITY_COOKIE)?.value?.trim();
  if (!raw || !ANCHOR_B64URL.test(raw)) return null;
  return raw;
}

export function continuityArtifactsPresent(store: CookieReader): boolean {
  for (const c of store.getAll()) {
    if (c.name === BROKER_CONTINUITY_COOKIE && c.value.length >= 40) return true;
    if (c.name === BROKER_ATTEMPT_COOKIE && c.value.length >= 16) return true;
    if (c.name === BROKER_LINEAGE_COOKIE && c.value.length >= 16) return true;
    if (c.name.startsWith(BROKER_COOKIE_PREFIX) && c.value.length >= 32) return true;
    if (c.name.startsWith(BROKER_INTENT_COOKIE_PREFIX) && c.value.length >= 16) return true;
  }
  return false;
}

export type BoundContinuity = {
  bootstrapHash: string;
  browserLineageId: string;
  currentGeneration: number;
  currentRegistryId: string | null;
  state: string;
  validUntil: string | null;
};

function mapContinuityRow(
  hash: string,
  row: Record<string, unknown>,
): BoundContinuity | null {
  if (row.ok !== true) return null;
  const browserLineageId = typeof row.browser_lineage_id === "string" ? row.browser_lineage_id : null;
  if (!browserLineageId) return null;
  return {
    bootstrapHash: hash,
    browserLineageId,
    currentGeneration: Number(row.current_generation ?? 0),
    currentRegistryId: typeof row.current_registry_id === "string" ? row.current_registry_id : null,
    state: typeof row.state === "string" ? row.state : "active",
    validUntil: typeof row.valid_until === "string" ? row.valid_until : null,
  };
}

/**
 * Read-only continuity lookup. Never INSERT / mint roots (R4-F03).
 * Auth, middleware, callback, resolve must use this — not bind.
 */
export async function readBoundBrowserContinuity(
  store: CookieReader,
): Promise<BoundContinuity | null> {
  const mirror = readContinuityMirror(store);
  if (!mirror) return null;
  const admin = createAdminClient();
  if (!admin) return null;
  const hash = hashBootstrapAnchor(mirror);
  const { data, error } = await admin.rpc("vel_broker_lookup_browser_continuity" as never, {
    p_bootstrap_hash: hash,
  } as never);
  if (error || !data || typeof data !== "object") {
    brokerLog("warn", "auth.broker.continuity.lookup_failed", {
      error_code: error?.code ?? "CONTINUITY_LOOKUP_FAILED",
    });
    return null;
  }
  return mapContinuityRow(hash, data as Record<string, unknown>);
}

/** Per-attempt wait under Preview/Supabase multi-10s latency; total budget stays bounded via retries. */
export const CONTINUITY_BIND_ATTEMPT_MS = 25_000;
export const CONTINUITY_BIND_MAX_ATTEMPTS = 3;

const TRANSPORT_CODES = [
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
  "BIND_ATTEMPT_TIMEOUT",
] as const;
const RETRYABLE_BACKEND_CODES = new Set(["57014", "PGRST301", "57P01", "53300"]);

function classifyBindError(error: unknown): {
  category: "transport" | "backend" | "unknown";
  code: string;
  retryable: boolean;
} {
  const row = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = row.cause && typeof row.cause === "object" ? row.cause as Record<string, unknown> : {};
  const backendCodes = ["PGRST202", "PGRST301", "42P01", "42883", "42501", "23505", "57P01", "53300", "57014"];
  // SDK transport errors can flatten the cause into details. Inspect, never copy, text.
  const text = [row.code, cause.code, row.message, row.details].filter((v) => typeof v === "string").join(" ");
  const transport = TRANSPORT_CODES.find((code) => new RegExp(`\\b${code}\\b`).test(text));
  const backend = typeof row.code === "string" && backendCodes.includes(row.code) ? row.code : undefined;
  const category = transport || /fetch failed|network error|timed out|TimeoutError/i.test(text)
    ? "transport"
    : backend
      ? "backend"
      : "unknown";
  const code = transport ?? backend ?? (category === "transport" ? "TRANSPORT" : "BIND_FAILED");
  const retryable =
    category === "transport"
    || (typeof backend === "string" && RETRYABLE_BACKEND_CODES.has(backend))
    || category === "unknown";
  return { category, code, retryable };
}

/** Allowlisted diagnostics only; never emit raw SDK errors, identifiers or payloads. */
function logBindFailure(error: unknown, started: number, attempt?: number) {
  const classified = classifyBindError(error);
  brokerLog("warn", "auth.broker.continuity.bind_failed", {
    stage: "continuity_bind",
    error_category: classified.category,
    error_code: classified.code,
    duration_ms: Math.max(0, Math.round(performance.now() - started)),
    ...(typeof attempt === "number" ? { attempt } : {}),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withAttemptBudget<T>(work: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(Object.assign(new Error("BIND_ATTEMPT_TIMEOUT"), { code: "BIND_ATTEMPT_TIMEOUT" }));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Explicit POST enrollment only — INSERT-capable bind. */
export async function bindBrowserContinuityFromAnchor(
  anchor: string,
  mirrorFromCookie: string | null,
): Promise<{ ok: true; lineageFingerprint: string } | { ok: false; code: string }> {
  if (!ANCHOR_B64URL.test(anchor)) return { ok: false, code: "INVALID_ANCHOR" };
  if (!mirrorFromCookie || mirrorFromCookie !== anchor) {
    return { ok: false, code: "MIRROR_MISMATCH" };
  }
  const admin = createAdminClient();
  if (!admin) return { ok: false, code: "UNAVAILABLE" };
  const hash = hashBootstrapAnchor(anchor);
  const started = performance.now();

  for (let attempt = 1; attempt <= CONTINUITY_BIND_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await withAttemptBudget(
        () => Promise.resolve(admin.rpc("vel_broker_bind_browser_continuity" as never, {
          p_bootstrap_hash: hash,
        } as never)),
        CONTINUITY_BIND_ATTEMPT_MS,
      );
      const { data, error } = result as { data: unknown; error: unknown };
      if (!error && data && typeof data === "object") {
        const row = data as Record<string, unknown>;
        if (row.ok === true) {
          const lineageId = typeof row.browser_lineage_id === "string" ? row.browser_lineage_id : "";
          const fp = createHash("sha256").update(lineageId).digest("hex").slice(0, 16);
          return { ok: true, lineageFingerprint: fp };
        }
        // Semantic reject from RPC — do not retry.
        return { ok: false, code: typeof row.code === "string" ? row.code : "BIND_REJECTED" };
      }
      logBindFailure(error ?? { message: "BIND_FAILED" }, started, attempt);
      const classified = classifyBindError(error ?? { message: "BIND_FAILED" });
      if (!classified.retryable || attempt === CONTINUITY_BIND_MAX_ATTEMPTS) {
        return { ok: false, code: "BIND_FAILED" };
      }
    } catch (error) {
      logBindFailure(error, started, attempt);
      const classified = classifyBindError(error);
      if (!classified.retryable || attempt === CONTINUITY_BIND_MAX_ATTEMPTS) {
        // Fail closed as BIND_FAILED so the client can retry enrollment without a 500 throw.
        return { ok: false, code: "BIND_FAILED" };
      }
    }
    await sleep(250 * attempt);
  }
  return { ok: false, code: "BIND_FAILED" };
}

export async function closeBrowserContinuity(input: {
  bootstrapHash: string;
  expectedRegistryId: string | null;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, code: "UNAVAILABLE" };
  const { data, error } = await admin.rpc("vel_broker_close_browser_continuity" as never, {
    p_bootstrap_hash: input.bootstrapHash,
    p_reset_nonce: randomUUID(),
    p_expected_registry_id: input.expectedRegistryId,
  } as never);
  if (error || !data || typeof data !== "object") return { ok: false, code: "CLOSE_FAILED" };
  const row = data as Record<string, unknown>;
  return row.ok === true ? { ok: true } : { ok: false, code: typeof row.code === "string" ? row.code : "CLOSE_REJECTED" };
}
