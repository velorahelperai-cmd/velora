/**
 * VEL-PAYMOB-ADAPTER-FIX-01 — Oman Paymob configuration with strict URL allowlist.
 * Live locked by default. Secrets must never be sent before URL validation.
 * OMR conversion requires an explicitly verified server setting; default NOT_CONFIGURED.
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
  liveConfigurationVerified: "PAYMOB_LIVE_CONFIGURATION_VERIFIED",
  apiBaseUrl: "PAYMOB_API_BASE_URL",
  checkoutBaseUrl: "PAYMOB_CHECKOUT_BASE_URL",
} as const;

export type PaymobEnvironment = "test" | "live";

export type PaymobAdapterConfig = {
  environment: PaymobEnvironment;
  /** Server-approved provider units per OMR; never supplied by a browser. */
  verifiedOmrUnitsPerOmr?: number;
  liveEnabled: boolean;
  /** Trusted operator verified the Live merchant, integration and OMR contract. */
  liveConfigurationVerified?: boolean;
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

export type PaymobAmountConversionState =
 | { status:"NOT_CONFIGURED"; reason:"paymob_omr_factor_unconfirmed" }
 | { status:"CONFIGURED"; unitsPerOmr:number };
export function getPaymobOmrConversionState(config?:Pick<PaymobAdapterConfig,"verifiedOmrUnitsPerOmr">):PaymobAmountConversionState {
 const verified=["true","1","yes","on"].includes(process.env.PAYMOB_OMR_CONVERSION_VERIFIED?.trim().toLowerCase()??"");
 const factor=config?.verifiedOmrUnitsPerOmr??(verified?Number(process.env.PAYMOB_OMR_UNITS_PER_OMR):NaN);
 return Number.isSafeInteger(factor)&&factor>0&&factor<=1000000?{status:"CONFIGURED",unitsPerOmr:factor}:{status:"NOT_CONFIGURED",reason:"paymob_omr_factor_unconfirmed"};
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
  if (config.environment !== "test" && config.environment !== "live") {
    throw new Error("paymob_environment_invalid");
  }
  if ((config.environment === "live" && config.liveEnabled !== true) ||
      (config.environment === "test" && config.liveEnabled)) {
    throw new Error("paymob_live_locked: explicit server opt-in required");
  }
  if (config.currency !== "OMR") {
    throw new Error("paymob_currency_must_be_OMR");
  }
  if (!Number.isSafeInteger(config.integrationId) || config.integrationId <= 0) {
    throw new Error("paymob_integration_id_invalid");
  }
  const mode = config.environment;
  const secretPattern = new RegExp("^(?:[a-z]{2,3}_)?sk_" + mode + "_[A-Za-z0-9_-]+$");
  const publicPattern = new RegExp("^(?:[a-z]{2,3}_)?pk_" + mode + "_[A-Za-z0-9_-]+$");
  if (!secretPattern.test(config.secretKey)) {
    throw new Error("paymob_" + mode + "_secret_key_required");
  }
  if (!publicPattern.test(config.publicKey)) {
    throw new Error("paymob_" + mode + "_public_key_required");
  }
  if (mode === "live") {
    if (config.liveConfigurationVerified !== true) {
      throw new Error("paymob_live_configuration_unverified");
    }
    if (!config.merchantOwnerId || !/^[1-9][0-9]*$/.test(config.merchantOwnerId) ||
        !Number.isSafeInteger(Number(config.merchantOwnerId))) {
      throw new Error("paymob_live_merchant_owner_required");
    }
    if (!config.hmacSecret || config.hmacSecret.trim() === "") {
      throw new Error("paymob_live_hmac_secret_required");
    }
    // Live must carry its own verified factor; ambient Test settings cannot supply it.
    const factor = config.verifiedOmrUnitsPerOmr;
    if (typeof factor !== "number" || !Number.isSafeInteger(factor) || factor <= 0 || factor > 1_000_000) {
      throw new Error("paymob_omr_factor_unconfirmed");
    }
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
