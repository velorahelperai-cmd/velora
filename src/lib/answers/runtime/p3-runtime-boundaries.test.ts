import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ rpc: vi.fn(), clientAvailable: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.clientAvailable ? { rpc: state.rpc } : null }));
vi.mock("../config/env", () => ({ getSecureProviderKey: () => null, getGeminiModelId: () => "gemini-3.8-flash" }));
import { executeRealAnswer } from "./execute";
import { createRealRuntimeStore, type RealRuntimeStore } from "./store";

const input = { actorId: "actor-fixture", sessionId: "session-fixture", companyId: "tenant-fixture", executionId: "execution-fixture", question: "Fixture opening hours?", locale: "en" as const, chunks: [], usageMode: "admin_test" as const };
const reserve = { id: "attempt-fixture", executionId: input.executionId, attempt: 1, companyId: input.companyId, actorId: input.actorId, sessionId: input.sessionId, model: "gpt-6-luna", provider: "openai", reservedBaisa: 1, pricingVersion: "fixture", pricingSnapshot: {}, usageMode: "admin_test" as const };
function store(patch: Partial<RealRuntimeStore> = {}): RealRuntimeStore { return { reserve: async () => ({ ok: true }), start: async () => true, settle: async () => true, ...patch }; }
beforeEach(() => { state.clientAvailable = true; state.rpc.mockReset(); });

describe("P3 actual durable store RPC evidence", () => {
  it("accepts the exact SQL reservation success and its retained id", async () => {
    state.rpc.mockResolvedValue({ error: null, data: { ok: true, id: reserve.id, remaining_baisa: 999 } });
    expect(await createRealRuntimeStore().reserve(reserve)).toMatchObject({ ok: true });
  });
  it.each([null, [], { ok: "true" }, { ok: true, id: "other-attempt", remaining_baisa: 999 }, { ok: true, id: reserve.id, remaining_baisa: -1 }])("rejects malformed reservation proof %j", async data => {
    state.rpc.mockResolvedValue({ error: null, data });
    await expect(createRealRuntimeStore().reserve(reserve)).rejects.toThrow();
  });
});

describe("P3 real execution dispatch boundary", () => {
  it("returns a local failure when default persistence construction is unavailable", async () => {
    state.clientAvailable = false;
    await expect(executeRealAnswer(input)).resolves.toMatchObject({ ok: false, error: "PERSISTENCE_UNAVAILABLE" });
  });
  it("keeps customer live execution disabled even with injected ports", async () => {
    const db = store(); const reserveSpy = vi.spyOn(db, "reserve"); const call = vi.fn();
    expect(await executeRealAnswer({ ...input, usageMode: "company_live" }, { store: db, call })).toMatchObject({ ok: false, error: "LIVE_AI_DISABLED" });
    expect(reserveSpy).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
  });
  it("never dispatches against a truthy malformed reservation result", async () => {
    const db = store({ reserve: async () => ({ ok: "false" }) as unknown as { ok: boolean } }); const call = vi.fn();
    expect(await executeRealAnswer(input, { store: db, call })).toMatchObject({ ok: false });
    expect(call).not.toHaveBeenCalled();
  });
  it("rejects unapproved model identifiers before reserving", async () => {
    const db = store(); const reserveSpy = vi.spyOn(db, "reserve"); const call = vi.fn();
    expect(await executeRealAnswer({ ...input, model: "unapproved-model" as never }, { store: db, call })).toMatchObject({ ok: false, error: "INVALID_INPUT" });
    expect(reserveSpy).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
  });
  it("enforces an administrative test cost ceiling before paid dispatch", async () => {
    const db = store(); const reserveSpy = vi.spyOn(db, "reserve"); const call = vi.fn();
    expect(await executeRealAnswer({ ...input, maxCostBaisa: 0.000001 } as typeof input, { store: db, call })).toMatchObject({ ok: false, error: "TEST_COST_LIMIT_EXCEEDED" });
    expect(reserveSpy).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
  });
  it("passes the bounded output ceiling to the existing provider path", async () => {
    const call = vi.fn().mockResolvedValue({ status: "rejected", text: "", errorCode: "PROVIDER_HTTP_400", latencyMs: 1 });
    await executeRealAnswer({ ...input, maxOutputTokens: 128 } as typeof input, { store: store(), call });
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 128 }));
  });
  it("does not downgrade a complex Sol request after definite rejection", async () => {
    const call = vi.fn().mockResolvedValue({ status: "rejected", text: "", errorCode: "PROVIDER_HTTP_404", latencyMs: 1 });
    await executeRealAnswer({ ...input, question: "This is a complicated complaint about damaged products" }, { store: store(), call });
    expect(call).toHaveBeenCalledTimes(1); expect(call).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-6.1-sol" }));
  });
  it("does not evade an account usage limit through another provider", async () => {
    const call = vi.fn().mockResolvedValue({ status: "rejected", text: "", errorCode: "PROVIDER_HTTP_429", latencyMs: 1 });
    await executeRealAnswer(input, { store: store(), call });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("does not claim authorization cancellation was persisted when settlement returns false", async () => {
    const call = vi.fn();
    expect(await executeRealAnswer(input, { store: store({ start: async () => false, settle: async () => false }), call })).toMatchObject({ ok: false, error: "LEDGER_WRITE_FAILED" });
    expect(call).not.toHaveBeenCalled();
  });
  it("records billed empty output as incomplete without claiming a completed answer", async () => {
    const db = store(); const settle = vi.spyOn(db, "settle");
    const call = vi.fn().mockResolvedValue({ status: "success", text: "", latencyMs: 1, usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } });
    expect(await executeRealAnswer(input, { store: db, call })).toMatchObject({ ok: true, complete: false });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ status: "incomplete" })); expect(call).toHaveBeenCalledTimes(1);
  });
  it("keeps malformed provider model metadata uncertain and holds cost", async () => {
    const db = store(); const settle = vi.spyOn(db, "settle");
    const call = vi.fn().mockResolvedValue({ status: "success", text: "Untrusted", actualModelId: {}, latencyMs: 1, usage: { promptTokens: 1, completionTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 } });
    await expect(executeRealAnswer(input, { store: db, call })).resolves.toMatchObject({ ok: false, error: "PROVIDER_MODEL_MISMATCH" });
    expect(settle).toHaveBeenCalledWith(expect.objectContaining({ status: "uncertain", costBaisa: null }));
  });
});
