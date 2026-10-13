import type { FinancialQualification } from "@/lib/billing/financial-truth";
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
  /** Server read-only qualification of the receipt and all lifecycle evidence. */
  financial?: FinancialQualification;
  /** Navigation only; persisted locked-order details do not grant entitlement. */
  selection?: { planVersionId: string; amountBaisa: number; currency: "OMR" };
  providerEnvironment?: "test" | "live";
};

export type BillingReturnDisplay =
  | { kind: "verifying"; messageKey: "payment_verifying" }
  | {
      kind: "awaiting_processing";
      messageKey: "payment_stored_awaiting_processing";
      grantsEntitlement: false;
    }
  | { kind: "success"; messageKey: "payment_confirmed"; paidThrough: string | null; environment?: "test" | "live" }
  | { kind: "reversed"; messageKey: "payment_reversed" }
  | { kind: "requires_review"; messageKey: "payment_requires_review" }
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

  const financial = input.row.financial;
  if (financial && (financial.companyId !== input.requestCompanyId || financial.orderId !== input.row.orderId)) return { kind: "unresolved", messageKey: "payment_unresolved" };
  if (financial?.state === "unknown") return { kind: "unresolved", messageKey: "payment_unresolved" };
  if (financial?.state === "reversed") return { kind: "reversed", messageKey: "payment_reversed" };
  if (financial?.state === "requires_review" || (input.row.hasGrant && !financial)) return { kind: "requires_review", messageKey: "payment_requires_review" };
  if (financial?.state === "proven" && financial.collectionProven && financial.paidThrough && financial.environment) {
    return {
      kind: "success",
      messageKey: "payment_confirmed",
      paidThrough: financial.paidThrough,
      environment: financial.environment,
    };
  }

  if (financial?.state === "failed") return { kind: "failed", messageKey: "payment_failed" };
  // A late failure does not override a qualified receipt. Pending/unknown reads
  // likewise cannot promote a bare grant or a browser redirect to success.
  if (financial?.state === "pending") return input.row.successEventStored
    ? { kind: "awaiting_processing", messageKey: "payment_stored_awaiting_processing", grantsEntitlement: false }
    : { kind: "verifying", messageKey: "payment_verifying" };

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
  void _query;
  return false;
}
