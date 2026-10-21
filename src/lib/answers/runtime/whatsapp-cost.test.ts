import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../config/env", () => ({ getGeminiModelId:()=>"gemini-3.8-flash",getSecureProviderKey: () => null }));
const admin = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: admin.create }));
import { createClaimedWhatsappAnswerExecutor, executeClaimedWhatsappAnswer } from "./whatsapp-cost";
import { createClaimedWhatsappRuntimeStore, type ClaimedWhatsappRuntimeStore } from "./whatsapp-store";

const input = { jobId: "job", claimToken: "claim", question: "Opening hours?", locale: "en" as const, chunks: [{ sourceId: "knowledge", title: "Synthetic knowledge", contentVersion: 1, text: "Synthetic approved content" }] };
const usage = { promptTokens: 20, completionTokens: 10, cachedTokens: 5, cacheWriteTokens: 3, reasoningTokens: 4, totalTokens: 30 };
function store(): ClaimedWhatsappRuntimeStore {
  return { reserve: vi.fn().mockResolvedValue({ ok: true }), start: vi.fn().mockResolvedValue(true), settle: vi.fn().mockResolvedValue(true) };
}
beforeEach(() => admin.create.mockReset());

describe("claimed WhatsApp cost execution", () => {
  it("keeps the production factory disabled before reading service credentials", async () => {
    expect(await createClaimedWhatsappAnswerExecutor()(input)).toMatchObject({ ok: false, error: "LIVE_AI_DISABLED", attempts: [] });
    expect(admin.create).not.toHaveBeenCalled();
  });
  it("does not dispatch after a reservation rejection", async () => {
    const db = store(), call = vi.fn();
    vi.mocked(db.reserve).mockResolvedValue({ ok: false, code: "CLAIM_REJECTED" });
    expect(await executeClaimedWhatsappAnswer(input, { store: db, call })).toMatchObject({ ok: false, error: "CLAIM_REJECTED" });
    expect(call).not.toHaveBeenCalled();
  });
  it("rechecks before dispatch and releases a definitely unstarted reservation", async () => {
    const db = store(), call = vi.fn();
    vi.mocked(db.start).mockResolvedValue(false);
    expect(await executeClaimedWhatsappAnswer(input, { store: db, call })).toMatchObject({ ok: false, error: "AUTHORIZATION_CHANGED_BEFORE_EXECUTION" });
    expect(call).not.toHaveBeenCalled();
    expect(db.settle).toHaveBeenCalledWith(expect.objectContaining({ status: "rejected", costBaisa: 0 }));
  });
  it("persists a complete draft with all actual usage metadata before returning it", async () => {
    const db = store(), call = vi.fn().mockResolvedValue({ status: "success", text: "Synthetic answer", usage, requestId: "request", responseId: "response", actualModelId: "gpt-6-luna", latencyMs: 12 });
    expect(await executeClaimedWhatsappAnswer(input, { store: db, call })).toMatchObject({ ok: true, complete: true, text: "Synthetic answer" });
    expect(db.settle).toHaveBeenCalledWith(expect.objectContaining({ responseText: "Synthetic answer", usage, requestId: "request", responseId: "response", actualModelId: "gpt-6-luna", latencyMs: 12, costBaisa: expect.any(Number) }));
    expect(db.reserve).toHaveBeenCalledWith(expect.objectContaining({ sourceCitations: [{ sourceId: "knowledge", title: "Synthetic knowledge", contentVersion: 1 }] }));
  });
  it("reserves each definite permitted fallback separately", async () => {
    const db = store(), call = vi.fn().mockResolvedValueOnce({ status: "rejected", text: "", errorCode: "PROVIDER_HTTP_404", latencyMs: 0 }).mockResolvedValueOnce({ status: "success", text: "Synthetic answer", usage, actualModelId: "gemini-3.8-flash", latencyMs: 1 });
    expect(await executeClaimedWhatsappAnswer(input, { store: db, call })).toMatchObject({ ok: true });
    expect(db.reserve).toHaveBeenCalledTimes(2);
    expect(vi.mocked(db.reserve).mock.calls.map(([i]) => i.attempt)).toEqual([1, 2]);
    expect(vi.mocked(db.reserve).mock.calls.every(([i]) => i.reservedBaisa > 0)).toBe(true);
  });
  it("keeps unknown provider cost held and never attempts fallback", async () => {
    const db = store(), call = vi.fn().mockRejectedValue(Error("Synthetic timeout"));
    expect(await executeClaimedWhatsappAnswer(input, { store: db, call })).toMatchObject({ ok: false });
    expect(call).toHaveBeenCalledTimes(1);
    expect(db.settle).toHaveBeenCalledWith(expect.objectContaining({ status: "uncertain", costUsd: null, costBaisa: null, responseText: undefined }));
  });
  it("does not expose a successful draft when its durable settlement failed", async () => {
    const db = store(), call = vi.fn().mockResolvedValue({ status: "success", text: "Synthetic answer", usage, actualModelId: "gpt-6-luna", latencyMs: 1 });
    vi.mocked(db.settle).mockRejectedValue(Error("Synthetic persistence failure"));
    expect(await executeClaimedWhatsappAnswer(input, { store: db, call })).toMatchObject({ ok: false, error: "SETTLEMENT_PENDING_RECONCILIATION" });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("holds a response whose actual model identity is absent", async () => {
    const db = store(), call = vi.fn().mockResolvedValue({ status: "success", text: "Synthetic answer", usage, latencyMs: 1 });
    expect(await executeClaimedWhatsappAnswer(input, { store: db, call })).toMatchObject({ ok: false, error: "PROVIDER_MODEL_MISSING" });
    expect(call).toHaveBeenCalledTimes(1);
    expect(db.settle).toHaveBeenCalledWith(expect.objectContaining({ status: "uncertain", costBaisa: null, responseText: undefined }));
  });
  it("blocks malformed question before allocating cost", async () => {
    const db = store(), call = vi.fn();
    expect(await executeClaimedWhatsappAnswer({ ...input, question: "" }, { store: db, call })).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(db.reserve).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
  });
});

describe("claimed worker RPC store", () => {
  it("binds the paid reservation to the verified company persona and plan version", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, id: "attempt", job_id: "job", company_id: "company", automation_generation: 2, remaining_baisa: 7, answer_persona: "lina", answer_plan_version_id: "plan-version" }, error: null });
    admin.create.mockReturnValue({ rpc });
    const db = createClaimedWhatsappRuntimeStore({ jobId: "job", claimToken: "claim" }, { persona: "lina", planVersionId: "plan-version", companyId: "company" });
    expect(await db.reserve({ id: "attempt", attempt: 1, model: "gpt-6-luna", provider: "openai", reservedBaisa: 1, pricingVersion: "fixture", pricingSnapshot: {}, sourceCitations: [] })).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("ai_reserve_whatsapp_capacity_cost_attempt", expect.objectContaining({ p_expected_persona: "lina", p_expected_plan_version_id: "plan-version", p_job_id: "job", p_claim_token: "claim" }));
  });
  it.each([{ company_id: "other" }, { answer_persona: "dana" }, { answer_plan_version_id: "other-plan" }])("rejects a reservation acknowledgement outside its verified profile %#", async patch => {
    admin.create.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: { ok: true, id: "attempt", job_id: "job", company_id: "company", automation_generation: 2, remaining_baisa: 7, answer_persona: "lina", answer_plan_version_id: "plan-version", ...patch }, error: null }) });
    const db = createClaimedWhatsappRuntimeStore({ jobId: "job", claimToken: "claim" }, { persona: "lina", planVersionId: "plan-version", companyId: "company" });
    await expect(db.reserve({ id: "attempt", attempt: 1, model: "gpt-6-luna", provider: "openai", reservedBaisa: 1, pricingVersion: "fixture", pricingSnapshot: {} })).rejects.toThrow("ANSWER_PROFILE_MISMATCH");
  });
  it("binds reserve/start/settle to the job claim without a fabricated owner session", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { ok: true, id: "attempt", job_id: "job", company_id: "company", automation_generation: 2, remaining_baisa: 7 }, error: null }).mockResolvedValue({ data: true, error: null });
    admin.create.mockReturnValue({ rpc });
    const db = createClaimedWhatsappRuntimeStore({ jobId: "job", claimToken: "claim" });
    const sourceCitations = [{ sourceId: "knowledge", title: "Synthetic knowledge", contentVersion: 1 }];
    await db.reserve({ id: "attempt", attempt: 1, model: "gpt-6-luna", provider: "openai", reservedBaisa: 1, pricingVersion: "fixture", pricingSnapshot: {}, sourceCitations });
    await db.start("attempt");
    await db.settle({ id: "attempt", status: "success", costBaisa: 1, costUsd: .0026008, usage, responseText: "Synthetic draft", actualModelId: "gpt-6-luna", responseId: "response", latencyMs: 1 });
    expect(rpc.mock.calls[0]).toEqual(["ai_reserve_whatsapp_capacity_cost_attempt", expect.objectContaining({ p_job_id: "job", p_claim_token: "claim", p_source_citations: sourceCitations })]);
    expect(rpc.mock.calls[0][1]).not.toHaveProperty("p_actor_id");
    expect(rpc.mock.calls[1]).toEqual(["ai_start_whatsapp_attempt", { p_id: "attempt", p_claim_token: "claim" }]);
    expect(rpc.mock.calls[2]).toEqual(["ai_settle_whatsapp_attempt", expect.objectContaining({ p_claim_token: "claim", p_response_text: "Synthetic draft", p_usage: usage, p_actual_model_id: "gpt-6-luna", p_response_id: "response" })]);
  });
  it("rejects malformed reservation acknowledgments", async () => {
    admin.create.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: { ok: true, id: "attempt", job_id: "different-job", remaining_baisa: 1 }, error: null }) });
    const db = createClaimedWhatsappRuntimeStore({ jobId: "job", claimToken: "claim" });
    await expect(db.reserve({ id: "attempt", attempt: 1, model: "gpt-6-luna", provider: "openai", reservedBaisa: 1, pricingVersion: "fixture", pricingSnapshot: {} })).rejects.toThrow("INVALID_RESERVATION_RESULT");
  });
});
