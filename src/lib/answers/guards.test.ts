import { afterEach, describe, expect, it, vi } from "vitest";
import { isLiveAnsweringEnabled, readLiveAnsweringFlag } from "./guards";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("live answering kill switch contract", () => {
  it("treats explicit false/off as kill switch even when a provider key exists", () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "AIza-test-key-not-used");
    for (const value of ["false", "0", "off", "no", "FALSE"]) {
      vi.stubEnv("AI_LIVE_ANSWERING", value);
      expect(readLiveAnsweringFlag()).toBe("off");
      expect(isLiveAnsweringEnabled()).toBe(false);
    }
  });

  it("does not let key presence bypass AI_LIVE_ANSWERING_ENABLED=false", () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "AIza-test-key-not-used");
    vi.stubEnv("AI_LIVE_ANSWERING_ENABLED", "false");
    delete process.env.AI_LIVE_ANSWERING;
    expect(isLiveAnsweringEnabled()).toBe(false);
  });

  it("enables only when the flag is explicitly on during hermetic tests", () => {
    vi.stubEnv("AI_LIVE_ANSWERING", "true");
    expect(isLiveAnsweringEnabled()).toBe(true);
    vi.stubEnv("AI_LIVE_ANSWERING", "false");
    expect(isLiveAnsweringEnabled()).toBe(false);
  });

  it("keeps unset flag off under Vitest even if a key string is present", () => {
    vi.stubEnv("AI_GEMINI_API_KEY", "AIza-test-key-not-used");
    delete process.env.AI_LIVE_ANSWERING;
    delete process.env.AI_LIVE_ANSWERING_ENABLED;
    expect(readLiveAnsweringFlag()).toBe("unset");
    expect(isLiveAnsweringEnabled()).toBe(false);
  });
});
