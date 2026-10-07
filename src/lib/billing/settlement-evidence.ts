/**
 * Server settlement evidence contract.
 *
 * Production RPC `billing_settle_verified_payment` rejects synthetic markers and live env;
 * provider HMAC is not implemented (no alternate grant path).
 *
 * Authorized test DBs may install artifact helper
 * `billing_settle_synthetic_test_payment` (not in production migrations).
 * Absence of that function on production is the hard boundary — not a GUC/flag.
 */

import type { BillingProviderEnvironment } from "@/lib/billing/types";

/** Accepted only by the authorized-test helper artifact — never by production RPC. */
export const SETTLEMENT_SYNTHETIC_EVIDENCE_MARKER =
  "VEL_BILLING_SYNTHETIC_TEST_EVIDENCE" as const;

/** Reserved for the future server adapter after real HMAC verification. */
export const SETTLEMENT_SERVER_ADAPTER_SOURCE =
  "server_adapter_attestation" as const;

export type SettlementAuthenticityMethod =
  | "synthetic_test_only"
  | "paymob_hmac_sha512";

export type SettlementAuthenticity = {
  /** Must be server_adapter_attestation — not a browser flag. */
  source: typeof SETTLEMENT_SERVER_ADAPTER_SOURCE;
  verified: true;
  method: SettlementAuthenticityMethod;
};

/**
 * Evidence the Paymob server converter will pass after verification.
 * Provider I/O is out of scope for this package; fields mirror the locked order.
 */
export type SettlementEvidence = {
  evidenceMarker: typeof SETTLEMENT_SYNTHETIC_EVIDENCE_MARKER | string;
  authenticity: SettlementAuthenticity;
  companyId: string;
  orderId: string;
  paymentAttemptId: string;
  provider: "paymob";
  providerAccountRef: string;
  providerEnvironment: BillingProviderEnvironment;
  providerTransactionId: string;
  specialReference: string;
  amountBaisa: number;
  currency: "OMR";
  eventStatus: "success";
  observationKey?: string;
  /** Provider observation time (audit only) — never used to backdate paid_through. */
  observedAt?: string;
};

export type SettlementEvidenceJson = {
  evidence_marker: string;
  authenticity: {
    source: string;
    verified: boolean;
    method: string;
  };
  company_id: string;
  order_id: string;
  payment_attempt_id: string;
  provider: string;
  provider_account_ref: string;
  provider_environment: string;
  provider_transaction_id: string;
  special_reference: string;
  amount_baisa: number;
  currency: string;
  event_status: string;
  observation_key?: string;
  observed_at?: string;
  /**
   * Explicitly rejected if present as sole/browser proof.
   * Server adapters must omit this key; use authenticity instead.
   */
  signature_verified?: unknown;
  /** Synthetic tests only — forces mid-transaction failure before commit. */
  _test_fail_after?: "before_grant" | "before_paid_through";
};

export function toSettlementEvidenceJson(
  evidence: SettlementEvidence,
  options?: { testFailAfter?: "before_grant" | "before_paid_through" },
): SettlementEvidenceJson {
  const json: SettlementEvidenceJson = {
    evidence_marker: evidence.evidenceMarker,
    authenticity: {
      source: evidence.authenticity.source,
      verified: evidence.authenticity.verified,
      method: evidence.authenticity.method,
    },
    company_id: evidence.companyId,
    order_id: evidence.orderId,
    payment_attempt_id: evidence.paymentAttemptId,
    provider: evidence.provider,
    provider_account_ref: evidence.providerAccountRef,
    provider_environment: evidence.providerEnvironment,
    provider_transaction_id: evidence.providerTransactionId,
    special_reference: evidence.specialReference,
    amount_baisa: evidence.amountBaisa,
    currency: evidence.currency,
    event_status: evidence.eventStatus,
  };
  if (evidence.observationKey) json.observation_key = evidence.observationKey;
  if (evidence.observedAt) json.observed_at = evidence.observedAt;
  if (options?.testFailAfter) json._test_fail_after = options.testFailAfter;
  return json;
}

export function buildSyntheticSettlementEvidence(
  partial: Omit<SettlementEvidence, "evidenceMarker" | "authenticity" | "provider" | "eventStatus" | "currency"> &
    Partial<Pick<SettlementEvidence, "provider" | "eventStatus" | "currency">>,
): SettlementEvidence {
  return {
    evidenceMarker: SETTLEMENT_SYNTHETIC_EVIDENCE_MARKER,
    authenticity: {
      source: SETTLEMENT_SERVER_ADAPTER_SOURCE,
      verified: true,
      method: "synthetic_test_only",
    },
    provider: "paymob",
    eventStatus: "success",
    currency: "OMR",
    ...partial,
  };
}
