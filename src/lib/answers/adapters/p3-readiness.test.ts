vi.mock("server-only", () => ({}));
import OpenAI from "openai";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIAnswerAdapter } from "./openai";
import { GeminiAnswerAdapter } from "./gemini";
import { matchesRequestedModel } from "./response-identity";
import { checkOpenAIModelAvailability, checkGeminiModelAvailability } from "../diagnostics/model-availability";
import type { AnswerProviderRequest } from "../types";

const input: AnswerProviderRequest = { question: "When do you open?", locale: "en", chunks: [{ sourceId: "approved-example", title: "Hours", contentVersion: 1, text: "Open at nine." }] };
const response = () => ({ id: "resp_mock", _request_id: "req_mock", status: "completed", model: "gpt-6-luna", output_text: "At nine.", usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140, input_tokens_details: { cached_tokens: 20 }, output_tokens_details: { reasoning_tokens: 10 } } });
const openai = (create = vi.fn().mockResolvedValue(response())) => ({ adapter: new OpenAIAnswerAdapter({ client: { responses: { create } } as unknown as OpenAI }), create });
const gemini = (generateContent = vi.fn().mockResolvedValue({ responseId: "gemini_mock", modelVersion: "gemini-3.8-flash", text: "At nine.", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30, cachedContentTokenCount: 10, totalTokenCount: 150 } })) => ({ adapter: new GeminiAnswerAdapter({ client: { models: { generateContent } } as unknown as GoogleGenAI }), generateContent });
afterEach(() => vi.unstubAllEnvs());

describe("P3 provider request boundaries", () => {
  it("accepts only documented aliases and same-family snapshot metadata", () => {
    expect(matchesRequestedModel("gpt-6-luna-2026-10-01", "gpt-6-luna")).toBe(true);
    expect(matchesRequestedModel("gpt-6.1-sol-2026-10-01", "gpt-6.1-sol")).toBe(true);
    expect(matchesRequestedModel("models/gemini-3.8-flash-001", "gemini-3.8-flash")).toBe(true);
    expect(matchesRequestedModel(undefined, "gpt-6-luna")).toBe(true);
    expect(matchesRequestedModel("gpt-6-luna-unapproved", "gpt-6-luna")).toBe(false);
    expect(matchesRequestedModel("gemini-3.8-flash-preview", "gemini-3.8-flash")).toBe(false);
    expect(matchesRequestedModel("gpt-6.1-sol", "gpt-6-luna")).toBe(false);
  });
  it.each(["gpt-6-luna", "gpt-6.1-sol"] as const)("uses bounded Responses API without automatic retries for %s", async (model) => {
    const { adapter, create } = openai(vi.fn().mockResolvedValue({ ...response(), model }));
    const result = await adapter.complete({ ...input, forceModelId: model, maxOutputTokens: 128, timeoutMs: 1000 });
    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    const [body, options] = create.mock.calls[0];
    expect(body).toMatchObject({ model, max_output_tokens: 128, store: false });
    expect(body).not.toHaveProperty("temperature");
    expect(options).toMatchObject({ maxRetries: 0, timeout: 1000 });
    expect(result).toMatchObject({ usage: { requestId: "req_mock", completionTokens: 40, reasoningTokens: 10, totalTokens: 140 } });
  });
  it("does not silently switch to the legacy Chat Completions endpoint", async () => {
    const create = vi.fn();
    const adapter = new OpenAIAnswerAdapter({ client: { chat: { completions: { create } } } as unknown as OpenAI });
    expect(await adapter.complete(input)).toMatchObject({ ok: false, code: "NEEDS_SETUP", providerAttempted: false });
    expect(create).not.toHaveBeenCalled();
  });
  it("uses modern Gemini thinking and one bounded SDK attempt", async () => {
    const { adapter, generateContent } = gemini();
    const result = await adapter.complete({ ...input, maxOutputTokens: 128, timeoutMs: 1000 });
    expect(result.ok).toBe(true);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0][0]).toMatchObject({ model: "gemini-3.8-flash", config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, maxOutputTokens: 128, httpOptions: { timeout: 1000, retryOptions: { attempts: 1 } } } });
    expect(generateContent.mock.calls[0][0].config).not.toHaveProperty("temperature");
    expect(result).toMatchObject({ usage: { requestId: "gemini_mock", completionTokens: 50, reasoningTokens: 30, totalTokens: 150 } });
  });
  it("counts tokens with the same contents/systemInstruction shape as complete()", async () => {
    const countTokens = vi.fn().mockResolvedValue({ totalTokens: 42 });
    const adapter = new GeminiAnswerAdapter({
      client: { models: { generateContent: vi.fn(), countTokens } } as unknown as GoogleGenAI,
    });
    await expect(adapter.countInputTokens({ ...input, persona: "noura" })).resolves.toBe(42);
    expect(countTokens).toHaveBeenCalledTimes(1);
    const args = countTokens.mock.calls[0][0];
    expect(args.model).toBe("gemini-3.8-flash");
    expect(typeof args.contents).toBe("string");
    expect(args.config?.systemInstruction).toEqual(expect.any(String));
    expect(Array.isArray(args.contents)).toBe(false);
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 4097])("rejects invalid output caps before provider execution: %s", async (maxOutputTokens) => {
    const { adapter, create } = openai();
    const { adapter: google, generateContent } = gemini();
    expect(await adapter.complete({ ...input, maxOutputTokens })).toMatchObject({ ok: false, code: "INVALID_INPUT", providerAttempted: false });
    expect(await google.complete({ ...input, maxOutputTokens })).toMatchObject({ ok: false, code: "INVALID_INPUT", providerAttempted: false });
    expect(create).not.toHaveBeenCalled(); expect(generateContent).not.toHaveBeenCalled();
  });
  it("rejects a forced model from another adapter", async () => {
    const { adapter, create } = openai(); const { adapter: google, generateContent } = gemini();
    expect(await adapter.complete({ ...input, forceModelId: "gemini-3.8-flash" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await google.complete({ ...input, forceModelId: "gpt-6-luna" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(create).not.toHaveBeenCalled(); expect(generateContent).not.toHaveBeenCalled();
  });
  it("does not dispatch already aborted requests", async () => {
    const controller = new AbortController(); controller.abort();
    const { adapter, create } = openai(); const { adapter: google, generateContent } = gemini();
    expect(await adapter.complete({ ...input, signal: controller.signal })).toMatchObject({ ok: false, providerAttempted: false, retrySafe: false });
    expect(await google.complete({ ...input, signal: controller.signal })).toMatchObject({ ok: false, providerAttempted: false, retrySafe: false });
    expect(create).not.toHaveBeenCalled(); expect(generateContent).not.toHaveBeenCalled();
  });
  it("passes abort signals to both SDKs", async () => {
    const controller = new AbortController(); const { adapter, create } = openai(); const { adapter: google, generateContent } = gemini();
    await adapter.complete({ ...input, signal: controller.signal }); await google.complete({ ...input, signal: controller.signal });
    expect(create.mock.calls[0][1].signal).toBe(controller.signal);
    expect(generateContent.mock.calls[0][0].config.abortSignal).toBe(controller.signal);
  });
});

describe("P3 paid failure evidence", () => {
  it.each([401, 429, 500, undefined])("does not allow fallback after an uncertain or account failure: %s", async (status) => {
    const error = { status, name: status ? "APIError" : "APIConnectionTimeoutError", message: "example secret" };
    const { adapter, create } = openai(vi.fn().mockRejectedValue(error)); const { adapter: google, generateContent } = gemini(vi.fn().mockRejectedValue(error));
    expect(await adapter.complete(input)).toMatchObject({ ok: false, providerAttempted: true, retrySafe: false });
    expect(await google.complete(input)).toMatchObject({ ok: false, providerAttempted: true, retrySafe: false });
    expect(create).toHaveBeenCalledTimes(1); expect(generateContent).toHaveBeenCalledTimes(1);
  });
  it.each([403, 404])("permits controlled fallback after explicit provider rejection: %s", async (status) => {
    const { adapter } = openai(vi.fn().mockRejectedValue({ status })); const { adapter: google } = gemini(vi.fn().mockRejectedValue({ status }));
    expect(await adapter.complete(input)).toMatchObject({ ok: false, providerAttempted: true, retrySafe: true });
    expect(await google.complete(input)).toMatchObject({ ok: false, providerAttempted: true, retrySafe: true });
  });
  it("retains billable usage for incomplete and empty OpenAI output", async () => {
    for (const partial of [{ status: "incomplete", output_text: "Partial answer" }, { output_text: "" }]) {
      const { adapter } = openai(vi.fn().mockResolvedValue({ ...response(), ...partial }));
      expect(await adapter.complete(input)).toMatchObject({ ok: false, providerAttempted: true, retrySafe: false, usage: { promptTokens: 100, completionTokens: 40, requestId: "req_mock" } });
    }
  });
  it("retains Gemini thought costs even when no answer is returned", async () => {
    const { adapter } = gemini(vi.fn().mockResolvedValue({ responseId: "gemini_empty", text: "", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 0, thoughtsTokenCount: 30, totalTokenCount: 130 } }));
    expect(await adapter.complete(input)).toMatchObject({ ok: false, retrySafe: false, usage: { promptTokens: 100, completionTokens: 30, reasoningTokens: 30, totalTokens: 130 } });
  });
  it("does not report successful unmetered responses as zero-cost", async () => {
    const { adapter } = openai(vi.fn().mockResolvedValue({ id: "unmetered", status: "completed", output_text: "Answer" }));
    const { adapter: google } = gemini(vi.fn().mockResolvedValue({ text: "Answer", responseId: "unmetered" }));
    expect(await adapter.complete(input)).toMatchObject({ ok: false, retrySafe: false });
    expect(await google.complete(input)).toMatchObject({ ok: false, retrySafe: false });
  });
  it("preserves unexpected model evidence without assigning the requested model's price", async () => {
    const { adapter } = openai(vi.fn().mockResolvedValue({ ...response(), model: "different-model" }));
    const { adapter: google } = gemini(vi.fn().mockResolvedValue({ modelVersion: "different-model", responseId: "other_model", text: "Answer", usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }));
    for (const result of [await adapter.complete(input), await google.complete(input)]) {
      expect(result).toMatchObject({ ok: false, retrySafe: false, providerAttempted: true, usage: { actualModelId: "different-model" } });
      expect(result.usage?.estimatedCostUsd).toBeUndefined(); expect(result.usage?.estimatedCostBaisa).toBeUndefined();
    }
  });
  it("never returns raw provider error bodies containing any secret format", async () => {
    // Runtime-constructed synthetic provider error shapes for redaction assertion only (not credentials).
    const message = [
      "sk-" + "example_key_abcdefghijklmnopqrstuvwxyz",
      "AQ." + "example_google_secret_abcdefghijklmnopqrstuvwxyz",
      "AIza" + "12345678901234567890123456789012345",
      "Bearer opaque-token user-key=opaque-value",
    ].join(" ");
    const { adapter } = openai(vi.fn().mockRejectedValue(new Error(message))); const { adapter: google } = gemini(vi.fn().mockRejectedValue(new Error(message)));
    const results = [await adapter.complete(input), await google.complete(input)];
    for (const result of results) expect(JSON.stringify(result)).not.toContain("opaque");
    expect(JSON.stringify(results)).not.toContain("AQ."); expect(JSON.stringify(results)).not.toContain("sk-example");
  });
});

describe("P3 model metadata diagnostics", () => {
  it("never returns provider error bodies in metadata diagnostics", async () => {
    const secret = "AQ.fake_secret_abcdefghijklmnopqrstuvwxyz user-key=opaque-value";
    const a = await checkOpenAIModelAvailability("gpt-6-luna", { models: { retrieve: vi.fn().mockRejectedValue(new Error(secret)) } } as unknown as OpenAI);
    const b = await checkGeminiModelAvailability("gemini-3.8-flash", { models: { get: vi.fn().mockRejectedValue(new Error(secret)) } } as unknown as GoogleGenAI);
    expect(JSON.stringify([a, b])).not.toContain(secret); expect(JSON.stringify([a, b])).not.toContain("opaque");
  });
  it("does not claim generation authorization from a catalog descriptor alone", async () => {
    const a = await checkOpenAIModelAvailability("gpt-6-luna", { models: { retrieve: vi.fn().mockResolvedValue({ id: "gpt-6-luna" }) } } as unknown as OpenAI);
    const b = await checkGeminiModelAvailability("gemini-3.8-flash", { models: { get: vi.fn().mockResolvedValue({ name: "models/gemini-3.8-flash" }) } } as unknown as GoogleGenAI);
    expect(a.message).not.toMatch(/fully authorized/i); expect(b.message).not.toMatch(/fully authorized/i);
    expect(a).toMatchObject({ generationVerified: false }); expect(b).toMatchObject({ generationVerified: false });
  });
  it("rejects model descriptors for a different model without substitution", async () => {
    const a = await checkOpenAIModelAvailability("gpt-6-luna", { models: { retrieve: vi.fn().mockResolvedValue({ id: "different-model" }) } } as unknown as OpenAI);
    const b = await checkGeminiModelAvailability("gemini-3.8-flash", { models: { get: vi.fn().mockResolvedValue({ name: "models/different-model" }) } } as unknown as GoogleGenAI);
    expect(a.status).toBe("NOT_FOUND_ON_ENDPOINT"); expect(b.status).toBe("NOT_FOUND_ON_ENDPOINT");
  });
});
