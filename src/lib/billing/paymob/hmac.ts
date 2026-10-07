/**
 * Paymob transaction callback HMAC (official field order + SHA-512).
 * Does NOT verify raw POST body signatures from other providers.
 * Missing / null signed fields → reject or isolate (null encoding undocumented).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/** Official HMAC string keys for Transaction Processed (POST) — values from obj. */
export const PAYMOB_HMAC_PROCESSED_KEYS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

/** Response (GET) uses flat id / order_id instead of obj paths. */
export const PAYMOB_HMAC_RESPONSE_KEYS = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order_id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
] as const;

export type PaymobHmacChannel = "processed_post" | "response_get";

export type HmacFieldSource = Record<string, unknown>;

function readPath(obj: HmacFieldSource, path: string): unknown {
  if (!path.includes(".")) return obj[path];
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Encode a signed field value for concatenation.
 * Official docs do not document null encoding → treat null/undefined as incomplete.
 */
export function encodeHmacFieldValue(
  value: unknown,
): { ok: true; text: string } | { ok: false; reason: "missing_or_null" | "unsupported_type" } {
  if (value === null || value === undefined) {
    return { ok: false, reason: "missing_or_null" };
  }
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint") {
    return { ok: true, text: String(value) };
  }
  if (typeof value === "string") {
    return { ok: true, text: value };
  }
  return { ok: false, reason: "unsupported_type" };
}

export function buildPaymobHmacConcatString(
  channel: PaymobHmacChannel,
  source: HmacFieldSource,
):
  | { ok: true; concat: string }
  | { ok: false; reason: "incomplete_signed_fields"; missing: string[] } {
  const keys =
    channel === "processed_post" ? PAYMOB_HMAC_PROCESSED_KEYS : PAYMOB_HMAC_RESPONSE_KEYS;
  const missing: string[] = [];
  const parts: string[] = [];
  for (const key of keys) {
    const raw =
      channel === "processed_post"
        ? key === "id"
          ? source.id
          : key === "order.id"
            ? readPath(source, "order.id")
            : readPath(source, key)
        : source[key];
    const enc = encodeHmacFieldValue(raw);
    if (!enc.ok) {
      missing.push(key);
      continue;
    }
    parts.push(enc.text);
  }
  if (missing.length > 0) {
    return { ok: false, reason: "incomplete_signed_fields", missing };
  }
  return { ok: true, concat: parts.join("") };
}

export function computePaymobHmacSha512(secret: string, concat: string): string {
  return createHmac("sha512", secret).update(concat, "utf8").digest("hex");
}

/** Constant-time hex compare; rejects length mismatch without leaking. */
export function safeEqualHex(a: string, b: string): boolean {
  const aa = a.trim().toLowerCase();
  const bb = b.trim().toLowerCase();
  if (aa.length === 0 || bb.length === 0) return false;
  if (aa.length !== bb.length) return false;
  try {
    return timingSafeEqual(Buffer.from(aa, "utf8"), Buffer.from(bb, "utf8"));
  } catch {
    return false;
  }
}

export type VerifyHmacResult =
  | { ok: true; concat: string; digest: string }
  | {
      ok: false;
      reason:
        | "incomplete_signed_fields"
        | "hmac_mismatch"
        | "hmac_missing"
        | "secret_missing";
      missing?: string[];
    };

export function verifyPaymobTransactionHmac(input: {
  channel: PaymobHmacChannel;
  /** For processed_post: the `obj` object. For response_get: flat query map. */
  fieldSource: HmacFieldSource;
  providedHmac: string | null | undefined;
  hmacSecret: string;
}): VerifyHmacResult {
  if (!input.hmacSecret || input.hmacSecret.trim().length === 0) {
    return { ok: false, reason: "secret_missing" };
  }
  if (input.providedHmac == null || String(input.providedHmac).trim() === "") {
    return { ok: false, reason: "hmac_missing" };
  }
  const built = buildPaymobHmacConcatString(input.channel, input.fieldSource);
  if (!built.ok) {
    return { ok: false, reason: "incomplete_signed_fields", missing: built.missing };
  }
  const digest = computePaymobHmacSha512(input.hmacSecret, built.concat);
  if (!safeEqualHex(digest, String(input.providedHmac))) {
    return { ok: false, reason: "hmac_mismatch" };
  }
  return { ok: true, concat: built.concat, digest };
}
