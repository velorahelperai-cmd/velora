import "server-only";
import { deductReplyCredit } from "@/lib/billing/es02/reply-credit-deduction";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ReservedRuntimeStore } from "./store";
import type { ClaimedAnswerProfile } from "../approved-retrieval";

export type ClaimedWhatsappRuntimeStore = ReservedRuntimeStore;

/** Service-worker authorization comes only from the stored original job and claim. */
export function createClaimedWhatsappRuntimeStore(binding: { jobId: string; claimToken: string }, expectedProfile?: ClaimedAnswerProfile): ClaimedWhatsappRuntimeStore {
  const client = createAdminClient();
  if (!client) throw Error("PERSISTENCE_UNAVAILABLE");
  const rpc = client.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  async function call(name: string, args: Record<string, unknown>) {
    const result = await rpc.call(client, name, args);
    if (result.error) throw Error("LEDGER_WRITE_FAILED");
    return result.data;
  }
  return {
    async reserve(i) {
      // Fresh paid work allocates the message slot and AI hold in one transaction.
      const data = await deductReplyCredit(call, binding, i, expectedProfile);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw Error("INVALID_RESERVATION_RESULT");
      const row = data as Record<string, unknown>;
      if (row.ok === false && typeof row.code === "string" && row.code.trim()) return { ok: false, code: row.code };
      if (expectedProfile && (row.company_id !== expectedProfile.companyId || row.answer_persona !== expectedProfile.persona || row.answer_plan_version_id !== expectedProfile.planVersionId)) throw Error("ANSWER_PROFILE_MISMATCH");
      if (row.ok !== true || row.id !== i.id || row.job_id !== binding.jobId || typeof row.company_id !== "string" || !row.company_id.trim() ||
        typeof row.automation_generation !== "number" || !Number.isSafeInteger(row.automation_generation) || row.automation_generation < 0 ||
        typeof row.remaining_baisa !== "number" || !Number.isFinite(row.remaining_baisa) || row.remaining_baisa < 0) throw Error("INVALID_RESERVATION_RESULT");
      return { ok: true };
    },
    async start(id) {
      return await call("ai_start_whatsapp_attempt", { p_id: id, p_claim_token: binding.claimToken }) === true;
    },
    async settle(i) {
      return await call("ai_settle_whatsapp_attempt", {
        p_id: i.id, p_claim_token: binding.claimToken, p_status: i.status,
        p_cost_usd: i.costUsd, p_cost_baisa: i.costBaisa, p_usage: i.usage,
        p_request_id: i.requestId ?? null, p_response_id: i.responseId ?? null,
        p_actual_model_id: i.actualModelId ?? null, p_response_text: i.responseText ?? null,
        p_error_code: i.errorCode ?? null, p_latency_ms: i.latencyMs,
      }) === true;
    },
  };
}
