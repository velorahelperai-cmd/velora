/**
 * Process stored provider events → optional atomic settlement.
 * Preserves RPC semantic outcomes — never collapse review into settled/granted.
 */

import { buildPaymobHmacSettlementEvidence } from "@/lib/billing/wiring/settlement-bridge";

export type StoredProviderEvent = {
  id: string;
  companyId: string;
  orderId: string;
  paymentAttemptId: string;
  providerTransactionId: string;
  eventStatus: "pending" | "success" | "failed" | "other" | "refunded" | "voided";
  providerEnvironment?:"test"|"live";
  providerAccountRef: string;
  specialReference: string;
  amountBaisa: number;
  observationKey: string;
};

/** Semantic process outcomes — distinct from HTTP webhook status. */
export type ProcessEventOutcome =
  | "skipped_pending"
  | "skipped_failed"
  | "settle_disabled"
  | "granted"
  | "idempotent_replay"
  | "duplicate_collection_review";
// Durable review is neither entitlement nor delivery failure.
type ReviewOutcome="lifecycle_review"|"late_payment_review"|"deadline_policy_review";

export type ProcessEventResult =
  | { ok: true; outcome: ProcessEventOutcome | ReviewOutcome }
  | { ok: false; code: string };

export type ProcessEventDeps = {
  settleEnabled: boolean;
  settleHmacVerified: (evidence: Record<string, unknown>) => Promise<
    | { ok: true; outcome: string }
    | { ok: false; code: string }
  >;
};

function mapSuccessfulSettleOutcome(raw: string): ProcessEventOutcome | ReviewOutcome | null {
  switch (raw) {
    case "granted":
      return "granted";
    case "idempotent_replay":
      return "idempotent_replay";
    case "duplicate_collection_review":
      return "duplicate_collection_review";
    case "lifecycle_review":case "late_payment_review":case "deadline_policy_review":return raw;
    // Legacy aliases from older callers/tests — map explicitly, never treat review as grant.
    case "settled":
      return "granted";
    case "already_settled":
      return "idempotent_replay";
    default:
      return null;
  }
}

export async function processStoredPaymobEvent(input: {
  deps: ProcessEventDeps;
  event: StoredProviderEvent;
}): Promise<ProcessEventResult> {
  if (input.event.eventStatus === "pending") {
    return { ok: true, outcome: "skipped_pending" };
  }
  if (!["success","refunded","voided"].includes(input.event.eventStatus)) {
    return { ok: true, outcome: "skipped_failed" };
  }
  if (!input.deps.settleEnabled) {
    return { ok: true, outcome: "settle_disabled" };
  }

  const evidence = buildPaymobHmacSettlementEvidence({
    companyId: input.event.companyId,
    orderId: input.event.orderId,
    paymentAttemptId: input.event.paymentAttemptId,
    providerAccountRef: input.event.providerAccountRef,
    providerTransactionId: input.event.providerTransactionId,
    specialReference: input.event.specialReference,
    amountBaisa: input.event.amountBaisa,
    observationKey: input.event.observationKey,
    providerEnvironment:input.event.providerEnvironment,
    eventStatus:input.event.eventStatus as "success"|"refunded"|"voided",
  });

  const settled = await input.deps.settleHmacVerified(evidence);
  if (!settled.ok) {
    if (
      settled.code === "idempotent_replay" ||
      settled.code === "already_settled"
    ) {
      return { ok: true, outcome: "idempotent_replay" };
    }
    if (settled.code === "duplicate_collection_review") {
      // Fail-closed reporting if a port surfaces review as error code.
      return { ok: true, outcome: "duplicate_collection_review" };
    }
    return { ok: false, code: settled.code };
  }

  const mapped = mapSuccessfulSettleOutcome(settled.outcome);
  if (!mapped) {
    return { ok: false, code: `unknown_settle_outcome:${settled.outcome}` };
  }
  return { ok: true, outcome: mapped };
}
