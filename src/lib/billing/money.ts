/**
 * Commercial OMR amounts use baisa (1 OMR = 1000 baisa).
 * Paymob "amount"/"amount_cents" conversion stays unconfigured until Oman docs confirm the factor.
 * Do NOT assume cents === baisa.
 *
 * Money must stay exact: reject non-safe Number values, silent rounding, and overflow.
 */

import type { CommercialMoneyOmr } from "@/lib/billing/types";

export const OMR_BAISA_PER_OMR = 1000 as const;

export type PaymobAmountConversion =
  | { configured: false; reason: "paymob_omr_factor_unconfirmed" }
  | {
      configured: true;
      /** Documented only after Paymob Oman confirmation — not enabled in P1/FIX. */
      factorBaisaPerProviderUnit: number;
    };

/** Always unconfigured until product explicitly enables a confirmed factor. */
export function getPaymobAmountConversion(): PaymobAmountConversion {
  return { configured: false, reason: "paymob_omr_factor_unconfirmed" };
}

export type MoneyParseError =
  | "not_omr"
  | "not_integer"
  | "negative"
  | "not_safe_integer"
  | "precision_loss"
  | "invalid_type";

/**
 * Parse commercial baisa from string | bigint | safe number.
 * Strings must be exact non-negative digit sequences (no scientific notation).
 */
export function parseCommercialBaisa(
  raw: string | number | bigint,
): { ok: true; amountBaisa: bigint } | { ok: false; code: MoneyParseError } {
  if (typeof raw === "bigint") {
    if (raw < BigInt(0)) return { ok: false, code: "negative" };
    return { ok: true, amountBaisa: raw };
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!/^\d+$/.test(s)) return { ok: false, code: "not_integer" };
    return { ok: true, amountBaisa: BigInt(s) };
  }
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, code: "invalid_type" };
    if (!Number.isInteger(raw)) return { ok: false, code: "not_integer" };
    if (raw < 0) return { ok: false, code: "negative" };
    // Reject values outside Number.MAX_SAFE_INTEGER — Number.isInteger alone is insufficient
    // (e.g. Number("9007199254740993") silently becomes 9007199254740992).
    if (!Number.isSafeInteger(raw)) return { ok: false, code: "not_safe_integer" };
    return { ok: true, amountBaisa: BigInt(raw) };
  }
  return { ok: false, code: "invalid_type" };
}

export function assertCommercialMoney(money: CommercialMoneyOmr): CommercialMoneyOmr {
  if (money.currency !== "OMR") {
    throw new Error("commercial currency must be OMR");
  }
  const parsed = parseCommercialBaisa(money.amountBaisa);
  if (!parsed.ok) {
    throw new Error(`amountBaisa rejected: ${parsed.code}`);
  }
  // Round-trip: Number projection must not lose precision for values we keep as number in snapshots.
  if (parsed.amountBaisa > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("amountBaisa rejected: not_safe_integer");
  }
  const asNumber = Number(parsed.amountBaisa);
  if (!Number.isSafeInteger(asNumber) || BigInt(asNumber) !== parsed.amountBaisa) {
    throw new Error("amountBaisa rejected: precision_loss");
  }
  return { currency: "OMR", amountBaisa: asNumber };
}

/**
 * Convert commercial baisa → Paymob provider amount.
 * Always refuses while conversion is unconfigured.
 */
export function commercialBaisaToPaymobAmount(amountBaisa: number | bigint | string): {
  ok: false;
  code: "paymob_amount_conversion_unconfigured" | MoneyParseError;
} {
  const parsed = parseCommercialBaisa(amountBaisa);
  if (!parsed.ok) return { ok: false, code: parsed.code };
  void parsed;
  const conv = getPaymobAmountConversion();
  if (!conv.configured) {
    return { ok: false, code: "paymob_amount_conversion_unconfigured" };
  }
  return { ok: false, code: "paymob_amount_conversion_unconfigured" };
}

/** File-size / single-upload caps are not company storage quotas. */
export function singleFileLimitIsCompanyStorageQuota(): false {
  return false;
}
