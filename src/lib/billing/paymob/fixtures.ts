/**
 * Synthetic Paymob fixtures for isolated adapter tests.
 * Marker must stay visible — never use as live credentials.
 */

import { computePaymobHmacSha512, buildPaymobHmacConcatString } from "@/lib/billing/paymob/hmac";

export const PAYMOB_ADAPTER_TEST_FIXTURE_MARKER = "VEL_PAYMOB_ADAPTER_TEST_FIXTURE_ONLY" as const;

export const paymobAdapterFixtures = {
  marker: PAYMOB_ADAPTER_TEST_FIXTURE_MARKER,
  hmacSecret: "test_hmac_secret_not_real_paymob",
  secretKey: "sk_test_FIXTURE_NOT_REAL",
  publicKey: "pk_test_FIXTURE_NOT_REAL",
  apiKeyShared: "api_key_shared_FIXTURE_NOT_REAL",
  integrationId: 71610,
  merchantOwnerId: "1001",
  companyId: "11111111-1111-4111-8111-111111111111",
  orderId: "22222222-2222-4222-8222-222222222222",
  specialReference: "VEL_PAYMOB_SR_FIXTURE_1",
  providerOrderId: "900001",
  providerAmount: 5000,
  currency: "OMR" as const,
};

export function buildProcessedObj(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: 800001,
    pending: false,
    amount_cents: paymobAdapterFixtures.providerAmount,
    success: true,
    is_auth: false,
    is_capture: false,
    is_standalone_payment: true,
    is_voided: false,
    is_refunded: false,
    is_3d_secure: true,
    integration_id: paymobAdapterFixtures.integrationId,
    has_parent_transaction: false,
    order: {
      id: Number(paymobAdapterFixtures.providerOrderId),
      merchant_order_id: paymobAdapterFixtures.specialReference,
    },
    created_at: "2026-10-06T12:00:00.000000",
    currency: paymobAdapterFixtures.currency,
    owner: 1001,
    error_occured: false,
    is_live: false,
    source_data: {
      pan: "2346",
      type: "card",
      sub_type: "MasterCard",
    },
  };
  return deepMerge(base, overrides);
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (
      v != null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      typeof out[k] === "object" &&
      out[k] != null &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function signProcessedObj(
  obj: Record<string, unknown>,
  secret = paymobAdapterFixtures.hmacSecret,
): string {
  const built = buildPaymobHmacConcatString("processed_post", obj);
  if (!built.ok) {
    throw new Error(`fixture sign incomplete: ${built.missing.join(",")}`);
  }
  return computePaymobHmacSha512(secret, built.concat);
}

export function buildProcessedCallbackBody(
  overrides: Record<string, unknown> = {},
): { body: { type: string; obj: Record<string, unknown> }; hmac: string } {
  const obj = buildProcessedObj(overrides);
  return {
    body: { type: "TRANSACTION", obj },
    hmac: signProcessedObj(obj),
  };
}
