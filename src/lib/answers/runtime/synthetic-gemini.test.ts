import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const provider = vi.hoisted(() => ({ generate: vi.fn(), constructors: vi.fn() }));
vi.mock("@google/genai", () => ({ ThinkingLevel: { LOW: "LOW" }, GoogleGenAI: class { models = { generateContent: provider.generate }; constructor(options: unknown) { provider.constructors(options); } } }));
import { executeSyntheticGemini } from "./synthetic-gemini";
import type { RealRuntimeStore } from "./store";
const ids = { actorId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222", companyId: "33333333-3333-4333-8333-333333333333", executionId: "44444444-4444-4444-8444-444444444444" };
function config(extra: Record<string, unknown> = {}) { return { NODE_ENV: "test" as const, VELORA_GEMINI_FREE_ENABLED: "true", VELORA_GEMINI_FREE_KEY_REFERENCE: "AI_GEMINI_API_KEY", AI_GEMINI_API_KEY: "synthetic-not-a-key", AI_GEMINI_FREE_API_KEY: "must-not-use-this-key", VELORA_GEMINI_FREE_ATTESTATION: JSON.stringify({ version: 1, verifiedAt: new Date().toISOString(), projectRef: "velora-510615", modelId: "gemini-3.8-flash", keyReference: "AI_GEMINI_API_KEY", billingDisabled: true, freeModelVerified: true, regionAllowed: true, unpaidTermsAccepted: true, ledgerVerified: true, quota: { modelId: "gemini-3.8-flash", verifiedAt: new Date().toISOString(), requestsAvailable: 1, promptTokensAvailable: 1024 }, ...ids, ...extra }) }; }
function store() { return { reserve: vi.fn(async () => ({ ok: true })), start: vi.fn(async () => true), settle: vi.fn(async () => true) } satisfies RealRuntimeStore; }
beforeEach(() => { vi.clearAllMocks(); provider.generate.mockResolvedValue({ text: "VELORA_SYNTHETIC_OK", responseId: "synthetic-response", modelVersion: "gemini-3.8-flash-001", candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 8, thoughtsTokenCount: 0, totalTokenCount: 28 } }); });
describe("scoped existing Gemini key", () => {
 it("dispatches through only the explicitly verified existing reference", async () => {
  const db = store(); const result = await executeSyntheticGemini({ ...ids, executeConfirmed: true }, { env: config(), store: db });
  expect(result.ok).toBe(true); expect(provider.generate).toHaveBeenCalledTimes(1);
  expect(provider.constructors).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "synthetic-not-a-key" }));
  expect(db.settle).toHaveBeenCalledWith(expect.objectContaining({ status: "success", costBaisa: 0 }));
 });
 it.each([undefined, {}, { modelId: "gemini-3.8-flash", verifiedAt: new Date().toISOString(), requestsAvailable: 0, promptTokensAvailable: 1024 }, { modelId: "gemini-3.8-flash", verifiedAt: new Date().toISOString(), requestsAvailable: 1, promptTokensAvailable: 0 }])("fails closed on absent or exhausted project quota: %j", async quota => {
  const db = store(); expect((await executeSyntheticGemini({ ...ids, executeConfirmed: true }, { env: config({ quota }), store: db })).ok).toBe(false);
  expect(db.reserve).not.toHaveBeenCalled(); expect(provider.generate).not.toHaveBeenCalled();
 });
 it("rejects stale quota without reserve or dispatch", async () => { const db = store(); const env = config({ quota: { modelId: "gemini-3.8-flash", verifiedAt: new Date(Date.now()-300001).toISOString(), requestsAvailable: 1, promptTokensAvailable: 1024 } });
  expect((await executeSyntheticGemini({ ...ids, executeConfirmed: true }, { env, store: db })).ok).toBe(false); expect(db.reserve).not.toHaveBeenCalled(); expect(provider.generate).not.toHaveBeenCalled();
 });
 it("never falls back to another present key", async () => { const db = store(); const env = { ...config(), AI_GEMINI_API_KEY: "", AI_GEMINI_FREE_API_KEY: "other-synthetic-key" };
  expect((await executeSyntheticGemini({ ...ids, executeConfirmed: true }, { env, store: db })).ok).toBe(false); expect(provider.generate).not.toHaveBeenCalled();
 });
 it("retains the hold on a project rate limit with no retry", async () => { provider.generate.mockRejectedValue({ status: 429 }); const db = store();
  expect(await executeSyntheticGemini({ ...ids, executeConfirmed: true }, { env: config(), store: db })).toMatchObject({ ok: false, error: "PROVIDER_RATE_LIMIT", retrySafe: false });
  expect(provider.generate).toHaveBeenCalledTimes(1); expect(db.settle).toHaveBeenCalledWith(expect.objectContaining({ status: "uncertain", costBaisa: null }));
 });
});
