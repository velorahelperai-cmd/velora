/**
 * Reconciliation inquiry (mockable).
 * Order/merchant reference: POST /api/ecommerce/orders/transaction_inquiry (official Postman).
 * Transaction ID: GET /api/acceptance/transactions/{id} (separate path).
 * Absence / malformed never allows a new collection.
 */

import {
  assertPaymobConfigForCalls,
  PAYMOB_AUTH_TOKEN_PATH,
  PAYMOB_INQUIRY_TRANSACTION_PATH,
  PAYMOB_ORDER_TRANSACTION_INQUIRY_PATH,
  type PaymobAdapterConfig,
} from "@/lib/billing/paymob/config";
import type { PaymobHttpClient, PaymobHttpRequest, PaymobHttpResult } from "@/lib/billing/paymob/http";
import { classifyPaymobTransactionStatus, type CanonicalProviderEventStatus } from "@/lib/billing/paymob/callback";

export type ReconcileLookup =
  | { by: "transaction_id"; transactionId: string }
  | { by: "order_id"; orderId: string }
  | { by: "merchant_order_id"; merchantOrderId: string };

export type ReconcileTransaction = {
  id: string;
  orderId: string | null;
  amountCents: number;
  currency: string;
  success: boolean;
  pending: boolean;
  integrationId: number | null;
  isLive: boolean | null;
  isLatestForOrder: boolean;
  /** Authenticated inquiry metadata; raw `success` alone is never settlement evidence. */
  ownerId?: string | null;
  merchantOrderId?: string | null;
  eventStatus?: CanonicalProviderEventStatus;
  errorOccured?: boolean | null;
  isAuth?: boolean | null;
  isCapture?: boolean | null;
  isVoided?: boolean | null;
  isRefunded?: boolean | null;
  hasParentTransaction?: boolean | null;
  isStandalonePayment?: boolean | null;
};

export type ReconcileResult =
  | { ok: true; transaction: ReconcileTransaction }
  | {
      ok: false;
      code:
        | "live_locked"
        | "config_invalid"
        | "api_key_not_environment_isolator"
        | "auth_failed"
        | "timeout_unknown"
        | "network_error"
        | "http_error"
        | "not_found"
        | "inquiry_failed"
        | "invalid_response";
      allowsNewCollection: false;
      detail?: string;
    };

function fail(
  code: Extract<ReconcileResult, { ok: false }>["code"],
  detail?: string,
): Extract<ReconcileResult, { ok: false }> {
  return { ok: false, code, allowsNewCollection: false, detail };
}

function asPositiveSafeInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = Number(v);
    if (Number.isSafeInteger(n) && n > 0) return n;
  }
  return null;
}

function asNonNegBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  return null;
}

async function requestOnce(http: PaymobHttpClient, request: PaymobHttpRequest): Promise<PaymobHttpResult> {
  try {
    return await http.request(request);
  } catch {
    // An exception cannot prove absence; never retry here or expose request/credential details.
    return { kind: "network_error", message: "request_failed" };
  }
}

async function fetchAuthToken(
  config: PaymobAdapterConfig,
  http: PaymobHttpClient,
  timeoutMs: number,
): Promise<{ ok: true; token: string } | { ok: false; result: Extract<ReconcileResult, { ok: false }> }> {
  if (!config.apiKeyShared || config.apiKeyShared.trim() === "") {
    return { ok: false, result: fail("auth_failed", "api_key_missing") };
  }

  const url = `${config.apiBaseUrl.replace(/\/$/, "")}${PAYMOB_AUTH_TOKEN_PATH}`;
  const result = await requestOnce(http, {
    method: "POST",
    url,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ api_key: config.apiKeyShared }),
    timeoutMs,
  });
  return mapAuthResult(result);
}

function mapAuthResult(
  result: PaymobHttpResult,
): { ok: true; token: string } | { ok: false; result: Extract<ReconcileResult, { ok: false }> } {
  if (result.kind === "timeout") return { ok: false, result: fail("timeout_unknown") };
  if (result.kind === "network_error") {
    return { ok: false, result: fail("network_error", result.message) };
  }
  if (result.response.status < 200 || result.response.status >= 300) {
    return { ok: false, result: fail("auth_failed", `status=${result.response.status}`) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.response.bodyText) as unknown;
  } catch {
    return { ok: false, result: fail("invalid_response", "auth_non_json") };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, result: fail("invalid_response", "auth_not_object") };
  }
  const token = (parsed as Record<string, unknown>).token;
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, result: fail("invalid_response", "missing_token") };
  }
  return { ok: true, token };
}

/** Strict parse — never throws; never coerces object IDs or negative amounts to success. */
export function parseReconcileTransactionBody(
  bodyText: string,
  isLatestForOrder: boolean,
): ReconcileResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    return fail("invalid_response", "non_json");
  }

  if (parsed === null) {
    return fail("invalid_response", "null_body");
  }

  let row: Record<string, unknown>;
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return fail("not_found");
    // Both documented inquiry endpoints return one object. Array order is untrusted.
    return fail("invalid_response", "unexpected_array_response");
  } else if (typeof parsed === "object") {
    row = parsed as Record<string, unknown>;
  } else {
    return fail("invalid_response", "unexpected_json_type");
  }

  const id = asPositiveSafeInt(row.id);
  if (id == null) {
    return fail("invalid_response", "id_not_positive_integer");
  }

  const amountCents = asPositiveSafeInt(row.amount_cents);
  if (amountCents == null) {
    return fail("invalid_response", "amount_cents_invalid");
  }

  const currency = typeof row.currency === "string" ? row.currency : null;
  if (currency == null) {
    return fail("invalid_response", "currency_missing");
  }

  const success = asNonNegBool(row.success);
  const pending = asNonNegBool(row.pending);
  if (success == null || pending == null) {
    return fail("invalid_response", "success_or_pending_invalid");
  }

  let orderId: string | null = null;
  if (row.order != null && typeof row.order === "object" && !Array.isArray(row.order)) {
    const oid = asPositiveSafeInt((row.order as Record<string, unknown>).id);
    if (oid == null) {
      return fail("invalid_response", "order_id_invalid");
    }
    orderId = String(oid);
  } else if (row.order_id != null) {
    const oid = asPositiveSafeInt(row.order_id);
    if (oid == null) {
      return fail("invalid_response", "order_id_invalid");
    }
    orderId = String(oid);
  }

  const integrationId =
    row.integration_id == null ? null : asPositiveSafeInt(row.integration_id);
  if (row.integration_id != null && integrationId == null) {
    return fail("invalid_response", "integration_id_invalid");
  }

  const owner = asPositiveSafeInt(row.owner);
  const order = row.order != null && typeof row.order === "object" && !Array.isArray(row.order)
    ? row.order as Record<string, unknown> : null;
  const merchantOrderId = typeof order?.merchant_order_id === "string" ? order.merchant_order_id : null;
  const lifecycle = {
    errorOccured: asNonNegBool(row.error_occured),
    isAuth: asNonNegBool(row.is_auth),
    isCapture: asNonNegBool(row.is_capture),
    isVoided: asNonNegBool(row.is_voided),
    isRefunded: asNonNegBool(row.is_refunded),
    hasParentTransaction: asNonNegBool(row.has_parent_transaction),
    isStandalonePayment: asNonNegBool(row.is_standalone_payment),
  };
  const actionFlags = [row.is_refund, row.is_void, order?.is_cancel, order?.is_canceled];
  if (actionFlags.some((flag) => flag != null && typeof flag !== "boolean")) {
    return fail("invalid_response", "action_or_cancellation_flag_invalid");
  }
  // These fields are unsigned in callbacks, but trustworthy in authenticated inquiry.
  const isActionOrCancelled = row.is_refund === true || row.is_void === true ||
    order?.is_cancel === true || order?.is_canceled === true;
  const eventStatus = isActionOrCancelled ? "other" : classifyPaymobTransactionStatus({
    pending, success, ...lifecycle,
  });

  return {
    ok: true,
    transaction: {
      id: String(id),
      orderId,
      amountCents,
      currency,
      success,
      pending,
      integrationId,
      isLive: typeof row.is_live === "boolean" ? row.is_live : null,
      isLatestForOrder,
      ownerId: owner == null ? null : String(owner),
      merchantOrderId,
      eventStatus,
      ...lifecycle,
    },
  };
}

export async function reconcilePaymobTransaction(input: {
  config: PaymobAdapterConfig;
  http: PaymobHttpClient;
  lookup: ReconcileLookup;
  timeoutMs?: number;
}): Promise<ReconcileResult> {
  try {
    assertPaymobConfigForCalls(input.config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("paymob_live_locked")) return fail("live_locked", msg);
    return fail("config_invalid", msg);
  }

  const timeoutMs = input.timeoutMs ?? 15_000;
  const auth = await fetchAuthToken(input.config, input.http, timeoutMs);
  if (!auth.ok) return auth.result;

  const base = input.config.apiBaseUrl.replace(/\/$/, "");
  let result: PaymobHttpResult;
  let latestForOrder = false;

  if (input.lookup.by === "transaction_id") {
    const url = `${base}${PAYMOB_INQUIRY_TRANSACTION_PATH}/${encodeURIComponent(input.lookup.transactionId)}`;
    result = await requestOnce(input.http, {
      method: "GET",
      url,
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: "application/json",
      },
      timeoutMs,
    });
  } else {
    latestForOrder = true;
    const url = `${base}${PAYMOB_ORDER_TRANSACTION_INQUIRY_PATH}`;
    const body =
      input.lookup.by === "order_id"
        ? { order_id: input.lookup.orderId }
        : { merchant_order_id: input.lookup.merchantOrderId };
    result = await requestOnce(input.http, {
      method: "POST",
      url,
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      timeoutMs,
    });
  }

  if (result.kind === "timeout") return fail("timeout_unknown");
  if (result.kind === "network_error") return fail("network_error", result.message);
  if (result.response.status === 404) return fail("not_found", "http_404");
  if (result.response.status < 200 || result.response.status >= 300) {
    return fail("inquiry_failed", `status=${result.response.status}`);
  }
  const parsed = parseReconcileTransactionBody(result.response.bodyText, latestForOrder);
  if (!parsed.ok) return parsed;
  const transaction = parsed.transaction;
  // The API key is shared by test/live: response identity and environment must agree.
  if (transaction.isLive !== (input.config.environment === "live")) {
    return fail("invalid_response", input.config.environment + "_environment_not_proven");
  }
  if (transaction.integrationId !== input.config.integrationId) return fail("invalid_response", "integration_mismatch");
  if (!input.config.merchantOwnerId || transaction.ownerId !== input.config.merchantOwnerId.trim()) {
    return fail("invalid_response", "owner_mismatch_or_unconfigured");
  }
  if (transaction.currency !== input.config.currency) return fail("invalid_response", "currency_mismatch");
  if (transaction.orderId == null) return fail("invalid_response", "order_id_missing");
  const lifecycle = [transaction.errorOccured, transaction.isAuth, transaction.isCapture,
    transaction.isVoided, transaction.isRefunded, transaction.hasParentTransaction, transaction.isStandalonePayment];
  if (lifecycle.some((flag) => typeof flag !== "boolean")) return fail("invalid_response", "lifecycle_incomplete");
  if (input.lookup.by === "transaction_id" && transaction.id !== input.lookup.transactionId) {
    return fail("invalid_response", "transaction_id_mismatch");
  }
  if (input.lookup.by === "order_id" && transaction.orderId !== input.lookup.orderId) {
    return fail("invalid_response", "order_id_mismatch");
  }
  if (input.lookup.by === "merchant_order_id" && transaction.merchantOrderId !== input.lookup.merchantOrderId) {
    return fail("invalid_response", "merchant_order_id_mismatch");
  }
  // Any future settlement caller must additionally match the locked server order amount/account.
  return parsed;
}

export function reconcileMissAllowsNewCollection(
  _result: Extract<ReconcileResult, { ok: false }>,
): false {
  return false;
}
