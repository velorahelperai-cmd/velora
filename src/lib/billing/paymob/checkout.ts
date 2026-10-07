/**
 * Hosted Checkout URL builder (Oman checkout host — separate from API base).
 */

import {
  assertPaymobConfigForCalls,
  type PaymobAdapterConfig,
} from "@/lib/billing/paymob/config";

export function buildOmanHostedCheckoutUrl(input: {
  config: PaymobAdapterConfig;
  clientSecret: string;
}):
  | { ok: true; url: string }
  | { ok: false; code: "live_locked" | "config_invalid" | "missing_client_secret"; detail?: string } {
  try {
    assertPaymobConfigForCalls(input.config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.startsWith("paymob_live_locked")) {
      return { ok: false, code: "live_locked", detail: msg };
    }
    return { ok: false, code: "config_invalid", detail: msg };
  }
  if (!input.clientSecret || input.clientSecret.trim().length === 0) {
    return { ok: false, code: "missing_client_secret" };
  }
  // Secrets/public material only attached after allowlist validation above.
  const base = input.config.checkoutBaseUrl.replace(/\/$/, "");
  const url = `${base}/?publicKey=${encodeURIComponent(input.config.publicKey)}&clientSecret=${encodeURIComponent(input.clientSecret)}`;
  return { ok: true, url };
}
