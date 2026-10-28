import { describe, expect, it, vi, beforeEach } from "vitest";

const VALID_ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ACCOUNT_ID = "99999999-9999-4999-8999-999999999999";
const VALID_COMPANY_ID = "22222222-2222-4222-8222-222222222222";
const VALID_BRANCH_ID = "33333333-3333-4333-8333-333333333333";

let currentSessionId: string | null = VALID_ACCOUNT_ID;
let rpcMock = vi.fn();
let trustedRpc = vi.fn();
let trustedAvailable = true;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => trustedAvailable ? { rpc: trustedRpc } : null }));

vi.mock("@/lib/auth/server-identity", () => ({
  readSessionIdentity: vi.fn(async () => {
    if (!currentSessionId) return { ok: false, code: "UNAUTHENTICATED" };
    return { ok: true, userId: currentSessionId, nativeSessionId: "55555555-5555-4555-8555-555555555555" };
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: rpcMock,
  })),
}));

vi.mock("@/lib/logging/logger.mjs", () => ({
  logEvent: vi.fn(),
  withLogContext: vi.fn(async (_ctx, fn) => fn()),
}));

vi.mock("./branch-hours-actions", () => ({
  readOwnedBranchHoursAction: vi.fn(async () => ({
    ok: true,
    snapshot: {
      version: 1,
      branchLabel: "Main Branch",
      timezone: "Asia/Muscat",
      schedule: { tuesday:{state:"closed"},wednesday:{state:"closed"},thursday:{state:"closed"},friday:{state:"closed"},saturday:{state:"closed"},sunday:{state:"closed"}, monday: { state: "open", intervals: [{ start: "09:00", end: "18:00", nextDay: false }] } },
    },
  })),
}));

vi.mock("./paid-reply-language-actions", () => ({
  readOwnedBranchReplyLanguageAction: vi.fn(async () => ({
    replyLanguage: "ar",
  })),
}));

vi.mock("./paid-branch-knowledge-actions", () => ({
  loadApprovedBranchKnowledgeContext: vi.fn(async () => ({
    ok: true,
    knowledgeRevision: "rev_1",
    chunks: [
      {
        sourceId: "source-1",
        title: "Policy",
        contentVersion: 1,
        text: "Our return policy is 14 days.",
        usageRole: "business_instructions",
      },
    ],
  })),
}));

import {
  askOwnedBranchAssistantTrialAction,
  recoverOwnedBranchAssistantTrialAction,
  readOwnedBranchAssistantTrialAction,
} from "./paid-assistant-trial-actions";
import { setAnswerProviderForTesting } from "@/lib/answers/provider";
import type { AnswerProvider, AnswerResult } from "@/lib/answers/types";

describe("paid-assistant-trial-actions", () => {
  beforeEach(() => {
    currentSessionId = VALID_ACCOUNT_ID;
    trustedAvailable = true;
    trustedRpc = vi.fn(async (name: string) => ({ data: name === "ai_settle_admin_attempt" ? true : { ok: true, newlyReserved: true, state: "reserved", receiptId: "receipt" }, error: null }));
    setAnswerProviderForTesting(null);
    rpcMock = vi.fn().mockResolvedValue({
      data: {
        ok: true,
        data: {
          persona: "level_2",
          snapshot: {
            scope: {
              expectedAccountId: VALID_ACCOUNT_ID,
              companyId: VALID_COMPANY_ID,
              branchId: VALID_BRANCH_ID,
            },
            version: 1,
            knowledgeRevision: "rev_1",
            branchLabel: "Main",
            businessType: "retail",
            canAsk: true,
            messages: [],
          },
        },
      },
      error: null,
    });
  });

  it("denies unauthenticated read", async () => {
    currentSessionId = null;
    const res = await readOwnedBranchAssistantTrialAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
    });
    expect(res).toBeNull();
  });
  it.each(['اريد المدير','refund this payment'])('previews escalation for %s without provider, ledger or receipt mutation',async question=>{
    const complete=vi.fn();setAnswerProviderForTesting({id:'must-not-run',complete});
    const result=await askOwnedBranchAssistantTrialAction({expectedAccountId:VALID_ACCOUNT_ID,companyId:VALID_COMPANY_ID,branchId:VALID_BRANCH_ID,expectedVersion:1,knowledgeRevision:'rev_1',question});
    expect(result).toMatchObject({ok:true,snapshot:{handoffPreview:expect.any(String),messages:[]}});
    expect(complete).not.toHaveBeenCalled();expect(trustedRpc).not.toHaveBeenCalled();
  });

  it("recovers a saved receipt without reserving allowance or calling the provider",async()=>{
    const operationId="66666666-6666-4666-8666-666666666666";
    const scope={expectedAccountId:VALID_ACCOUNT_ID,companyId:VALID_COMPANY_ID,branchId:VALID_BRANCH_ID};
    const complete=vi.fn();setAnswerProviderForTesting({id:"must-not-run",complete});
    rpcMock.mockResolvedValue({data:{ok:true,data:{snapshot:{scope,version:1,knowledgeRevision:"rev_1",messages:[{executionId:operationId,origin:"engine"}]}}},error:null});
    expect(await recoverOwnedBranchAssistantTrialAction({...scope,operationId})).toMatchObject({ok:true});
    expect(complete).not.toHaveBeenCalled();
    expect(trustedRpc.mock.calls.map(c=>c[0])).toEqual(["es02_recover_branch_trial_result"]);
  });
  it("does not recover or expose another account's receipt",async()=>{
    const scope={expectedAccountId:VALID_ACCOUNT_ID,companyId:VALID_COMPANY_ID,branchId:VALID_BRANCH_ID};
    currentSessionId=OTHER_ACCOUNT_ID;
    expect(await recoverOwnedBranchAssistantTrialAction({...scope,operationId:VALID_ACCOUNT_ID})).toMatchObject({ok:false,code:"UNAUTHENTICATED"});
    expect(trustedRpc).not.toHaveBeenCalled();
  });

  it.each(["version", "knowledge", "branch", "unavailable"])("rejects %s trial context before reserving or calling AI", async (failure) => {
    const scope = { expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID };
    const normalRpc = rpcMock;
    rpcMock = vi.fn(async (name, args) => name === "es02_read_owned_branch_assistant_trial"
      ? { error: failure === "unavailable" ? { message: "offline" } : null, data: { ok: true, data: { snapshot: {
        scope: failure === "branch" ? { ...scope, branchId: OTHER_ACCOUNT_ID } : scope,
        version: failure === "version" ? 2 : 1, knowledgeRevision: failure === "knowledge" ? "rev_2" : "rev_1", messages: [],
      } } } } : normalRpc(name, args));
    const complete = vi.fn(async (): Promise<AnswerResult> => ({ ok: false, code: "UNAVAILABLE", message: "must not dispatch" }));
    setAnswerProviderForTesting({ id: "test-only", complete });
    const result = await askOwnedBranchAssistantTrialAction({ ...scope, expectedVersion: 1, knowledgeRevision: "rev_1", question: "Hours?" });
    expect(result).toMatchObject({ ok: false, code: ["unavailable","branch"].includes(failure) ? "UNAVAILABLE" : "CONTEXT_CHANGED" });
    expect(complete).not.toHaveBeenCalled();
    expect(trustedRpc).not.toHaveBeenCalled();
  });

  it("denies account mismatch on trial ask", async () => {
    currentSessionId = OTHER_ACCOUNT_ID;
    const res = await askOwnedBranchAssistantTrialAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      knowledgeRevision: "rev_1",
      question: "ما مواعيد العمل؟",
    });
    expect(res).toEqual({ ok: false, code: "UNAUTHENTICATED", message: "User session does not match account" });
  });

  it("fails with NEEDS_SETUP when answer provider is not configured (no fake answer)", async () => {
    // Answer provider is null by default
    const res = await askOwnedBranchAssistantTrialAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      knowledgeRevision: "rev_1",
      question: "ما مواعيد العمل؟",
    });

    // Must return an explicit error and NOT call RPC to record a fake answer
    expect(res).toEqual({
      ok: false,
      code: "NEEDS_SETUP",
      message: "Gemini provider is not configured. API key is required.",
    });
    expect(rpcMock).not.toHaveBeenCalledWith("es02_record_owned_branch_assistant_trial", expect.anything());
  });

  it("fails with provider error when completion fails (no fake answer)", async () => {
    const mockProvider: AnswerProvider = {
      id: "mock-gemini",
      complete: vi.fn(async (): Promise<AnswerResult> => ({
        ok: false,
        code: "UNAVAILABLE",
        message: "Quota exceeded",
        retrySafe: true,
      })),
    };
    setAnswerProviderForTesting(mockProvider);

    const res = await askOwnedBranchAssistantTrialAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      knowledgeRevision: "rev_1",
      question: "ما مواعيد العمل؟",
    });

    expect(res).toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: "Quota exceeded",
    });
    expect(rpcMock).not.toHaveBeenCalledWith("es02_record_owned_branch_assistant_trial", expect.anything());
  });

  it("records genuine engine answer when provider succeeds", async () => {
    const mockProvider: AnswerProvider = {
      id: "mock-gemini",
      complete: vi.fn(async (req): Promise<AnswerResult> => ({
        ok: true,
        text: "نعمل من 9 صباحاً حتى 6 مساءً.",
        citations: [],
        usage: {
          promptChars: req.question.length,
          contextChars: 100,
          sourceCount: 1,
          promptTokens: 25,
          completionTokens: 20,
          cachedTokens: 0,
          reasoningTokens: 0,
          totalTokens: 45,
          modelId: "gemini-3.8-flash",
          provider: "google",
          estimatedCostBaisa: 1,
          estimatedCostUsd: 0.001,
          requestId: "req-123",
          responseId: "req-123",
          actualModelId: "gemini-3.8-flash",
          latencyMs: 1,
        },
        modelId: "gemini-3.8-flash",
        attemptsCount: 1,
      })),
    };
    setAnswerProviderForTesting(mockProvider);

    const res = await askOwnedBranchAssistantTrialAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      knowledgeRevision: "rev_1",
      question: "ما مواعيد العمل؟",
    });

    expect(res.ok).toBe(true);
    expect(rpcMock).not.toHaveBeenCalledWith("es02_record_owned_branch_assistant_trial", expect.anything());
    expect(mockProvider.complete).toHaveBeenCalledWith(expect.objectContaining({ persona: "lina" }));
    expect(trustedRpc).toHaveBeenCalledWith(
      "es02_checkpoint_branch_trial_result",
      expect.objectContaining({ p_result: expect.objectContaining({answer: "نعمل من 9 صباحاً حتى 6 مساءً.", modelId:"gemini-3.8-flash"}) })
    );
  });
});

it("never calls provider when branch authorization fails", async () => {
  currentSessionId = VALID_ACCOUNT_ID;
  rpcMock = vi.fn().mockResolvedValue({ data: { ok: false, code: "SUSPENDED" }, error: null });
  const complete = vi.fn(async () => ({ ok: false as const, code: "UNAVAILABLE" as const, message: "fake provider" }));
  setAnswerProviderForTesting({ id: "fake-only", complete });
  const result = await askOwnedBranchAssistantTrialAction({ expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID, expectedVersion: 1, knowledgeRevision: "rev_1", question: "Hours?" });
  expect(complete).not.toHaveBeenCalled();
  expect(result).toMatchObject({ ok: false, code: "SUSPENDED" });
});
it.each(["hours", "knowledge", "language"])("stops before provider when %s context cannot be read", async (part) => {
  currentSessionId = VALID_ACCOUNT_ID;
  rpcMock = vi.fn().mockResolvedValue({ data: { ok: true, data: { persona: "level_2", snapshot: { scope: { expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID }, version: 1, knowledgeRevision: "rev_1", messages: [] } } }, error: null });
  const complete = vi.fn(async (): Promise<AnswerResult> => ({ ok: false, code: "UNAVAILABLE", message: "fake only" }));
  setAnswerProviderForTesting({ id: "fake-only", complete });
  if (part === "hours") vi.mocked((await import("./branch-hours-actions")).readOwnedBranchHoursAction).mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE" } as never);
  if (part === "knowledge") vi.mocked((await import("./paid-branch-knowledge-actions")).loadApprovedBranchKnowledgeContext).mockResolvedValueOnce({ ok: false, chunks: [], knowledgeRevision: "no_pages" });
  if (part === "language") vi.mocked((await import("./paid-reply-language-actions")).readOwnedBranchReplyLanguageAction).mockResolvedValueOnce(null);
  const result = await askOwnedBranchAssistantTrialAction({ expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID, expectedVersion: 1, knowledgeRevision: "rev_1", question: "Hours?" });
  expect(complete).not.toHaveBeenCalled();
  expect(result).toMatchObject({ ok: false });
});

it("does not spend a provider request without a trusted receipt writer", async () => {
  currentSessionId = VALID_ACCOUNT_ID;
  rpcMock = vi.fn().mockResolvedValue({ data: { ok: true, data: { persona: "level_2", snapshot: { scope: { expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID }, version: 1, knowledgeRevision: "rev_1", messages: [] } } }, error: null });
  trustedAvailable = false;
  const complete = vi.fn(async (): Promise<AnswerResult> => ({ ok: false, code: "UNAVAILABLE", message: "fake only" }));
  setAnswerProviderForTesting({ id: "fake-only", complete });
  try {
    const result = await askOwnedBranchAssistantTrialAction({ expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID, expectedVersion: 1, knowledgeRevision: "rev_1", question: "Hours?" });
    expect(complete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  } finally { trustedAvailable = true; }
});

it.each(["TRIAL_LIMIT_REACHED", "TRIAL_PENDING"])("does not call provider when durable allowance reports %s", async (code) => {
  currentSessionId = VALID_ACCOUNT_ID;
  trustedAvailable = true;
  rpcMock = vi.fn().mockResolvedValue({ data: { ok: true, data: { persona: "level_2", snapshot: { scope: { expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID }, version: 1, knowledgeRevision: "rev_1", messages: [] } } }, error: null });
  trustedRpc = vi.fn().mockResolvedValue({ data: { ok: false, code }, error: null });
  const complete = vi.fn(async (): Promise<AnswerResult> => ({ ok: false, code: "UNAVAILABLE", message: "fake only" }));
  setAnswerProviderForTesting({ id: "fake-only", complete });
  const result = await askOwnedBranchAssistantTrialAction({ expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID, expectedVersion: 1, knowledgeRevision: "rev_1", question: "Hours?" });
  expect(complete).not.toHaveBeenCalled();
  expect(result).toMatchObject({ ok: false, code });
});

describe("consolidated trial replay receipt", () => {
  const operationId = "66666666-6666-4666-8666-666666666666";
  const input = { expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID, expectedVersion: 1, knowledgeRevision: "rev_1", question: "Hours?", operationId };
  const scope = { expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID };

  it.each(["different operation", "missing operation", "different question", "different branch", "synthetic"])("does not attest a completed provider request from a %s message", async (mismatch) => {
    currentSessionId = VALID_ACCOUNT_ID;
    trustedAvailable = true;
    const message = { id: "receipt", executionId: operationId, scope, version: 1, knowledgeRevision: "rev_1", question: input.question, origin: "engine", result: { ok: true, text: "Stored answer", modelId: "gemini-3.8-flash", citations: [] } };
    const altered = mismatch === "different operation" ? { ...message, executionId: VALID_ACCOUNT_ID }
      : mismatch === "missing operation" ? { ...message, executionId: undefined }
      : mismatch === "different question" ? { ...message, question: "Another question" }
      : mismatch === "different branch" ? { ...message, scope: { ...scope, branchId: VALID_COMPANY_ID } }
      : { ...message, origin: "synthetic" };
    rpcMock = vi.fn().mockResolvedValue({ data: { ok: true, data: { persona: "level_2", snapshot: { scope, version: 1, knowledgeRevision: "rev_1", messages: [altered] } } }, error: null });
    trustedRpc = vi.fn().mockResolvedValue({ data: { ok: true, newlyReserved: false, state: "success" }, error: null });
    const complete = vi.fn(async (): Promise<AnswerResult> => ({ ok: false, code: "UNAVAILABLE", message: "test provider must not run" }));
    setAnswerProviderForTesting({ id: "test-only", complete });
    expect(await askOwnedBranchAssistantTrialAction(input)).toMatchObject({ ok: false, code: "TRIAL_PENDING" });
    expect(complete).not.toHaveBeenCalled();
    expect(trustedRpc).toHaveBeenCalledTimes(1);
  });

  it("returns the matching stored operation without calling the provider again", async () => {
    currentSessionId = VALID_ACCOUNT_ID;
    trustedAvailable = true;
    const snapshot = { scope, version: 1, knowledgeRevision: "rev_1", messages: [{ id: "receipt", executionId: operationId, scope, version: 1, knowledgeRevision: "rev_1", question: input.question, origin: "engine", result: { ok: true, text: "Stored answer", modelId: "gemini-3.8-flash", citations: [] } }] };
    rpcMock = vi.fn().mockResolvedValue({ data: { ok: true, data: { persona: "level_2", snapshot } }, error: null });
    trustedRpc = vi.fn().mockResolvedValue({ data: { ok: true, newlyReserved: false, state: "success" }, error: null });
    const complete = vi.fn(async (): Promise<AnswerResult> => ({ ok: false, code: "UNAVAILABLE", message: "test provider must not run" }));
    setAnswerProviderForTesting({ id: "test-only", complete });
    expect(await askOwnedBranchAssistantTrialAction(input)).toEqual({ ok: true, snapshot });
    expect(complete).not.toHaveBeenCalled();
  });
});
