/**
 * VEL-PAYMOB-ADAPTER-FIX-01 — Oman Paymob configuration with strict URL allowlist.
 * Live locked by default. Secrets must never be sent before URL validation.
 * Conversion OMR↔provider units stays NOT_CONFIGURED.
 */

export const PAYMOB_OMAN_API_BASE_URL = "https://oman.paymob.com" as const;
export const PAYMOB_OMAN_CHECKOUT_BASE_URL = "https://om.checkout.paymob.com" as const;

/** Exact allowlisted API hosts (Oman only in this package). */
export const PAYMOB_ALLOWED_API_HOSTS = ["oman.paymob.com"] as const;

/** Exact allowlisted Hosted Checkout hosts (Oman only). */
export const PAYMOB_ALLOWED_CHECKOUT_HOSTS = ["om.checkout.paymob.com"] as const;

/** Suggested Intention path on the Oman API host (Create Intention). */
export const PAYMOB_INTENTION_PATH = "/v1/intention/" as const;

/** Transaction-ID inquiry (GET) — separate from order/reference inquiry. */
export const PAYMOB_INQUIRY_TRANSACTION_PATH = "/api/acceptance/transactions" as const;

/**
 * Order / merchant_order_id inquiry (POST + JSON) — official Postman collection.
 * Returns the most recent transaction for the order.
 */
export const PAYMOB_ORDER_TRANSACTION_INQUIRY_PATH =
  "/api/ecommerce/orders/transaction_inquiry" as const;

export const PAYMOB_AUTH_TOKEN_PATH = "/api/auth/tokens" as const;

/**
 * Integration ID 71610 is a Test-mode candidate from the merchant panel.
 * Must match key mode + currency before any real use — not auto-enabled.
 */
export const PAYMOB_TEST_INTEGRATION_ID_CANDIDATE = 71610 as const;

/** Required setting / secret names (server-side only; never browser). */
export const PAYMOB_SETTING_NAMES = {
  secretKeyTest: "PAYMOB_SECRET_KEY_TEST",
  secretKeyLive: "PAYMOB_SECRET_KEY_LIVE",
  publicKeyTest: "PAYMOB_PUBLIC_KEY_TEST",
  publicKeyLive: "PAYMOB_PUBLIC_KEY_LIVE",
  /**
   * API Key — documented as shared across Test/Live.
   * Must NOT be the sole isolation boundary between environments.
   */
  apiKeyShared: "PAYMOB_API_KEY",
  hmacSecret: "PAYMOB_HMAC_SECRET",
  integrationIdTest: "PAYMOB_INTEGRATION_ID_TEST",
  integrationIdLive: "PAYMOB_INTEGRATION_ID_LIVE",
  /** Documented merchant owner id for matching signed callback `owner`. */
  merchantOwnerId: "PAYMOB_MERCHANT_OWNER_ID",
  liveEnabled: "PAYMOB_LIVE_ENABLED",
  apiBaseUrl: "PAYMOB_API_BASE_URL",
  checkoutBaseUrl: "PAYMOB_CHECKOUT_BASE_URL",
} as const;

export type PaymobEnvironment = "test" | "live";

export type PaymobAdapterConfig = {
  environment: PaymobEnvironment;
  liveEnabled: boolean;
  apiBaseUrl: string;
  checkoutBaseUrl: string;
  secretKey: string;
  publicKey: string;
  hmacSecret: string;
  integrationId: number;
  apiKeyShared?: string;
  currency: "OMR";
  /**
   * Documented merchant owner (signed callback field `owner`).
   * Required for match when present on the observation.
   */
  merchantOwnerId?: string;
};

export type PaymobAmountConversionState = {
  status: "NOT_CONFIGURED";
  reason: "paymob_omr_factor_unconfirmed";
};

export function getPaymobOmrConversionState(): PaymobAmountConversionState {
  return { status: "NOT_CONFIGURED", reason: "paymob_omr_factor_unconfirmed" };
}

export type PaymobUrlKind = "api" | "checkout";

/**
 * Parse and allowlist Paymob base URLs. Exact hostname match only —
 * rejects suffix tricks, credentials-in-URL, and non-443 ports.
 */
export function assertAllowedPaymobBaseUrl(
  raw: string,
  kind: PaymobUrlKind,
): { ok: true; origin: string } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "paymob_url_unparseable" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "paymob_url_must_be_https" };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "paymob_url_credentials_forbidden" };
  }
  if (parsed.port !== "" && parsed.port !== "443") {
    return { ok: false, reason: "paymob_url_port_not_allowed" };
  }
  const host = parsed.hostname.toLowerCase();
  const allowed =
    kind === "api" ? PAYMOB_ALLOWED_API_HOSTS : PAYMOB_ALLOWED_CHECKOUT_HOSTS;
  if (!(allowed as readonly string[]).includes(host)) {
    return { ok: false, reason: "paymob_url_host_not_allowlisted" };
  }
  // Base URL must not smuggle path/query/hash that could redirect secret traffic.
  if (parsed.pathname !== "/" && parsed.pathname !== "") {
    return { ok: false, reason: "paymob_url_base_must_not_include_path" };
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    return { ok: false, reason: "paymob_url_base_must_not_include_query_or_hash" };
  }
  return { ok: true, origin: `https://${host}` };
}

/**
 * Validates live lock, currency, and allowlisted hosts.
 * Must run before any Authorization / secret is attached to an HTTP request.
 */
export function assertPaymobConfigForCalls(config: PaymobAdapterConfig): void {
  const api = assertAllowedPaymobBaseUrl(config.apiBaseUrl, "api");
  if (!api.ok) {
    throw new Error(api.reason);
  }
  const checkout = assertAllowedPaymobBaseUrl(config.checkoutBaseUrl, "checkout");
  if (!checkout.ok) {
    throw new Error(checkout.reason);
  }
  if (config.environment === "live" || config.liveEnabled) {
    throw new Error("paymob_live_locked: live environment disabled in this package");
  }
  if (config.currency !== "OMR") {
    throw new Error("paymob_currency_must_be_OMR");
  }
}

export function defaultPaymobTestConfigSkeleton(): Omit<
  PaymobAdapterConfig,
  "secretKey" | "publicKey" | "hmacSecret" | "apiKeyShared" | "merchantOwnerId"
> {
  return {
    environment: "test",
    liveEnabled: false,
    apiBaseUrl: PAYMOB_OMAN_API_BASE_URL,
    checkoutBaseUrl: PAYMOB_OMAN_CHECKOUT_BASE_URL,
    integrationId: PAYMOB_TEST_INTEGRATION_ID_CANDIDATE,
    currency: "OMR",
  };
}

export const PAYMOB_SUGGESTED_ROUTES = {
  webhookTransaction: "/api/billing/paymob/webhook",
  webhookCardToken: "/api/billing/paymob/card-token",
  returnDisplay: "/api/billing/paymob/return",
} as const;
