/**
 * Inbound storage decision after subscription end (P1 pure contract).
 * Not wired to the live WhatsApp webhook in this phase.
 */

import type { Clock } from "@/lib/billing/clock";
import { systemClock } from "@/lib/billing/clock";
import { requirePositiveIntLimit } from "@/lib/billing/limits";
import { evaluateSubscriptionEntitlement } from "@/lib/billing/subscription-state";
import type {
  CompanyOperationalStatus,
  InboundStorageOutcome,
  SubscriptionSnapshot,
} from "@/lib/billing/types";

export type InboundDecisionInput = {
  subscription: SubscriptionSnapshot | null;
  companyStatus: CompanyOperationalStatus;
  /**
   * Required when evaluating post-expiry retention storage.
   * Missing/invalid ⇒ rejected_by_policy (not stored, not retryable).
   */
  retentionMessageCap: number | null | undefined;
  /** Messages already stored in the retention window (caller-supplied count). */
  retentionMessagesUsed: number;
  /** When true, storage layer failed for an otherwise eligible message. */
  storageFailed?: boolean;
  clock?: Clock;
};

export function decideInboundStorage(input: InboundDecisionInput): InboundStorageOutcome {
  const clock = input.clock ?? systemClock;
  const caps = evaluateSubscriptionEntitlement({
    subscription: input.subscription,
    companyStatus: input.companyStatus,
    clock,
  });

  if (caps.securityBlocked) {
    return {
      outcome: "rejected_by_policy",
      reason: "security_suspended",
      policyCode: "inbound_rejected_security",
    };
  }

  if (caps.withinPaidPeriod) {
    if (input.storageFailed) {
      return { outcome: "retryable_failure", reason: "storage_failed" };
    }
    return { outcome: "stored", reason: "within_paid_period" };
  }

  if (caps.neverPaid) {
    return {
      outcome: "rejected_by_policy",
      reason: "never_paid",
      policyCode: "inbound_rejected_unpaid_retention",
    };
  }

  if (!caps.inboundRetentionEligible) {
    return {
      outcome: "rejected_by_policy",
      reason: "retention_window_elapsed",
      policyCode: "inbound_rejected_unpaid_retention",
    };
  }

  const cap = requirePositiveIntLimit(input.retentionMessageCap);
  if (!cap.ok) {
    return {
      outcome: "rejected_by_policy",
      reason: "retention_cap_not_configured",
      policyCode: "inbound_rejected_limit",
    };
  }

  if (input.retentionMessagesUsed >= cap.value) {
    return {
      outcome: "rejected_by_policy",
      reason: "retention_cap_reached",
      policyCode: "inbound_rejected_limit",
    };
  }

  if (input.storageFailed) {
    return { outcome: "retryable_failure", reason: "storage_failed" };
  }

  return { outcome: "stored", reason: "within_retention_window" };
}

/** Policy rejection must never be logged as a successful store. */
export function isSuccessfulStore(outcome: InboundStorageOutcome): boolean {
  return outcome.outcome === "stored";
}
