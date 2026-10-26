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

/** Allowlisted diagnostics only; never emit raw SDK errors, identifiers or payloads. */
function logBindFailure(error: unknown, started: number) {
  const row = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = row.cause && typeof row.cause === "object" ? row.cause as Record<string, unknown> : {};
  const transportCodes = ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_SOCKET"];
  const backendCodes = ["PGRST202", "PGRST301", "42P01", "42883", "42501", "23505", "57P01", "53300"];
  // SDK transport errors can flatten the cause into details. Inspect, never copy, text.
  const text = [row.code, cause.code, row.message, row.details].filter(v => typeof v === "string").join(" ");
  const transport = transportCodes.find(code => new RegExp(`\\b${code}\\b`).test(text));
  const backend = typeof row.code === "string" && backendCodes.includes(row.code) ? row.code : undefined;
  const category = transport || /fetch failed|network error/i.test(text) ? "transport" : backend ? "backend" : "unknown";
  brokerLog("warn", "auth.broker.continuity.bind_failed", {
    stage: "continuity_bind",
    error_category: category,
    error_code: transport ?? backend ?? (category === "transport" ? "TRANSPORT" : "BIND_FAILED"),
    duration_ms: Math.max(0, Math.round(performance.now() - started)),
  });
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
  const result = await (async () => {
    try {
      return await admin.rpc("vel_broker_bind_browser_continuity" as never, {
        p_bootstrap_hash: hash,
      } as never);
    } catch (error) {
      logBindFailure(error, started);
      throw error;
    }
  })();
  const { data, error } = result;
  if (error || !data || typeof data !== "object") {
    logBindFailure(error, started);
    return { ok: false, code: "BIND_FAILED" };
  }
  const row = data as Record<string, unknown>;
  if (row.ok !== true) {
    return { ok: false, code: typeof row.code === "string" ? row.code : "BIND_REJECTED" };
  }
  const lineageId = typeof row.browser_lineage_id === "string" ? row.browser_lineage_id : "";
  const fp = createHash("sha256").update(lineageId).digest("hex").slice(0, 16);
  return { ok: true, lineageFingerprint: fp };
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
