/**
 * VEL-PAYMOB-TEST-WIRING-01 — operational switches (default OFF).
 * Separate keys for create / webhook / settle. Live always refused in this package.
 */

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function envBool(name: string, defaultValue = false): boolean {
  const v = env(name).toLowerCase();
  if (v === "") return defaultValue;
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return defaultValue;
}

/** Setting names for ops / later Test publish (values never logged). */
export const BILLING_WIRING_SETTING_NAMES = {
  createEnabled: "BILLING_PAYMOB_CREATE_ENABLED",
  webhookEnabled: "BILLING_PAYMOB_WEBHOOK_ENABLED",
  settleEnabled: "BILLING_PAYMOB_SETTLE_ENABLED",
  liveEnabled: "BILLING_PAYMOB_LIVE_ENABLED",
  hmacSecret: "PAYMOB_HMAC_SECRET",
  merchantOwnerId: "PAYMOB_MERCHANT_OWNER_ID",
  integrationIdTest: "PAYMOB_INTEGRATION_ID_TEST",
  secretKeyTest: "PAYMOB_SECRET_KEY_TEST",
  publicKeyTest: "PAYMOB_PUBLIC_KEY_TEST",
  apiKeyShared: "PAYMOB_API_KEY",
  apiBaseUrl: "PAYMOB_API_BASE_URL",
  checkoutBaseUrl: "PAYMOB_CHECKOUT_BASE_URL",
} as const;

export type BillingPaymobWiringFlags = {
  createEnabled: boolean;
  webhookEnabled: boolean;
  settleEnabled: boolean;
  /** Always treated as false for enforcement in this package. */
  liveEnabled: boolean;
};

export function readBillingPaymobWiringFlags(
  overrides?: Partial<BillingPaymobWiringFlags>,
): BillingPaymobWiringFlags {
  return {
    createEnabled: overrides?.createEnabled ?? envBool(BILLING_WIRING_SETTING_NAMES.createEnabled, false),
    webhookEnabled: overrides?.webhookEnabled ?? envBool(BILLING_WIRING_SETTING_NAMES.webhookEnabled, false),
    settleEnabled: overrides?.settleEnabled ?? envBool(BILLING_WIRING_SETTING_NAMES.settleEnabled, false),
    liveEnabled: overrides?.liveEnabled ?? envBool(BILLING_WIRING_SETTING_NAMES.liveEnabled, false),
  };
}

export type WiringReadinessBlock =
  | "create_disabled"
  | "webhook_disabled"
  | "settle_disabled"
  | "live_rejected"
  | "omr_conversion_not_configured"
  | "merchant_owner_missing"
  | "integration_id_missing"
  | "hmac_secret_missing"
  | "secret_key_missing"
  | "public_key_missing";

export function assertLiveRejected(flags: BillingPaymobWiringFlags): WiringReadinessBlock | null {
  if (flags.liveEnabled) return "live_rejected";
  return null;
}

export type WiringSecretsPresence = {
  hmacSecret: boolean;
  merchantOwnerId: boolean;
  integrationId: boolean;
  secretKey: boolean;
  publicKey: boolean;
  /** Always false in this package — OMR↔Paymob factor unconfirmed. */
  omrConversionConfigured: false;
};

export function readWiringSecretsPresence(
  overrides?: Partial<Omit<WiringSecretsPresence, "omrConversionConfigured">>,
): WiringSecretsPresence {
  return {
    hmacSecret: overrides?.hmacSecret ?? env(BILLING_WIRING_SETTING_NAMES.hmacSecret).length > 0,
    merchantOwnerId:
      overrides?.merchantOwnerId ?? env(BILLING_WIRING_SETTING_NAMES.merchantOwnerId).length > 0,
    integrationId:
      overrides?.integrationId ?? env(BILLING_WIRING_SETTING_NAMES.integrationIdTest).length > 0,
    secretKey: overrides?.secretKey ?? env(BILLING_WIRING_SETTING_NAMES.secretKeyTest).length > 0,
    publicKey: overrides?.publicKey ?? env(BILLING_WIRING_SETTING_NAMES.publicKeyTest).length > 0,
    omrConversionConfigured: false,
  };
}

/**
 * Blocks opening Paymob HTTP / Intention. Local order lock may still proceed.
 * Never guesses merchant id, integration, or OMR conversion.
 */
export function blocksPaymobConnection(
  flags: BillingPaymobWiringFlags,
  secrets: WiringSecretsPresence,
): WiringReadinessBlock | null {
  const live = assertLiveRejected(flags);
  if (live) return live;
  if (!secrets.omrConversionConfigured) return "omr_conversion_not_configured";
  if (!secrets.merchantOwnerId) return "merchant_owner_missing";
  if (!secrets.integrationId) return "integration_id_missing";
  if (!secrets.hmacSecret) return "hmac_secret_missing";
  if (!secrets.secretKey) return "secret_key_missing";
  if (!secrets.publicKey) return "public_key_missing";
  if (!flags.createEnabled) return "create_disabled";
  return null;
}

export function blocksWebhookReceive(
  flags: BillingPaymobWiringFlags,
  secrets: WiringSecretsPresence,
): WiringReadinessBlock | null {
  const live = assertLiveRejected(flags);
  if (live) return live;
  if (!flags.webhookEnabled) return "webhook_disabled";
  if (!secrets.hmacSecret) return "hmac_secret_missing";
  if (!secrets.merchantOwnerId) return "merchant_owner_missing";
  return null;
}

export function blocksSettlement(
  flags: BillingPaymobWiringFlags,
): WiringReadinessBlock | null {
  const live = assertLiveRejected(flags);
  if (live) return live;
  if (!flags.settleEnabled) return "settle_disabled";
  return null;
}
