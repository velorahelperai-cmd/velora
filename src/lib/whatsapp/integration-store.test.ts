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
  const rpc = vi.fn().mockImplementation(async name => ({ data: name === "billing_load_worker_frame" ? { ok: true, data: { ...frame } } : proof, error: null }));
  return { rpc };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T12:00:00Z")); vi.clearAllMocks(); });
afterEach(() => vi.useRealTimers());
describe("production integration context and send gates", () => {
  it("leaves fresh message capacity to the atomic cost reservation before the paid call", async () => {
    const db = client(), ports = createIntegrationPorts(binding, db as never);
    await ports.frame(); expect(await ports.reserve()).toBe(true);
    expect(db.rpc.mock.calls.filter(([name]) => name === "whatsapp_reserve_job_usage")).toHaveLength(0);
  });
  it("revalidates existing message capacity when recovering an already paid draft", async () => {
    const db = client();
    db.rpc.mockImplementation(async name => ({ data: name === "billing_load_worker_frame" ? { ok: true, data: { ...frame, ai_status: "success", ai_attempt_id: "attempt", reply_text: "Saved reply" } } : window, error: null }));
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
      return { data: name === "billing_load_worker_frame" ? { ok: true, data: { ...frame } } : window, error: null };
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
    db.rpc.mockImplementation(async name => ({ data: name === "billing_load_worker_frame"
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
    db.rpc.mockImplementation(async name => ({ data: name === "billing_load_worker_frame"
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
