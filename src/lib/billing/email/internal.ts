import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { readEmailConfig, sendReceiptEmail, validEmailClaim } from "./resend";
import { runEmailWorker } from "./worker";
import type { ClaimResult, EmailWorkerResult } from "./contracts";
type Rpc = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export async function processEmailOutbox(): Promise<EmailWorkerResult> {
  const config = readEmailConfig(process.env); if (!config.ok) return config;
  const client = createAdminClient() as unknown as Rpc | null; if (!client) return { ok: false, code: "EMAIL_STORE_UNAVAILABLE" };
  return runEmailWorker(true, {
    claim: async (): Promise<ClaimResult> => {
      const { data, error } = await client.rpc("billing_claim_subscription_email", {});
      if (error || !data || typeof data !== "object" || !("ok" in data) || data.ok !== true || !("claim" in data)) return { ok: false, code: "EMAIL_STORE_UNAVAILABLE" };
      if (data.claim === null) return { ok: true, claim: null };
      return validEmailClaim(data.claim) ? { ok: true, claim: data.claim } : { ok: false, code: "EMAIL_STORE_UNAVAILABLE" };
    },
    send: claim => sendReceiptEmail(config.config, claim),
    finish: async (claim, result) => {
      const { data, error } = await client.rpc("billing_finish_subscription_email", { p_id: claim.id, p_claim_token: claim.claimToken, p_status: result.kind, p_provider_id: result.kind === "accepted" ? result.providerId : null, p_code: result.code });
      return !error && data === true;
    },
  });
}
