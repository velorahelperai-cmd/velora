import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const sdk = vi.hoisted(() => ({ openai: vi.fn(), google: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: sdk.openai }; } }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { interactions = { create: sdk.google }; } }));
vi.mock("../config/env", () => ({ getSecureProviderKey: () => "offline-fixture-key" }));
import { callRealModel } from "./provider";
const openaiResponse = { id: "resp.fixture", _request_id: "request.fixture", model: "gpt-6-luna", status: "completed", output_text: "Synthetic OK", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 1, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 2 } } };
const geminiResponse = { id: "interaction.fixture", model: "gemini-3.8-flash", status: "completed", output_text: "Synthetic OK", usage: { total_input_tokens: 10, total_output_tokens: 2, total_thought_tokens: 3, total_cached_tokens: 1, total_tokens: 15 } };
beforeEach(() => { sdk.openai.mockReset().mockResolvedValue(openaiResponse); sdk.google.mockReset().mockResolvedValue(geminiResponse); });
describe("P3 actual administrative provider boundary", () => {
  it("preserves OpenAI response/request/model and token provenance", async () => {
    expect(await callRealModel({ model: "gpt-6-luna", system: "Fixture", prompt: "Fixture", maxOutputTokens: 128 })).toMatchObject({ status: "success", requestId: "request.fixture", responseId: "resp.fixture", actualModelId: "gpt-6-luna", usage: { totalTokens: 15 } });
    expect(sdk.openai).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-6-luna", max_output_tokens: 128, store: false }));
  });
  it("preserves Gemini billed output including thoughts once", async () => {
    expect(await callRealModel({ model: "gemini-3.8-flash", system: "Fixture", prompt: "Fixture" })).toMatchObject({ status: "success", actualModelId: "gemini-3.8-flash", responseId: "interaction.fixture", usage: { promptTokens: 10, completionTokens: 5, reasoningTokens: 3, totalTokens: 15 } });
  });
  it("checks Gemini output counters independently of the reported total", async () => {
    sdk.google.mockResolvedValue({ ...geminiResponse, usage: { ...geminiResponse.usage, total_output_tokens: 1000 } });
    expect(await callRealModel({ model: "gemini-3.8-flash", system: "Fixture", prompt: "Fixture" })).toMatchObject({ status: "uncertain" });
  });
  it("does not price unexpected tool usage as a tool-free test", async () => {
    sdk.google.mockResolvedValue({ ...geminiResponse, usage: { ...geminiResponse.usage, total_tool_use_tokens: 1 } });
    expect(await callRealModel({ model: "gemini-3.8-flash", system: "Fixture", prompt: "Fixture" })).toMatchObject({ status: "uncertain" });
  });
  it("does not accept inconsistent OpenAI total usage", async () => {
    sdk.openai.mockResolvedValue({ ...openaiResponse, usage: { ...openaiResponse.usage, total_tokens: 100 } });
    expect(await callRealModel({ model: "gpt-6-luna", system: "Fixture", prompt: "Fixture" })).toMatchObject({ status: "uncertain" });
  });
  it("does not accept unexpected provider model families", async () => {
    sdk.openai.mockResolvedValue({ ...openaiResponse, model: "different-model" });
    expect(await callRealModel({ model: "gpt-6-luna", system: "Fixture", prompt: "Fixture" })).toMatchObject({ status: "uncertain", actualModelId: "different-model", errorCode: "PROVIDER_MODEL_MISMATCH" });
  });
  it("never substitutes unknown input model with a provider default", async () => {
    expect(await callRealModel({ model: "different-model" as never, system: "Fixture", prompt: "Fixture" })).toMatchObject({ status: "rejected", errorCode: "INVALID_INPUT" });
    expect(sdk.openai).not.toHaveBeenCalled(); expect(sdk.google).not.toHaveBeenCalled();
  });
});
