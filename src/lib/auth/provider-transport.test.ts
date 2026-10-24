import { describe, expect, it } from "vitest";
import { actionCodeForProviderFailure, classifyProviderAuthFailure } from "./provider-transport";

describe("classifyProviderAuthFailure", () => {
  it("keeps confirmed credential rejects as AUTH_ERROR", () => {
    expect(classifyProviderAuthFailure({ status: 400, code: "invalid_credentials" })).toBe("confirmed_reject");
    expect(actionCodeForProviderFailure("confirmed_reject")).toBe("AUTH_ERROR");
  });

  it("treats 5xx, 408 and network-shaped failures as UNKNOWN transport", () => {
    for (const error of [
      { status: 503, code: "service_unavailable" },
      { status: 408, code: "request_timeout" },
      { name: "TypeError", message: "fetch failed" },
      { message: "NetworkError when attempting to fetch resource." },
    ]) {
      expect(classifyProviderAuthFailure(error)).toBe("unknown_transport");
    }
    expect(actionCodeForProviderFailure("unknown_transport")).toBe("UNAVAILABLE");
  });

  it("keeps rate-limit dispositions as confirmed rejects for a new attempt", () => {
    expect(classifyProviderAuthFailure({ status: 429, code: "over_request_rate_limit" })).toBe("confirmed_reject");
  });
});

