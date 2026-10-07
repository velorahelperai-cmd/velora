/**
 * Explicit early renew — never implied by "buy again" while subscribed.
 */

import { computePaidThroughAfterPeriod, type BillingPeriod } from "@/lib/billing/period";
import type { Clock } from "@/lib/billing/clock";
import { systemClock } from "@/lib/billing/clock";
import type { EarlyRenewConfirmation } from "@/lib/billing/wiring/purchase-gate";

export type EarlyRenewQuote = {
  amountBaisa: number;
  currency: "OMR";
  period: BillingPeriod;
  currentPaidThroughIso: string | null;
  projectedPaidThroughIso: string;
};

export function buildEarlyRenewQuote(input: {
  amountBaisa: number;
  period: BillingPeriod;
  currentPaidThrough: Date | null;
  clock?: Clock;
}): EarlyRenewQuote {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const projected = computePaidThroughAfterPeriod({
    now,
    currentPaidThrough: input.currentPaidThrough,
    period: input.period,
  });
  return {
    amountBaisa: input.amountBaisa,
    currency: "OMR",
    period: input.period,
    currentPaidThroughIso: input.currentPaidThrough?.toISOString() ?? null,
    projectedPaidThroughIso: projected.toISOString(),
  };
}

/** Client must echo the quote; server rebuilds and compares. */
export function confirmationFromQuote(quote: EarlyRenewQuote): EarlyRenewConfirmation {
  return {
    amountBaisa: quote.amountBaisa,
    periodUnit: quote.period.unit,
    periodCount: quote.period.count,
    projectedPaidThroughIso: quote.projectedPaidThroughIso,
  };
}

/**
 * Fingerprint for renew client_op uniqueness — separate from initial subscribe ops.
 * Same renew intent + same quote → same fingerprint material for conflict detection.
 */
export function earlyRenewClientOpFingerprint(input: {
  companyId: string;
  planVersionId: string;
  projectedPaidThroughIso: string;
  amountBaisa: number;
}): string {
  return [
    "early_renew",
    input.companyId,
    input.planVersionId,
    String(input.amountBaisa),
    input.projectedPaidThroughIso,
  ].join("|");
}
