import "server-only";

import {
  assertPaymobConfigForCalls,
  PAYMOB_OMAN_API_BASE_URL,
  PAYMOB_OMAN_CHECKOUT_BASE_URL,
  PAYMOB_SETTING_NAMES as names,
  type PaymobAdapterConfig,
  type PaymobEnvironment,
} from "./config";

export type PaymobServerSettings = Readonly<Record<string, string | undefined>>;
export type PaymobServerConfigResult =
  | { ok: true; config: PaymobAdapterConfig }
  | { ok: false; reason: string };

function enabled(value: string | undefined): boolean {
  return ["true", "1", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function positiveInteger(value: string | undefined): number {
  const raw = value?.trim() ?? "";
  return /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : NaN;
}

/**
 * Call only with a server-owned environment and trusted deployment settings.
 * Nothing is enabled by reading this configuration. Callers retain rollout,
 * authorization, persistence, webhook settlement and idempotency boundaries.
 */
export function readPaymobServerConfig(
  environment: PaymobEnvironment,
  settings: PaymobServerSettings = process.env,
): PaymobServerConfigResult {
  if (environment !== "test" && environment !== "live") {
    return { ok: false, reason: "paymob_environment_invalid" };
  }
  const live = environment === "live";
  const config: PaymobAdapterConfig = {
    environment,
    liveEnabled: live && enabled(settings[names.liveEnabled]),
    liveConfigurationVerified: live && enabled(settings[names.liveConfigurationVerified]),
    secretKey: settings[live ? names.secretKeyLive : names.secretKeyTest] ?? "",
    publicKey: settings[live ? names.publicKeyLive : names.publicKeyTest] ?? "",
    integrationId: positiveInteger(settings[live ? names.integrationIdLive : names.integrationIdTest]),
    merchantOwnerId: settings[names.merchantOwnerId]?.trim(),
    hmacSecret: settings[names.hmacSecret] ?? "",
    apiKeyShared: settings[names.apiKeyShared],
    apiBaseUrl: settings[names.apiBaseUrl] ?? PAYMOB_OMAN_API_BASE_URL,
    checkoutBaseUrl: settings[names.checkoutBaseUrl] ?? PAYMOB_OMAN_CHECKOUT_BASE_URL,
    currency: "OMR",
    verifiedOmrUnitsPerOmr: enabled(settings.PAYMOB_OMR_CONVERSION_VERIFIED)
      ? positiveInteger(settings.PAYMOB_OMR_UNITS_PER_OMR)
      : undefined,
  };
  try {
    assertPaymobConfigForCalls(config);
    return { ok: true, config };
  } catch (error) {
    // Config validation emits fixed reasons, never setting values or credentials.
    return { ok: false, reason: error instanceof Error ? error.message : "paymob_config_invalid" };
  }
}
