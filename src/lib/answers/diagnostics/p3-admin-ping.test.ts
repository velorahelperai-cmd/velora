import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const trial = vi.hoisted(() => vi.fn());
vi.mock("../runtime/admin-actions", () => ({ runAdminAITrial: trial }));
import { executeLiveModelPing } from "./ping-test";
const companyId = "11111111-1111-4111-8111-111111111111";
const executionId = "22222222-2222-4222-8222-222222222222";
beforeEach(() => trial.mockReset());
describe("P3 explicit owner-only synthetic ping preparation", () => {
  it("blocked approval makes zero administrative/provider attempts", async () => {
    expect(await executeLiveModelPing({ modelId: "gpt-6-luna", executeConfirmed: false })).toMatchObject({ ok: false, latencyMs: 0 });
    expect(trial).not.toHaveBeenCalled();
  });
  it("requires retained company/execution identity for a later approved trial", async () => {
    expect(await executeLiveModelPing({ modelId: "gpt-6-luna", executeConfirmed: true })).toMatchObject({ ok: false, error: "INVALID_TEST_SCOPE" });
    expect(trial).not.toHaveBeenCalled();
  });
  it.each(["gpt-6-luna", "gpt-6.1-sol", "gemini-3.8-flash"] as const)("uses existing authorized ledger path and fixed caps for %s", async modelId => {
    trial.mockResolvedValue({ ok: true, complete: true, model: modelId, text: "Synthetic OK", attempts: [{ model: modelId, status: "success", requestId: "request.fixture", latencyMs: 2, costUsd: 0.001, costBaisa: 0.384, usage: { promptTokens: 5, completionTokens: 5, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 1, totalTokens: 10 } }] });
    const result = await executeLiveModelPing({ modelId, executeConfirmed: true, companyId, executionId } as Parameters<typeof executeLiveModelPing>[0]);
    expect(trial).toHaveBeenCalledWith(expect.objectContaining({ model: modelId, companyId, executionId, contextMode: "connection", maxOutputTokens: 128, maxCostBaisa: 250 }));
    expect(result).toMatchObject({ ok: true, modelId, requestId: "request.fixture", tokens: { promptTokens: 5, completionTokens: 5, totalTokens: 10 } });
  });
  it("does not accept arbitrary data in the synthetic test", async () => {
    expect(await executeLiveModelPing({ modelId: "gpt-6-luna", executeConfirmed: true, companyId, executionId, customPrompt: "Private customer data" } as Parameters<typeof executeLiveModelPing>[0])).toMatchObject({ ok: false, error: "SYNTHETIC_PROMPT_REQUIRED" });
    expect(trial).not.toHaveBeenCalled();
  });
  it("owner denial propagates without direct adapter dispatch", async () => {
    trial.mockResolvedValue({ ok: false, error: "OWNER_REQUIRED" });
    expect(await executeLiveModelPing({ modelId: "gpt-6-luna", executeConfirmed: true, companyId, executionId } as Parameters<typeof executeLiveModelPing>[0])).toMatchObject({ ok: false, error: "OWNER_REQUIRED" });
  });
  it("retains billed attempt telemetry when settlement is pending", async () => {
    trial.mockResolvedValue({ ok: false, error: "SETTLEMENT_PENDING_RECONCILIATION", attempts: [{ model: "gpt-6-luna", status: "success", requestId: "request.fixture", responseId: "response.fixture", actualModelId: "gpt-6-luna", latencyMs: 21, costUsd: 0.001, costBaisa: 0.384, usage: { promptTokens: 5, completionTokens: 5, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 1, totalTokens: 10 } }] });
    expect(await executeLiveModelPing({ modelId: "gpt-6-luna", executeConfirmed: true, companyId, executionId })).toMatchObject({ ok: false, error: "SETTLEMENT_PENDING_RECONCILIATION", latencyMs: 21, requestId: "request.fixture", responseId: "response.fixture", tokens: { totalTokens: 10 }, economics: { costUsd: 0.001, costBaisa: 0.384 } });
  });
  it("retains uncertain timing without inventing a zero cost", async () => {
    trial.mockResolvedValue({ ok: false, error: "PROVIDER_NETWORK_ERROR", attempts: [{ model: "gpt-6-luna", status: "uncertain", requestId: "request.fixture", latencyMs: 21, costUsd: null, costBaisa: null }] });
    const result = await executeLiveModelPing({ modelId: "gpt-6-luna", executeConfirmed: true, companyId, executionId });
    expect(result).toMatchObject({ ok: false, latencyMs: 21, requestId: "request.fixture" });
    expect(result.economics).toBeUndefined();
  });
});
