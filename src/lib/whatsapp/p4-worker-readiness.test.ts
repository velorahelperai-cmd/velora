import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { runInboundWorkerAnswer } from "./inbound-worker";
import type { IntegrationFrame, IntegrationPorts } from "./integration-worker";
import { runOperationalAnswer, type WorkerPorts } from "@/lib/answers/operational-worker/run";

const input = { jobId: "job-fixture", claimToken: "claim-fixture", companyId: "company-fixture" };

function makePorts(patch: Partial<IntegrationPorts> = {}): IntegrationPorts {
  const frame: IntegrationFrame = {
    job_id: input.jobId,
    company_id: input.companyId,
    message_id: "message-fixture",
    conversation_id: "conversation-fixture",
    phone_number_id: "phone-fixture",
    recipient_wa_id: "recipient-fixture",
    automation_generation: 0,
    link_id: "link-fixture",
    link_generation: 1,
    question: "Fixture question",
    ai_status: null,
    reply_text: null,
    ai_attempt_id: null,
    intent_id: null,
    staged_citations: null,
  };
  const chunks = [{ sourceId: "source-fixture", title: "Approved fixture", contentVersion: 1, text: "Fixture knowledge" }];
  const intent = { id: "intent-fixture", outcome: "attempting", company_id: input.companyId, conversation_id: "conversation-fixture", phone_number_id: "phone-fixture", recipient_wa_id: "recipient-fixture", body: "Answer" };
  return {
    enabled: true,
    frame: vi.fn(async () => frame),
    context: vi.fn(async () => chunks),
    verify: vi.fn(async () => true),
    secret: vi.fn(async () => "synthetic-token"),
    reserve: vi.fn(async () => true),
    answer: vi.fn(async () => ({ ok: false, complete: false, code: "PROCESSING_DISABLED", text: "", attempts: [] })),
    stage: vi.fn(async () => "intent-fixture"),
    claimSend: vi.fn(async () => ({ ok: true, claimed: true, attempt_token: "send-claim", intent })),
    send: vi.fn(async () => ({ ok: true, waMessageId: "wamid.fixture" })),
    finalize: vi.fn(async () => true),
    finish: vi.fn(async () => "accepted"),
    repair: vi.fn(async () => true),
    retry: vi.fn(async () => {}),
    heartbeat: vi.fn(async () => true),
    ...patch,
  };
}

describe("P4 worker preparation boundary on unified pipeline", () => {
  it("rejects worker invocation when ports are omitted", async () => {
    // @ts-expect-error verifying explicit rejection when ports are omitted
    expect(await runInboundWorkerAnswer(input)).toMatchObject({
      ok: false,
      code: "PORTS_REQUIRED",
      jobCompleted: false,
      sendAccepted: false,
      delivered: false,
    });
  });

  it("preserves disabled-worker outcome for a valid stored claim", async () => {
    const ports = makePorts({ enabled: false });
    expect(await runInboundWorkerAnswer(input, ports)).toMatchObject({
      ok: false,
      code: "WORKER_DISABLED",
      jobCompleted: false,
      sendAccepted: false,
      delivered: false,
    });
    expect(ports.frame).not.toHaveBeenCalled();
  });

  it("does not prepare AI for another tenant's job", async () => {
    const ports = makePorts({
      frame: async () => ({
        job_id: input.jobId,
        company_id: "foreign-company",
        message_id: "message-fixture",
        conversation_id: "conversation-fixture",
        phone_number_id: "phone-fixture",
        recipient_wa_id: "recipient-fixture",
        automation_generation: 0,
        link_id: "link-fixture",
        link_generation: 1,
        question: "Fixture question",
        ai_status: null,
        reply_text: null,
        ai_attempt_id: null,
        intent_id: null,
        staged_citations: null,
      }),
    });
    expect(await runInboundWorkerAnswer(input, ports)).toMatchObject({
      ok: false,
      jobCompleted: false,
    });
    expect(ports.answer).not.toHaveBeenCalled();
    expect(ports.send).not.toHaveBeenCalled();
  });

  it("does not prepare AI when claim frame is missing or expired", async () => {
    const ports = makePorts({ frame: async () => null });
    expect(await runInboundWorkerAnswer(input, ports)).toMatchObject({
      ok: false,
      code: "CLAIM_BINDING_REJECTED",
    });
    expect(ports.answer).not.toHaveBeenCalled();
  });

  it("does not invoke AI for inactive subscription or denied reservation", async () => {
    const ports = makePorts({ reserve: async () => false });
    expect(await runInboundWorkerAnswer(input, ports)).toMatchObject({
      ok: false,
      code: "ENTITLEMENT_OR_USAGE_DENIED",
      sendAccepted: false,
      jobCompleted: false,
    });
    expect(ports.answer).not.toHaveBeenCalled();
  });

  it("keeps employee handoff outcome and never claims send or completion", async () => {
    const ports = makePorts({
      frame: async () => ({
        job_id: input.jobId,
        company_id: input.companyId,
        message_id: "message-fixture",
        conversation_id: "conversation-fixture",
        phone_number_id: "phone-fixture",
        recipient_wa_id: "recipient-fixture",
        automation_generation: 0,
        link_id: "link-fixture",
        link_generation: 1,
        question: "I want a refund",
        ai_status: null,
        reply_text: null,
        ai_attempt_id: null,
        intent_id: null,
        staged_citations: null,
      }),
    });
    expect(await runInboundWorkerAnswer(input, ports)).toMatchObject({
      code: "HUMAN_REVIEW_REQUIRED",
      sendAccepted: false,
      delivered: false,
      jobCompleted: false,
    });
    expect(ports.retry).toHaveBeenCalledWith("HUMAN_REVIEW_REQUIRED", false, true);
    expect(ports.send).not.toHaveBeenCalled();
  });

  it("contains preparation failure without marking work complete", async () => {
    const ports = makePorts({
      answer: async () => { throw new Error("fixture failure"); },
    });
    expect(await runInboundWorkerAnswer(input, ports)).toMatchObject({
      code: "WORKER_UNAVAILABLE",
      jobCompleted: false,
      sendAccepted: false,
    });
  });

  it("rejects invalid input before invoking ports", async () => {
    const ports = makePorts();
    expect(await runInboundWorkerAnswer({ ...input, jobId: "" }, ports)).toMatchObject({
      code: "INVALID_INPUT",
      sendAccepted: false,
    });
    expect(ports.frame).not.toHaveBeenCalled();
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
