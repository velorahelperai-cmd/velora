/**
 * Create Intention client (Oman API host) with mockable HTTP.
 * OMR conversion defaults to NOT_CONFIGURED; trusted server configuration must verify it.
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

export type PaymobSandboxStage =
  | "order_create"
  | "checkout_claim"
  | "intention_request"
  | "intention_response"
  | "checkout_ready"
  | "webhook_receive"
  | "hmac_verify"
  | "order_match"
  | "settlement"
  | "return";

export type PaymobSandboxLogEntry = {
  timestamp: string;
  scope: "paymob_sandbox";
  correlationId: string;
  stage: PaymobSandboxStage;
  code: string;
  orderId?: string;
  paymentAttemptId?: string;
  providerOrderId?: string;
  providerTransactionId?: string;
  status?: number;
  detail?: string;
};

// Diagnostics are disposable and bounded; they are never payment authority.
class CorrelationCache {
  private entries = new Map<string, { value: string; expiresAt: number }>();
  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) { this.entries.delete(key); return undefined; }
    return entry.value;
  }
  set(key: string, value: string): void {
    const now = Date.now();
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id);
    this.entries.delete(key);
    while (this.entries.size >= 512) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { value, expiresAt: now + 15 * 60 * 1000 });
  }
}
const CORRELATION_BY_ORDER = new CorrelationCache();
const CORRELATION_BY_PROVIDER_ORDER = new CorrelationCache();
const CORRELATION_BY_SPECIAL_REF = new CorrelationCache();

let customLogSink: ((entry: PaymobSandboxLogEntry) => void) | null = null;

export function setPaymobSandboxLogSink(
  sink: ((entry: PaymobSandboxLogEntry) => void) | null,
): void {
  customLogSink = sink;
}

const PAYMOB_CORRELATION_ID_RE = /^[A-Za-z0-9._:-]{6,120}$/;
const PAYMOB_CORRELATION_KEY_RE = /^[A-Za-z0-9._:-]{1,96}$/;

const SECRET_REDACTION_PATTERNS: RegExp[] = [
  /(?:[a-z]{2,3}_)?sk_(?:test|live)_[A-Za-z0-9_-]+/gi,
  /(?:[a-z]{2,3}_)?pk_(?:test|live)_[A-Za-z0-9_-]+/gi,
  /(?:[a-z]{2,3}_)?csk_(?:test|live)_[A-Za-z0-9_-]+/gi,
  /(Token\s+)(?!\[REDACTED\])[A-Za-z0-9._~+/-]+=*/gi,
  /(Bearer\s+)(?!\[REDACTED\])[A-Za-z0-9._~+/-]+=*/gi,
  /(hmac=)(?!\[REDACTED\])[^&\s"']+/gi,
  /(clientSecret=)(?!\[REDACTED\])[^&\s"']+/gi,
  /("?(?:hmacSecret|secretKey|client_secret|clientSecret|authorization|Authorization|pan|card_number|phone_number|billingPhone)"?\s*:\s*"?)(?!(?:Token|Bearer)\s+\[REDACTED\]|\[REDACTED)[^",\s}]+/gi,
  /(\+\d{7,15})/g,
];

export function redactPaymobLogText(value: unknown): string {
  let text = String(value ?? "");
  for (const pattern of SECRET_REDACTION_PATTERNS) {
    text = text.replace(pattern, (full, prefix?: string) => {
      if (typeof prefix === "string" && /^(hmac=|clientSecret=|Token\s+|Bearer\s+)/i.test(prefix)) {
        return `${prefix.replace(/\s+$/, " ")}[REDACTED]`;
      }
      if (typeof prefix === "string" && prefix.includes(":")) {
        return `${prefix}[REDACTED]`;
      }
      if (full.startsWith("+")) {
        return "[REDACTED_PHONE]";
      }
      return "[REDACTED]";
    });
  }
  return text;
}

function sanitizeCorrelationSegment(value: unknown, pattern: RegExp): string {
  const raw = value != null ? String(value).trim() : "";
  if (!raw || !pattern.test(raw)) return "";
  const redacted = redactPaymobLogText(raw);
  if (redacted !== raw || /\[REDACTED/i.test(redacted)) return "";
  return raw;
}

export function sanitizePaymobCorrelationId(
  value: unknown,
  fallback = "paymob-corr-unlinked",
): string {
  return sanitizeCorrelationSegment(value, PAYMOB_CORRELATION_ID_RE) || fallback;
}

export function bindPaymobCorrelation(keys: {
  correlationId?: string | null;
  orderId?: string | null;
  providerOrderId?: string | number | null;
  specialReference?: string | null;
}): string {
  const cleanCorrelation = sanitizeCorrelationSegment(
    keys.correlationId,
    PAYMOB_CORRELATION_ID_RE,
  );
  const cleanOrder = sanitizeCorrelationSegment(keys.orderId, PAYMOB_CORRELATION_KEY_RE);
  const cleanProviderOrder = sanitizeCorrelationSegment(
    keys.providerOrderId,
    PAYMOB_CORRELATION_KEY_RE,
  );
  const cleanRef = sanitizeCorrelationSegment(
    keys.specialReference,
    PAYMOB_CORRELATION_KEY_RE,
  );

  const existing =
    cleanCorrelation ||
    (cleanOrder && CORRELATION_BY_ORDER.get(cleanOrder)) ||
    (cleanProviderOrder && CORRELATION_BY_PROVIDER_ORDER.get(cleanProviderOrder)) ||
    (cleanRef && CORRELATION_BY_SPECIAL_REF.get(cleanRef));

  const candidate =
    existing ||
    (cleanOrder
      ? `paymob-corr-${cleanOrder}`
      : cleanRef
        ? `paymob-corr-${cleanRef}`
        : cleanProviderOrder
          ? `paymob-corr-pord-${cleanProviderOrder}`
          : "paymob-corr-unlinked");
  const correlationId = sanitizePaymobCorrelationId(candidate, "paymob-corr-unlinked");

  if (cleanOrder) CORRELATION_BY_ORDER.set(cleanOrder, correlationId);
  if (cleanProviderOrder) CORRELATION_BY_PROVIDER_ORDER.set(cleanProviderOrder, correlationId);
  if (cleanRef) CORRELATION_BY_SPECIAL_REF.set(cleanRef, correlationId);
  return correlationId;
}

export function resolvePaymobCorrelationId(keys: {
  correlationId?: string | null;
  orderId?: string | null;
  providerOrderId?: string | number | null;
  specialReference?: string | null;
}): string {
  return bindPaymobCorrelation(keys);
}

export function logPaymobSandboxEvent(input: {
  correlationId?: string | null;
  stage: PaymobSandboxStage;
  code: string;
  orderId?: string | null;
  paymentAttemptId?: string | null;
  providerOrderId?: string | number | null;
  providerTransactionId?: string | number | null;
  specialReference?: string | null;
  status?: number;
  detail?: string;
}): PaymobSandboxLogEntry {
  const correlationId = bindPaymobCorrelation({
    correlationId: input.correlationId,
    orderId: input.orderId,
    providerOrderId: input.providerOrderId,
    specialReference: input.specialReference,
  });

  const entry: PaymobSandboxLogEntry = {
    timestamp: new Date().toISOString(),
    scope: "paymob_sandbox",
    correlationId,
    stage: input.stage,
    code: redactPaymobLogText(input.code),
    ...(input.orderId ? { orderId: redactPaymobLogText(input.orderId) } : {}),
    ...(input.paymentAttemptId
      ? { paymentAttemptId: redactPaymobLogText(input.paymentAttemptId) }
      : {}),
    ...(input.providerOrderId != null && String(input.providerOrderId) !== ""
      ? { providerOrderId: redactPaymobLogText(String(input.providerOrderId)) }
      : {}),
    ...(input.providerTransactionId != null && String(input.providerTransactionId) !== ""
      ? { providerTransactionId: redactPaymobLogText(String(input.providerTransactionId)) }
      : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    ...(input.detail ? { detail: redactPaymobLogText(input.detail) } : {}),
  };

  if (customLogSink) {
    customLogSink(entry);
  } else {
    console.info(JSON.stringify(entry));
  }
  return entry;
}

export type LockedIntentionOrder = {
  companyId: string;
  orderId: string;
  paymentAttemptId: string;
  specialReference: string;
  currency: "OMR";
  providerAmount: number | null;
  /** Persisted server price and immutable plan version; required for Live. */
  amountBaisa?: number;
  planVersionId?: string;
  providerAmountUnit: "paymob_amount" | "unconfigured" | null;
  providerAccountRef: string;
  providerEnvironment: "test" | "live";
  integrationId: number;
  billingPhone: string;
  itemName: string;
  notificationUrl: string;
  redirectionUrl: string;
};

/** Provider transport needs a locked order, not a provisioned company. Legacy stores may retain companyId. */
export type PaymobIntentionInput = Omit<LockedIntentionOrder, "companyId"> & {
  companyId?: string;
  correlationId?: string;
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
    | "provider_amount_mismatch"
    | "locked_order_invalid"
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
  locked: PaymobIntentionInput;
  timeoutMs?: number;
}): Promise<IntentionCreateResult> {
  const correlationId = bindPaymobCorrelation({
    correlationId: input.locked.correlationId,
    orderId: input.locked.orderId,
    specialReference: input.locked.specialReference,
  });

  const failPreHttp = (
    code: IntentionCreateFailure["code"],
    detail?: string,
  ): IntentionCreateFailure => {
    logPaymobSandboxEvent({
      correlationId,
      stage: "intention_request",
      code,
      orderId: input.locked.orderId,
      paymentAttemptId: input.locked.paymentAttemptId,
      specialReference: input.locked.specialReference,
      detail,
    });
    return detail ? { ok: false, code, detail } : { ok: false, code };
  };

  try {
    assertPaymobConfigForCalls(input.config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("paymob_live_locked")) {
      return failPreHttp("live_locked", msg);
    }
    return failPreHttp("config_invalid", msg);
  }

  if (input.locked.providerEnvironment !== input.config.environment) {
    return failPreHttp("environment_mismatch");
  }

  if (input.locked.integrationId !== input.config.integrationId) {
    return failPreHttp("integration_mismatch");
  }

  if (input.locked.providerAccountRef !== String(input.config.integrationId)) {
    return failPreHttp("integration_mismatch");
  }
  if (input.locked.currency !== input.config.currency) {
    return failPreHttp("currency_mismatch");
  }
  if (input.locked.providerAmountUnit !== "paymob_amount") {
    return failPreHttp("provider_amount_unit_invalid");
  }
  if (typeof input.locked.specialReference !== "string" || input.locked.specialReference.trim().length === 0) {
    return failPreHttp("special_reference_invalid");
  }

  // Manual locked amount must not bypass the conversion contract while unconfigured.
  const conversion = getPaymobOmrConversionState(input.config);
  if (conversion.status === "NOT_CONFIGURED") {
    return failPreHttp("conversion_not_configured");
  }

  const amountCheck = assertPositiveProviderAmount(input.locked.providerAmount);
  if (!amountCheck.ok) {
    return failPreHttp(amountCheck.code);
  }

  if (input.config.environment === "live") {
    const baisa = input.locked.amountBaisa;
    const version = input.locked.planVersionId;
    if (typeof baisa !== "number" || !Number.isSafeInteger(baisa) || baisa <= 0 ||
        typeof version !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(version)) {
      return failPreHttp("locked_order_invalid");
    }
    const scaled = BigInt(baisa) * BigInt(conversion.unitsPerOmr);
    if (scaled % BigInt(1000) !== BigInt(0) || scaled / BigInt(1000) !== BigInt(amountCheck.amount)) {
      return failPreHttp("provider_amount_mismatch");
    }
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
      // Fictional billing identity belongs only to the explicitly configured Test path.
      ...(input.config.environment === "test" ? { first_name: "Velora", last_name: "Sandbox" } : {}),
    },
    special_reference: input.locked.specialReference,
    notification_url: input.locked.notificationUrl,
    redirection_url: input.locked.redirectionUrl,
  };

  const url = `${input.config.apiBaseUrl.replace(/\/$/, "")}${PAYMOB_INTENTION_PATH}`;
  logPaymobSandboxEvent({
    correlationId,
    stage: "intention_request",
    code: "sending",
    orderId: input.locked.orderId,
    paymentAttemptId: input.locked.paymentAttemptId,
    specialReference: input.locked.specialReference,
    detail: `integration=${input.locked.integrationId};amount=${amountCheck.amount};currency=${input.locked.currency}`,
  });

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
    logPaymobSandboxEvent({
      correlationId,
      stage: "intention_response",
      code: "network_error",
      orderId: input.locked.orderId,
      paymentAttemptId: input.locked.paymentAttemptId,
      specialReference: input.locked.specialReference,
      detail: "provider_request_failed",
    });
    return { ok: false, code: "network_error", detail: "provider_request_failed", needsReconciliation: true };
  }

  const mapped = mapIntentionHttpResult(result, input.locked);
  if (mapped.ok) {
    bindPaymobCorrelation({
      correlationId,
      orderId: input.locked.orderId,
      providerOrderId: mapped.intentionOrderId,
      specialReference: input.locked.specialReference,
    });
    logPaymobSandboxEvent({
      correlationId,
      stage: "intention_response",
      code: "created",
      orderId: input.locked.orderId,
      paymentAttemptId: input.locked.paymentAttemptId,
      providerOrderId: mapped.intentionOrderId,
      specialReference: input.locked.specialReference,
      status: result.kind === "response" ? result.response.status : undefined,
      detail: mapped.intentionId ? `intentionId=${mapped.intentionId}` : undefined,
    });
  } else {
    logPaymobSandboxEvent({
      correlationId,
      stage: "intention_response",
      code: mapped.code,
      orderId: input.locked.orderId,
      paymentAttemptId: input.locked.paymentAttemptId,
      specialReference: input.locked.specialReference,
      status: result.kind === "response" ? result.response.status : undefined,
      detail: mapped.detail,
    });
  }
  return mapped;
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
