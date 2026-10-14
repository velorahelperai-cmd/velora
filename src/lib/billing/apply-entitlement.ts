/**
 * PURE evaluation model for entitlement application — NOT atomic SQL settlement.
 *
 * This module decides whether evidence would allow a grant in memory.
 * Server-side atomic settlement (RPC that locks order/attempt/sub/grant in one
 * transaction) is a later, explicit phase before any live webhook wiring.
 *
 * Fail-closed: success alone is never enough. Amount, currency, order identity,
 * provider account, environment, and verification flag are required.
 */

import { type Clock, systemClock } from "@/lib/billing/clock";
import { parseCommercialBaisa } from "@/lib/billing/money";
import {
  computePaidThroughAfterPeriod,
  periodFromLockedOrder,
  type BillingPeriod,
} from "@/lib/billing/period";
import type {
  BillingProviderEnvironment,
  LockedOrderSnapshot,
  ProviderEventStatus,
  SubscriptionSnapshot,
} from "@/lib/billing/types";

export type ProviderEventRecord = {
  providerTransactionId: string;
  eventStatus: ProviderEventStatus;
  companyId: string;
  providerEnvironment: BillingProviderEnvironment;
  providerAccountRef: string;
  /** Must match locked order.specialReference / merchant_order_id. */
  specialReference: string;
  /** Commercial baisa claimed by the verified notification — required. */
  amountBaisa: number | bigint | string;
  currency: "OMR";
  /**
   * Server verified provider authenticity (e.g. HMAC). Pure model requires true;
   * unsigned/unverified notifications never apply.
   */
  signatureVerified: boolean;
  observationKey?: string;
};

export type EntitlementApplyDecision =
  | {
      action: "apply";
      previousPaidThrough: Date | null;
      appliedPaidThrough: Date;
      newStatus: "active";
      /** Explicit: pure model only — not a durable settlement receipt. */
      settlement: "pure_model_only";
    }
  | {
      action: "skip";
      reason:
        | "event_not_success"
        | "already_applied_for_transaction"
        | "already_applied_for_order"
        | "company_mismatch"
        | "environment_mismatch"
        | "provider_account_mismatch"
        | "order_reference_mismatch"
        | "order_amount_mismatch"
        | "currency_mismatch"
        | "amount_invalid"
        | "signature_unverified"
        | "evidence_incomplete";
    };

/**
 * Early renew keeps remainder:
 * paid_through_new = max(now, currentPaidThrough) + period
 * Day periods use calendar days; month/year use calendar rules (see period.ts).
 */
export function computePaidThroughAfterSuccessfulPayment(input: {
  now: Date;
  currentPaidThrough: Date | null;
  periodDays?: number;
  period?: BillingPeriod;
}): Date {
  const period =
    input.period ??
    ({ unit: "day", count: input.periodDays ?? 0 } satisfies BillingPeriod);
  return computePaidThroughAfterPeriod({
    now: input.now,
    currentPaidThrough: input.currentPaidThrough,
    period:period.unit==='month'&&period.count===1?{unit:'day',count:30}:period,
  });
}

function evidenceComplete(event: ProviderEventRecord): boolean {
  return (
    typeof event.providerTransactionId === "string" &&
    event.providerTransactionId.trim().length > 0 &&
    typeof event.companyId === "string" &&
    event.companyId.trim().length > 0 &&
    typeof event.providerAccountRef === "string" &&
    event.providerAccountRef.trim().length > 0 &&
    typeof event.specialReference === "string" &&
    event.specialReference.trim().length > 0 &&
    event.currency === "OMR" &&
    event.amountBaisa !== undefined &&
    event.amountBaisa !== null &&
    typeof event.signatureVerified === "boolean"
  );
}

/**
 * Pure fail-closed decision. Does not write the database.
 * Callers must still run a future atomic settlement RPC before treating this as paid.
 */
export function decideEntitlementApplication(input: {
  event: ProviderEventRecord;
  order: LockedOrderSnapshot;
  subscription: SubscriptionSnapshot;
  /** True if billing_entitlement_applications already has this provider_transaction_id. */
  alreadyAppliedForTransaction: boolean;
  /** True if a grant already exists for this purchase order (blocks second txn grant). */
  alreadyAppliedForOrder: boolean;
  clock?: Clock;
}): EntitlementApplyDecision {
  if (input.event.eventStatus !== "success") {
    return { action: "skip", reason: "event_not_success" };
  }
  if (!evidenceComplete(input.event)) {
    return { action: "skip", reason: "evidence_incomplete" };
  }
  if (input.event.signatureVerified !== true) {
    return { action: "skip", reason: "signature_unverified" };
  }
  if (input.alreadyAppliedForTransaction) {
    return { action: "skip", reason: "already_applied_for_transaction" };
  }
  if (input.alreadyAppliedForOrder) {
    return { action: "skip", reason: "already_applied_for_order" };
  }
  if (
    input.event.companyId !== input.order.companyId ||
    input.event.companyId !== input.subscription.companyId
  ) {
    return { action: "skip", reason: "company_mismatch" };
  }
  if (input.event.providerEnvironment !== input.order.providerEnvironment) {
    return { action: "skip", reason: "environment_mismatch" };
  }
  if (input.event.providerAccountRef !== input.order.providerAccountRef) {
    return { action: "skip", reason: "provider_account_mismatch" };
  }
  if (input.event.specialReference !== input.order.specialReference) {
    return { action: "skip", reason: "order_reference_mismatch" };
  }
  if (input.event.currency !== input.order.currency) {
    return { action: "skip", reason: "currency_mismatch" };
  }

  const parsed = parseCommercialBaisa(input.event.amountBaisa);
  if (!parsed.ok) {
    return { action: "skip", reason: "amount_invalid" };
  }
  const orderParsed = parseCommercialBaisa(input.order.amountBaisa);
  if (!orderParsed.ok || parsed.amountBaisa !== orderParsed.amountBaisa) {
    return { action: "skip", reason: "order_amount_mismatch" };
  }

  const clock = input.clock ?? systemClock;
  const previousPaidThrough = input.subscription.paidThrough;
  const appliedPaidThrough = computePaidThroughAfterSuccessfulPayment({
    now: clock.now(),
    currentPaidThrough: previousPaidThrough,
    period: periodFromLockedOrder(input.order),
  });

  return {
    action: "apply",
    previousPaidThrough,
    appliedPaidThrough,
    newStatus: "active",
    settlement: "pure_model_only",
  };
}

/** Pure apply onto an in-memory subscription snapshot (no DB). */
export function applyEntitlementToSubscription(
  sub: SubscriptionSnapshot,
  decision: Extract<EntitlementApplyDecision, { action: "apply" }>,
  planVersionId: string,
): SubscriptionSnapshot {
  return {
    ...sub,
    planVersionId,
    paidThrough: decision.appliedPaidThrough,
    status: "active",
    cancelAtPeriodEnd: false,
  };
}

export type ProviderEventScope = {
  provider: string;
  providerAccountRef: string;
  providerEnvironment: BillingProviderEnvironment;
  providerTransactionId: string;
};

/**
 * Whether a new observation may be recorded.
 * Scope is provider + account + environment + transaction.
 * Same status with a different observationKey is allowed (e.g. refund notice).
 * Exact duplicate (same scope + status + observationKey) is rejected.
 */
export function canInsertProviderEvent(input: {
  existing: ReadonlyArray<{
    scope: ProviderEventScope;
    eventStatus: ProviderEventStatus;
    observationKey: string;
  }>;
  next: {
    scope: ProviderEventScope;
    eventStatus: ProviderEventStatus;
    observationKey: string;
  };
}):
  | { ok: true }
  | { ok: false; reason: "duplicate_observation" } {
  const hit = input.existing.some(
    (row) =>
      row.scope.provider === input.next.scope.provider &&
      row.scope.providerAccountRef === input.next.scope.providerAccountRef &&
      row.scope.providerEnvironment === input.next.scope.providerEnvironment &&
      row.scope.providerTransactionId === input.next.scope.providerTransactionId &&
      row.eventStatus === input.next.eventStatus &&
      row.observationKey === input.next.observationKey,
  );
  if (hit) return { ok: false, reason: "duplicate_observation" };
  return { ok: true };
}
