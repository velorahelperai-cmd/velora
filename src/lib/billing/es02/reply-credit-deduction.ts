import "server-only";
import type { RuntimeAttemptReserveInput } from "@/lib/answers/runtime/store";
import type { ClaimedAnswerProfile } from "@/lib/answers/approved-retrieval";

/** One hold in the existing paid reply + AI cost ledger, owned by the stored job claim.
 * Success/unknown/release remain with the existing worker settlement. Never debit twice.
 */
export async function deductReplyCredit(
  invoke: (name: string, args: Record<string, unknown>) => Promise<unknown>,
  binding: { jobId: string; claimToken: string },
  input: RuntimeAttemptReserveInput,
  profile?: ClaimedAnswerProfile,
): Promise<unknown> {
  if (!binding.jobId?.trim() || !binding.claimToken?.trim()) throw Error("WORKER_CLAIM_REQUIRED");
  const es02 = profile?.authority === "es02";
  return invoke(es02 ? "es02_reserve_whatsapp_capacity_cost_attempt" : "ai_reserve_whatsapp_capacity_cost_attempt", {
    p_id: input.id, p_job_id: binding.jobId, p_claim_token: binding.claimToken, p_attempt: input.attempt,
    p_model_id: input.model, p_provider: input.provider, p_reserved_baisa: input.reservedBaisa,
    p_pricing_version: input.pricingVersion, p_pricing_snapshot: input.pricingSnapshot,
    p_source_citations: input.sourceCitations ?? null,
    ...(profile?.authority === "es02" ? {
      p_expected_persona: profile.persona, p_expected_order_id: profile.orderId,
      p_expected_branch_id: profile.branchId, p_expected_slot_index: profile.slotIndex,
      p_expected_paid_fingerprint: profile.paidFingerprint,
    } : profile ? { p_expected_persona: profile.persona, p_expected_plan_version_id: profile.planVersionId } : {}),
  });
}
