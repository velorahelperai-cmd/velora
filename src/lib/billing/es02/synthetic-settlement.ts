/**
 * Synthetic settlement evidence builder + fixture gate evaluation.
 * Customer Production path never uses this. Acceptance requires owned-local fixture.
 * Gate binds the ACTUAL admin transport URL (NEXT_PUBLIC_SUPABASE_URL only),
 * plus an explicit owned postgres fixture descriptor — not generic DB env fallbacks.
 */

import { ES02_SYNTHETIC_EVIDENCE_MARKER, es02Uuid, type Es02Result } from "./contracts";

/** Owned local harness database name — not a generic /fixture ownership claim. */
export const ES02_OWNED_FIXTURE_DATABASE = "c1_ui_integration";

export type SyntheticSettlementEvidence = {
  evidence_marker: typeof ES02_SYNTHETIC_EVIDENCE_MARKER;
  authenticity: {
    source: "es02_synthetic_local";
    verified: true;
    method: "synthetic_local_only";
  };
  account_id: string;
  order_id: string;
  payment_attempt_id: string;
  special_reference: string;
  amount_baisa: number;
  currency: "OMR";
  provider_transaction_id: string;
  event_status: "success";
};

export type SyntheticGateReason =
  | "production_node_env"
  | "production_vercel_env"
  | "fixture_flag_unset"
  | "database_not_owned_fixture"
  | "transport_not_loopback"
  | "transport_missing"
  | "paymob_live_enabled"
  | "ok";

/** Explicit owned fixture DB URL only — never DATABASE_URL / SUPABASE_DB_URL / POSTGRES_URL. */
function ownedFixtureDatabaseUrl(env: NodeJS.ProcessEnv): string {
  return (env.VELORA_OWNED_FIXTURE_DATABASE_URL || "").trim();
}

/** Actual createAdminClient transport — matches admin.ts (NEXT_PUBLIC only; no SUPABASE_URL). */
function adminTransportUrl(env: NodeJS.ProcessEnv): string {
  return (env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
}

export function isOwnedLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/**
 * Owned fixture DB proof: postgres/postgresql scheme, loopback host, database name
 * exactly c1_ui_integration. Parse errors fail closed (no regex host fallback).
 */
export function isOwnedFixtureDatabaseUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return false;
    if (!isOwnedLoopbackHost(parsed.hostname)) return false;
    // Entire decoded pathname must be exactly /c1_ui_integration (reject nested paths).
    const pathname = decodeURIComponent(parsed.pathname).replace(/\/+$/, "") || "/";
    return pathname === `/${ES02_OWNED_FIXTURE_DATABASE}`;
  } catch {
    return false;
  }
}

/** @deprecated Prefer isOwnedFixtureDatabaseUrl — retained name for call-site clarity in older tests. */
export function isOwnedLoopbackDatabaseUrl(url: string): boolean {
  return isOwnedFixtureDatabaseUrl(url);
}

/** Admin/PostgREST transport must be loopback http(s); remote https hosts denied. */
export function isOwnedLoopbackAdminTransportUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return isOwnedLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Fixture-only dual fence: owned fixture flag + owned c1_ui_integration postgres URL
 * + loopback NEXT_PUBLIC_SUPABASE_URL + non-production.
 */
export function evaluateSyntheticSettlementGate(
  env: NodeJS.ProcessEnv = process.env,
): { allowed: boolean; reason: SyntheticGateReason } {
  if (env.NODE_ENV === "production") {
    return { allowed: false, reason: "production_node_env" };
  }
  if (env.VERCEL_ENV === "production") {
    return { allowed: false, reason: "production_vercel_env" };
  }
  if (env.PAYMOB_LIVE_ENABLED === "true" || env.PAYMOB_LIVE_ENABLED === "1") {
    return { allowed: false, reason: "paymob_live_enabled" };
  }
  const fixture = (env.VELORA_ES02_OWNED_FIXTURE ?? "").trim().toLowerCase();
  if (fixture !== "1" && fixture !== "true" && fixture !== "yes" && fixture !== "on") {
    return { allowed: false, reason: "fixture_flag_unset" };
  }
  if (!isOwnedFixtureDatabaseUrl(ownedFixtureDatabaseUrl(env))) {
    return { allowed: false, reason: "database_not_owned_fixture" };
  }
  const transport = adminTransportUrl(env);
  if (!transport) {
    return { allowed: false, reason: "transport_missing" };
  }
  if (!isOwnedLoopbackAdminTransportUrl(transport)) {
    return { allowed: false, reason: "transport_not_loopback" };
  }
  return { allowed: true, reason: "ok" };
}

export function buildSyntheticSettlementEvidence(input: {
  accountId: string;
  orderId: string;
  paymentAttemptId: string;
  specialReference: string;
  amountBaisa: number;
  providerTransactionId: string;
  env?: NodeJS.ProcessEnv;
}): Es02Result<SyntheticSettlementEvidence> {
  const gate = evaluateSyntheticSettlementGate(input.env ?? process.env);
  if (!gate.allowed) return { ok: false, code: "SYNTHETIC_DISABLED" };
  if (
    !es02Uuid(input.accountId) ||
    !es02Uuid(input.orderId) ||
    !es02Uuid(input.paymentAttemptId) ||
    typeof input.specialReference !== "string" ||
    input.specialReference.length < 8 ||
    input.specialReference.length > 120 ||
    !Number.isSafeInteger(input.amountBaisa) ||
    input.amountBaisa < 1 ||
    typeof input.providerTransactionId !== "string" ||
    input.providerTransactionId.length < 4 ||
    input.providerTransactionId.length > 120
  ) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  return {
    ok: true,
    data: {
      evidence_marker: ES02_SYNTHETIC_EVIDENCE_MARKER,
      authenticity: {
        source: "es02_synthetic_local",
        verified: true,
        method: "synthetic_local_only",
      },
      account_id: input.accountId,
      order_id: input.orderId,
      payment_attempt_id: input.paymentAttemptId,
      special_reference: input.specialReference,
      amount_baisa: input.amountBaisa,
      currency: "OMR",
      provider_transaction_id: input.providerTransactionId,
      event_status: "success",
    },
  };
}

export function paymobExternalSettlementStatus(): {
  status: "DEFERRED";
  code: "PAYMOB_EXTERNAL_DEFERRED";
} {
  return { status: "DEFERRED", code: "PAYMOB_EXTERNAL_DEFERRED" };
}
