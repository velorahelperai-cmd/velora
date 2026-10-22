import { expect, it } from "vitest";
import { projectIngressAttempts } from "./ingress-projection";
const id = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const now = Date.now();
  return { version: 1, coverage: "PARTIAL", successRate: "UNKNOWN", windowStart: new Date(now - 86400000).toISOString(), windowEnd: new Date(now).toISOString(), attempts: [
    { request_id: id, trace_id: id, source: "whatsapp", stage: "finished", http_status: 503, duration_ms: 20, recorded_at: new Date(now - 100).toISOString() },
  ] };
}
it("projects generated attempt context and safe codes, excluding arbitrary input", () => {
  const data = fixture();
  Object.assign(data.attempts[0], { body: "secret", phone: "sensitive" });
  expect(projectIngressAttempts(data)).toEqual([expect.objectContaining({ traceId: id, requestId: id, companyId: null, severity: "warning", errorCode: "INGRESS_WHATSAPP_FINISHED" })]);
  expect(JSON.stringify(projectIngressAttempts(data))).not.toMatch(/secret|sensitive/);
});
it("rejects fake coverage and business-success percentages", () => {
  expect(projectIngressAttempts({ ...fixture(), coverage: "COMPLETE" })).toBeNull();
  expect(projectIngressAttempts({ ...fixture(), successRate: "100%" })).toBeNull();
});
it("rejects invalid trace, inconsistent stage, duplicate and out-of-window rows", () => {
  for (const change of [{ trace_id: "provider-message" }, { stage: "started" }, { http_status: null }, { recorded_at: "2000-01-01T00:00:00Z" }]) {
    const data = fixture(); Object.assign(data.attempts[0], change); expect(projectIngressAttempts(data)).toBeNull();
  }
  const data = fixture(); data.attempts.push(data.attempts[0]); expect(projectIngressAttempts(data)).toBeNull();
});
