/**
 * Attempted-write acknowledgement classification for ES02 mutating RPCs.
 * Unstructured / contradictory / unrecognized envelopes → status unknown.
 * Recognized explicit business denials → status denied (authoritative).
 */

import type { Es02ActionCode } from "./contracts";

/** Real authoritative denials only — UNKNOWN is an uncertain outcome, not a denial. */
const RECOGNIZED_WRITE_DENY: readonly Es02ActionCode[] = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_INPUT",
  "OFFER_TAMPER",
  "STALE_CAPTURE",
  "FOREIGN_OWNER",
  "ALREADY_PROVISIONED",
  "NOT_SETTLED",
  "DUPLICATE_SETTLEMENT",
  "SYNTHETIC_DISABLED",
  "PAYMOB_EXTERNAL_DEFERRED",
  "UNAVAILABLE",
  "UNCONFIGURED",
  "CONFLICT",
  "RECONCILIATION_REQUIRED",
];

/** Maps a deny code for callers that need an Es02ActionCode; unrecognized → UNKNOWN. */
export function mapAttemptedWriteDenyCode(code: unknown): Es02ActionCode {
  if (typeof code === "string" && (RECOGNIZED_WRITE_DENY as readonly string[]).includes(code)) {
    return code as Es02ActionCode;
  }
  return "UNKNOWN";
}

type FalseWriteAck = { status: "denied"; code: Es02ActionCode } | { status: "unknown" };

/** ok:false → denied only for recognized business codes; unrecognized/UNKNOWN → unknown. */
function classifyFalseWriteAck(code: unknown): FalseWriteAck {
  if (typeof code === "string" && (RECOGNIZED_WRITE_DENY as readonly string[]).includes(code)) {
    return { status: "denied", code: code as Es02ActionCode };
  }
  return { status: "unknown" };
}

function asPlainObject(data: unknown): Record<string, unknown> | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

export type CreateOrderWriteAck =
  | { status: "success"; action: "insert" | "reuse"; data: unknown }
  | { status: "denied"; code: Es02ActionCode }
  | { status: "unknown" };

/** Strict create/reuse acknowledgement after es02_create_account_order was attempted. */
export function classifyCreateOrderWriteAck(data: unknown): CreateOrderWriteAck {
  const row = asPlainObject(data);
  if (!row) return { status: "unknown" };
  if (row.ok === true) {
    if (row.action !== "insert" && row.action !== "reuse") return { status: "unknown" };
    return { status: "success", action: row.action, data: row.data };
  }
  if (row.ok === false) {
    return classifyFalseWriteAck(row.code);
  }
  return { status: "unknown" };
}

export type ProvisionWriteAck =
  | { status: "success"; action: "provisioned" | "reuse"; data: unknown }
  | { status: "denied"; code: Es02ActionCode }
  | { status: "unknown" };

/** Strict provision acknowledgement after es02_provision_owned_purchase was attempted. */
export function classifyProvisionWriteAck(data: unknown): ProvisionWriteAck {
  const row = asPlainObject(data);
  if (!row) return { status: "unknown" };
  if (row.ok === true) {
    if (row.action !== "provisioned" && row.action !== "reuse") return { status: "unknown" };
    return { status: "success", action: row.action, data: row.data };
  }
  if (row.ok === false) {
    return classifyFalseWriteAck(row.code);
  }
  return { status: "unknown" };
}

export type SettleWriteAck =
  | { status: "success"; action: "settled" | "duplicate"; data: unknown }
  | { status: "denied"; code: Es02ActionCode }
  | { status: "unknown" };

/** Strict synthetic settle acknowledgement after mutating RPC was attempted. */
export function classifySettleWriteAck(data: unknown): SettleWriteAck {
  const row = asPlainObject(data);
  if (!row) return { status: "unknown" };
  if (row.ok === true) {
    if (row.action !== "settled" && row.action !== "duplicate") return { status: "unknown" };
    return { status: "success", action: row.action, data: row.data };
  }
  if (row.ok === false) {
    return classifyFalseWriteAck(row.code);
  }
  return { status: "unknown" };
}
