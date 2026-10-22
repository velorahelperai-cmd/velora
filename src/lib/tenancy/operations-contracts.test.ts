import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminGetOperationsOverview } from "./operations-actions";
// Synthetic unit-contract inputs, not operational/database acceptance evidence.
const state = vi.hoisted(() => ({ allowed: true, error: null as { code: string } | null, data: null as unknown, ingress: null as unknown, fromCalls: [] as string[], rpcArgs: null as Record<string, unknown> | null }));
vi.mock("@/lib/tenancy/access", () => ({ requirePlatformOwner: async () => state.allowed ? { ok: true, context: { userId: "synthetic-owner" } } : { ok: false, code: "FORBIDDEN" } }));
vi.mock("@/lib/logging/logger.mjs", () => ({ logEvent: vi.fn(), withLogContext: (_value: unknown, run: () => unknown) => run() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from: (name: string) => { state.fromCalls.push(name); return { select: () => ({ limit: async () => ({ error: null }) }) }; },
  rpc: async (name: string, args: Record<string, unknown>) => { if (name === "admin_read_ingress_attempts") { state.rpcArgs = args; return { data: state.ingress, error: null }; } expect(name).toBe("admin_read_operations_snapshot"); state.rpcArgs = args; return { data: state.data, error: state.error }; },
}) }));
afterEach(() => vi.unstubAllEnvs());
it("reads genuine HTTP context only through reviewed rollout and filtered RPC", async () => {
  vi.stubEnv("OPS_INGRESS_OBSERVATION_ENABLED", "true");
  const id = "11111111-1111-4111-8111-111111111111", now = new Date();
  state.ingress = { version: 1, coverage: "PARTIAL", successRate: "UNKNOWN", windowStart: new Date(now.getTime() - 86400000).toISOString(), windowEnd: now.toISOString(), attempts: [{ request_id: id, trace_id: id, source: "whatsapp", stage: "finished", http_status: 503, duration_ms: 10, recorded_at: now.toISOString() }] };
  const result = await adminGetOperationsOverview({ correlationId: id, service: "webhook_meta", severity: "warning" });
  expect(state.rpcArgs).toEqual({ p_request_id: id, p_service: "webhook_meta", p_severity: "warning" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.data.recentEvents).toEqual([expect.objectContaining({ requestId: id, traceId: id, errorCode: "INGRESS_WHATSAPP_FINISHED" })]);
    expect(result.data.kpis.webhookSuccessRate).toBe("UNKNOWN");
  }
});
it("fails explicitly for incompatible enabled recorder read", async () => {
  vi.stubEnv("OPS_INGRESS_OBSERVATION_ENABLED", "true"); state.ingress = { successRate: "100%" };
  expect(await adminGetOperationsOverview()).toMatchObject({ ok: false, code: "UNAVAILABLE" });
});
function snapshot(paymob = 0) {
  const end = new Date(), start = new Date(end.getTime() - 86400000);
  return { ok: true, windowStart: start.toISOString(), windowEnd: end.toISOString(), traceCoverage: "NOT_RECORDED", ingressRatesMeasured: false,
    sources: [ { source: "paymob", count: paymob, lastActiveAt: paymob ? end.toISOString() : null }, { source: "whatsapp", count: 0, lastActiveAt: null }, { source: "instagram", count: 0, lastActiveAt: null } ], events: [] as Record<string, unknown>[] };
}
beforeEach(() => { state.allowed = true; state.error = null; state.data = snapshot(); state.fromCalls = []; state.rpcArgs = null; });
describe("operations safe diagnostic contract", () => {
  it("denies a non-owner before reading", async () => { state.allowed = false; expect((await adminGetOperationsOverview()).ok).toBe(false); expect(state.fromCalls).toHaveLength(0); });
  it("uses a limited RPC and never directly reads the private receipt table", async () => { expect((await adminGetOperationsOverview()).ok).toBe(true); expect(state.fromCalls).toEqual(["companies"]); });
  it("reports a missing RPC instead of treating inaccessible data as empty", async () => { state.error = { code: "PGRST202" }; const result = await adminGetOperationsOverview(); expect(result.ok).toBe(false); if (!result.ok) expect(result.message).toContain("OPERATIONS_CONTRACT_NOT_INSTALLED"); });
  it("does not infer Meta health or ingress success from Paymob activity", async () => { state.data = snapshot(2); const result = await adminGetOperationsOverview(); expect(result.ok).toBe(true); if (result.ok) { expect(result.data.services.find(service => service.id === "meta-webhook")?.status).toBe("UNKNOWN"); expect(result.data.webhookPipes.map(pipe => pipe.successRate)).toEqual(["UNKNOWN", "UNKNOWN", "UNKNOWN"]); expect(result.data.kpis.webhookSuccessRate).toBe("UNKNOWN"); expect(result.data.kpis.totalEvents).toBe(2); } });
  it("leaves actual missing trace context UNKNOWN rather than fabricating it", async () => { const data = snapshot(1); data.events = [{ id: "00000000-0000-4000-8000-000000000001", companyId: null, traceId: "UNKNOWN", requestId: "UNKNOWN", service: "billing_paymob", severity: "info", errorCode: "PAYMOB_EVENT_RECORDED", message: "PAYMOB_EVENT_RECORDED", createdAt: data.windowEnd }]; state.data = data; const result = await adminGetOperationsOverview(); expect(result.ok).toBe(true); if (result.ok) expect(result.data.recentEvents[0].traceId).toBe("UNKNOWN"); });
  it("rejects invented trace IDs in an incompatible envelope", async () => { const data = snapshot(1); data.events = [{ id: "00000000-0000-4000-8000-000000000001", companyId: null, traceId: "pay-synthetic-attempt", requestId: "synthetic-provider-transaction", service: "billing_paymob", severity: "info", errorCode: "PAYMOB_EVENT_RECORDED", message: "PAYMOB_EVENT_RECORDED", createdAt: data.windowEnd }]; state.data = data; expect((await adminGetOperationsOverview()).ok).toBe(false); });
  it("passes filters to SQL before its result limit", async () => { await adminGetOperationsOverview({ correlationId: "safe-trace-reference", service: "webhook_meta", severity: "warning" }); expect(state.rpcArgs).toEqual({ p_correlation_id: "safe-trace-reference", p_service: "webhook_meta", p_severity: "warning" }); });
  it("rejects events outside the stated time window", async () => { const data = snapshot(1); data.events = [{ id: "00000000-0000-4000-8000-000000000001", companyId: null, traceId: "UNKNOWN", requestId: "UNKNOWN", service: "billing_paymob", severity: "info", errorCode: "PAYMOB_EVENT_RECORDED", message: "PAYMOB_EVENT_RECORDED", createdAt: "2000-01-01T00:00:00Z" }]; state.data = data; expect((await adminGetOperationsOverview()).ok).toBe(false); });
});
