import { describe, expect, it, vi } from "vitest";
import { beginDiagnostic } from "./flow";
import { diagnosticText,validDiagnostic } from "./contract";

describe("safe launch diagnostics", () => {
  it("refuses extra transported fields instead of treating customer payload as diagnostic detail",()=>{
    const detail={reference:"VEL-0123456789ABCDEF",operation:"company_save",stage:"persistence",code:"UNAVAILABLE"};
    expect(validDiagnostic(detail)).toBe(true);expect(validDiagnostic({...detail,email:"private@example.test"})).toBe(false);
    expect(diagnosticText({...detail,message:"private raw provider reply"},"en")).toBe("");
  });
  it("keeps one opaque reference across stages without carrying input or error objects", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const trace = beginDiagnostic("company_save");
      trace.stage("access");
      trace.stage("persistence");
      const failure = trace.finish("AUTH_ERROR");
      expect(failure.reference).toMatch(/^VEL-[A-F0-9]{16}$/);
      expect(failure).toMatchObject({ operation: "company_save", stage: "persistence", code: "AUTH_ERROR" });
      const events = log.mock.calls.map(([entry]) => JSON.parse(entry));
      expect(events.every(event => event.reference === failure.reference)).toBe(true);
      expect(events.every(event => Object.keys(event).sort().join() === "code,durationMs,operation,reference,stage")).toBe(true);
      expect(events.every(event => Number.isSafeInteger(event.durationMs) && event.durationMs >= 0)).toBe(true);
      expect(diagnosticText(failure, "en")).toContain(failure.reference);
      expect(diagnosticText(failure, "ar")).toContain(failure.reference);
    } finally { log.mockRestore(); }
  });
  it("drops runtime payloads outside the fixed vocabulary", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const trace = beginDiagnostic("customer private@example.test" as never);
      trace.stage("token private-tenant" as never);
      const failure = trace.finish("secret raw provider error" as never);
      expect(log.mock.calls.flat().join()).not.toMatch(/private|secret|token|provider error/);
      expect(failure).toMatchObject({ operation: "unknown", stage: "unknown", code: "UNEXPECTED_FAILURE" });
      expect(diagnosticText({ ...failure, reference: "private-email@example.test" }, "en")).toBe("");
    } finally { log.mockRestore(); }
  });
  it("diagnostic logging failures do not change the business operation", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => { throw new Error("log unavailable"); });
    try { expect(() => beginDiagnostic("auth_verification").finish("OK")).not.toThrow(); }
    finally { log.mockRestore(); }
  });
});
