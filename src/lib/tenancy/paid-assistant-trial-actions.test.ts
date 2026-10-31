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
  releaseOwnedBranchAssistantTrialAction,
  readOwnedBranchAssistantTrialAction,
} from "./paid-assistant-trial-actions";
import { setAnswerProviderForTesting } from "@/lib/answers/provider";
import type { AnswerProvider, AnswerResult, AnswerUsage } from "@/lib/answers/types";

describe("paid-assistant-trial-actions", () => {
  beforeEach(() => {
    process.env.VELORA_TRIAL_BUDGET_CAP_BAISA = "2";
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

  it("releases a non-recoverable uncertain hold at zero cost without calling the provider", async () => {
    const operationId = "66666666-6666-4666-8666-666666666666";
    const scope = { expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID };
    const complete = vi.fn();
    setAnswerProviderForTesting({ id: "must-not-run", complete });
    let released = false;
    rpcMock.mockImplementation(async (name: string) => {
      if (name === "es02_read_owned_branch_assistant_trial") {
        return {
          data: {
            ok: true,
            data: {
              snapshot: {
                scope,
                version: 1,
                knowledgeRevision: "rev_1",
                canAsk: released,
                messages: [],
                ...(released ? {} : { pendingOperation: { id: operationId, status: "uncertain", recoverable: false } }),
              },
            },
          },
          error: null,
        };
      }
      if (name === "es02_read_owned_branch_trial_recovery") {
        return {
          data: released
            ? { ok: true, operation: null }
            : { ok: true, operation: { id: operationId, status: "uncertain", recoverable: false } },
          error: null,
        };
      }
      return { data: { ok: true }, error: null };
    });
    trustedRpc.mockImplementation(async (name: string) => {
      if (name === "ai_reconcile_attempt") {
        released = true;
        return { data: true, error: null };
      }
      return { data: { ok: true }, error: null };
    });
    const releasedResult = await releaseOwnedBranchAssistantTrialAction({ ...scope, operationId });
    expect(releasedResult).toMatchObject({ ok: true, snapshot: expect.objectContaining({ canAsk: true }) });
    expect(releasedResult.ok && releasedResult.snapshot.pendingOperation).toBeFalsy();
    expect(complete).not.toHaveBeenCalled();
    expect(trustedRpc.mock.calls.map((c) => c[0])).toEqual(["ai_reconcile_attempt"]);
    expect(trustedRpc.mock.calls[0]![1]).toMatchObject({
      p_id: operationId,
      p_cost_usd: 0,
      p_cost_baisa: 0,
      p_provider_reference: "setup_trial_timeout_no_provider_evidence",
    });
  });

  it("refuses release when the hold is recoverable or not uncertain", async () => {
    const operationId = "66666666-6666-4666-8666-666666666666";
    const scope = { expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID };
    rpcMock.mockResolvedValue({
      data: {
        ok: true,
        data: {
          snapshot: {
            scope,
            version: 1,
            knowledgeRevision: "rev_1",
            canAsk: false,
            messages: [],
          },
        },
      },
      error: null,
    });
    // recovery overlay marks recoverable success — must not zero-cost reconcile
    const recoveryRpc = rpcMock;
    rpcMock = vi.fn(async (name: string, args: unknown) => {
      if (name === "es02_read_owned_branch_trial_recovery") {
        return { data: { ok: true, operation: { id: operationId, status: "success", recoverable: true } }, error: null };
      }
      return recoveryRpc(name, args);
    });
    expect(await releaseOwnedBranchAssistantTrialAction({ ...scope, operationId })).toMatchObject({
      ok: false,
      code: "TRIAL_PENDING",
    });
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

  it("fails with provider error when completion fails and surfaces retrySafe metadata (no fake answer)", async () => {
    const mockProvider: AnswerProvider = {
      id: "mock-gemini",
      complete: vi.fn(async (): Promise<AnswerResult> => ({
        ok: false,
        code: "UNAVAILABLE",
        message: "Quota exceeded",
        requestId: "req-err-1",
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
      requestId: "req-err-1",
      retrySafe: true,
    });
    expect(trustedRpc).toHaveBeenCalledWith("ai_settle_admin_attempt", expect.objectContaining({ p_status: "rejected", p_cost_baisa: 0 }));
    expect(rpcMock).not.toHaveBeenCalledWith("es02_record_owned_branch_assistant_trial", expect.anything());
  });

  it("grounds branch hours question, knowledge question, and out-of-knowledge question with branch-isolated context", async () => {
    const capturedRequests: Array<{ question: string; chunks: Array<{ sourceId: string; title: string; text: string }>; persona?: string }> = [];
    const mockProvider: AnswerProvider = {
      id: "mock-gemini",
      complete: vi.fn(async (req: Parameters<AnswerProvider["complete"]>[0]): Promise<AnswerResult> => {
        capturedRequests.push({ question: req.question, chunks: req.chunks, persona: req.persona });
        const text = req.question.includes("مواعيد")
          ? "نعمل يوم الإثنين من 09:00 إلى 18:00 بتوقيت مسقط."
          : req.question.includes("التوصيل")
            ? "سياسة الاسترجاع لدينا هي 14 يومًا."
            : "عذراً، لا تتوفر لدي هذه المعلومة في المعرفة المعتمدة للفرع، ويمكنني إحالة استفسارك للموظف المختص.";
        return {
          ok: true,
          text,
          citations: req.chunks.map(c => ({ sourceId: c.sourceId, title: c.title, contentVersion: c.contentVersion })),
          usage: {
            promptChars: req.question.length,
            contextChars: 100,
            sourceCount: req.chunks.length,
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
        };
      }),
    };
    setAnswerProviderForTesting(mockProvider);

    // 1. Branch working hours question
    const hoursRes = await askOwnedBranchAssistantTrialAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      knowledgeRevision: "rev_1",
      question: "ما مواعيد العمل؟",
    });
    expect(hoursRes.ok).toBe(true);
    expect(capturedRequests[0]?.chunks.some(c => c.sourceId === `hours-${VALID_BRANCH_ID}` && c.text.includes("09:00"))).toBe(true);

    // 2. Branch knowledge question
    const knowRes = await askOwnedBranchAssistantTrialAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      knowledgeRevision: "rev_1",
      question: "ما تفاصيل خدمة التوصيل والضمان؟",
    });
    expect(knowRes.ok).toBe(true);
    expect(capturedRequests[1]?.chunks.some(c => c.sourceId === "source-1" && c.text.includes("14 days"))).toBe(true);

    // 3. Out-of-knowledge question
    const outRes = await askOwnedBranchAssistantTrialAction({
      expectedAccountId: VALID_ACCOUNT_ID,
      companyId: VALID_COMPANY_ID,
      branchId: VALID_BRANCH_ID,
      expectedVersion: 1,
      knowledgeRevision: "rev_1",
      question: "هل لديكم فرع في طوكيو؟",
    });
    expect(outRes.ok).toBe(true);
    expect(trustedRpc).toHaveBeenCalledWith(
      "es02_checkpoint_branch_trial_result",
      expect.objectContaining({
        p_branch_id: VALID_BRANCH_ID,
        p_result: expect.objectContaining({
          question: "هل لديكم فرع في طوكيو؟",
          answer: expect.stringContaining("لا تتوفر لدي هذه المعلومة"),
        }),
      }),
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

describe("trial budget cap, billed-but-unusable calls and settlement failure", () => {
  const input = { expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID, expectedVersion: 1, knowledgeRevision: "rev_1", question: "ما مواعيد العمل؟" };
  const usage: AnswerUsage = { promptChars: 1, contextChars: 1, sourceCount: 1, promptTokens: 600, completionTokens: 256, cachedTokens: 0, reasoningTokens: 100, totalTokens: 856, modelId: "gemini-3.8-flash", provider: "google", requestId: "r1", responseId: "r1", actualModelId: "gemini-3.8-flash", latencyMs: 5 };
  type Handler = (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>;
  const setup = (handler?: Handler) => {
    currentSessionId = VALID_ACCOUNT_ID; trustedAvailable = true;
    rpcMock = vi.fn().mockResolvedValue({ data: { ok: true, data: { persona: "level_2", snapshot: { scope: { expectedAccountId: VALID_ACCOUNT_ID, companyId: VALID_COMPANY_ID, branchId: VALID_BRANCH_ID }, version: 1, knowledgeRevision: "rev_1", messages: [] } } }, error: null });
    trustedRpc = vi.fn(async (name: string, args: Record<string, unknown>) =>
      (handler ? await handler(name, args) : null) ?? { data: name === "ai_settle_admin_attempt" ? true : { ok: true, newlyReserved: true, state: "reserved" }, error: null });
  };
  const called = (name: string) => trustedRpc.mock.calls.filter(c => c[0] === name).map(c => c[1] as Record<string, unknown>);
  const failingProvider = (extra: Partial<Extract<AnswerResult, { ok: false }>> = {}) => vi.fn(async (): Promise<AnswerResult> => ({ ok: false, code: "UNAVAILABLE", message: "Gemini returned no complete answer.", usage, providerAttempted: true, retrySafe: false, ...extra }));

  it("reserves from the provider token count and stops before any reservation when counting fails", async () => {
    setup();
    const complete = failingProvider();
    setAnswerProviderForTesting({ id: "p", complete, countInputTokens: vi.fn(async () => null) });
    expect(await askOwnedBranchAssistantTrialAction(input)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(trustedRpc).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    setup();
    setAnswerProviderForTesting({ id: "p", complete, countInputTokens: vi.fn(async () => 400) });
    await askOwnedBranchAssistantTrialAction(input);
    // (400*0.75 + 256*3.75)/1e6 USD * 1.2 / 2.6008 * 1000 baisa
    expect(called("es02_reserve_branch_trial_capped")[0].p_reserved_baisa).toBeCloseTo(((400 * 0.75 + 256 * 3.75) / 1e6) * 1.2 * 1000 / 2.6008, 5);
  });

  it("prices an empty/truncated provider result as incomplete and never counts it as a reply", async () => {
    setup();
    setAnswerProviderForTesting({ id: "p", complete: failingProvider() });
    expect(await askOwnedBranchAssistantTrialAction(input)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    const settle = called("ai_settle_admin_attempt");
    expect(settle).toHaveLength(1);
    expect(settle[0].p_status).toBe("incomplete");
    expect(settle[0].p_cost_baisa as number).toBeGreaterThan(0);
    expect(trustedRpc).not.toHaveBeenCalledWith("es02_checkpoint_branch_trial_result", expect.anything());
  });

  it("holds an unverifiable billed call as uncertain when the incomplete settlement is refused", async () => {
    setup(async (name, args) => name === "ai_settle_admin_attempt" && args.p_status === "incomplete" ? { data: null, error: { message: "PROVIDER_MODEL_MISMATCH" } } : (null as never));
    setAnswerProviderForTesting({ id: "p", complete: failingProvider() });
    expect(await askOwnedBranchAssistantTrialAction(input)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(called("ai_settle_admin_attempt").map(a => a.p_status)).toEqual(["incomplete", "uncertain"]);
    expect(called("ai_settle_admin_attempt")[1].p_cost_baisa).toBeNull();
  });

  it("releases a timeout without usage evidence as rejected so the branch is not permanently locked", async () => {
    setup();
    setAnswerProviderForTesting({
      id: "p",
      complete: vi.fn(async (): Promise<AnswerResult> => ({
        ok: false,
        code: "UNAVAILABLE",
        message: "Request timed out or was aborted; provider outcome is unknown.",
        providerAttempted: true,
        retrySafe: false,
      })),
    });
    expect(await askOwnedBranchAssistantTrialAction(input)).toMatchObject({ ok: false, code: "UNAVAILABLE", retrySafe: true });
    expect(called("ai_settle_admin_attempt")).toEqual([
      expect.objectContaining({ p_status: "rejected", p_cost_baisa: 0, p_cost_usd: 0 }),
    ]);
  });

  it("releases a thrown provider failure without usage as rejected", async () => {
    setup();
    setAnswerProviderForTesting({
      id: "p",
      complete: vi.fn(async () => { throw new Error("transport_timeout"); }),
    });
    expect(await askOwnedBranchAssistantTrialAction(input)).toMatchObject({ ok: false, code: "UNAVAILABLE", retrySafe: true });
    expect(called("ai_settle_admin_attempt")).toEqual([
      expect.objectContaining({ p_status: "rejected", p_cost_baisa: 0 }),
    ]);
  });

  it("reports TRIAL_PENDING and never resends when settlement fails or throws", async () => {
    for (const mode of ["false", "throws"]) {
      setup(async name => name === "ai_settle_admin_attempt" ? (mode === "throws" ? Promise.reject(new Error("network")) : { data: false, error: null }) : (null as never));
      const complete = failingProvider();
      setAnswerProviderForTesting({ id: "p", complete });
      expect(await askOwnedBranchAssistantTrialAction(input)).toMatchObject({ ok: false, code: "TRIAL_PENDING" });
      expect(complete).toHaveBeenCalledTimes(1);
    }
  });

  it("does not dispatch when the reservation call throws", async () => {
    setup(async name => name === "es02_reserve_branch_trial_capped" ? Promise.reject(new Error("network")) : (null as never));
    const complete = failingProvider();
    setAnswerProviderForTesting({ id: "p", complete });
    expect(await askOwnedBranchAssistantTrialAction(input)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("stops before any reservation when the trial budget cap is missing in restricted mode", async () => {
    vi.stubEnv("VELORA_LOCAL_CUSTOMER_MODE", "live");
    vi.stubEnv("VELORA_TRIAL_PINNED_BRANCH_ID", VALID_BRANCH_ID);
    delete process.env.VELORA_TRIAL_BUDGET_CAP_BAISA;
    try {
      setup();
      const complete = failingProvider();
      setAnswerProviderForTesting({ id: "p", complete });
      expect(await askOwnedBranchAssistantTrialAction(input)).toMatchObject({
        ok: false,
        code: "UNAVAILABLE",
        message: expect.stringContaining("Restricted trial configuration is incomplete"),
      });
      expect(trustedRpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("stops before any reservation when branch does not match pinned branch in restricted mode", async () => {
    vi.stubEnv("VELORA_TRIAL_PINNED_BRANCH_ID", "a268f9d8-fe5b-41b2-a337-97046a5eaa5c");
    vi.stubEnv("VELORA_TRIAL_BUDGET_CAP_BAISA", "2");
    try {
      setup();
      const complete = failingProvider();
      setAnswerProviderForTesting({ id: "p", complete });
      expect(await askOwnedBranchAssistantTrialAction({ ...input, branchId: "44444444-4444-4444-8444-444444444444" })).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(trustedRpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("permits standard reservation without local restriction when local customer mode is inactive", async () => {
    delete process.env.VELORA_LOCAL_CUSTOMER_MODE;
    delete process.env.VELORA_TRIAL_PINNED_BRANCH_ID;
    delete process.env.VELORA_TRIAL_BUDGET_CAP_BAISA;
    setup();
    const complete = failingProvider();
    setAnswerProviderForTesting({ id: "p", complete });
    await askOwnedBranchAssistantTrialAction(input);
    expect(called("es02_reserve_branch_trial")).toHaveLength(1);
    expect(called("es02_reserve_branch_trial_capped")).toHaveLength(0);
  });

  it("uses the atomic capped reservation and stops before the provider when the cap is exceeded", async () => {
    vi.stubEnv("VELORA_TRIAL_BUDGET_CAP_BAISA", "2");
    try {
      setup(async name => name === "es02_reserve_branch_trial_capped" ? { data: { ok: false, code: "TRIAL_BUDGET_EXCEEDED", committedBaisa: 1.9, capBaisa: 2 }, error: null } : (null as never));
      const complete = failingProvider();
      setAnswerProviderForTesting({ id: "p", complete, countInputTokens: vi.fn(async () => 400) });
      expect(await askOwnedBranchAssistantTrialAction(input)).toMatchObject({ ok: false, code: "UNAVAILABLE", message: expect.stringContaining("budget") });
      expect(called("es02_reserve_branch_trial_capped")[0].p_trial_cap_baisa).toBe(2);
      expect(called("es02_reserve_branch_trial")).toHaveLength(0);
      expect(complete).not.toHaveBeenCalled();
      expect(called("ai_settle_admin_attempt")).toHaveLength(0);
    } finally { vi.unstubAllEnvs(); }
  });

  it("fails closed on an invalid cap configuration before any reservation", async () => {
    vi.stubEnv("VELORA_TRIAL_BUDGET_CAP_BAISA", "abc");
    try {
      setup();
      const complete = failingProvider();
      setAnswerProviderForTesting({ id: "p", complete });
      expect(await askOwnedBranchAssistantTrialAction(input)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
      expect(trustedRpc).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });
});
