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
    expect(last.trace_id).toMatch(/^[a-f0-9]{32}$/);
    expect(last.span_id).toMatch(/^[a-f0-9]{16}$/);
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

it('preserves root correlation with a distinct child span and unchanged public detail shape',()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});
 const root=beginDiagnostic('auth_verification');const child=beginDiagnostic('auth_verification',root.correlation);
 const detail=child.finish('OK');const log=JSON.parse(String(info.mock.calls.at(-1)![0]));
 expect(detail).toEqual({reference:root.reference,operation:'auth_verification',stage:'input',code:'OK'});
 expect(log.trace_id).toBe(root.correlation.trace_id);expect(log.parent_span_id).toBe(root.logContext.span_id);expect(log.span_id).not.toBe(root.logContext.span_id);
 info.mockRestore();
});
it('invalid metadata cannot supply a support reference or leak arbitrary content',()=>{
 const info=vi.spyOn(console,'info').mockImplementation(()=>{});
 const child=beginDiagnostic('auth_login',{request_id:'private@example.test',password:'private-payload'});child.finish('OK');
 expect(child.reference).toMatch(/^VEL-[A-F0-9]{16}$/);expect(JSON.stringify(info.mock.calls)).not.toContain('private');info.mockRestore();
});
