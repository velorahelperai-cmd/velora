import { describe, expect, it, vi } from "vitest";
import type { AnswerResult } from "../types";
import { checkCompanyAIBudget, InMemoryAIUsageLedger, recordExecutionInLedger } from "./ledger";

function success(): AnswerResult {
  return { ok: true, text: "fixture", citations: [], usage: {
    promptChars: 5, contextChars: 0, sourceCount: 0, modelId: "gpt-6-luna", provider: "openai",
    promptTokens: 1_000, completionTokens: 500, cachedTokens: 200, cacheWriteTokens: 100,
    reasoningTokens: 400, totalTokens: 1_500, estimatedCostUsd: 0.0003345,
    estimatedCostBaisa: 0.128615, requestId: "req-fixture", latencyMs: 25,
    actualModelId: "gpt-6-luna", responseId: "resp-fixture", pricingVersion: "verified-2026-10-08",
  } };
}

describe("per-attempt offline ledger evidence", () => {
  it("preserves request, latency, cache-write, real model, and pricing evidence", async () => {
    const ledger = new InMemoryAIUsageLedger();
    const entry = await recordExecutionInLedger("tenant-a", success(), { store: ledger });
    expect(entry).toMatchObject({ companyId: "tenant-a", requestId: "req-fixture", latencyMs: 25, cacheWriteTokens: 100,
      actualModelId: "gpt-6-luna", responseId: "resp-fixture", pricingVersion: "verified-2026-10-08", totalTokens: 1_500 });
    expect(Date.parse(entry.createdAt)).toBeGreaterThan(0);
  });

  it("never labels a failed Google attempt as Luna/OpenAI", async () => {
    const entry = await recordExecutionInLedger("tenant-a", { ok: false, code: "UNAVAILABLE",
      modelId: "gemini-3.8-flash", provider: "google", requestId: "google-request", latencyMs: 30,
      providerAttempted: false, retrySafe: true }, { store: new InMemoryAIUsageLedger() });
    expect(entry).toMatchObject({ modelId: "gemini-3.8-flash", provider: "google", requestId: "google-request", latencyMs: 30 });
  });

  it("rejects missing model evidence instead of inventing a requested model", async () => {
    await expect(recordExecutionInLedger("tenant-a", { ok: false, code: "UNAVAILABLE" }, { store: new InMemoryAIUsageLedger() }))
      .rejects.toThrow("MISSING_MODEL_EVIDENCE");
  });

  it("records separately charged fallback attempts without copying the successful cost", async () => {
    const ledger = new InMemoryAIUsageLedger();
    const result = success();
    if (!result.ok) throw Error("fixture");
    result.attempts = [
      { modelId: "gemini-3.8-flash", provider: "google", status: "failed", latencyMs: 10,
        usage: { promptChars: 1, contextChars: 0, sourceCount: 0, promptTokens: 1, completionTokens: 1,
          estimatedCostUsd: 0.001, estimatedCostBaisa: 0.3845 } },
      { modelId: "gpt-6-luna", provider: "openai", status: "success", latencyMs: 25, usage: result.usage },
    ];
    await recordExecutionInLedger("tenant-a", result, { store: ledger });
    const entries = await ledger.getCompanyUsage("tenant-a");
    expect(entries.map((entry) => entry.modelId)).toEqual(["gemini-3.8-flash", "gpt-6-luna"]);
    expect(await ledger.getCompanySpendBaisa("tenant-a")).toBeCloseTo(0.513115, 6);
    expect(await ledger.getCompanyUsage("tenant-b")).toEqual([]);
  });

  it("rejects mismatched model/provider evidence", async () => {
    const result = success();
    if (!result.ok) throw Error("fixture");
    result.usage.provider = "google";
    await expect(recordExecutionInLedger("tenant-a", result, { store: new InMemoryAIUsageLedger() })).rejects.toThrow("INVALID_LEDGER_EVIDENCE");
  });

  it("propagates a failed ledger write without reporting a stored execution", async () => {
    const ledger = new InMemoryAIUsageLedger();
    vi.spyOn(ledger, "record").mockRejectedValue(Error("persistence failed"));
    await expect(recordExecutionInLedger("tenant-a", success(), { store: ledger })).rejects.toThrow("persistence failed");
  });

  it("returns detached tenant rows so consumers cannot rewrite stored identities", async () => {
    const ledger = new InMemoryAIUsageLedger();
    await recordExecutionInLedger("tenant-a", success(), { store: ledger });
    const rows = await ledger.getCompanyUsage("tenant-a");
    rows[0].companyId = "tenant-b";
    expect(await ledger.getCompanyUsage("tenant-b")).toEqual([]);
    expect(await ledger.getCompanyUsage("tenant-a")).toHaveLength(1);
  });

  it("redacts credential-shaped errors before ledger persistence", async () => {
    const entry = await recordExecutionInLedger("tenant-a", { ok: false, code: "UNAVAILABLE", modelId: "gpt-6-luna",
      providerAttempted: false, message: "Bearer test-secret-1234567890 sk-proj-test-12345678901234567890 AQ.test-12345678901234567890" }, { store: new InMemoryAIUsageLedger() });
    expect(entry.errorMessage).not.toContain("test-secret");
    expect(entry.errorMessage).not.toContain("1234567890");
  });

  it("redacts nested credential fields and values in optional ledger metadata", async () => {
    const entry = await recordExecutionInLedger("tenant-a", success(), { store: new InMemoryAIUsageLedger(),
      metadata: { nested: { api_key: "short-secret", authorization: "Bearer fixture-secret", message: "sk-proj-fixture-12345678901234567890" } } });
    expect(JSON.stringify(entry.metadata)).not.toContain("short-secret");
    expect(JSON.stringify(entry.metadata)).not.toContain("fixture-secret");
    expect(JSON.stringify(entry.metadata)).not.toContain("12345678901234567890");
  });

  it("retains unexpected actual model evidence without trusting its quoted cost", async () => {
    const ledger = new InMemoryAIUsageLedger();
    const result = success();
    if (!result.ok) throw Error("fixture");
    result.usage.actualModelId = "gpt-other-model";
    const entry = await recordExecutionInLedger("tenant-a", result, { store: ledger });
    expect(entry).toMatchObject({ actualModelId: "gpt-other-model", status: "failed", metadata: { costStatus: "unknown" } });
    expect((await checkCompanyAIBudget("tenant-a", 5, ledger)).allowed).toBe(false);
  });
});

describe("offline budget preflight validation", () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("blocks invalid projected cost %s", async (projectedCostBaisa) => {
    const result = await checkCompanyAIBudget("tenant-a", 5, { store: new InMemoryAIUsageLedger(), projectedCostBaisa });
    expect(result.allowed).toBe(false);
  });

  it("blocks an uncertain charged execution until reconciliation", async () => {
    const ledger = new InMemoryAIUsageLedger();
    const entry = await recordExecutionInLedger("tenant-a", { ok: false, code: "UNAVAILABLE", modelId: "gpt-6-luna", providerAttempted: true }, { store: ledger });
    expect(entry.estimatedCostBaisa).toBeNull();
    expect(entry.estimatedCostUsd).toBeNull();
    await expect(ledger.getCompanySpendBaisa("tenant-a")).rejects.toThrow("USAGE_COST_UNKNOWN");
    expect((await checkCompanyAIBudget("tenant-a", 5, ledger)).allowed).toBe(false);
    expect((await checkCompanyAIBudget("tenant-b", 5, ledger)).allowed).toBe(true);
  });
});
