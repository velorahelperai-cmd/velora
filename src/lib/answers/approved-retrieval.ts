import { ANSWER_MAX_CONTEXT_CHARS, ANSWER_MAX_QUESTION_CHARS, ANSWER_MAX_SOURCES } from "./constants";
import type { ApprovedRow, PackedContext } from "./context";
import type { AnswerPersona } from "./types";

export type ClaimedKnowledgeQuery = { question: string; jobId: string; claimToken: string };
type RpcClient = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const personaForPlan: Record<string, AnswerPersona> = { noor_basic: "noura", noor_premium: "noura", lina_basic: "lina", lina_premium: "lina", dana_basic: "dana", dana_premium: "dana" };
export type NativePlanClaimedAnswerProfile = {
  authority?: "native_plan";
  persona: AnswerPersona;
  planVersionId: string;
  companyId: string;
};
export type Es02ClaimedAnswerProfile = {
  authority: "es02";
  persona: AnswerPersona;
  companyId: string;
  orderId: string;
  branchId: string;
  slotIndex: number;
  paidFingerprint: string;
};
export type ClaimedAnswerProfile = NativePlanClaimedAnswerProfile | Es02ClaimedAnswerProfile;
const nativeUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const es02ProfileKeys = ["es02_order_id", "es02_branch_id", "es02_slot_index", "es02_paid_fingerprint"] as const;

/**
 * Only the claimed native RPC establishes authority. ES02 carries its immutable
 * paid order/branch/slot snapshot explicitly; an order UUID is never a plan UUID.
 * A browser persona/name or a partly mixed response cannot establish either path.
 */
export async function loadClaimedAnswerProfile(companyId: string, binding: Pick<ClaimedKnowledgeQuery, "jobId" | "claimToken">, client: RpcClient): Promise<ClaimedAnswerProfile | null> {
  try {
    const { data, error } = await client.rpc("whatsapp_read_answer_profile", { p_company_id: companyId, p_job_id: binding.jobId, p_claim_token: binding.claimToken });
    const result = object(data);
    if (error || result?.ok !== true || result.company_id !== companyId || result.job_id !== binding.jobId) return null;
    if (result.authority === "es02") {
      if (result.plan_version_id != null || result.plan_code != null
        || !["noura", "lina", "dana"].includes(String(result.persona))
        || !nativeUuid(result.es02_order_id) || !nativeUuid(result.es02_branch_id)
        || !Number.isSafeInteger(result.es02_slot_index) || Number(result.es02_slot_index) < 0 || Number(result.es02_slot_index) > 31
        || typeof result.es02_paid_fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(result.es02_paid_fingerprint)) return null;
      return {
        authority: "es02", companyId, persona: result.persona as AnswerPersona,
        orderId: result.es02_order_id, branchId: result.es02_branch_id,
        slotIndex: Number(result.es02_slot_index), paidFingerprint: result.es02_paid_fingerprint,
      };
    }
    if ((result.authority !== undefined && result.authority !== "native_plan") || es02ProfileKeys.some(key => result[key] != null)
      || typeof result.plan_code !== "string" || !Object.hasOwn(personaForPlan, result.plan_code) || result.persona !== personaForPlan[result.plan_code]
      || typeof result.plan_version_id !== "string" || !result.plan_version_id.trim()) return null;
    return { persona: personaForPlan[result.plan_code], planVersionId: result.plan_version_id, companyId };
  } catch { return null; }
}

/** The database bounds relevant complete rows before returning bodies; never loads the entire corpus. */
export async function retrieveApprovedRows(companyId: string, query: ClaimedKnowledgeQuery, client: RpcClient): Promise<{ ok: true; rows: ApprovedRow[] } | Extract<PackedContext, { ok: false }>> {
  if (!companyId.trim() || !query.jobId?.trim() || !query.claimToken?.trim() || typeof query.question !== "string" || !query.question.trim() || query.question.length > ANSWER_MAX_QUESTION_CHARS) return { ok: false, code: "UNAVAILABLE" };
  try {
    const { data, error } = await client.rpc("whatsapp_retrieve_approved_knowledge", { p_company_id: companyId, p_job_id: query.jobId, p_claim_token: query.claimToken, p_question: query.question });
    const result = object(data);
    if (error || !result) return { ok: false, code: "UNAVAILABLE" };
    if (result.ok !== true) {
      const code = result.code;
      if (code === "CONTEXT_OVERFLOW" || code === "NO_KNOWLEDGE" || code === "APPROVAL_INCOMPLETE") return { ok: false, code };
      return { ok: false, code: "UNAVAILABLE" };
    }
    if (result.company_id !== companyId || result.job_id !== query.jobId || !Array.isArray(result.sources)) return { ok: false, code: "UNAVAILABLE" };
    if (result.sources.length > ANSWER_MAX_SOURCES) return { ok: false, code: "CONTEXT_OVERFLOW" };
    const rows: ApprovedRow[] = [];
    const seen = new Set<string>();
    let chars = 0;
    for (const source of result.sources) {
      const row = object(source);
      if (!row || row.company_id !== companyId || typeof row.id !== "string" || !row.id.trim() || seen.has(row.id) ||
          typeof row.title !== "string" || typeof row.content !== "string" || !row.content.trim() ||
          !Number.isSafeInteger(row.content_version) || Number(row.content_version) < 1 || row.approved_version !== row.content_version ||
          row.approved_for_answers !== true || row.status !== "ready" || !["text", "file"].includes(String(row.kind)) ||
          !["knowledge", "business_instructions"].includes(String(row.usage_role)) || typeof row.updated_at !== "string" ||
          (row.storage_path !== null && typeof row.storage_path !== "string") ||
          (row.byte_size !== null && (!Number.isSafeInteger(row.byte_size) || Number(row.byte_size) < 0))) return { ok: false, code: "APPROVAL_INCOMPLETE" };
      seen.add(row.id);
      chars += `### ${row.title}\n${row.content.trim()}`.length + (rows.length ? 2 : 0);
      rows.push(row as ApprovedRow);
    }
    if (chars > ANSWER_MAX_CONTEXT_CHARS) return { ok: false, code: "CONTEXT_OVERFLOW" };
    if (!rows.some(row => row.usage_role === "knowledge")) return { ok: false, code: "NO_KNOWLEDGE" };
    return { ok: true, rows };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}
