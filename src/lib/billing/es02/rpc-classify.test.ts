import { describe, expect, it } from "vitest";
import { classifyEs02RpcFailure } from "./rpc-classify";

describe("es02 rpc classify", () => {
  it("maps attempted-write 502/503/504 and service-unavailable text to UNKNOWN", () => {
    expect(classifyEs02RpcFailure({ data: null, error: { message: "Service Unavailable" }, status: 503 }, true)).toBe(
      "UNKNOWN",
    );
    expect(classifyEs02RpcFailure({ data: null, error: { message: "Bad Gateway" }, status: 502 }, true)).toBe(
      "UNKNOWN",
    );
    expect(
      classifyEs02RpcFailure(
        { data: null, error: { message: JSON.stringify({ message: "Gateway Timeout", code: 504 }) } },
        true,
      ),
    ).toBe("UNKNOWN");
  });

  it("keeps non-uncertain failures as UNAVAILABLE", () => {
    expect(classifyEs02RpcFailure({ data: null, error: { message: "schema cache" }, status: 404 }, false)).toBe(
      "UNAVAILABLE",
    );
  });
});
