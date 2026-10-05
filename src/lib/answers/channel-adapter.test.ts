import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnswerProvider } from "@/lib/answers/types";
import {
  evaluateInboundClaim,
  evaluateMessageIdentity,
  processInboundJobAnswer,
  type ClaimedJobRow,
  type ConversationRow,
  type MessageRow,
} from "./channel-adapter";

const liveEnabled = vi.hoisted(() => vi.fn(() => false));
const getProvider = vi.hoisted(() => vi.fn((): AnswerProvider | null => null));

vi.mock("@/lib/answers/guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/answers/guards")>();
  return {
    ...actual,
    isLiveAnsweringEnabled: () => liveEnabled(),
  };
});

vi.mock("@/lib/answers/provider", () => ({
  getAnswerProvider: () => getProvider(),
}));

const JOB: ClaimedJobRow = {
  id: "job-1",
  company_id: "co-a",
  message_id: "msg-1",
  wa_message_id: "wamid.1",
  status: "claimed",
  claim_token: "tok",
  claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
};

const MESSAGE: MessageRow = {
  id: "msg-1",
  company_id: "co-a",
  conversation_id: "conv-1",
  wa_message_id: "wamid.1",
  body: "What are your hours?",
  direction: "inbound",
  sender: "customer",
};

const CONVERSATION: ConversationRow = {
  id: "conv-1",
  company_id: "co-a",
  phone_number_id: "phone-1",
};

const KNOWLEDGE = [
  {
    id: "src-1",
    company_id: "co-a",
    title: "Hours",
    content: "Daily 10-22",
    content_version: 1,
    approved_version: 1,
    approved_for_answers: true,
    status: "ready",
  },
];

type KnowledgeRow = (typeof KNOWLEDGE)[number];

const GATE_OK = {
  ok: true,
  conversation_id: "conv-1",
  company_id: "co-a",
  status: "open",
  automation_allowed: true,
  automation_generation: 1,
  control_revision: 1,
  company_status: "active",
  eligible: true,
};

type Store = {
  jobs: ClaimedJobRow[];
  messages: MessageRow[];
  conversations: ConversationRow[];
  knowledge: KnowledgeRow[];
  /** successive gate RPC payloads */
  gates: unknown[];
};

function createFilterAdmin(store: Store) {
  let gateIdx = 0;
  const rpc = vi.fn(async (name: string, args?: { p_conversation_id?: string }) => {
    if (name === "whatsapp_automation_gate") {
      const payload = store.gates[Math.min(gateIdx, store.gates.length - 1)];
      gateIdx += 1;
      return { data: payload, error: null };
    }
    if (name === "complete_whatsapp_inbound_job") {
      return { data: null, error: { message: "must_not_complete" } };
    }
    return { data: null, error: { message: `unexpected rpc ${name} ${JSON.stringify(args)}` } };
  });

  const from = (table: string) => {
    if (table === "whatsapp_inbound_jobs") {
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => ({
              data: store.jobs.find((j) => j.id === id) ?? null,
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "whatsapp_messages") {
      return {
        select: () => ({
          eq: (col1: string, v1: string) => ({
            eq: (col2: string, v2: string) => ({
              maybeSingle: async () => {
                const row = store.messages.find((m) => {
                  const a = col1 === "id" ? m.id === v1 : col1 === "company_id" ? m.company_id === v1 : false;
                  const b = col2 === "company_id" ? m.company_id === v2 : col2 === "id" ? m.id === v2 : false;
                  return a && b;
                });
                return { data: row ?? null, error: null };
              },
            }),
          }),
        }),
      };
    }
    if (table === "whatsapp_conversations") {
      return {
        select: () => ({
          eq: (col1: string, v1: string) => ({
            eq: (col2: string, v2: string) => ({
              maybeSingle: async () => {
                const row = store.conversations.find((c) => {
                  const a = col1 === "id" ? c.id === v1 : col1 === "company_id" ? c.company_id === v1 : false;
                  const b = col2 === "company_id" ? c.company_id === v2 : col2 === "id" ? c.id === v2 : false;
                  return a && b;
                });
                return { data: row ?? null, error: null };
              },
            }),
          }),
        }),
      };
    }
    if (table === "knowledge_sources") {
      return {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) {
            return {
              eq: (c1: string, v1: string) => ({
                eq: async () => {
                  const companyId = c1 === "company_id" ? v1 : null;
                  const count = store.knowledge.filter((k) =>
                    (!companyId || k.company_id === companyId) && k.status === "ready",
                  ).length;
                  return { count, error: null };
                },
              }),
            };
          }
          // Track company filter from the first .eq("company_id", ...)
          let companyId: string | null = null;
          const forCompany = () =>
            store.knowledge.filter((k) => !companyId || k.company_id === companyId);
          const filteredReady = () =>
            forCompany().filter((k) => k.status === "ready" && k.approved_for_answers);
          const afterCompany = {
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: async () => ({ data: filteredReady(), error: null }),
                }),
                in: async (_col: string, ids: string[]) => ({
                  data: forCompany().filter((k) => ids.includes(k.id)),
                  error: null,
                }),
              }),
              in: async (_col: string, ids: string[]) => ({
                data: forCompany().filter((k) => ids.includes(k.id)),
                error: null,
              }),
              order: () => ({
                limit: async () => ({ data: filteredReady(), error: null }),
              }),
            }),
            in: async (_col: string, ids: string[]) => ({
              data: forCompany().filter((k) => ids.includes(k.id)),
              error: null,
            }),
          };
          return {
            eq: (col: string, val: string) => {
              if (col === "company_id") companyId = val;
              return afterCompany;
            },
          };
        },
      };
    }
    throw new Error(`unexpected table ${table}`);
  };

  return { from, rpc };
}

describe("evaluateInboundClaim", () => {
  it("rejects missing row, wrong token, or non-claimed status", () => {
    expect(evaluateInboundClaim(null, "tok")).toBe("CLAIM_INVALID");
    expect(evaluateInboundClaim({ ...JOB, claim_token: "other" }, "tok")).toBe("CLAIM_INVALID");
    expect(evaluateInboundClaim({ ...JOB, status: "pending" }, "tok")).toBe("CLAIM_INVALID");
  });

  it("rejects expired lease against the provided clock", () => {
    const now = Date.parse(JOB.claim_expires_at!) + 1;
    expect(evaluateInboundClaim(JOB, "tok", now)).toBe("CLAIM_EXPIRED");
  });

  it("accepts active claim before expiry", () => {
    expect(evaluateInboundClaim(JOB, "tok", Date.parse(JOB.claim_expires_at!) - 1)).toBeNull();
  });
});

describe("evaluateMessageIdentity", () => {
  it("requires inbound customer message with matching wa_message_id", () => {
    expect(
      evaluateMessageIdentity({ job: JOB, message: null, conversation: CONVERSATION }),
    ).toBe("INVALID_INPUT");
    expect(
      evaluateMessageIdentity({
        job: JOB,
        message: { ...MESSAGE, sender: "staff" },
        conversation: CONVERSATION,
      }),
    ).toBe("INVALID_INPUT");
    expect(
      evaluateMessageIdentity({
        job: JOB,
        message: { ...MESSAGE, direction: "outbound" },
        conversation: CONVERSATION,
      }),
    ).toBe("INVALID_INPUT");
    expect(
      evaluateMessageIdentity({
        job: JOB,
        message: { ...MESSAGE, wa_message_id: "wamid.other" },
        conversation: CONVERSATION,
      }),
    ).toBe("INVALID_INPUT");
  });

  it("requires company/conversation/phone binding", () => {
    expect(
      evaluateMessageIdentity({
        job: JOB,
        message: { ...MESSAGE, company_id: "co-other" },
        conversation: CONVERSATION,
      }),
    ).toBe("INVALID_INPUT");
    expect(
      evaluateMessageIdentity({
        job: JOB,
        message: MESSAGE,
        conversation: { ...CONVERSATION, company_id: "co-other" },
      }),
    ).toBe("INVALID_INPUT");
    expect(
      evaluateMessageIdentity({
        job: JOB,
        message: MESSAGE,
        conversation: CONVERSATION,
        expectedConversationId: "conv-other",
      }),
    ).toBe("INVALID_INPUT");
    expect(
      evaluateMessageIdentity({
        job: JOB,
        message: MESSAGE,
        conversation: CONVERSATION,
        expectedPhoneNumberId: "phone-other",
      }),
    ).toBe("INVALID_INPUT");
    expect(
      evaluateMessageIdentity({
        job: JOB,
        message: MESSAGE,
        conversation: CONVERSATION,
        expectedMessageId: "msg-other",
      }),
    ).toBe("INVALID_INPUT");
    expect(
      evaluateMessageIdentity({
        job: JOB,
        message: MESSAGE,
        conversation: CONVERSATION,
        expectedWaMessageId: "wamid.other",
      }),
    ).toBe("INVALID_INPUT");
    expect(
      evaluateMessageIdentity({ job: JOB, message: MESSAGE, conversation: CONVERSATION }),
    ).toBeNull();
  });
});

describe("processInboundJobAnswer (offline / pre-provider)", () => {
  beforeEach(() => {
    liveEnabled.mockReturnValue(false);
    getProvider.mockReturnValue(null);
  });

  it("requires jobId and claimToken", async () => {
    const result = await processInboundJobAnswer({
      jobId: "",
      claimToken: "",
      admin: {} as never,
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT", jobCompleted: false });
  });

  it("rejects via real company filter when conversation belongs elsewhere", async () => {
    const admin = createFilterAdmin({
      jobs: [JOB],
      messages: [MESSAGE],
      // same id but foreign company — eq(company_id) must miss
      conversations: [{ ...CONVERSATION, company_id: "co-foreign" }],
      knowledge: KNOWLEDGE,
      gates: [GATE_OK],
    });

    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT", jobCompleted: false });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects mismatched wa_message_id between job and message", async () => {
    const admin = createFilterAdmin({
      jobs: [JOB],
      messages: [{ ...MESSAGE, wa_message_id: "wamid.mismatch" }],
      conversations: [CONVERSATION],
      knowledge: KNOWLEDGE,
      gates: [GATE_OK],
    });
    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT", jobCompleted: false });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("rejects non-customer sender", async () => {
    const admin = createFilterAdmin({
      jobs: [JOB],
      messages: [{ ...MESSAGE, sender: "assistant" }],
      conversations: [CONVERSATION],
      knowledge: KNOWLEDGE,
      gates: [GATE_OK],
    });
    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT", jobCompleted: false });
  });

  it("returns AUTOMATION_PAUSED when gate is not eligible", async () => {
    const admin = createFilterAdmin({
      jobs: [JOB],
      messages: [MESSAGE],
      conversations: [CONVERSATION],
      knowledge: KNOWLEDGE,
      gates: [{ ...GATE_OK, automation_allowed: false, eligible: false }],
    });
    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "AUTOMATION_PAUSED",
      jobCompleted: false,
    });
  });

  it("surfaces PROCESSING_DISABLED with live answering off (no provider)", async () => {
    const providerComplete = vi.fn();
    getProvider.mockReturnValue({ complete: providerComplete } as never);
    const admin = createFilterAdmin({
      jobs: [JOB],
      messages: [MESSAGE],
      conversations: [CONVERSATION],
      knowledge: KNOWLEDGE,
      gates: [GATE_OK],
    });

    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "PROCESSING_DISABLED",
      jobCompleted: false,
    });
    expect(providerComplete).not.toHaveBeenCalled();
    expect(admin.rpc).toHaveBeenCalledWith("whatsapp_automation_gate", {
      p_conversation_id: "conv-1",
    });
    expect(
      admin.rpc.mock.calls.every((c) => c[0] !== "complete_whatsapp_inbound_job"),
    ).toBe(true);
  });
});

describe("processInboundJobAnswer (post-answer re-verify)", () => {
  beforeEach(() => {
    liveEnabled.mockReturnValue(true);
  });

  function providerOk(complete = vi.fn(async () => ({
    ok: true as const,
    text: "We open 10-22",
  }))) {
    getProvider.mockReturnValue({ complete } as never);
    return complete;
  }

  it("rejects when claim expires during provider work (fresh clock)", async () => {
    const expiresAt = Date.parse(JOB.claim_expires_at!);
    let t = expiresAt - 5_000;
    const now = vi.fn(() => t);
    const complete = providerOk(vi.fn(async () => {
      t = expiresAt + 1; // time advances past lease while answering
      return { ok: true as const, text: "late" };
    }));
    const admin = createFilterAdmin({
      jobs: [JOB],
      messages: [MESSAGE],
      conversations: [CONVERSATION],
      knowledge: KNOWLEDGE,
      gates: [GATE_OK, GATE_OK],
    });

    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
      now,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, code: "CLAIM_EXPIRED", jobCompleted: false });
    expect(admin.rpc.mock.calls.every((c) => c[0] !== "complete_whatsapp_inbound_job")).toBe(true);
    expect(now.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects when claim token is reset after provider", async () => {
    const complete = providerOk();
    const store: Store = {
      jobs: [JOB],
      messages: [MESSAGE],
      conversations: [CONVERSATION],
      knowledge: KNOWLEDGE,
      gates: [GATE_OK, GATE_OK],
    };
    const admin = createFilterAdmin(store);
    complete.mockImplementation(async () => {
      store.jobs = [{ ...JOB, claim_token: "rotated" }];
      return { ok: true as const, text: "answer" };
    });

    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    expect(complete).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, code: "CLAIM_INVALID", jobCompleted: false });
    expect(admin.rpc.mock.calls.every((c) => c[0] !== "complete_whatsapp_inbound_job")).toBe(true);
  });

  it("rejects when automation generation changes after provider", async () => {
    const complete = providerOk();
    const admin = createFilterAdmin({
      jobs: [JOB],
      messages: [MESSAGE],
      conversations: [CONVERSATION],
      knowledge: KNOWLEDGE,
      gates: [GATE_OK, { ...GATE_OK, automation_generation: 99 }],
    });

    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    expect(complete).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, code: "AUTOMATION_PAUSED", jobCompleted: false });
    expect(admin.rpc.mock.calls.every((c) => c[0] !== "complete_whatsapp_inbound_job")).toBe(true);
  });

  it("rejects when company becomes suspended after provider", async () => {
    const complete = providerOk();
    const admin = createFilterAdmin({
      jobs: [JOB],
      messages: [MESSAGE],
      conversations: [CONVERSATION],
      knowledge: KNOWLEDGE,
      gates: [
        GATE_OK,
        {
          ...GATE_OK,
          company_status: "suspended",
          eligible: false,
          automation_allowed: false,
        },
      ],
    });

    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    expect(complete).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, code: "COMPANY_SUSPENDED", jobCompleted: false });
    expect(admin.rpc.mock.calls.every((c) => c[0] !== "complete_whatsapp_inbound_job")).toBe(true);
  });

  it("rejects when message identity changes after provider", async () => {
    const complete = providerOk();
    const store: Store = {
      jobs: [JOB],
      messages: [MESSAGE],
      conversations: [CONVERSATION],
      knowledge: [...KNOWLEDGE],
      gates: [GATE_OK, GATE_OK],
    };
    const admin = createFilterAdmin(store);
    complete.mockImplementation(async () => {
      store.messages = [{ ...MESSAGE, conversation_id: "conv-hijacked" }];
      store.conversations = [
        { id: "conv-hijacked", company_id: "co-a", phone_number_id: "phone-other" },
      ];
      return { ok: true as const, text: "answer" };
    });

    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    expect(complete).toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT", jobCompleted: false });
    expect(admin.rpc.mock.calls.every((c) => c[0] !== "complete_whatsapp_inbound_job")).toBe(true);
  });

  it("rejects swap to another valid inbound message in the same conversation", async () => {
    const otherMessage: MessageRow = {
      id: "msg-2",
      company_id: "co-a",
      conversation_id: "conv-1",
      wa_message_id: "wamid.2",
      body: "Different question?",
      direction: "inbound",
      sender: "customer",
    };
    const complete = providerOk();
    const store: Store = {
      jobs: [JOB],
      messages: [MESSAGE, otherMessage],
      conversations: [CONVERSATION],
      knowledge: [...KNOWLEDGE],
      gates: [GATE_OK, GATE_OK],
    };
    const admin = createFilterAdmin(store);
    complete.mockImplementation(async () => {
      // Job retargeted to another legitimate inbound/customer row in the same conversation.
      store.jobs = [{
        ...JOB,
        message_id: otherMessage.id,
        wa_message_id: otherMessage.wa_message_id,
      }];
      return { ok: true as const, text: "answer for wrong message" };
    });

    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT", jobCompleted: false });
    expect(admin.rpc.mock.calls.every((c) => c[0] !== "complete_whatsapp_inbound_job")).toBe(true);
    expect(admin.rpc.mock.calls.every((c) => !String(c[0]).includes("send"))).toBe(true);
  });

  it("does not load knowledge from another company", async () => {
    const admin = createFilterAdmin({
      jobs: [JOB],
      messages: [MESSAGE],
      conversations: [CONVERSATION],
      knowledge: [
        {
          id: "src-foreign",
          company_id: "co-other",
          title: "Secret",
          content: "Foreign company hours",
          content_version: 1,
          approved_version: 1,
          approved_for_answers: true,
          status: "ready",
        },
      ],
      gates: [GATE_OK],
    });

    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    // Company filter drops foreign rows → no eligible knowledge for co-a.
    expect(result).toMatchObject({ ok: false, code: "NO_KNOWLEDGE", jobCompleted: false });
    expect(admin.rpc.mock.calls.every((c) => c[0] !== "complete_whatsapp_inbound_job")).toBe(true);
  });

  it("rejects when knowledge citations become stale after provider", async () => {
    const complete = providerOk();
    const store: Store = {
      jobs: [JOB],
      messages: [MESSAGE],
      conversations: [CONVERSATION],
      knowledge: [...KNOWLEDGE],
      gates: [GATE_OK, GATE_OK],
    };
    const admin = createFilterAdmin(store);
    complete.mockImplementation(async () => {
      store.knowledge = [
        {
          ...KNOWLEDGE[0],
          content_version: 2,
          approved_version: 1,
          approved_for_answers: false,
        },
      ];
      return { ok: true as const, text: "answer" };
    });

    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    expect(complete).toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.jobCompleted).toBe(false);
      // citations_stale maps to UNAVAILABLE, or approval path may surface differently
      expect(["UNAVAILABLE", "NO_KNOWLEDGE", "APPROVAL_INCOMPLETE"]).toContain(result.code);
    }
    expect(admin.rpc.mock.calls.every((c) => c[0] !== "complete_whatsapp_inbound_job")).toBe(true);
  });

  it("stages success without completing job or sending", async () => {
    const complete = providerOk();
    const admin = createFilterAdmin({
      jobs: [JOB],
      messages: [MESSAGE],
      conversations: [CONVERSATION],
      knowledge: KNOWLEDGE,
      gates: [GATE_OK, GATE_OK],
    });

    const result = await processInboundJobAnswer({
      jobId: "job-1",
      claimToken: "tok",
      admin: admin as never,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      jobCompleted: false,
      jobId: "job-1",
      companyId: "co-a",
      conversationId: "conv-1",
      messageId: "msg-1",
      phoneNumberId: "phone-1",
      automationGeneration: 1,
      text: "We open 10-22",
    });
    expect(admin.rpc.mock.calls.every((c) => c[0] !== "complete_whatsapp_inbound_job")).toBe(true);
    expect(admin.rpc.mock.calls.every((c) => !String(c[0]).includes("send"))).toBe(true);
  });
});
