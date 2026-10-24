import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { authCallbackUrl } from "@/lib/auth/site-url";
import { safeInternalPath } from "@/lib/auth/safe-next";
import { commitIntentCookie, type CookieReader, type CookieWriter } from "./cookies";
import { encryptSecret } from "./crypto";
import { prepareBrokerAdmissionLineage } from "./lineage-auth";
import { createProviderAuthClient } from "./provider";
import { loadAuthIntentByNonce, probeBrokerCapability, reserveBoundAuthIntent } from "./registry";

/** PKCE's one-time CAS guards the outgoing mail; callback claims provider exchange separately. */
export async function prepareEmailConfirmation(input: {
  purpose: "signup_email" | "signup_resend";
  requestNonce: string;
  next?: string | null;
  reader: CookieReader;
  writer: CookieWriter;
}) {
  const capability = await probeBrokerCapability();
  if (!capability.ok || !capability.boundAdmit) return { ok: false as const };
  const lineageCtx = await prepareBrokerAdmissionLineage(input.reader, input.writer);
  if (!lineageCtx.ok) return { ok: false as const };
  const intent = await reserveBoundAuthIntent({
    bootstrapHash: lineageCtx.bootstrapHash, requestNonce: input.requestNonce, purpose: input.purpose,
  });
  if (!intent) return { ok: false as const };
  const saved = await loadAuthIntentByNonce(intent.stateNonce);
  if (!saved || saved.purpose !== input.purpose || saved.status !== "reserved"
    || saved.browserLineageId !== lineageCtx.browserLineageId
    || !Number.isFinite(Date.parse(saved.expiresAt)) || Date.parse(saved.expiresAt) <= Date.now()) {
    return { ok: false as const };
  }
  if (saved.pkceVerifier) {
    // A previous mail may have been accepted. Restore only its browser binding;
    // never replace its verifier or report that another email was sent.
    commitIntentCookie(input.writer, intent.stateNonce, 600);
    return { ok: false as const };
  }
  const admin = createAdminClient();
  if (!admin) return { ok: false as const };
  const bundle = createProviderAuthClient({ persistPkceVerifier: async verifier => {
    const encrypted = encryptSecret(verifier)?.toString("base64");
    if (!encrypted) throw new Error("EMAIL_VERIFIER_ENCRYPTION_UNAVAILABLE");
    const { data, error } = await admin.from("vel_broker_auth_intents" as never)
      .update({ pkce_verifier_enc: encrypted, updated_at: new Date().toISOString() } as never)
      .eq("id", intent.id as never).eq("status", "reserved" as never)
      .eq("provider_state", "ready" as never).is("pkce_verifier_enc", null).select("id");
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error("EMAIL_VERIFIER_PERSIST_UNAVAILABLE");
    commitIntentCookie(input.writer, intent.stateNonce, 600);
  } });
  if (!bundle) return { ok: false as const };
  const base = authCallbackUrl(safeInternalPath(input.next, "/setup"));
  return {
    ok: true as const, bundle, intent, lineageCtx,
    emailRedirectTo: `${base}${base.includes("?") ? "&" : "?"}vel_intent=${encodeURIComponent(intent.stateNonce)}`,
  };
}
