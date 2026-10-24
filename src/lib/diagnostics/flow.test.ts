import { afterEach, describe, expect, it, vi } from "vitest";
import { beginDiagnostic } from "./flow";

describe("beginDiagnostic LOG-001 shape", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits UTC timestamp, level, service, request_id and event without secrets", () => {
    const lines: string[] = [];
    vi.spyOn(console, "info").mockImplementation((value: unknown) => {
      lines.push(String(value));
    });
    const trace = beginDiagnostic("auth_signup");
    trace.stage("provider");
    const detail = trace.finish("UNAVAILABLE");
    expect(detail.reference).toMatch(/^VEL-[A-F0-9]{16}$/);
    expect(lines.length).toBeGreaterThan(0);
    const last = JSON.parse(lines.at(-1)!);
    expect(last.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(["info", "warn", "error"]).toContain(last.level);
    expect(last.service).toBe("velora.auth");
    expect(last.request_id).toBe(detail.reference);
    expect(last.event).toMatch(/^auth\./);
    expect(last.trace_id).toBeNull();
    expect(last.span_id).toBeNull();
    expect(last.duration_ms).toBeGreaterThanOrEqual(0);
    expect(last.error_code).toBe("UNAVAILABLE");
    expect(JSON.stringify(last)).not.toMatch(/password|otp|token|verifier/i);
  });

  it("does not throw when console logging fails", () => {
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("console blocked");
    });
    const trace = beginDiagnostic("auth_login");
    expect(() => trace.finish("OK")).not.toThrow();
  });
});
