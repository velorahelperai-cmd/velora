/**
 * Per-number Graph credentials. No approved vault is wired.
 * Never reads WHATSAPP_ACCESS_TOKEN as a fallback for another company.
 * Never returns plaintext for browser/profile/JSON display.
 */

export type WhatsappSecretScope = {
  companyId: string;
  providerPhoneNumberId: string;
  linkId: string;
  linkGeneration: number;
};

/** Active backend. `supabase_vault` is the candidate for approval — not enabled here. */
export type WhatsappSecretBackend = "unconfigured";

export const WHATSAPP_SECRET_BACKEND_CANDIDATE = "supabase_vault" as const;

export type WhatsappSecretLookup =
  | { ok: false; code: "NEEDS_SETUP" | "INVALID_INPUT" }
  | { ok: true; accessToken: string };

export function whatsappSecretBackend(): WhatsappSecretBackend {
  return "unconfigured";
}

export function lookupWhatsappAccessSecret(scope: WhatsappSecretScope): WhatsappSecretLookup {
  const companyId = scope.companyId.trim();
  const phone = scope.providerPhoneNumberId.trim();
  const linkId = scope.linkId.trim();
  if (!companyId || !phone || !linkId || !Number.isFinite(scope.linkGeneration) || scope.linkGeneration < 1) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (whatsappSecretBackend() === "unconfigured") {
    return { ok: false, code: "NEEDS_SETUP" };
  }
  return { ok: false, code: "NEEDS_SETUP" };
}
