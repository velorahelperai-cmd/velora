/**
 * Pure subscription / entitlement evaluation (server clock injectable).
 * Account ≠ company.active ≠ WhatsApp ≠ paid. Security suspend outranks paid.
 */

import type { Clock } from "@/lib/billing/clock";
import { systemClock } from "@/lib/billing/clock";
import type {
  CompanyOperationalStatus,
  SubscriptionSnapshot,
  SubscriptionStatusB,
} from "@/lib/billing/types";

export type EntitlementCapabilities = {
  /** Layer B status after time + flags (not raw DB enum alone). */
  layerB: SubscriptionStatusB;
  neverPaid: boolean;
  periodEnded: boolean;
  /** Within paid period (now < paid_through) and not security-blocked. */
  withinPaidPeriod: boolean;
  liveAi: boolean;
  liveSend: boolean;
  manualSendViaVelora: boolean;
  /** 7-day inbound retention only after a real paid_through end — never for NULL. */
  inboundRetentionEligible: boolean;
  inboundRetentionEndsAt: Date | null;
  securityBlocked: boolean;
  cancelAtPeriodEnd: boolean;
};

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function evaluateSubscriptionEntitlement(input: {
  subscription: SubscriptionSnapshot | null;
  companyStatus: CompanyOperationalStatus;
  clock?: Clock;
}): EntitlementCapabilities {
  const clock = input.clock ?? systemClock;
  const now = clock.now();
  const securityBlocked = input.companyStatus === "suspended";

  if (!input.subscription) {
    return {
      layerB: "unprovisioned",
      neverPaid: true,
      periodEnded: false,
      withinPaidPeriod: false,
      liveAi: false,
      liveSend: false,
      manualSendViaVelora: false,
      inboundRetentionEligible: false,
      inboundRetentionEndsAt: null,
      securityBlocked,
      cancelAtPeriodEnd: false,
    };
  }

  const sub = input.subscription;
  const neverPaid = sub.paidThrough == null;
  const paidThrough = sub.paidThrough;
  const withinPaidPeriod =
    !securityBlocked && paidThrough != null && now.getTime() < paidThrough.getTime();
  const periodEnded = paidThrough != null && now.getTime() >= paidThrough.getTime();

  let inboundRetentionEndsAt: Date | null = null;
  let inboundRetentionEligible = false;
  if (!securityBlocked && periodEnded && paidThrough) {
    inboundRetentionEndsAt = new Date(paidThrough.getTime() + RETENTION_MS);
    inboundRetentionEligible = now.getTime() < inboundRetentionEndsAt.getTime();
  }

  let layerB: SubscriptionStatusB;
  if (neverPaid) {
    layerB =
      sub.status === "awaiting_payment" ? "awaiting_payment" : "unprovisioned";
  } else if (periodEnded) {
    layerB = "ended";
  } else if (sub.cancelAtPeriodEnd || sub.status === "cancel_at_period_end") {
    layerB = "cancel_at_period_end";
  } else if (sub.status === "past_due") {
    layerB = "past_due";
  } else {
    layerB = "active";
  }

  const live = withinPaidPeriod;
  return {
    layerB,
    neverPaid,
    periodEnded,
    withinPaidPeriod,
    liveAi: live,
    liveSend: live,
    manualSendViaVelora: live,
    inboundRetentionEligible,
    inboundRetentionEndsAt,
    securityBlocked,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd || layerB === "cancel_at_period_end",
  };
}

/** Failed renew must not wipe a still-valid paid_through. */
export function applyRenewalFailure(sub: SubscriptionSnapshot): SubscriptionSnapshot {
  if (sub.paidThrough == null) {
    return { ...sub, status: sub.status === "awaiting_payment" ? "awaiting_payment" : "unprovisioned" };
  }
  return {
    ...sub,
    status: "past_due",
  };
}

/** cancel_at_period_end keeps entitlement until paid_through. */
export function applyCancelAtPeriodEnd(sub: SubscriptionSnapshot): SubscriptionSnapshot {
  if (sub.paidThrough == null) {
    return { ...sub, cancelAtPeriodEnd: false, status: "unprovisioned" };
  }
  return {
    ...sub,
    cancelAtPeriodEnd: true,
    status: "cancel_at_period_end",
  };
}
