import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => { throw Error("inject client"); } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw Error("inject client"); } }));
const send = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true, waMessageId: "synthetic-wamid" }));
vi.mock("./send", () => ({ sendWhatsappText: send }));
import { createIntegrationPorts } from "./integration-store";
import type { IntegrationFrame } from "./integration-worker";
const binding = { jobId: "job", claimToken: "claim", companyId: "company" };
const frame: IntegrationFrame = { job_id: "job", company_id: "company", message_id: "message", conversation_id: "conversation", phone_number_id: "phone", recipient_wa_id: "recipient", automation_generation: 1, link_id: "link", link_generation: 1, question: "Espresso price?", ai_status: null, reply_text: null, ai_attempt_id: null, intent_id: null, staged_citations: null };
const window = { ok: true, company_id: "company", conversation_id: "conversation", phone_number_id: "phone", recipient_wa_id: "recipient", last_inbound_at: "2026-10-08T11:00:00Z", valid_until: "2026-10-09T11:00:00Z" };
const intent = { id: "intent", outcome: "attempting", company_id: "company", conversation_id: "conversation", phone_number_id: "phone", recipient_wa_id: "recipient", body: "1.200 OMR." };
function client(proof: unknown = window) {
  const rpc = vi.fn().mockImplementation(async name => ({ data: name === "es02_classify_claimed_reply" ? { ok: true, recipientClass: "legacy" } : name === "billing_load_worker_frame" ? { ok: true, data: { ...frame } } : proof, error: null }));
  return { rpc };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T12:00:00Z")); vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("production integration context and send gates", () => {
  it("leaves fresh message capacity to the atomic cost reservation before the paid call", async () => {
    const db = client(), ports = createIntegrationPorts(binding, db as never);
    await ports.frame(); expect(await ports.reserve()).toBe(true);
    expect(db.rpc.mock.calls.filter(([name]) => name === "whatsapp_reserve_job_usage")).toHaveLength(0);
  });
  it("revalidates existing message capacity when recovering an already paid draft", async () => {
    const db = client();
    db.rpc.mockImplementation(async name => ({ data: name === "es02_classify_claimed_reply" ? { ok: true, recipientClass: "legacy" } : name === "billing_load_worker_frame" ? { ok: true, data: { ...frame, ai_status: "success", ai_attempt_id: "attempt", reply_text: "Saved reply" } } : window, error: null }));
    const ports = createIntegrationPorts(binding, db as never); await ports.frame(); expect(await ports.reserve()).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("whatsapp_reserve_job_usage", { p_job_id: "job", p_claim_token: "claim" });
  });
  it.each(["rpc-error", "transport-throw"])("keeps confirmed OAuth rejection independent of a separate cleanup failure: %s", async failure => {
    const db = client();
    db.rpc.mockImplementation(async name => {
      if (name === "whatsapp_revoke_failed_credential") {
        if (failure === "transport-throw") throw Error("synthetic cleanup transport failure");
        return { data: null, error: true };
      }
      return { data: name === "es02_classify_claimed_reply" ? { ok: true, recipientClass: "legacy" } : name === "billing_load_worker_frame" ? { ok: true, data: { ...frame } } : window, error: null };
    });
    const ports = createIntegrationPorts(binding, db as never); await ports.frame();
    send.mockResolvedValueOnce({ ok: false, code: "GRAPH_REJECTED", detail: "graph_190" });
    await expect(ports.send(intent, "synthetic-token")).resolves.toMatchObject({ ok: false, code: "GRAPH_REJECTED", detail: "graph_190" });
  });
  it("reads exact fresh server window evidence when loading a frame", async () => {
    const db = client(), ports = createIntegrationPorts(binding, db as never);
    expect(await ports.frame()).toMatchObject({ service_window_expires_at: "2026-10-09T11:00:00Z" });
    expect(db.rpc).toHaveBeenCalledWith("whatsapp_check_service_window", { p_company_id: "company", p_conversation_id: "conversation", p_phone_number_id: "phone", p_recipient_wa_id: "recipient" });
  });
  it("fails the frame when its persisted service window is absent", async () => {
    const ports = createIntegrationPorts(binding, client({ ok: false }) as never);
    await expect(ports.frame()).rejects.toMatchObject({ code: "SERVICE_WINDOW_CLOSED" });
  });
  it("queries only approved sources relevant to the stored job question", async () => {
    const db = client();
    db.rpc.mockResolvedValue({ data: { ok: true, company_id: "company", job_id: "job", sources: [{ id: "menu", company_id: "company", title: "Menu", content: "Espresso 1.200 OMR.", content_version: 3, approved_version: 3, approved_for_answers: true, status: "ready", kind: "text", storage_path: null, byte_size: null, updated_at: "2026-10-08T10:00:00Z", usage_role: "knowledge" }] }, error: null });
    const ports = createIntegrationPorts(binding, db as never);
    expect(await ports.context(frame)).toMatchObject([{ sourceId: "menu", text: "Espresso 1.200 OMR.", contentVersion: 3 }]);
    expect(db.rpc).toHaveBeenCalledWith("whatsapp_retrieve_approved_knowledge", { p_company_id: "company", p_job_id: "job", p_claim_token: "claim", p_question: "Espresso price?" });
  });
  it("rechecks window immediately before send and supplies its current expiry", async () => {
    const db = client(), ports = createIntegrationPorts(binding, db as never);
    await ports.frame();
    expect(await ports.send(intent, "synthetic-secret")).toMatchObject({ ok: true });
    expect(db.rpc.mock.calls.filter(([name]) => name === "whatsapp_check_service_window")).toHaveLength(2);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ serviceWindowExpiresAt: "2026-10-09T11:00:00Z" }));
  });
  it("does not contact the provider if window authorization expired after claim", async () => {
    const db = client(), ports = createIntegrationPorts(binding, db as never);
    await ports.frame();
    db.rpc.mockResolvedValue({ data: { ok: false, code: "service_window_closed" }, error: null });
    expect(await ports.send(intent, "synthetic-secret")).toEqual({ ok: false, code: "SERVICE_WINDOW_CLOSED" });
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["usage_not_configured", "usage_exhausted", "subscription_inactive", "NOURA_JOB_AUTHORITY_CHANGED", "NOURA_SERVICE_NOT_ACTIVE"])("saved draft cannot bypass authoritative quota/plan denial: %s", async code => {
    const db = client();
    db.rpc.mockImplementation(async name => ({ data: name === "es02_classify_claimed_reply" ? { ok: true, recipientClass: "legacy" } : name === "billing_load_worker_frame"
      ? { ok: true, data: { ...frame, ai_status: "success", ai_attempt_id: "attempt", reply_text: "Saved reply" } }
      : name === "whatsapp_reserve_job_usage" ? { ok: false, code } : window, error: null }));
    const ports = createIntegrationPorts(binding, db as never);
    await ports.frame();
    const results = await Promise.all(Array.from({ length: 8 }, () => ports.reserve()));
    expect(results).toEqual(Array(8).fill(false));
    expect(db.rpc.mock.calls.filter(([name]) => name === "whatsapp_reserve_job_usage")).toHaveLength(8);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([null, {}, { ok: "true" }, { ok: false, limit: 0 }, { ok: false, limit: null }])("unknown or zero quota denial never becomes unlimited: %j", async quota => {
    const db = client();
    db.rpc.mockImplementation(async name => ({ data: name === "es02_classify_claimed_reply" ? { ok: true, recipientClass: "legacy" } : name === "billing_load_worker_frame"
      ? { ok: true, data: { ...frame, ai_status: "success", ai_attempt_id: "attempt", reply_text: "Saved reply" } }
      : name === "whatsapp_reserve_job_usage" ? quota : window, error: null }));
    const ports = createIntegrationPorts(binding, db as never);
    await ports.frame(); expect(await ports.reserve()).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
  it("forwards unknown settlement as unknown, never converts it to released or accepted", async () => {
    const db = client({ ok: true, status: "unknown" });
    const ports = createIntegrationPorts(binding, db as never);
    expect(await ports.finish("intent")).toBe("unknown");
    expect(db.rpc).toHaveBeenCalledWith("billing_finalize_automated_usage", { p_company_id: "company", p_intent_id: "intent" });
    expect(send).not.toHaveBeenCalled();
  });
});


describe("trusted recipient binding before operational frame", () => {
  it("binds the original job claim before reading a worker frame", async () => {
    const db = client(), ports = createIntegrationPorts(binding, db as never);
    await ports.frame();
    expect(db.rpc.mock.calls.slice(0, 2).map(([name]) => name)).toEqual(["es02_classify_claimed_reply", "billing_load_worker_frame"]);
    expect(db.rpc).toHaveBeenCalledWith("es02_classify_claimed_reply", expect.objectContaining({ p_job_id: "job", p_claim_token: "claim" }));
  });
  it.each([null, {}, { ok: true }, { ok: true, recipientClass: "unknown" }, { ok: false, code: "CLASSIFICATION_CHANGED" }])("denies a frame and provider dispatch for unbound classification %j", async classification => {
    const db = client();
    db.rpc.mockImplementation(async name => ({ data: name === "es02_classify_claimed_reply" ? classification : { ok: true, data: { ...frame } }, error: null }));
    const ports = createIntegrationPorts(binding, db as never);
    await expect(ports.frame()).rejects.toThrow("RECIPIENT_CLASSIFICATION_UNAVAILABLE");
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(["es02_classify_claimed_reply"]);
    expect(await ports.reserve()).toBe(false);
    expect(await ports.send(intent, "synthetic-secret")).toEqual({ ok: false, code: "NEEDS_SETUP" });
    expect(send).not.toHaveBeenCalled();
  });
  it("invalidates a previously cached frame when classification can no longer be proved", async () => {
    const db = client(), ports = createIntegrationPorts(binding, db as never);
    await ports.frame();
    db.rpc.mockImplementation(async name => ({ data: name === "es02_classify_claimed_reply" ? { ok: false, code: "CLASSIFICATION_CHANGED" } : window, error: null }));
    await expect(ports.frame()).rejects.toThrow("RECIPIENT_CLASSIFICATION_UNAVAILABLE");
    expect(await ports.reserve()).toBe(false);
    expect(await ports.send(intent, "synthetic-secret")).toEqual({ ok: false, code: "NEEDS_SETUP" });
    expect(send).not.toHaveBeenCalled();
  });
  it("passes meta-test configuration as a test-number snapshot without a clock mutation RPC", async () => {
    vi.stubEnv("WHATSAPP_CONFIGURATION_MODE", "meta_test");
    vi.stubEnv("WHATSAPP_TEST_PHONE_NUMBER_ID", "synthetic-test-phone");
    vi.stubEnv("WHATSAPP_TEST_RECIPIENTS", "96890000000");
    const db = client();
    db.rpc.mockImplementation(async name => ({ data: name === "es02_classify_claimed_reply" ? { ok: true, recipientClass: "test_number" } : name === "billing_load_worker_frame" ? { ok: true, data: { ...frame } } : window, error: null }));
    const ports = createIntegrationPorts(binding, db as never);
    await ports.frame();
    expect(db.rpc).toHaveBeenCalledWith("es02_classify_claimed_reply", { p_job_id: "job", p_claim_token: "claim", p_configuration_mode: "meta_test", p_test_phone_number_id: "synthetic-test-phone", p_test_recipients: ["96890000000"] });
    expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(["es02_classify_claimed_reply", "billing_load_worker_frame", "whatsapp_check_service_window"]);
    expect(send).not.toHaveBeenCalled();
  });
});


// RPC-contract doubles; native SQL owns branch-page/hours version authority.
const es02Citations = [
  { sourceId: "page-3701c3a6-026c-43b5-b23c-2858d4ae0477", title: "Synthetic indexed page", contentVersion: 2 },
  { sourceId: "hours-3701c3a6-026c-43b5-b23c-2858d4ae0477", title: "Synthetic saved hours", contentVersion: 3 },
];
function citationClient(proof: unknown = { ok: true, company_id: "company", job_id: "job" }) {
  const rpc = vi.fn().mockImplementation(async name => ({ data: name === "es02_classify_claimed_reply" ? { ok: true, recipientClass: "real_customer" }
    : name === "billing_load_worker_frame" ? { ok: true, data: { ...frame, authority: "es02" } }
    : name === "es02_verify_claimed_reply_citations" ? proof : window, error: null }));
  const from = vi.fn(() => { throw Error("ES02 page/hour IDs must not fall back to native knowledge UUID reads"); });
  return { rpc, from };
}
describe("ES02 claimed branch citation verification", () => {
  it("revalidates page and hours citations through the exact native job claim RPC", async () => {
    const db = citationClient(), ports = createIntegrationPorts(binding, db as never);
    const loaded = await ports.frame();
    expect(loaded).toMatchObject({ authority: "es02" });
    expect(await ports.verify(loaded!, es02Citations)).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("es02_verify_claimed_reply_citations", { p_job_id: "job", p_claim_token: "claim", p_source_citations: es02Citations });
    expect(db.from).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls.map(([name]) => name)).not.toContain("es02_reserve_whatsapp_capacity_cost_attempt");
  });
  it.each([null, {}, { ok: false, code: "KNOWLEDGE_CHANGED" }, { ok: true, company_id: "foreign-company", job_id: "job" }, { ok: true, company_id: "company", job_id: "foreign-job" }])("denies invalid or foreign citation proof without native fallback: %j", async proof => {
    const db = citationClient(proof), ports = createIntegrationPorts(binding, db as never);
    const loaded = await ports.frame();
    expect(await ports.verify(loaded!, es02Citations)).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it("does not verify an ES02 frame as a legacy one after authority changes", async () => {
    const db = citationClient(), ports = createIntegrationPorts(binding, db as never);
    const loaded = await ports.frame();
    db.rpc.mockImplementation(async name => ({ data: name === "es02_classify_claimed_reply" ? { ok: true, recipientClass: "legacy" } : name === "billing_load_worker_frame" ? { ok: true, data: { ...frame } } : window, error: null }));
    expect(await ports.verify(loaded!, es02Citations)).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("rejects an unknown frame authority instead of treating it as legacy", async () => {
    const db = citationClient();
    db.rpc.mockImplementation(async name => ({ data: name === "es02_classify_claimed_reply" ? { ok: true, recipientClass: "legacy" } : name === "billing_load_worker_frame" ? { ok: true, data: { ...frame, authority: "unknown" } } : window, error: null }));
    expect(await createIntegrationPorts(binding, db as never).frame()).toBeNull();
  });
  it("does not replace empty ES02 citations with fresh knowledge", async () => {
    const db = citationClient(), ports = createIntegrationPorts(binding, db as never);
    const loaded = await ports.frame();
    expect(await ports.verify(loaded!, [])).toBe(false);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc.mock.calls.map(([name]) => name)).not.toContain("whatsapp_retrieve_approved_knowledge");
  });
});
