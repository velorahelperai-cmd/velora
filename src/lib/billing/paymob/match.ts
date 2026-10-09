/**
 * Match a verified Paymob observation to a locked server order.
 * Missing saved providerOrderId ⇒ not matchable; needs reconciliation.
 * Unsigned merchant_order_id / is_live never substitute for signed order.id binding.
 */

import type { VerifiedTransactionObservation } from "@/lib/billing/paymob/callback";

export type ServerOrderBinding = {
  companyId: string;
  orderId: string;
  /** Paymob order id persisted after Intention — required for match. */
  providerOrderId: string | null;
  specialReference: string;
  amountBaisa: number;
  currency: "OMR";
  providerAmount: number | null;
  /** Merchant / integration account ref locked on the order — must be matched. */
  providerAccountRef: string;
  providerEnvironment: "test" | "live";
  integrationId: number;
  /**
   * Documented merchant owner id (matches signed callback `owner`) when account is prepared.
   * Null ⇒ owner match deferred / fail if observation carries owner.
   */
  merchantOwnerId: string | null;
};

export type MatchResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "provider_order_id_missing_needs_reconciliation"
        | "provider_order_mismatch"
        | "currency_mismatch"
        | "amount_mismatch"
        | "integration_mismatch"
        | "provider_account_ref_mismatch"
        | "owner_mismatch"
        | "owner_not_configured"
        | "environment_live_forbidden"
        | "provider_amount_unconfigured"
        | "company_not_from_unsigned_field"
        | "unsigned_fields_cannot_bind";
    };

/**
 * Bind observation using signed order.id + owner + locked server fields.
 * Do not use unsigned merchant_order_id / is_live as primary binding.
 */
export function matchVerifiedObservationToOrder(input: {
  observation: VerifiedTransactionObservation;
  order: ServerOrderBinding;
  companyFromUnsignedField?: boolean;
  /**
   * When true, caller tried to bind solely via unsigned merchant_order_id / is_live
   * because providerOrderId was missing — always rejected.
   */
  unsignedOnlyBindingAttempt?: boolean;
  allowLiveEnvironment?: boolean;
  /** Review only: signed reversal amount may be partial; this never authorizes collection. */
  lifecycleReviewOnly?: boolean;
}): MatchResult {
  if (input.companyFromUnsignedField) {
    return { ok: false, reason: "company_not_from_unsigned_field" };
  }
  if (input.unsignedOnlyBindingAttempt) {
    return { ok: false, reason: "unsigned_fields_cannot_bind" };
  }

  if (input.order.providerOrderId == null || input.order.providerOrderId.trim() === "") {
    return { ok: false, reason: "provider_order_id_missing_needs_reconciliation" };
  }

  if (input.observation.signedOrderId !== input.order.providerOrderId) {
    return { ok: false, reason: "provider_order_mismatch" };
  }

  if (input.order.providerEnvironment === "live" && input.allowLiveEnvironment!==true) {
    return { ok: false, reason: "environment_live_forbidden" };
  }

  if (input.observation.currency !== input.order.currency) {
    return { ok: false, reason: "currency_mismatch" };
  }

  if (input.observation.integrationId !== input.order.integrationId) {
    return { ok: false, reason: "integration_mismatch" };
  }

  const expectedAccount = String(input.order.integrationId);
  if (
    input.order.providerAccountRef.trim() === "" ||
    input.order.providerAccountRef !== expectedAccount
  ) {
    // providerAccountRef must identify the locked integration/account — not an ignored field.
    return { ok: false, reason: "provider_account_ref_mismatch" };
  }

  if (input.order.merchantOwnerId == null || input.order.merchantOwnerId.trim() === "") {
    return { ok: false, reason: "owner_not_configured" };
  }
  if (input.observation.signedOwner !== input.order.merchantOwnerId) {
    return { ok: false, reason: "owner_mismatch" };
  }

  if (input.order.providerAmount == null) {
    return { ok: false, reason: "provider_amount_unconfigured" };
  }
  if (
    !Number.isSafeInteger(input.order.providerAmount) ||
    input.order.providerAmount <= 0 ||
    (input.lifecycleReviewOnly?input.observation.amountCents>input.order.providerAmount:input.observation.amountCents !== input.order.providerAmount)
  ) {
    return { ok: false, reason: "amount_mismatch" };
  }

  return { ok: true };
}
