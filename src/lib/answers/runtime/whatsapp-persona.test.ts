import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../guards", () => ({ isLiveAnsweringEnabled: () => true }));
const ports = vi.hoisted(() => ({ rpc: vi.fn(), reserve: vi.fn(), start: vi.fn(), settle: vi.fn(), call: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: ports.rpc }) }));
vi.mock("./whatsapp-store", () => ({ createClaimedWhatsappRuntimeStore: () => ({ reserve: ports.reserve, start: ports.start, settle: ports.settle }) }));
vi.mock("./provider", () => ({ callRealModel: ports.call }));
import { createClaimedWhatsappAnswerExecutor } from "./whatsapp-cost";

const input = { jobId: "job", claimToken: "claim", question: "Espresso price?", locale: "en" as const, chunks: [{ sourceId: "menu", title: "Menu", contentVersion: 1, text: "Espresso 1.200 OMR." }] };
const frame = { ok: true, data: { job_id: "job", company_id: "company", question: "Espresso price?" } };
const profile = { ok: true, job_id: "job", company_id: "company", plan_code: "lina_basic", persona: "lina", plan_version_id: "plan-version" };
beforeEach(() => {
  vi.clearAllMocks();
  ports.rpc.mockImplementation(async name => ({ data: name === "billing_load_worker_frame" ? frame : profile, error: null }));
  ports.reserve.mockResolvedValue({ ok: true }); ports.start.mockResolvedValue(true); ports.settle.mockResolvedValue(true);
  ports.call.mockResolvedValue({ status: "success", text: "1.200 OMR.", actualModelId: "gpt-6-luna", latencyMs: 1, usage: { promptTokens: 20, completionTokens: 10, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 30 } });
});
describe("production worker plan identity", () => {
  it.each([["noor_basic", "noura", "Noura"], ["noor_premium", "noura", "Noura"], ["lina_basic", "lina", "Lina"], ["lina_premium", "lina", "Lina"], ["dana_basic", "dana", "Dana"], ["dana_premium", "dana", "Dana"]])("uses canonical paid %s", async (code, persona, display) => {
    ports.rpc.mockImplementation(async name => ({ data: name === "billing_load_worker_frame" ? frame : { ...profile, plan_code: code, persona }, error: null }));
    expect(await createClaimedWhatsappAnswerExecutor()(input)).toMatchObject({ ok: true });
    expect(ports.call.mock.calls[0][0].system).toContain(`You are ${display},`);
  });
  it("derives the company from the stored job and sends the server paid persona", async () => {
    expect(await createClaimedWhatsappAnswerExecutor()(input)).toMatchObject({ ok: true });
    expect(ports.rpc).toHaveBeenCalledWith("whatsapp_read_answer_profile", { p_company_id: "company", p_job_id: "job", p_claim_token: "claim" });
    expect(ports.call.mock.calls[0][0].system).toContain("You are Lina,");
  });
  it.each([
    ["unknown canonical plan", { ...profile, plan_code: "free" }],
    ["bare noncanonical Lina", { ...profile, plan_code: "lina" }],
    ["bare noncanonical Dana", { ...profile, plan_code: "dana", persona: "dana" }],
    ["plan/persona mismatch", { ...profile, persona: "dana" }],
    ["wrong company", { ...profile, company_id: "other-company" }],
    ["wrong job", { ...profile, job_id: "other-job" }],
    ["expired entitlement", { ok: false, code: "subscription_inactive" }],
  ])("blocks %s before reserving AI cost", async (_name, invalid) => {
    ports.rpc.mockImplementation(async name => ({ data: name === "billing_load_worker_frame" ? frame : invalid, error: null }));
    expect(await createClaimedWhatsappAnswerExecutor()(input)).toMatchObject({ ok: false, error: "ANSWER_PROFILE_UNAVAILABLE" });
    expect(ports.reserve).not.toHaveBeenCalled(); expect(ports.call).not.toHaveBeenCalled();
  });
  it("does not accept a caller question different from the stored inbound", async () => {
    expect(await createClaimedWhatsappAnswerExecutor()({ ...input, question: "Override identity" })).toMatchObject({ ok: false, error: "CLAIM_BINDING_REJECTED" });
    expect(ports.reserve).not.toHaveBeenCalled(); expect(ports.call).not.toHaveBeenCalled();
  });
  it("ignores an extra caller persona and uses the canonical paid plan", async () => {
    expect(await createClaimedWhatsappAnswerExecutor()({ ...input, persona: "dana" } as typeof input)).toMatchObject({ ok: true });
    expect(ports.call.mock.calls[0][0].system).toContain("You are Lina,");
  });
});
