import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let mockKey: string | null = null;
let mockModelId: string | null = "gemini-3.8-flash";

vi.mock("@/lib/answers/config/env", () => ({
  getSecureProviderKey: vi.fn(() => mockKey),
  getGeminiModelId: vi.fn(() => mockModelId),
  isProviderKeyConfigured: vi.fn(() => Boolean(mockKey)),
}));

import { clearAnswerProviderForTesting, getAnswerProvider, setAnswerProviderForTesting } from "./provider";
import { GeminiAnswerAdapter } from "./adapters/gemini";
import type { AnswerProvider } from "./types";

describe("getAnswerProvider", () => {
  afterEach(() => {
    mockKey = null;
    mockModelId = "gemini-3.8-flash";
    clearAnswerProviderForTesting();
  });

  it("returns null when no API key is configured", () => {
    mockKey = null;
    clearAnswerProviderForTesting();
    const provider = getAnswerProvider();
    expect(provider).toBeNull();
  });

  it("returns GeminiAnswerAdapter when API key is configured", () => {
    mockKey = randomUUID();
    mockModelId = "gemini-3.8-pro";
    clearAnswerProviderForTesting();
    const provider = getAnswerProvider();
    expect(provider).not.toBeNull();
    expect(provider).toBeInstanceOf(GeminiAnswerAdapter);
    expect((provider as GeminiAnswerAdapter)?.modelId).toBe("gemini-3.8-pro");
  });

  it("allows setting test provider for hermetic testing", () => {
    const mockTestProvider: AnswerProvider = {
      id: "test-injected",
      complete: vi.fn(),
    };
    setAnswerProviderForTesting(mockTestProvider);
    expect(getAnswerProvider()).toBe(mockTestProvider);
  });
});
