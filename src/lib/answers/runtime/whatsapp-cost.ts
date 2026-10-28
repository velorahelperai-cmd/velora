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
    let locale: "ar" | "en";
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
      const nativeStore = createClaimedWhatsappRuntimeStore(input, profile);
      store = nativeStore;
      locale = input.locale;
      // ES02 setup owns branch confirmations. Preserve the separate native-plan contract.
      if (profile.authority === "es02") {
      const readLanguage = async () => {
        const read = await client.rpc("es02_read_claimed_reply_language", {p_company_id:frame.company_id,p_job_id:input.jobId,p_claim_token:input.claimToken});
        const row = read.data as {ok?:boolean;company_id?:string;job_id?:string;branch_id?:string;reply_language?:string;revision?:number} | null;
        if (read.error || row?.ok !== true || row.company_id !== frame.company_id || row.job_id !== input.jobId ||
          typeof row.branch_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.branch_id) ||
          (profile.authority === "es02" && row.branch_id !== profile.branchId) ||
          !["ar","en","both"].includes(row.reply_language ?? "") || !Number.isSafeInteger(row.revision) || Number(row.revision)<1) return null;
        return {branch:row.branch_id,language:row.reply_language!,revision:row.revision!};
      };
      const language = await readLanguage();
      if (!language) return {ok:false,error:"REPLY_LANGUAGE_UNCONFIRMED",attempts:[]};
      // Fixed branch choices override caller locale; bilingual follows the stored inbound question.
      locale = language.language === "en" || (language.language === "both" && !/[\u0600-\u06ff]/.test(frame.question)) ? "en" : "ar";
      store = {...nativeStore,start:async id=>{
        if (!await nativeStore.start(id)) return false;
        const fresh = await readLanguage().catch(()=>null);
        return !!fresh && fresh.branch===language.branch && fresh.language===language.language && fresh.revision===language.revision;
      }};
      }
    }
    catch { return { ok: false, error: "PERSISTENCE_UNAVAILABLE", attempts: [] }; }
    return executeClaimedWhatsappAnswer({...input,locale}, { store, call: callRealModel, persona });
  };
}
