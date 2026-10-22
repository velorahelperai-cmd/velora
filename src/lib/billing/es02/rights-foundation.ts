/**
 * WP07A foundation — calendar, activation clock, purchased-first credits.
 * INITIAL clock starts at the first native provider-accepted real-customer reply.
 * Owner/browser readiness booleans are not authority.
 */

import { addCalendarPeriod } from "@/lib/billing/period";
import { es02Uuid, type Es02ActivationFoundation, type Es02CreditBalanceView, type Es02ImmutableOffer } from "./contracts";

export const ES02_INITIAL_ACTIVATION_DAYS = 7 as const;
export const ES02_FIRST_PURCHASE_BONUS_DAYS = 7 as const;
export const ES02_RENEWAL_GRACE_DAYS = 3 as const;

export function termUnitFromOffer(offer: Es02ImmutableOffer): "month" | "year" {
  return offer.term === "yearly" ? "year" : "month";
}

export function computeActivationDeadline(paymentConfirmedAt: Date): Date {
  return addCalendarPeriod(paymentConfirmedAt, { unit: "day", count: ES02_INITIAL_ACTIVATION_DAYS });
}

export function computeInitialPaidThrough(input: {
  subscriptionStartedAt: Date;
  offer: Es02ImmutableOffer;
}): Date {
  const afterTerm = addCalendarPeriod(input.subscriptionStartedAt, {
    unit: termUnitFromOffer(input.offer),
    count: 1,
  });
  return addCalendarPeriod(afterTerm, { unit: "day", count: ES02_FIRST_PURCHASE_BONUS_DAYS });
}

/**
 * Projection of a receipt already verified by the trusted native settlement path.
 * This type/calculator does not authenticate a caller, verify a provider response,
 * or make a browser-supplied object authoritative. The database must verify the
 * claim, immutable native job/intent/AI receipt and trusted test-number provenance
 * under its company lock before supplying its FIRST accepted operational receipt.
 */
export type Es02AcceptedOperationalReplyProof = {
  authority: "native_provider_acceptance";
  companyId: string;
  orderGroupId: string;
  jobId: string;
  intentId: string;
  providerMessageId: string;
  acceptedAt: string;
  usageMode: "company_live" | "setup_trial";
  recipientClass: "real_customer" | "test_number" | "unknown";
};

/**
 * Readiness permits operation but never starts paid time by itself. Only a bound
 * real-customer operational acceptance does; test numbers and setup trials do not.
 * Existing persisted clock dates remain immutable during replay/readiness loss.
 * This is a pure projection, not the database's settlement/authorization boundary.
 */
export function reconcileInitialActivationClock(input: {
  companyId: string;
  orderGroupId: string;
  paymentConfirmedAt: string;
  entitlementCreatedAt: string;
  offer: Es02ImmutableOffer;
  /** Verified native readiness facts, never owner/browser booleans alone. */
  firstChannelReady: boolean;
  actualAiReady: boolean;
  acceptedOperationalReply?: Es02AcceptedOperationalReplyProof | null;
  /** Existing native foundation for this exact company and original order group. */
  existing?: Es02ActivationFoundation | null;
  now: Date;
}): Es02ActivationFoundation {
  const paymentAt = new Date(input.paymentConfirmedAt);
  const entitlementAt = new Date(input.entitlementCreatedAt);
  if (!Number.isFinite(input.now.getTime()) || !Number.isFinite(entitlementAt.getTime())) {
    throw Error("INVALID_ACTIVATION_TIME");
  }
  const deadline = computeActivationDeadline(paymentAt);
  const bothReady = input.firstChannelReady === true && input.actualAiReady === true;
  const projection: Es02ActivationFoundation = {
    companyId: input.companyId,
    orderGroupId: input.orderGroupId,
    paymentConfirmedAt: input.paymentConfirmedAt,
    entitlementCreatedAt: input.entitlementCreatedAt,
    activationDeadlineAt: deadline.toISOString(),
    bonusDays: ES02_FIRST_PURCHASE_BONUS_DAYS,
    renewalGraceDays: ES02_RENEWAL_GRACE_DAYS,
    termUnit: termUnitFromOffer(input.offer),
    termCount: 1,
    clockState: "waiting_readiness",
    firstChannelReady: input.firstChannelReady === true,
    actualAiReady: input.actualAiReady === true,
    operationalReady: bothReady,
    subscriptionStartedAt: null,
    paidThroughAt: null,
  };
  const existing = input.existing;
  if (existing) {
    if (existing.companyId !== input.companyId || existing.orderGroupId !== input.orderGroupId) {
      throw Error("ACTIVATION_SCOPE_MISMATCH");
    }
    if (existing.clockState === "active" || existing.clockState === "ended") {
      const start = Date.parse(existing.subscriptionStartedAt ?? "");
      const through = Date.parse(existing.paidThroughAt ?? "");
      if (!Number.isFinite(start) || !Number.isFinite(through) || through <= start) {
        throw Error("INVALID_EXISTING_ACTIVATION_CLOCK");
      }
      return {
        ...existing,
        firstChannelReady: projection.firstChannelReady,
        actualAiReady: projection.actualAiReady,
        operationalReady: bothReady && existing.clockState === "active",
      };
    }
  }
  const proof = input.acceptedOperationalReply;
  // The trusted dispatch path established readiness before sending. Revocation
  // afterward stops new work but cannot erase an already accepted real reply.
  if (!proof || proof.authority !== "native_provider_acceptance"
    || proof.companyId !== input.companyId || proof.orderGroupId !== input.orderGroupId
    || proof.usageMode !== "company_live" || proof.recipientClass !== "real_customer"
    || !es02Uuid(proof.jobId) || !es02Uuid(proof.intentId)
    || typeof proof.providerMessageId !== "string" || !proof.providerMessageId
    || proof.providerMessageId.length > 512 || /[\s\u0000-\u001f]/.test(proof.providerMessageId)) {
    return projection;
  }
  const acceptedAt = typeof proof.acceptedAt === "string" ? new Date(proof.acceptedAt) : new Date(NaN);
  if (!Number.isFinite(acceptedAt.getTime()) || acceptedAt < paymentAt || acceptedAt < entitlementAt || acceptedAt > input.now) {
    return projection;
  }
  return {
    ...projection,
    clockState: "active",
    subscriptionStartedAt: acceptedAt.toISOString(),
    paidThroughAt: computeInitialPaidThrough({ subscriptionStartedAt: acceptedAt, offer: input.offer }).toISOString(),
  };
}

export function buildInitialCreditBalances(input: {
  companyId: string;
  orderGroupId: string;
  baseReplies: number;
  purchasedReplies?: number;
}): Es02CreditBalanceView[] {
  const base: Es02CreditBalanceView = {
    companyId: input.companyId,
    orderGroupId: input.orderGroupId,
    kind: "base",
    granted: input.baseReplies,
    remaining: input.baseReplies,
    ordinaryExpiry: null,
  };
  const purchasedUnits = input.purchasedReplies ?? 0;
  if (purchasedUnits < 1) return [base];
  return [
    {
      companyId: input.companyId,
      orderGroupId: input.orderGroupId,
      kind: "purchased",
      granted: purchasedUnits,
      remaining: purchasedUnits,
      ordinaryExpiry: null,
    },
    base,
  ];
}

export function consumeCreditsPurchasedFirst(
  balances: readonly Es02CreditBalanceView[],
  units: number,
): { ok: true; next: Es02CreditBalanceView[] } | { ok: false; code: "INSUFFICIENT" | "INVALID_INPUT" } {
  if (!Number.isSafeInteger(units) || units < 1) return { ok: false, code: "INVALID_INPUT" };
  const next = balances.map((b) => ({ ...b }));
  let left = units;
  for (const kind of ["purchased", "base"] as const) {
    const row = next.find((b) => b.kind === kind);
    if (!row || row.remaining < 1) continue;
    const take = Math.min(row.remaining, left);
    row.remaining -= take;
    left -= take;
    if (left === 0) break;
  }
  if (left > 0) return { ok: false, code: "INSUFFICIENT" };
  return { ok: true, next };
}

export const ES02_DISABLED_EDGE_POLICIES = [
  "extra_reply_price",
  "extra_reply_bundle",
  "extra_reply_refund",
  "post_base_spending_extension",
  "bonus_quota_anchor_remedy",
] as const;

export function isEdgePolicyEnabled(_policy: (typeof ES02_DISABLED_EDGE_POLICIES)[number]): false {
  return false;
}
