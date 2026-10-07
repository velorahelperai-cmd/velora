/**
 * Server entitlement snapshot. Account ≠ active company ≠ verified WhatsApp ≠ paid plan.
 * P1: readCompanyEntitlement stays fail-closed (no DB wiring). Evaluation helpers are pure.
 *
 * Recorded product decisions (not implemented as prices/grace/refund/deletion):
 * - Team-provisioned onboarding starts after payment.
 * - Self-serve pays after relevant Meta requirements are complete.
 * - VEL-SUBSCRIPTION-SINGLE-PRODUCT-FIX-01: one Velora AI staff product per company;
 *   3 personas = tiers of that product; monthly/yearly = billing cycle; upgrade
 *   proration/collection remains a separate unconfigured decision.
 */

import type { EntitlementCapabilities } from "@/lib/billing/subscription-state";
import { evaluateSubscriptionEntitlement } from "@/lib/billing/subscription-state";
import type { CompanyOperationalStatus, SubscriptionSnapshot } from "@/lib/billing/types";
import type { Clock } from "@/lib/billing/clock";

export type EntitlementStatus = "not_configured" | "evaluated";

export type EntitlementSnapshot = {
  status: EntitlementStatus;
  paid: boolean;
  liveSendAllowed: boolean;
  liveAnswerAllowed: boolean;
  source: "none" | "subscription";
};

/** Fail-closed until P2 wires subscription reads. */
export function readCompanyEntitlement(companyId: string | null): EntitlementSnapshot {
  void companyId;
  return {
    status: "not_configured",
    paid: false,
    liveSendAllowed: false,
    liveAnswerAllowed: false,
    source: "none",
  };
}

export function entitlementAllowsAutomation(snapshot: EntitlementSnapshot): boolean {
  return snapshot.paid && snapshot.liveSendAllowed && snapshot.liveAnswerAllowed;
}

export function entitlementSnapshotFromCapabilities(
  caps: EntitlementCapabilities,
): EntitlementSnapshot {
  const live = caps.withinPaidPeriod;
  return {
    status: "evaluated",
    paid: live,
    liveSendAllowed: caps.manualSendViaVelora,
    liveAnswerAllowed: caps.liveAi,
    source: "subscription",
  };
}

/**
 * Evaluate at execution time (send/AI/inbound) — must not rely on cron alone.
 */
export function evaluateCompanyEntitlement(input: {
  subscription: SubscriptionSnapshot | null;
  companyStatus: CompanyOperationalStatus;
  clock?: Clock;
}): EntitlementSnapshot {
  const caps = evaluateSubscriptionEntitlement(input);
  return entitlementSnapshotFromCapabilities(caps);
}
