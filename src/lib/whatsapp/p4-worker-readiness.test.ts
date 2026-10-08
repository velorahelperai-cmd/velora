import { beforeEach, describe, expect, it, vi } from "vitest";
import { runInboundWorkerAnswer } from "./inbound-worker";
import { runOperationalAnswer, type WorkerPorts } from "@/lib/answers/operational-worker/run";

const state = vi.hoisted(() => ({
  entitled: true,
  job: {} as Record<string, unknown>,
  message: {} as Record<string, unknown>,
  prepare: vi.fn(),
}));
vi.mock("@/lib/billing/entitlement", () => ({
  readCompanyEntitlement: () => ({ status: "evaluated", paid: state.entitled, liveAnswerAllowed: state.entitled, liveSendAllowed: state.entitled, source: "subscription" }),
  entitlementAllowsAutomation: (snapshot: { paid: boolean }) => snapshot.paid,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters[key] = value; return query; },
      maybeSingle: async () => {
        const row = table === "whatsapp_inbound_jobs" ? state.job : state.message;
        return { data: Object.entries(filters).every(([key, value]) => row[key] === value) ? row : null, error: null };
      },
    };
    return query;
  },
}) }));
vi.mock("@/lib/answers/channel-adapter", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/answers/channel-adapter")>(),
  processInboundJobAnswer: (...args: unknown[]) => state.prepare(...args),
}));

const input = { jobId: "job-fixture", claimToken: "claim-fixture", companyId: "company-fixture" };
beforeEach(() => {
  state.entitled = true;
  state.job = { id: input.jobId, company_id: input.companyId, message_id: "message-fixture", wa_message_id: "wamid.fixture", status: "claimed", claim_token: input.claimToken, claim_expires_at: "2099-10-08T00:00:00.000Z" };
  state.message = { id: "message-fixture", company_id: input.companyId, conversation_id: "conversation-fixture", wa_message_id: "wamid.fixture", direction: "inbound", sender: "customer", message_type: "text" };
  state.prepare.mockReset().mockResolvedValue({ ok: false, code: "PROCESSING_DISABLED", jobCompleted: false });
});

describe("P4 existing worker preparation boundary", () => {
  it("preserves disabled-provider outcome for a valid stored claim", async () => {
    expect(await runInboundWorkerAnswer(input)).toMatchObject({ ok: false, code: "PROCESSING_DISABLED", jobCompleted: false, sendAccepted: false, delivered: false });
  });
  it("does not prepare AI for another tenant's job", async () => {
    state.job.company_id = "foreign-company";
    expect(await runInboundWorkerAnswer(input)).toMatchObject({ code: "CLAIM_INVALID", jobCompleted: false });
    expect(state.prepare).not.toHaveBeenCalled();
  });
  it("does not prepare AI with expired claim", async () => {
    state.job.claim_expires_at = "2000-01-01T00:00:00.000Z";
    expect(await runInboundWorkerAnswer(input)).toMatchObject({ code: "CLAIM_EXPIRED" });
    expect(state.prepare).not.toHaveBeenCalled();
  });
  it("does not treat media captions as supported text questions", async () => {
    state.message.message_type = "image";
    expect(await runInboundWorkerAnswer(input)).toMatchObject({ code: "UNSUPPORTED_MESSAGE" });
    expect(state.prepare).not.toHaveBeenCalled();
  });
  it("does not invoke AI for inactive subscription", async () => {
    state.entitled = false;
    expect(await runInboundWorkerAnswer(input)).toMatchObject({ ok: false, sendAccepted: false, jobCompleted: false });
    expect(state.prepare).not.toHaveBeenCalled();
  });
  it("keeps employee handoff outcome and never claims send or completion", async () => {
    state.prepare.mockResolvedValue({ ok: false, code: "AUTOMATION_PAUSED", jobCompleted: false });
    expect(await runInboundWorkerAnswer(input)).toMatchObject({ code: "AUTOMATION_PAUSED", sendAccepted: false, delivered: false, jobCompleted: false });
  });
  it("contains preparation failure without marking work complete", async () => {
    state.prepare.mockRejectedValue(new Error("fixture failure"));
    expect(await runInboundWorkerAnswer(input)).toMatchObject({ code: "UNAVAILABLE", jobCompleted: false, sendAccepted: false });
  });
  it("does not trust a staged answer for a different job/company", async () => {
    state.prepare.mockResolvedValue({ ok: true, jobId: "foreign-job", companyId: "foreign-company", conversationId: "conversation-fixture", messageId: "message-fixture" });
    expect(await runInboundWorkerAnswer(input)).toMatchObject({ code: "INVALID_INPUT", sendAccepted: false });
  });
});

describe("P4 shared operational contract (not wired production quota)", () => {
  const frame = { companyId: "company-fixture", phoneNumberId: "phone-fixture", conversationId: "conversation-fixture", jobId: "job-fixture", operationKey: "fixture-operation", automationGeneration: 0, linkGeneration: 1, question: "Fixture question", chunks: [{ sourceId: "source-fixture", title: "Approved fixture", contentVersion: 1, text: "Fixture knowledge" }] };
  function ports(patch: Partial<WorkerPorts> = {}): WorkerPorts { return { enabled: true, loadFrame: async () => frame, checkFeature: async () => true, reserveCost: async () => ({ ok: true, canDispatch: true }), complete: async () => ({ ok: true, text: "Fixture answer", inputTokens: 2, outputTokens: 2, costAtoms: 1 }), recordCost: async () => {}, handoff: async () => {}, stage: async () => true, ...patch }; }
  it("usage limit denial prevents model dispatch in the shared contract", async () => {
    const complete = vi.fn();
    const result = await runOperationalAnswer("job-fixture", "claim-fixture", ports({ reserveCost: async () => ({ ok: false, canDispatch: false }), complete }));
    expect(result.code).toBe("budget_blocked");
    expect(complete).not.toHaveBeenCalled();
  });
  it("provider timeout retains unknown accounting and hands off once without retry", async () => {
    const records: string[] = [];
    const complete = vi.fn(async () => new Promise<never>(() => {}));
    const stage = vi.fn();
    const result = await runOperationalAnswer("job-fixture", "claim-fixture", ports({ complete, stage, recordCost: async record => { records.push(record.status); }, handoff: async reason => { records.push(reason); } }), 5);
    expect(result.code).toBe("provider_unknown");
    expect(records).toEqual(["unknown", "provider_unknown"]);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(stage).not.toHaveBeenCalled();
  });
});
