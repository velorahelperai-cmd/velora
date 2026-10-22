import { describe, expect, it } from "vitest";
import { redactSensitiveData } from "./audit-redaction";
describe("audit display redaction", () => {
  it("redacts nested phone, email and secret field variants", () => {
    expect(redactSensitiveData({ mobile_phone: 96890000000, contactEmail: "unit@example.invalid", nested: [{ apiKey: "synthetic-secret", fullName: "Synthetic Person" }] })).toEqual({ mobile_phone: "[REDACTED]", contactEmail: "[REDACTED]", nested: [{ apiKey: "[REDACTED]", fullName: "[REDACTED]" }] });
  });
  it("denies arbitrary free text including unlabelled credentials", () => { expect(redactSensitiveData({ detail: "unit@example.invalid +968 9000 0000 unrelated opaque-secret", content: "Synthetic free text" })).toEqual({ detail: "[REDACTED]", content: "[REDACTED]" }); });
  it("preserves validated audit enums and non-sensitive numeric changes", () => { expect(redactSensitiveData({ role: "delegated", status: "active", revision: 3, enabled: true })).toEqual({ role: "delegated", status: "active", revision: 3, enabled: true }); });
  it("does not trust a safe enum field with an arbitrary string", () => { expect(redactSensitiveData({ status: "Synthetic secret goes here" })).toEqual({ status: "[REDACTED]" }); });
  it("handles arrays, null and circular input without mutating the original", () => { const input: Record<string, unknown> = { status: "open", nullable: null }; input.loop = input; expect(redactSensitiveData(input)).toEqual({ status: "open", nullable: null, loop: "[REDACTED]" }); expect(input.status).toBe("open"); });
});
