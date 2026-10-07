/**
 * Evidence contract for the app settlement bridge (HMAC verified server-side).
 * NOT the synthetic test helper. NOT billing_settle_verified_payment with fake attestation.
 *
 * RPC (migration): public.billing_settle_paymob_hmac_verified(jsonb) → service_role only
 * → private.billing_settle_payment_core after gate.
 */

export const PAYMOB_HMAC_SETTLEMENT_EVIDENCE_MARKER =
  "VEL_PAYMOB_SERVER_HMAC_VERIFIED" as const;

export const PAYMOB_HMAC_SETTLEMENT_METHOD = "paymob_hmac_sha512" as const;

export type PaymobHmacSettlementEvidenceJson = {
  evidence_marker: typeof PAYMOB_HMAC_SETTLEMENT_EVIDENCE_MARKER;
  authenticity: {
    source: "server_adapter_attestation";
    verified: true;
    method: typeof PAYMOB_HMAC_SETTLEMENT_METHOD;
  };
  company_id: string;
  order_id: string;
  payment_attempt_id: string;
  provider: "paymob";
  provider_account_ref: string;
  provider_environment: "test";
  provider_transaction_id: string;
  special_reference: string;
  amount_baisa: number;
  currency: "OMR";
  event_status: "success";
  observation_key?: string;
};

export function buildPaymobHmacSettlementEvidence(input: {
  companyId: string;
  orderId: string;
  paymentAttemptId: string;
  providerAccountRef: string;
  providerTransactionId: string;
  specialReference: string;
  amountBaisa: number;
  observationKey?: string;
}): PaymobHmacSettlementEvidenceJson {
  return {
    evidence_marker: PAYMOB_HMAC_SETTLEMENT_EVIDENCE_MARKER,
    authenticity: {
      source: "server_adapter_attestation",
      verified: true,
      method: PAYMOB_HMAC_SETTLEMENT_METHOD,
    },
    company_id: input.companyId,
    order_id: input.orderId,
    payment_attempt_id: input.paymentAttemptId,
    provider: "paymob",
    provider_account_ref: input.providerAccountRef,
    provider_environment: "test",
    provider_transaction_id: input.providerTransactionId,
    special_reference: input.specialReference,
    amount_baisa: input.amountBaisa,
    currency: "OMR",
    event_status: "success",
    ...(input.observationKey ? { observation_key: input.observationKey } : {}),
  };
}

/** Contract notes for human review before enabling BILLING_PAYMOB_SETTLE_ENABLED. */
export const PAYMOB_HMAC_SETTLEMENT_RPC_CONTRACT = {
  functionName: "billing_settle_paymob_hmac_verified",
  executeGrant: "service_role",
  denied: ["anon", "authenticated", "public"],
  acceptsMarker: PAYMOB_HMAC_SETTLEMENT_EVIDENCE_MARKER,
  acceptsMethod: PAYMOB_HMAC_SETTLEMENT_METHOD,
  rejects: [
    "VEL_BILLING_SYNTHETIC_TEST_EVIDENCE",
    "synthetic_test_only",
    "signature_verified browser field",
    "provider_environment=live",
    "billing_settle_verified_payment (disabled stub)",
  ],
  calls: "private.billing_settle_payment_core",
} as const;
