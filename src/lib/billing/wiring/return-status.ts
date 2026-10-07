/**
 * Return-page status — DB only. Query params never grant entitlement.
 * HTTP 200 on webhook ≠ subscription complete.
 */

export type BillingReturnDbRow = {
  companyId: string;
  orderId: string;
  orderStatus: string;
  attemptStatus: string | null;
  latestEventStatus: "pending" | "success" | "failed" | "other" | null;
  hasGrant: boolean;
  paidThrough: string | null;
  /** Success provider event persisted for this attempt. */
  successEventStored: boolean;
  /** Event saved; settlement/processing not finished (no grant yet). */
  awaitingProcessing: boolean;
};

export type BillingReturnDisplay =
  | { kind: "verifying"; messageKey: "payment_verifying" }
  | {
      kind: "awaiting_processing";
      messageKey: "payment_stored_awaiting_processing";
      grantsEntitlement: false;
    }
  | { kind: "success"; messageKey: "payment_confirmed"; paidThrough: string | null }
  | { kind: "failed"; messageKey: "payment_failed" }
  | { kind: "unresolved"; messageKey: "payment_unresolved" }
  | { kind: "forbidden"; messageKey: "order_not_found" };

export function mapBillingReturnDisplay(input: {
  requestCompanyId: string;
  row: BillingReturnDbRow | null;
}): BillingReturnDisplay {
  if (!input.row || input.row.companyId !== input.requestCompanyId) {
    return { kind: "forbidden", messageKey: "order_not_found" };
  }

  if (input.row.hasGrant) {
    return {
      kind: "success",
      messageKey: "payment_confirmed",
      paidThrough: input.row.paidThrough,
    };
  }

  if (input.row.awaitingProcessing) {
    return {
      kind: "awaiting_processing",
      messageKey: "payment_stored_awaiting_processing",
      grantsEntitlement: false,
    };
  }

  if (input.row.latestEventStatus === "failed") {
    return { kind: "failed", messageKey: "payment_failed" };
  }

  if (input.row.latestEventStatus === "pending" || input.row.attemptStatus === "provider_submitted") {
    return { kind: "verifying", messageKey: "payment_verifying" };
  }

  if (input.row.latestEventStatus === "success" && !input.row.hasGrant) {
    return {
      kind: "awaiting_processing",
      messageKey: "payment_stored_awaiting_processing",
      grantsEntitlement: false,
    };
  }

  return { kind: "unresolved", messageKey: "payment_unresolved" };
}

/** Explicit: URL query success/hmac must not flip entitlement. */
export function redirectionQueryGrantsEntitlement(_query: Record<string, string | undefined>): false {
  return false;
}
