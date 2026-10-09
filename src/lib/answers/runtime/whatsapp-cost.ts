import "server-only";
import { isLiveAnsweringEnabled } from "../guards";
import { executeReservedRealAnswer, type RealAnswerPayload, type RealAnswerResult } from "./execute";
import { callRealModel } from "./provider";
import { createClaimedWhatsappRuntimeStore, type ClaimedWhatsappRuntimeStore } from "./whatsapp-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadClaimedAnswerProfile } from "../approved-retrieval";
import type { AnswerPersona } from "../types";

export type ClaimedWhatsappAnswerInput = RealAnswerPayload & { jobId: string; claimToken: string };

/** Explicit ports support offline checks; no identity/session is fabricated for a worker. */
export async function executeClaimedWhatsappAnswer(
  input: ClaimedWhatsappAnswerInput,
  deps: { store: ClaimedWhatsappRuntimeStore; call: typeof callRealModel; persona?: AnswerPersona },
): Promise<RealAnswerResult> {
  if (!input.jobId?.trim() || !input.claimToken?.trim()) return { ok: false, error: "INVALID_INPUT", attempts: [] };
  return executeReservedRealAnswer(input, { ...deps, requireProviderIdentity: true });
}

/** Production has no caller-controlled provider or rollout flag. Live AI stays off. */
export function createClaimedWhatsappAnswerExecutor(): (input: ClaimedWhatsappAnswerInput) => Promise<RealAnswerResult> {
  return async input => {
    if (!isLiveAnsweringEnabled()) return { ok: false, error: "LIVE_AI_DISABLED", attempts: [] };
    let store: ClaimedWhatsappRuntimeStore;
    let persona: AnswerPersona;
    try {
      const admin = createAdminClient();
      if (!admin) return { ok: false, error: "PERSISTENCE_UNAVAILABLE", attempts: [] };
      const rpc = admin.rpc as unknown as Parameters<typeof loadClaimedAnswerProfile>[2]["rpc"];
      const client = { rpc: rpc.bind(admin) };
      const loaded = await client.rpc("billing_load_worker_frame", { p_job_id: input.jobId, p_claim_token: input.claimToken });
      const result = loaded.data as { ok?: boolean; data?: { job_id?: string; company_id?: string; question?: string } } | null;
      const frame = result?.data;
      if (loaded.error || result?.ok !== true || frame?.job_id !== input.jobId || typeof frame.company_id !== "string" || !frame.company_id.trim() || frame.question !== input.question) return { ok: false, error: "CLAIM_BINDING_REJECTED", attempts: [] };
      const profile = await loadClaimedAnswerProfile(frame.company_id, input, client);
      if (!profile) return { ok: false, error: "ANSWER_PROFILE_UNAVAILABLE", attempts: [] };
      persona = profile.persona;
      store = createClaimedWhatsappRuntimeStore(input, profile);
    }
    catch { return { ok: false, error: "PERSISTENCE_UNAVAILABLE", attempts: [] }; }
    return executeClaimedWhatsappAnswer(input, { store, call: callRealModel, persona });
  };
}
