/**
 * Callback classification + mapping. No settlement / entitlement grants here.
 * Redirection is display-only. Card-token callbacks are isolated from payment txns.
 */

import { verifyPaymobTransactionHmac } from "@/lib/billing/paymob/hmac";

export type PaymobCallbackKind =
  | "transaction_processed"
  | "transaction_response_display"
  | "card_token"
  | "unknown"
  | "rejected";

export type CanonicalProviderEventStatus = "pending" | "success" | "failed" | "other";

export type VerifiedTransactionObservation = {
  kind: "transaction_processed";
  providerTransactionId: string;
  providerOrderId: string;
  merchantOrderId: string | null;
  amountCents: number;
  currency: string;
  integrationId: number;
  /** Signed HMAC field `owner` — match to documented merchant owner id. */
  signedOwner: string;
  /**
   * Unsigned on the HMAC string — informational only; never binds company/order alone.
   */
  isLive: boolean | null;
  pending: boolean;
  success: boolean;
  errorOccured: boolean;
  eventStatus: CanonicalProviderEventStatus;
  hmacVerified: true;
  /** Signed order.id — primary server binding key. */
  signedOrderId: string;
  /** Signed HMAC lifecycle flags (included in observation_key). */
  isAuth: boolean;
  isCapture: boolean;
  isVoided: boolean;
  isRefunded: boolean;
  is3dSecure: boolean;
  hasParentTransaction: boolean;
  isStandalonePayment: boolean;
};

export type DisplayOnlyRedirection = {
  kind: "transaction_response_display";
  /** Never use for entitlement. */
  grantsEntitlement: false;
  success: boolean | null;
  pending: boolean | null;
  providerTransactionId: string | null;
  hmacVerified: boolean;
  displayHint: "success" | "pending" | "failed" | "unknown";
};

export type CardTokenCallback = {
  kind: "card_token";
  isolatedFromPaymentSettlement: true;
};

function asBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v)) {
    const n = Number(v);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

export function classifyNotificationPayload(body: unknown): PaymobCallbackKind {
  if (body == null || typeof body !== "object") return "unknown";
  const rec = body as Record<string, unknown>;
  const type = typeof rec.type === "string" ? rec.type.toUpperCase() : "";
  if (type === "TOKEN" || type.includes("TOKEN")) return "card_token";
  if (type === "TRANSACTION" || rec.obj != null) return "transaction_processed";
  return "unknown";
}

/**
 * Verify Processed POST callback and map to a canonical observation.
 * Company identity must come from server order lookup via signed order.id — never unsigned fields alone.
 */
export function verifyAndMapProcessedCallback(input: {
  body: unknown;
  hmacQueryParam: string | null | undefined;
  hmacSecret: string;
}):
  | { ok: true; observation: VerifiedTransactionObservation }
  | {
      ok: false;
      reason:
        | "not_transaction"
        | "card_token"
        | "hmac_failed"
        | "incomplete_payload"
        | "isolated_incomplete_fields";
      detail?: string;
    } {
  const kind = classifyNotificationPayload(input.body);
  if (kind === "card_token") return { ok: false, reason: "card_token" };
  if (kind !== "transaction_processed") return { ok: false, reason: "not_transaction" };

  const root = input.body as Record<string, unknown>;
  const obj = root.obj;
  if (obj == null || typeof obj !== "object") {
    return { ok: false, reason: "incomplete_payload", detail: "missing_obj" };
  }
  const o = obj as Record<string, unknown>;

  const hmac = verifyPaymobTransactionHmac({
    channel: "processed_post",
    fieldSource: o,
    providedHmac: input.hmacQueryParam,
    hmacSecret: input.hmacSecret,
  });
  if (!hmac.ok) {
    if (hmac.reason === "incomplete_signed_fields") {
      return {
        ok: false,
        reason: "isolated_incomplete_fields",
        detail: (hmac.missing ?? []).join(","),
      };
    }
    return { ok: false, reason: "hmac_failed", detail: hmac.reason };
  }

  const txnId = asNumber(o.id);
  const order = o.order;
  const orderId =
    order != null && typeof order === "object"
      ? asNumber((order as Record<string, unknown>).id)
      : null;
  const amountCents = asNumber(o.amount_cents);
  const currency = typeof o.currency === "string" ? o.currency : null;
  const integrationId = asNumber(o.integration_id);
  const pending = asBool(o.pending);
  const success = asBool(o.success);
  const errorOccured = asBool(o.error_occured);
  const isAuth = asBool(o.is_auth);
  const isCapture = asBool(o.is_capture);
  const isVoided = asBool(o.is_voided);
  const isRefunded = asBool(o.is_refunded);
  const is3dSecure = asBool(o.is_3d_secure);
  const hasParentTransaction = asBool(o.has_parent_transaction);
  const isStandalonePayment = asBool(o.is_standalone_payment);
  const ownerRaw = o.owner;
  const signedOwner =
    typeof ownerRaw === "number" && Number.isSafeInteger(ownerRaw)
      ? String(ownerRaw)
      : typeof ownerRaw === "string" && ownerRaw.trim() !== ""
        ? ownerRaw.trim()
        : null;

  if (
    txnId == null ||
    orderId == null ||
    amountCents == null ||
    amountCents <= 0 ||
    currency == null ||
    integrationId == null ||
    pending == null ||
    success == null ||
    errorOccured == null ||
    isAuth == null ||
    isCapture == null ||
    isVoided == null ||
    isRefunded == null ||
    is3dSecure == null ||
    hasParentTransaction == null ||
    isStandalonePayment == null ||
    signedOwner == null
  ) {
    return { ok: false, reason: "incomplete_payload" };
  }

  const merchantOrderId =
    order != null && typeof order === "object"
      ? typeof (order as Record<string, unknown>).merchant_order_id === "string"
        ? ((order as Record<string, unknown>).merchant_order_id as string)
        : (order as Record<string, unknown>).merchant_order_id == null
          ? null
          : String((order as Record<string, unknown>).merchant_order_id)
      : null;

  let eventStatus: CanonicalProviderEventStatus;
  if (pending) eventStatus = "pending";
  else if (success && !errorOccured) eventStatus = "success";
  else if (!success || errorOccured) eventStatus = "failed";
  else eventStatus = "other";

  return {
    ok: true,
    observation: {
      kind: "transaction_processed",
      providerTransactionId: String(txnId),
      providerOrderId: String(orderId),
      merchantOrderId,
      amountCents,
      currency,
      integrationId,
      signedOwner,
      isLive: asBool(o.is_live),
      pending,
      success,
      errorOccured,
      eventStatus,
      hmacVerified: true,
      signedOrderId: String(orderId),
      isAuth,
      isCapture,
      isVoided,
      isRefunded,
      is3dSecure,
      hasParentTransaction,
      isStandalonePayment,
    },
  };
}

/** GET redirection: display only — HMAC may be verified for UX integrity but never grants. */
export function mapRedirectionDisplay(input: {
  query: Record<string, string | undefined>;
  hmacSecret: string;
}): DisplayOnlyRedirection {
  const hmacParam = input.query.hmac;
  const hmac = verifyPaymobTransactionHmac({
    channel: "response_get",
    fieldSource: input.query,
    providedHmac: hmacParam,
    hmacSecret: input.hmacSecret,
  });

  const success = asBool(input.query.success);
  const pending = asBool(input.query.pending);
  let displayHint: DisplayOnlyRedirection["displayHint"] = "unknown";
  if (pending) displayHint = "pending";
  else if (success === true) displayHint = "success";
  else if (success === false) displayHint = "failed";

  return {
    kind: "transaction_response_display",
    grantsEntitlement: false,
    success,
    pending,
    providerTransactionId: input.query.id ?? input.query.txn_id ?? null,
    hmacVerified: hmac.ok,
    displayHint,
  };
}
