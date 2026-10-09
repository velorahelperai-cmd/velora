import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MultiModelAIRouter } from "./router";
import { simulateAdminAIAnswer } from "../admin-test";
import { InMemoryAIUsageLedger, setActiveLedgerStore } from "../ledger/ledger";
import type { AnswerFailure, AnswerProvider, AnswerProviderRequest, AnswerResult } from "../types";
import type { OpenAIAnswerAdapter } from "../adapters/openai";
import type { GeminiAnswerAdapter } from "../adapters/gemini";

const request: AnswerProviderRequest = {
  question: "What are your opening hours?", locale: "en",
  chunks: [{ sourceId: "approved-hours", title: "Opening hours", contentVersion: 2, text: "Open 9am to 5pm." }],
};
const success: AnswerResult = { ok: true, text: "Open 9am to 5pm.", citations: [], usage: { promptChars: 34, contextChars: 18, sourceCount: 1, promptTokens: 50, completionTokens: 10 } };
type FailureWithSafety = AnswerFailure & { providerAttempted?: boolean; retrySafe?: boolean };
function makeRouter(failure: FailureWithSafety) {
  const openai: AnswerProvider = { id: "test-openai", complete: vi.fn().mockResolvedValue(failure) };
  const google: AnswerProvider = { id: "test-google", complete: vi.fn().mockResolvedValue(success) };
  const router = new MultiModelAIRouter({ openAIAdapter: openai as OpenAIAnswerAdapter, geminiAdapter: google as GeminiAnswerAdapter });
  return { router, openai, google };
}

describe("P3 routing and paid retry boundaries", () => {
  it.each([
    ["What are your opening hours?", "gpt-6-luna"],
    ["Compare the product specifications", "gemini-3.8-flash"],
    ["I have a complaint about damaged goods", "gpt-6.1-sol"],
  ])("routes actual task intent: %s", (question, expected) => {
    expect(new MultiModelAIRouter().classify({ ...request, question }).modelId).toBe(expected);
  });

  it.each([
    { ok: false, code: "UNAVAILABLE", message: "Request timed out", providerAttempted: true, retrySafe: false },
    { ok: false, code: "UNAVAILABLE", message: "Connection reset after dispatch", providerAttempted: true, retrySafe: false },
    { ok: false, code: "UNAVAILABLE", message: "Provider failure with unknown billing status" },
    { ok: false, code: "FORBIDDEN", message: "Usage limit reached", providerAttempted: false, retrySafe: false },
    { ok: false, code: "UNAVAILABLE", message: "Billable response was empty", providerAttempted: true, retrySafe: false },
  ] as FailureWithSafety[])("does not issue another paid request after $message", async (failure) => {
    const { router, google } = makeRouter(failure);
    expect(await router.complete(request)).toMatchObject({ ok: false, code: failure.code });
    expect(google.complete).not.toHaveBeenCalled();
  });

  it("allows fallback after an explicitly rejected unavailable model", async () => {
    const { router, google } = makeRouter({ ok: false, code: "UNAVAILABLE", providerAttempted: true, retrySafe: true });
    const result = await router.complete(request);
    expect(result).toMatchObject({ ok: true, modelId: "gemini-3.8-flash", attemptsCount: 2 });
    expect(google.complete).toHaveBeenCalledWith(expect.objectContaining({ chunks: request.chunks, forceModelId: "gemini-3.8-flash" }));
  });

  it("pins an owner's explicitly selected model even when unavailable", async () => {
    const { router, google } = makeRouter({ ok: false, code: "UNAVAILABLE", providerAttempted: true, retrySafe: true });
    expect(await router.complete({ ...request, forceModelId: "gpt-6-luna" })).toMatchObject({ ok: false });
    expect(google.complete).not.toHaveBeenCalled();
  });

  it("does not downgrade a complex complaint from Sol to Luna or Gemini", async () => {
    const { router, google } = makeRouter({ ok: false, code: "UNAVAILABLE", providerAttempted: true, retrySafe: true });
    expect(await router.complete({ ...request, question: "I have a complaint about damaged goods" })).toMatchObject({ ok: false });
    expect(google.complete).not.toHaveBeenCalled();
  });

  it("does not downgrade an advanced task to Luna after Gemini fails", async () => {
    const { router, openai, google } = makeRouter({ ok: false, code: "UNAVAILABLE", providerAttempted: true, retrySafe: true });
    vi.mocked(google.complete).mockResolvedValue({ ok: false, code: "UNAVAILABLE", providerAttempted: true, retrySafe: true } as FailureWithSafety);
    await router.complete({ ...request, question: "Compare the product specifications" });
    expect(openai.complete).toHaveBeenCalledWith(expect.objectContaining({ forceModelId: "gpt-6.1-sol" }));
    expect(openai.complete).not.toHaveBeenCalledWith(expect.objectContaining({ forceModelId: "gpt-6-luna" }));
  });

  it("independently identifies a financial action even with a forced cheap model", () => {
    const classification = new MultiModelAIRouter().classify({ ...request, question: "Confirm that my bank transfer was received", forceModelId: "gpt-6-luna" });
    expect(classification).toMatchObject({ verificationRequired: true, taskType: "risk_escalation" });
  });

  it("blocks unverified financial execution before any provider is called", async () => {
    const { router, openai, google } = makeRouter({ ok: false, code: "UNAVAILABLE", providerAttempted: true, retrySafe: true });
    expect(await router.complete({ ...request, question: "Please issue a refund", forceModelId: "gpt-6-luna" })).toMatchObject({ ok: false, code: "UNVERIFIED" });
    expect(openai.complete).not.toHaveBeenCalled();
    expect(google.complete).not.toHaveBeenCalled();
  });

  it("retains a forced model for an offline financial classification without verifying an action", async () => {
    const { router, openai } = makeRouter({ ok: false, code: "UNAVAILABLE", providerAttempted: true, retrySafe: false });
    await router.complete({ ...request, question: "Please issue a refund", forceModelId: "gpt-6-luna", dryRun: true });
    expect(openai.complete).toHaveBeenCalledWith(expect.objectContaining({ forceModelId: "gpt-6-luna", dryRun: true }));
  });

  it("rejects empty approved context before dispatch", async () => {
    const { router, openai } = makeRouter({ ok: false, code: "UNAVAILABLE", providerAttempted: false, retrySafe: false });
    expect(await router.complete({ ...request, chunks: [] })).toMatchObject({ ok: false, code: "NO_KNOWLEDGE" });
    expect(openai.complete).not.toHaveBeenCalled();
  });

  it("rejects malformed approved context before dispatch", async () => {
    const { router, openai } = makeRouter({ ok: false, code: "UNAVAILABLE", providerAttempted: false, retrySafe: false });
    expect(await router.complete({ ...request, chunks: [{ ...request.chunks[0], contentVersion: 0 }] })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(openai.complete).not.toHaveBeenCalled();
  });

  it("does not dispatch an already aborted request", async () => {
    const { router, openai } = makeRouter({ ok: false, code: "UNAVAILABLE", providerAttempted: false, retrySafe: true });
    const controller = new AbortController(); controller.abort();
    expect(await router.complete({ ...request, signal: controller.signal })).toMatchObject({ ok: false, code: "UNAVAILABLE", providerAttempted: false });
    expect(openai.complete).not.toHaveBeenCalled();
  });

  it("does not dispatch fallback when the caller cancels after a known rejection", async () => {
    const controller = new AbortController();
    const failure: FailureWithSafety = { ok: false, code: "UNAVAILABLE", providerAttempted: true, retrySafe: true };
    const { router, openai, google } = makeRouter(failure);
    vi.mocked(openai.complete).mockImplementation(async () => { controller.abort(); return failure; });
    expect(await router.complete({ ...request, signal: controller.signal })).toMatchObject({ ok: false, code: "UNAVAILABLE", attempts: [{ modelId: "gpt-6-luna", status: "failed" }] });
    expect(google.complete).not.toHaveBeenCalled();
  });

  it.each([NaN, 1.5, Infinity])("rejects noninteger knowledge version %s", async (contentVersion) => {
    const { router, openai } = makeRouter({ ok: false, code: "UNAVAILABLE", providerAttempted: false, retrySafe: false });
    expect(await router.complete({ ...request, chunks: [{ ...request.chunks[0], contentVersion }] })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(openai.complete).not.toHaveBeenCalled();
  });

  it("preserves failed billable telemetry rather than hiding it behind a new successful model", async () => {
    const { router } = makeRouter({ ok: false, code: "UNAVAILABLE", modelId: "gpt-6-luna", provider: "openai", providerAttempted: true, retrySafe: false, requestId: "test-req-uncertain", latencyMs: 250, usage: { promptChars: 34, contextChars: 18, sourceCount: 1, promptTokens: 80, completionTokens: 5, cachedTokens: 10, reasoningTokens: 2, estimatedCostUsd: 0.0005 } });
    expect(await router.complete(request)).toMatchObject({ ok: false, modelId: "gpt-6-luna", attempts: [{ modelId: "gpt-6-luna", provider: "openai", status: "uncertain", requestId: "test-req-uncertain", latencyMs: 250, usage: { promptTokens: 80, completionTokens: 5, estimatedCostUsd: 0.0005 } }] });
  });

  it("cannot configure a downgrade for an advanced task", () => {
    const router = new MultiModelAIRouter({ config: { fallbackOrder: { "gpt-6-luna": [], "gemini-3.8-flash": ["gpt-6-luna", "gpt-6.1-sol"], "gpt-6.1-sol": ["gpt-6-luna"] }, maxAttempts: 3 } });
    expect(router.getEligibleModels({ ...request, question: "Compare the product specifications" })).toEqual(["gemini-3.8-flash", "gpt-6.1-sol"]);
  });

  it("requires the durable authorized runtime for a company's paid execution", async () => {
    const { router, openai, google } = makeRouter({ ok: false, code: "UNAVAILABLE", providerAttempted: false, retrySafe: true });
    expect(await router.complete({ ...request, companyId: "test-company" })).toMatchObject({ ok: false, code: "NEEDS_SETUP", providerAttempted: false });
    expect(openai.complete).not.toHaveBeenCalled(); expect(google.complete).not.toHaveBeenCalled();
  });

  it("never reads the active company's budget during a synthetic fallback", async () => {
    const active = new InMemoryAIUsageLedger(); setActiveLedgerStore(active);
    await active.setBudget({ companyId: "test-company", monthlyLimitBaisa: 0, maxTokensPerRequest: 1, hardStopEnabled: true });
    const { router } = makeRouter({ ok: false, code: "UNAVAILABLE", providerAttempted: false, retrySafe: true });
    expect(await router.complete({ ...request, companyId: "test-company", dryRun: true })).toMatchObject({ ok: true, modelId: "gemini-3.8-flash" });
    expect(await active.getCompanyUsage("test-company")).toEqual([]);
  });
});

describe("P3 offline simulator never contaminates durable accounting", () => {
  let active: InMemoryAIUsageLedger;
  beforeEach(() => { active = new InMemoryAIUsageLedger(); setActiveLedgerStore(active); });
  it("keeps a mock answer and estimated spend outside the active company ledger", async () => {
    const result = await simulateAdminAIAnswer({ ...request, companyId: "test-company", dryRun: true });
    expect(result).toMatchObject({ ok: true, usageMode: "offline_simulation" });
    expect(await active.getCompanyUsage("test-company")).toEqual([]);
    expect(await active.getCompanySpendBaisa("test-company")).toBe(0);
  });
  it("does not read real company's budget while executing an offline mock", async () => {
    await active.setBudget({ companyId: "test-company", monthlyLimitBaisa: 0, hardStopEnabled: true, maxTokensPerRequest: 1 });
    expect(await simulateAdminAIAnswer({ ...request, companyId: "test-company", dryRun: true })).toMatchObject({ ok: true });
  });
});
