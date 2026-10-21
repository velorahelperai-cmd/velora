import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ createClient: () => { throw Error("End-user client is forbidden in claimed worker accounting"); } }));
import { deductReplyCredit } from "./reply-credit-deduction";
const input = { id: "attempt", attempt: 1, model: "gemini-3.8-flash", provider: "google", reservedBaisa: 100, pricingVersion: "test-pricing", pricingSnapshot: { version: "test-pricing" }, sourceCitations: [{ sourceId: "source", title: "Policy", contentVersion: 1 }] };
it("uses the worker's existing atomic capacity-and-cost ledger once, without a parallel account debit", async () => {
  const invoke = vi.fn().mockResolvedValue({ ok: true, id: "attempt" });
  await deductReplyCredit(invoke, { jobId: "job", claimToken: "claim" }, input);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith("ai_reserve_whatsapp_capacity_cost_attempt", expect.objectContaining({ p_id: "attempt", p_job_id: "job", p_claim_token: "claim", p_reserved_baisa: 100, p_source_citations: input.sourceCitations }));
});
it("cannot debit by account id or company id without the existing job claim", async () => {
  const invoke = vi.fn();
  await expect(deductReplyCredit(invoke, { jobId: "job", claimToken: "" }, input)).rejects.toThrow("WORKER_CLAIM_REQUIRED");
  expect(invoke).not.toHaveBeenCalled();
});
it("retains the paid answer profile binding in the same atomic reservation", async () => {
  const invoke = vi.fn().mockResolvedValue({ ok: false, code: "subscription_inactive" });
  const result = await deductReplyCredit(invoke, { jobId: "job", claimToken: "claim" }, input, { companyId: "company", persona: "lina", planVersionId: "plan" });
  expect(result).toMatchObject({ ok: false, code: "subscription_inactive" });
  expect(invoke).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ p_expected_persona: "lina", p_expected_plan_version_id: "plan" }));
});
