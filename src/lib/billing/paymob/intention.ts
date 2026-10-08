/**
 * Create Intention client (Oman API host) with mockable HTTP.
 * OMR conversion defaults to NOT_CONFIGURED; trusted Test configuration must verify it.
 * Non-positive amounts refused before any HTTP. Malformed responses → invalid_response (no throw).
 * Timeout / opaque failure after send → unknown (reconcile; no new collection).
 */

import {
  assertPaymobConfigForCalls,
  getPaymobOmrConversionState,
  PAYMOB_INTENTION_PATH,
  type PaymobAdapterConfig,
} from "@/lib/billing/paymob/config";
import type { PaymobHttpClient, PaymobHttpResult } from "@/lib/billing/paymob/http";

export type LockedIntentionOrder = {
  companyId: string;
  orderId: string;
  paymentAttemptId: string;
  specialReference: string;
  currency: "OMR";
  providerAmount: number | null;
  providerAmountUnit: "paymob_amount" | "unconfigured" | null;
  providerAccountRef: string;
  providerEnvironment: "test" | "live";
  integrationId: number;
  billingPhone: string;
  itemName: string;
  notificationUrl: string;
  redirectionUrl: string;
};

export type IntentionCreateSuccess = {
  ok: true;
  clientSecret: string;
  intentionOrderId: number;
  intentionId: string | null;
  specialReference: string | null;
  rawSummary: Record<string, unknown>;
};

export type IntentionCreateFailure = {
  ok: false;
  code:
    | "live_locked"
    | "config_invalid"
    | "conversion_not_configured"
    | "provider_amount_invalid"
    | "provider_amount_missing"
    | "provider_amount_unit_invalid"
    | "currency_mismatch"
    | "special_reference_invalid"
    | "integration_mismatch"
    | "environment_mismatch"
    | "http_error"
    | "timeout_unknown"
    | "network_error"
    | "invalid_response";
  detail?: string;
  /** When true after a request was attempted — reconcile; do not re-collect. */
  needsReconciliation?: boolean;
};

export type IntentionCreateResult = IntentionCreateSuccess | IntentionCreateFailure;

export type IntentionLocalPersistence = {
  companyId: string;
  orderId: string;
  paymentAttemptId: string;
  specialReference: string;
  providerIntentionOrderId: number;
  providerIntentionId: string | null;
  clientSecret: string;
  persistedBeforeRedirect: true;
};

export function assertSpecialReferenceIsNotIdempotencyKey(): {
  specialReferenceIsIdempotency: false;
  note: string;
} {
  return {
    specialReferenceIsIdempotency: false,
    note: "Paymob special_reference correlates merchant_order_id in callbacks; Velora idempotency is client_op_id + fingerprint / order row uniqueness.",
  };
}

/** Refuse non-positive / non-safe amounts before any network I/O. */
export function assertPositiveProviderAmount(
  amount: number | null | undefined,
): { ok: true; amount: number } | { ok: false; code: "provider_amount_missing" | "provider_amount_invalid" } {
  if (amount == null) return { ok: false, code: "provider_amount_missing" };
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return { ok: false, code: "provider_amount_invalid" };
  }
  return { ok: true, amount };
}

type IntentionResponseBinding = Pick<
  LockedIntentionOrder,
  "providerAmount" | "currency" | "integrationId" | "specialReference" | "providerEnvironment"
>;

function invalidIntentionResponse(detail: string): IntentionCreateFailure {
  return { ok: false, code: "invalid_response", detail, needsReconciliation: true };
}

function isResponseRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse success without throwing; validate optional provider echoes when present. */
export function parseIntentionSuccessResponse(
  bodyText: string,
  expected?: IntentionResponseBinding,
): IntentionCreateResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    return { ok: false, code: "invalid_response", detail: "non_json", needsReconciliation: true };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      code: "invalid_response",
      detail: "not_object",
      needsReconciliation: true,
    };
  }
  const rec = parsed as Record<string, unknown>;
  const clientSecret = rec.client_secret;
  const intentionOrderId = rec.intention_order_id ?? rec.order_id;
  if (typeof clientSecret !== "string" || clientSecret.trim().length === 0) {
    return {
      ok: false,
      code: "invalid_response",
      detail: "missing_client_secret",
      needsReconciliation: true,
    };
  }
  if (typeof intentionOrderId !== "number" || !Number.isSafeInteger(intentionOrderId) || intentionOrderId <= 0) {
    return {
      ok: false,
      code: "invalid_response",
      detail: "missing_intention_order_id",
      needsReconciliation: true,
    };
  }
  if (rec.intention_order_id != null && rec.order_id != null && rec.intention_order_id !== rec.order_id) {
    return invalidIntentionResponse("conflicting_order_ids");
  }
  if (expected) {
    if (rec.special_reference != null && rec.special_reference !== expected.specialReference) {
      return invalidIntentionResponse("special_reference_mismatch");
    }
    if (rec.intention_detail != null) {
      if (!isResponseRecord(rec.intention_detail)) return invalidIntentionResponse("intention_detail_invalid");
      if (rec.intention_detail.amount != null && rec.intention_detail.amount !== expected.providerAmount) {
        return invalidIntentionResponse("provider_amount_mismatch");
      }
      if (rec.intention_detail.currency != null && rec.intention_detail.currency !== expected.currency) {
        return invalidIntentionResponse("currency_mismatch");
      }
    }
    if (rec.payment_methods != null) {
      if (!Array.isArray(rec.payment_methods)) return invalidIntentionResponse("payment_methods_invalid");
      for (const method of rec.payment_methods) {
        if (!isResponseRecord(method)) return invalidIntentionResponse("payment_method_invalid");
        if (method.integration_id != null && method.integration_id !== expected.integrationId) {
          return invalidIntentionResponse("integration_mismatch");
        }
        if (method.currency != null && method.currency !== expected.currency) {
          return invalidIntentionResponse("payment_method_currency_mismatch");
        }
        if (method.live != null && method.live !== (expected.providerEnvironment === "live")) {
          return invalidIntentionResponse("environment_mismatch");
        }
      }
    }
    if (rec.payment_keys != null) {
      if (!Array.isArray(rec.payment_keys)) return invalidIntentionResponse("payment_keys_invalid");
      for (const key of rec.payment_keys) {
        if (!isResponseRecord(key)) return invalidIntentionResponse("payment_key_invalid");
        if (key.integration != null && key.integration !== expected.integrationId) {
          return invalidIntentionResponse("payment_key_integration_mismatch");
        }
        if (key.order_id != null && key.order_id !== intentionOrderId) {
          return invalidIntentionResponse("payment_key_order_mismatch");
        }
      }
    }
  }
  const intentionId =
    typeof rec.id === "string"
      ? rec.id
      : typeof rec.intention_id === "string"
        ? rec.intention_id
        : null;

  return {
    ok: true,
    clientSecret,
    intentionOrderId,
    intentionId,
    specialReference: typeof rec.special_reference === "string" ? rec.special_reference : null,
    rawSummary: {
      status: rec.status ?? null,
      confirmed: rec.confirmed ?? null,
    },
  };
}

export function mapIntentionHttpResult(
  result: PaymobHttpResult,
  expected?: IntentionResponseBinding,
): IntentionCreateResult {
  if (result.kind === "timeout") {
    return {
      ok: false,
      code: "timeout_unknown",
      detail: "Intention outcome unknown — reconcile; do not create a new collection",
      needsReconciliation: true,
    };
  }
  if (result.kind === "network_error") {
    return {
      ok: false,
      code: "network_error",
      detail: result.message,
      needsReconciliation: true,
    };
  }
  if (!Number.isInteger(result.response.status) || result.response.status < 100 || result.response.status > 599) {
    return invalidIntentionResponse("http_status_invalid");
  }
  if (result.response.status < 200 || result.response.status >= 300) {
    return {
      ok: false,
      code: "http_error",
      detail: `status=${result.response.status}`,
      needsReconciliation: true,
    };
  }
  return parseIntentionSuccessResponse(result.response.bodyText, expected);
}

export async function createPaymobIntention(input: {
  config: PaymobAdapterConfig;
  http: PaymobHttpClient;
  locked: LockedIntentionOrder;
  timeoutMs?: number;
}): Promise<IntentionCreateResult> {
  try {
    assertPaymobConfigForCalls(input.config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("paymob_live_locked")) {
      return { ok: false, code: "live_locked", detail: msg };
    }
    return { ok: false, code: "config_invalid", detail: msg };
  }

  if (input.locked.providerEnvironment !== "test" || input.config.environment !== "test") {
    return { ok: false, code: "environment_mismatch" };
  }

  if (input.locked.integrationId !== input.config.integrationId) {
    return { ok: false, code: "integration_mismatch" };
  }

  if (input.locked.providerAccountRef !== String(input.config.integrationId)) {
    return { ok: false, code: "integration_mismatch" };
  }
  if (input.locked.currency !== input.config.currency) {
    return { ok: false, code: "currency_mismatch" };
  }
  if (input.locked.providerAmountUnit !== "paymob_amount") {
    return { ok: false, code: "provider_amount_unit_invalid" };
  }
  if (typeof input.locked.specialReference !== "string" || input.locked.specialReference.trim().length === 0) {
    return { ok: false, code: "special_reference_invalid" };
  }

  // Manual locked amount must not bypass the conversion contract while unconfigured.
  const conversion = getPaymobOmrConversionState(input.config);
  if (conversion.status === "NOT_CONFIGURED") {
    return { ok: false, code: "conversion_not_configured" };
  }

  const amountCheck = assertPositiveProviderAmount(input.locked.providerAmount);
  if (!amountCheck.ok) {
    return { ok: false, code: amountCheck.code };
  }

  const body = {
    amount: amountCheck.amount,
    currency: input.locked.currency,
    payment_methods: [input.locked.integrationId],
    items: [
      {
        name: input.locked.itemName,
        amount: amountCheck.amount,
        description: input.locked.itemName,
        quantity: 1,
      },
    ],
    billing_data: {
      phone_number: input.locked.billingPhone,
    },
    special_reference: input.locked.specialReference,
    notification_url: input.locked.notificationUrl,
    redirection_url: input.locked.redirectionUrl,
  };

  const url = `${input.config.apiBaseUrl.replace(/\/$/, "")}${PAYMOB_INTENTION_PATH}`;
  let result: PaymobHttpResult;
  try {
    // A failed POST may already have created the Intention. Never retry here.
    result = await input.http.request({
      method: "POST",
      url,
      headers: {
        Authorization: `Token ${input.config.secretKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      timeoutMs: input.timeoutMs ?? 15_000,
    });
  } catch {
    return { ok: false, code: "network_error", detail: "provider_request_failed", needsReconciliation: true };
  }

  return mapIntentionHttpResult(result, input.locked);
}

export function buildPersistenceAfterIntention(input: {
  locked: LockedIntentionOrder;
  intention: IntentionCreateSuccess;
}): IntentionLocalPersistence {
  return {
    companyId: input.locked.companyId,
    orderId: input.locked.orderId,
    paymentAttemptId: input.locked.paymentAttemptId,
    specialReference: input.locked.specialReference,
    providerIntentionOrderId: input.intention.intentionOrderId,
    providerIntentionId: input.intention.intentionId,
    clientSecret: input.intention.clientSecret,
    persistedBeforeRedirect: true,
  };
}
