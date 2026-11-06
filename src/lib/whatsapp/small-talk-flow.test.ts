import { describe, expect, it, vi } from "vitest";
import { runPersistedInboundJob, type IntegrationPorts, type IntegrationFrame } from "./integration-worker";
import type { AnswerContextChunk } from "@/lib/answers/types";

function mockPorts(frame: IntegrationFrame, overrides?: Partial<IntegrationPorts>): IntegrationPorts {
  return {
    enabled: true,
    frame: vi.fn(async () => frame),
    context: vi.fn(async () => [
      { sourceId: "services-1", title: "Services", contentVersion: 1, text: "تقدم تاجسيم خدمات التصميم والبرمجة." },
    ] as AnswerContextChunk[]),
    verify: vi.fn(async () => ({ ok: true as const })),
    secret: vi.fn(async () => "test_token"),
    reserve: vi.fn(async () => true),
    answer: vi.fn(async () => ({
      ok: true,
      complete: true,
      text: "خدماتنا تشمل التصميم والبرمجة.",
      attempts: [{ id: "attempt-1", status: "success" }],
    })),
    stage: vi.fn(async () => "intent-1"),
    claimSend: vi.fn(async () => ({
      ok: true,
      claimed: true,
      attempt_token: "token-1",
      intent: {
        id: "intent-1",
        outcome: "ready",
        company_id: frame.company_id,
        conversation_id: frame.conversation_id,
        phone_number_id: frame.phone_number_id,
        recipient_wa_id: frame.recipient_wa_id,
        body: "خدماتنا تشمل التصميم والبرمجة.",
      },
    })),
    send: vi.fn(async () => ({ ok: true, waMessageId: "wamid.123" })),
    finalize: vi.fn(async () => true),
    finish: vi.fn(async () => "accepted"),
    repair: vi.fn(async () => true),
    retry: vi.fn(async () => {}),
    heartbeat: vi.fn(async () => true),
    ...overrides,
  };
}

describe("WhatsApp small-talk targeted flow & safety gates", () => {
  const baseFrame: IntegrationFrame = {
    job_id: "job-1",
    company_id: "company-1",
    conversation_id: "conv-1",
    message_id: "msg-1",
    phone_number_id: "phone-1",
    recipient_wa_id: "96893180420",
    automation_generation: 1,
    link_id: "link-1",
    link_generation: 1,
    question: "ما هي الخدمات التي تقدمها تاجسيم؟",
    ai_status: null,
    reply_text: null,
    ai_attempt_id: null,
    intent_id: null,
    staged_citations: null,
  };

  it("services -> thanks -> services sequence completes automatically without human handover", async () => {
    // 1. Initial services question
    const ports1 = mockPorts({ ...baseFrame, job_id: "job-1", question: "ما هي الخدمات التي تقدمها تاجسيم؟" });
    const res1 = await runPersistedInboundJob({ jobId: "job-1", claimToken: "claim-1", companyId: "company-1" }, ports1);
    expect(res1.ok).toBe(true);
    expect(res1.code).toBe("ACCEPTED");
    expect(ports1.context).toHaveBeenCalled();
    expect(ports1.retry).not.toHaveBeenCalled();

    // 2. Pure thanks «شكرا» - pure small-talk
    // Context is empty (no business knowledge for thanks), but it must NOT fail with APPROVED_KNOWLEDGE_REQUIRED
    const ports2 = mockPorts(
      { ...baseFrame, job_id: "job-2", question: "شكرا" },
      {
        context: vi.fn(async () => []), // no knowledge sources
        stage: vi.fn(async () => "intent-2"),
        answer: vi.fn(async () => ({
          ok: true,
          complete: true,
          text: "العفو! في خدمتك دائماً.",
          attempts: [{ id: "attempt-2", status: "success" }],
        })),
        claimSend: vi.fn(async () => ({
          ok: true,
          claimed: true,
          attempt_token: "token-2",
          intent: {
            id: "intent-2",
            outcome: "ready",
            company_id: "company-1",
            conversation_id: "conv-1",
            phone_number_id: "phone-1",
            recipient_wa_id: "96893180420",
            body: "العفو! في خدمتك دائماً.",
          },
        })),
      }
    );
    const res2 = await runPersistedInboundJob({ jobId: "job-2", claimToken: "claim-2", companyId: "company-1" }, ports2);
    expect(res2.ok).toBe(true);
    expect(res2.code).toBe("ACCEPTED");
    // Crucial: context was NOT required to be non-empty, and retry/escalation was NOT called
    expect(ports2.retry).not.toHaveBeenCalled();
    expect(ports2.stage).toHaveBeenCalledWith("attempt-2", []);

    // 3. Subsequent services question continues uninterrupted
    const ports3 = mockPorts({ ...baseFrame, job_id: "job-3", question: "ما هي الخدمات التي تقدمها تاجسيم؟" });
    const res3 = await runPersistedInboundJob({ jobId: "job-3", claimToken: "claim-3", companyId: "company-1" }, ports3);
    expect(res3.ok).toBe(true);
    expect(res3.code).toBe("ACCEPTED");
    expect(ports3.retry).not.toHaveBeenCalled();
  });

  it("compound message (thanks + commercial inquiry) routes to knowledge and answers politely on NO_MATCH without handover", async () => {
    // "شكرًا، والأسعار كام؟" contains thanks but also a commercial inquiry.
    // It must NOT be reduced to pure social small-talk shortcut ("العفو").
    // When context returns [] (NO_MATCH), it answers politely with empty citations,
    // does NOT dead-letter, does NOT disable automation, and completes successfully.
    const ports = mockPorts(
      { ...baseFrame, job_id: "job-compound", question: "شكرًا، والأسعار كام؟" },
      {
        context: vi.fn(async () => []), // empty knowledge match (NO_MATCH)
        answer: vi.fn(async (_f, chunks) => {
          expect(chunks).toEqual([]);
          return {
            ok: true,
            complete: true,
            text: "عذراً، أسعار هذه الخدمات غير متوفرة لدي حالياً. هل ترغب في معرفة تفاصيل الخدمات أولاً؟",
            attempts: [{ id: "attempt-no-match", status: "success" }],
          };
        }),
      }
    );
    const res = await runPersistedInboundJob({ jobId: "job-compound", claimToken: "claim-c", companyId: "company-1" }, ports);
    expect(res.ok).toBe(true);
    expect(res.code).toBe("ACCEPTED");
    expect(ports.context).toHaveBeenCalled();
    expect(ports.retry).not.toHaveBeenCalled();
    expect(ports.send).toHaveBeenCalledWith(
      expect.objectContaining({ id: "intent-1" }),
      "test_token"
    );
  });

  it("retrieval breakdown returns RETRIEVAL_UNAVAILABLE with transient retry without handover", async () => {
    const ports = mockPorts(
      { ...baseFrame, job_id: "job-breakdown", question: "ما هي الخدمات؟" },
      {
        context: vi.fn(async () => null), // database or search breakdown
      }
    );
    const res = await runPersistedInboundJob({ jobId: "job-breakdown", claimToken: "claim-b", companyId: "company-1" }, ports);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("RETRIEVAL_UNAVAILABLE");
    expect(ports.retry).toHaveBeenCalledWith("RETRIEVAL_UNAVAILABLE", false, false);
    expect(ports.send).not.toHaveBeenCalled();
  });

  it("real human employee takeover remains strictly blocking for automated replies", async () => {
    // When employee takes over, verify fails or worker is disabled/changed
    const ports = mockPorts(
      { ...baseFrame, job_id: "job-takeover", question: "شكرا" },
      {
        verify: vi.fn(async () => ({ ok: false, code: "KNOWLEDGE_OR_AUTOMATION_CHANGED" as const })),
      }
    );
    const res = await runPersistedInboundJob({ jobId: "job-takeover", claimToken: "claim-t", companyId: "company-1" }, ports);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("KNOWLEDGE_OR_AUTOMATION_CHANGED");
    expect(ports.send).not.toHaveBeenCalled();
    expect(ports.retry).toHaveBeenCalledWith("KNOWLEDGE_OR_AUTOMATION_CHANGED", false, true);
  });
});
