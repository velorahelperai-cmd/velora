/**
 * WP07A foundation — calendar, activation clock, purchased-first credits.
 * INITIAL clock starts at readiness observation (no backdate / no paid-day loss).
 * Owner/browser readiness booleans are not authority.
 */

import { addCalendarPeriod } from "@/lib/billing/period";
import type { Es02ActivationFoundation, Es02CreditBalanceView, Es02ImmutableOffer } from "./contracts";

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
 * Pure clock reconcile for verified readiness facts only.
 * Start = readiness observation (`now`), never backdated to activation deadline.
 */
export function reconcileInitialActivationClock(input: {
  companyId: string;
  orderGroupId: string;
  paymentConfirmedAt: string;
  entitlementCreatedAt: string;
  offer: Es02ImmutableOffer;
  /** Must come from verified server/native facts — never owner browser claims alone. */
  firstChannelReady: boolean;
  actualAiReady: boolean;
  now: Date;
}): Es02ActivationFoundation {
  const paymentAt = new Date(input.paymentConfirmedAt);
  const deadline = computeActivationDeadline(paymentAt);
  const bothReady = input.firstChannelReady === true && input.actualAiReady === true;
  if (!bothReady) {
    return {
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
      operationalReady: false,
      subscriptionStartedAt: null,
      paidThroughAt: null,
    };
  }
  const started = input.now;
  const paidThrough = computeInitialPaidThrough({
    subscriptionStartedAt: started,
    offer: input.offer,
  });
  return {
    companyId: input.companyId,
    orderGroupId: input.orderGroupId,
    paymentConfirmedAt: input.paymentConfirmedAt,
    entitlementCreatedAt: input.entitlementCreatedAt,
    activationDeadlineAt: deadline.toISOString(),
    bonusDays: ES02_FIRST_PURCHASE_BONUS_DAYS,
    renewalGraceDays: ES02_RENEWAL_GRACE_DAYS,
    termUnit: termUnitFromOffer(input.offer),
    termCount: 1,
    clockState: "active",
    firstChannelReady: true,
    actualAiReady: true,
    operationalReady: true,
    subscriptionStartedAt: started.toISOString(),
    paidThroughAt: paidThrough.toISOString(),
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
