import { describe, it, expect, vi } from "vitest";
import { runPersistedInboundJob, type IntegrationFrame, type IntegrationPorts } from "./integration-worker";
import { guardResponseAgainstUngroundedClaims } from "@/lib/answers/claim-guard";
import { formatAnswerUserPrompt } from "@/lib/answers/adapters/prompt";

const baseFrame: IntegrationFrame = {
  authority: "es02",
  job_id: "job-conv-1",
  company_id: "co-journey-1",
  branch_id: "branch-journey-1",
  created_at: new Date().toISOString(),
  message_id: "msg-1",
  conversation_id: "conv-journey-1",
  phone_number_id: "phone-1",
  recipient_wa_id: "96893180420",
  automation_generation: 10,
  link_id: "link-1",
  link_generation: 1,
  question: "ما هي خدماتكم؟",
  service_window_expires_at: new Date(Date.now() + 3600_000).toISOString(),
  ai_status: null,
  reply_text: null,
  ai_attempt_id: null,
  intent_id: null,
  staged_citations: null,
};

function createMockPorts(frame: IntegrationFrame, overrides: Partial<IntegrationPorts> = {}): IntegrationPorts {
  return {
    enabled: true,
    frame: vi.fn(async () => frame),
    context: vi.fn(async () => [
      {
        sourceId: "src-services",
        title: "Services Catalog",
        contentVersion: 1,
        text: "نقدم خدمات تصميم المواقع الإلكترونية، والمتاجر الرقمية، وبرمجة الأنظمة السحابية.",
      },
    ]),
    verify: vi.fn(async () => ({ ok: true as const })),
    secret: vi.fn(async () => "journey-token"),
    reserve: vi.fn(async () => true),
    answer: vi.fn(async (_f, chunks, history) => {
      if (chunks.length > 0) {
        return {
          ok: true,
          complete: true,
          text: "أهلاً بك! نقدم خدمات تصميم المواقع الإلكترونية، والمتاجر الرقمية، وبرمجة الأنظمة السحابية.",
          attempts: [{ id: "attempt-1", status: "success" }],
        };
      }
      // NO_MATCH response with continuity
      const referent = history?.find((h: { role: string; text: string }) => h.role === "assistant")?.text;
      const followUpText = referent
        ? "عذراً، تفاصيل الأسعار لهذه الخدمات غير محددة في معلوماتنا حالياً. هل ترغب في تزويدك بمزيد من التفاصيل الفنية عن الخدمة؟"
        : "عذراً، هذه المعلومة غير متوفرة لدي حالياً. هل يمكنك توضيح الخدمة التي تقصدها؟";
      return {
        ok: true,
        complete: true,
        text: followUpText,
        attempts: [{ id: "attempt-no-match", status: "success" }],
      };
    }),
    stage: vi.fn(async () => "intent-journey-1"),
    claimSend: vi.fn(async () => ({
      ok: true,
      claimed: true,
      attempt_token: "token-journey-1",
      intent: {
        id: "intent-journey-1",
        outcome: "ready",
        company_id: frame.company_id,
        conversation_id: frame.conversation_id,
        phone_number_id: frame.phone_number_id,
        recipient_wa_id: frame.recipient_wa_id,
        body: "Response text",
      },
    })),
    send: vi.fn(async () => ({ ok: true, waMessageId: "wamid.journey_mock" })),
    finalize: vi.fn(async () => true),
    finish: vi.fn(async () => "accepted"),
    repair: vi.fn(async () => true),
    retry: vi.fn(async () => {}),
    heartbeat: vi.fn(async () => true),
    history: vi.fn(async () => []),
    ...overrides,
  };
}

describe("Conversational Answering Journey & Reliability Gates", () => {
  it("executes the full conversational sequence: services -> thanks -> new question -> missing info -> services without interruption", async () => {
    // Turn 1: Services question (Full knowledge match)
    const portsTurn1 = createMockPorts({
      ...baseFrame,
      job_id: "job-step-1",
      question: "ما هي خدماتكم؟",
    });
    const res1 = await runPersistedInboundJob({ jobId: "job-step-1", claimToken: "claim-1", companyId: baseFrame.company_id }, portsTurn1);
    expect(res1.ok).toBe(true);
    expect(res1.code).toBe("ACCEPTED");
    expect(portsTurn1.send).toHaveBeenCalled();
    expect(portsTurn1.retry).not.toHaveBeenCalled();

    // Turn 2: Pure thanks ("شكرا جزيلا") -> Social small-talk shortcut ("العفو")
    const portsTurn2 = createMockPorts({
      ...baseFrame,
      job_id: "job-step-2",
      question: "شكرا جزيلا",
    });
    const res2 = await runPersistedInboundJob({ jobId: "job-step-2", claimToken: "claim-2", companyId: baseFrame.company_id }, portsTurn2);
    expect(res2.ok).toBe(true);
    expect(res2.code).toBe("ACCEPTED");
    // Context is bypassed for pure courtesy
    expect(portsTurn2.context).not.toHaveBeenCalled();
    expect(portsTurn2.retry).not.toHaveBeenCalled();

    // Turn 3: New question with missing info (NO_MATCH) -> Answers politely without handover or dead_letter
    const portsTurn3 = createMockPorts(
      {
        ...baseFrame,
        job_id: "job-step-3",
        question: "هل لديكم خدمة برمجة الروبوتات الطبية؟",
      },
      {
        context: vi.fn(async () => []), // No matching knowledge
      }
    );
    const res3 = await runPersistedInboundJob({ jobId: "job-step-3", claimToken: "claim-3", companyId: baseFrame.company_id }, portsTurn3);
    expect(res3.ok).toBe(true);
    expect(res3.code).toBe("ACCEPTED");
    // Context was queried
    expect(portsTurn3.context).toHaveBeenCalled();
    // Assistant answered politely with NO_MATCH and citations=[]
    expect(portsTurn3.stage).toHaveBeenCalledWith("attempt-no-match", []);
    expect(portsTurn3.retry).not.toHaveBeenCalled();
    expect(portsTurn3.send).toHaveBeenCalled();

    // Turn 4: Follow-up question back to services ("وما هي خدمات المواقع الإلكترونية؟") -> Full knowledge continues
    const portsTurn4 = createMockPorts({
      ...baseFrame,
      job_id: "job-step-4",
      question: "وما هي خدمات المواقع الإلكترونية؟",
    });
    const res4 = await runPersistedInboundJob({ jobId: "job-step-4", claimToken: "claim-4", companyId: baseFrame.company_id }, portsTurn4);
    expect(res4.ok).toBe(true);
    expect(res4.code).toBe("ACCEPTED");
    expect(portsTurn4.send).toHaveBeenCalled();
    expect(portsTurn4.retry).not.toHaveBeenCalled();
  });

  it("handles follow-up inquiry «وبكام؟» with recent conversation context", async () => {
    const priorHistory = [
      { role: "customer" as const, text: "ما هي خدماتكم؟" },
      { role: "assistant" as const, text: "نقدم تصميم وتطوير المواقع والمتاجر الإلكترونية." },
    ];

    const ports = createMockPorts(
      {
        ...baseFrame,
        job_id: "job-followup",
        question: "وبكام؟",
      },
      {
        history: vi.fn(async () => priorHistory),
        context: vi.fn(async () => []), // No price chunk in knowledge
      }
    );

    const res = await runPersistedInboundJob({ jobId: "job-followup", claimToken: "claim-f", companyId: baseFrame.company_id }, ports);
    expect(res.ok).toBe(true);
    expect(res.code).toBe("ACCEPTED");
    expect(ports.history).toHaveBeenCalled();
    expect(ports.answer).toHaveBeenCalledWith(
      expect.anything(),
      [],
      priorHistory
    );
    // Verified: Prompt properly formats history turns
    const formattedPrompt = formatAnswerUserPrompt("وبكام؟", [], "ar", priorHistory);
    expect(formattedPrompt).toContain("سياق المحادثة الأخيرة");
    expect(formattedPrompt).toContain("العميل: ما هي خدماتكم؟");
    expect(formattedPrompt).toContain("المساعد: نقدم تصميم وتطوير المواقع والمتاجر الإلكترونية.");
    expect(formattedPrompt).toContain("وبكام؟");
  });

  it("compound message «شكرًا، والأسعار كام؟» is NOT collapsed into pure courtesy", async () => {
    const ports = createMockPorts(
      {
        ...baseFrame,
        job_id: "job-compound-q",
        question: "شكرًا، والأسعار كام؟",
      },
      {
        context: vi.fn(async () => []), // No prices in knowledge
      }
    );

    const res = await runPersistedInboundJob({ jobId: "job-compound-q", claimToken: "claim-c", companyId: baseFrame.company_id }, ports);
    expect(res.ok).toBe(true);
    expect(res.code).toBe("ACCEPTED");
    // Verifies that context was checked because it contains a commercial question
    expect(ports.context).toHaveBeenCalled();
  });

  it("distinguishes RETRIEVAL_UNAVAILABLE (retryable) from NO_MATCH (polite answer)", async () => {
    // 1. Retrieval breakdown: returns blocked(RETRIEVAL_UNAVAILABLE), retries transiently, no handover
    const portsBreakdown = createMockPorts(
      {
        ...baseFrame,
        job_id: "job-breakdown",
        question: "ما هي المواعيد؟",
      },
      {
        context: vi.fn(async () => null), // DB connection or search engine failed
      }
    );
    const resBreakdown = await runPersistedInboundJob({ jobId: "job-breakdown", claimToken: "claim-bd", companyId: baseFrame.company_id }, portsBreakdown);
    expect(resBreakdown.ok).toBe(false);
    expect(resBreakdown.code).toBe("RETRIEVAL_UNAVAILABLE");
    // Retry called with permanent = false (no dead-letter, no handover)
    expect(portsBreakdown.retry).toHaveBeenCalledWith("RETRIEVAL_UNAVAILABLE", false, false);
    expect(portsBreakdown.send).not.toHaveBeenCalled();

    // 2. NO_MATCH: returns ACCEPTED, answers politely with empty citations
    const portsNoMatch = createMockPorts(
      {
        ...baseFrame,
        job_id: "job-no-match",
        question: "ما هي المواعيد؟",
      },
      {
        context: vi.fn(async () => []), // Search succeeded, 0 chunks found
      }
    );
    const resNoMatch = await runPersistedInboundJob({ jobId: "job-no-match", claimToken: "claim-nm", companyId: baseFrame.company_id }, portsNoMatch);
    expect(resNoMatch.ok).toBe(true);
    expect(resNoMatch.code).toBe("ACCEPTED");
    expect(portsNoMatch.retry).not.toHaveBeenCalled();
    expect(portsNoMatch.send).toHaveBeenCalled();
  });

  it("preserves employee takeover protection (control_actor_id != null)", async () => {
    // When human staff takes over, verification blocks automation
    const ports = createMockPorts(
      {
        ...baseFrame,
        job_id: "job-staff-takeover",
        question: "أريد مساعدة",
      },
      {
        verify: vi.fn(async () => ({ ok: false, code: "KNOWLEDGE_OR_AUTOMATION_CHANGED" as const })),
      }
    );

    const res = await runPersistedInboundJob({ jobId: "job-staff-takeover", claimToken: "claim-to", companyId: baseFrame.company_id }, ports);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("KNOWLEDGE_OR_AUTOMATION_CHANGED");
    expect(ports.send).not.toHaveBeenCalled();
  });

  it("citation guard intercepts hallucinated price or booking when citations are empty", () => {
    const hallucinatedPrice = "سعر هذه الخدمة هو 45 ر.ع ويمكنك البدء الآن.";
    const priceCheck = guardResponseAgainstUngroundedClaims(hallucinatedPrice, false, "ar");
    expect(priceCheck.valid).toBe(false);
    expect(priceCheck.reason).toBe("UNGROUNDED_PRICE");
    expect(priceCheck.sanitizedText).toContain("عذراً، هذه التفاصيل غير متوفرة لدي بدقة حالياً");

    const hallucinatedBooking = "تم الحجز بنجاح، موعدك غداً الساعة 10 صباحاً.";
    const bookingCheck = guardResponseAgainstUngroundedClaims(hallucinatedBooking, false, "ar");
    expect(bookingCheck.valid).toBe(false);
    expect(bookingCheck.reason).toBe("UNGROUNDED_ACTION");
    expect(bookingCheck.sanitizedText).toContain("عذراً، هذه التفاصيل غير متوفرة لدي بدقة حالياً");

    const politeNoMatch = "عذراً، تفاصيل هذه الخدمة غير متوفرة حالياً. هل ترغب في الاستفسار عن باقاتنا الأخرى؟";
    const honestCheck = guardResponseAgainstUngroundedClaims(politeNoMatch, false, "ar");
    expect(honestCheck.valid).toBe(true);
    expect(honestCheck.sanitizedText).toBe(politeNoMatch);
  });
});
