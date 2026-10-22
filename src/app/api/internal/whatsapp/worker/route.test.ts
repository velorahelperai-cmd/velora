import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const state = vi.hoisted(() => ({ code: "ACCEPTANCE_ACCOUNTING_PENDING", accepted: true, completed: false, sends: 0, rollout: true, pending: 0, claims: 0 }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async (name: string) => {
  if (name === "whatsapp_repair_accepted_jobs") return { data: { ok: true, repaired: 0, pending: state.pending }, error: null };
  state.claims++;
  return { data: { ok: true, jobs: [{ job_id: "synthetic-job", claim_token: "synthetic-capability", company_id: "synthetic-company" }] }, error: null };
} }) }));
vi.mock("@/lib/whatsapp/integration-store", () => ({ createIntegrationPorts: () => ({}), workerRolloutEnabled: () => state.rollout }));
vi.mock("@/lib/whatsapp/fixed-ack", () => ({ fixedAckConfig: vi.fn(), runFixedAcknowledgementBatch: vi.fn() }));
vi.mock("@/lib/whatsapp/inbound-worker", () => ({ runInboundWorkerAnswer: async () => { state.sends++; return { ok: false, code: state.code, sendAccepted: state.accepted, jobCompleted: state.completed, delivered: false }; } }));
const syntheticSecret = "synthetic-test-worker-secret-at-least-thirty-two-characters";
beforeEach(() => { vi.stubEnv("WHATSAPP_WORKER_SECRET", syntheticSecret); vi.stubEnv("WHATSAPP_WORKER_ENABLED", "true"); vi.stubEnv("WHATSAPP_FIXED_ACK_ENABLED", "false"); state.code = "ACCEPTANCE_ACCOUNTING_PENDING"; state.accepted = true; state.completed = false; state.sends = 0; state.rollout = true; state.pending = 0; state.claims = 0; });
afterEach(() => vi.unstubAllEnvs());
describe("worker response monitoring (synthetic ports, no provider calls)", () => {
  it.each([0, 2])("reports repair-only pending=%s without claiming or sending", async (pending) => {
    state.rollout = false; state.pending = pending;
    const response = await POST(new Request("http://localhost/api/internal/whatsapp/worker", { method: "POST", headers: { authorization: "Bearer " + syntheticSecret } }));
    expect(response.status).toBe(pending ? 202 : 200);
    expect(await response.json()).toMatchObject({ code: pending ? "RECONCILIATION_REQUIRED" : "CUSTOMER_ANSWERING_DISABLED", repairOnly: true, repair: { pending }, automaticRetry: false });
    expect(state.claims).toBe(0); expect(state.sends).toBe(0);
  });
  it("retains authorization checks", async () => { const response = await POST(new Request("http://localhost/api/internal/whatsapp/worker", { method: "POST" })); expect(response.status).toBe(401); expect(state.sends).toBe(0); });
  it("reports accepted but unsettled jobs without exposing capabilities", async () => { const response = await POST(new Request("http://localhost/api/internal/whatsapp/worker", { method: "POST", headers: { authorization: "Bearer " + syntheticSecret } })); expect(response.status).toBe(202); const body = await response.json(); expect(body).toMatchObject({ accepted: 1, completed: 0, accountingPending: 1, code: "RECONCILIATION_REQUIRED", automaticRetry: false }); expect(JSON.stringify(body)).not.toMatch(/synthetic-capability|synthetic-company|synthetic-job/); expect(state.sends).toBe(1); });
  it("does not retry an unknown send inside the route", async () => { state.code = "SEND_REQUIRES_RECONCILIATION"; state.accepted = false; const response = await POST(new Request("http://localhost/api/internal/whatsapp/worker", { method: "POST", headers: { authorization: "Bearer " + syntheticSecret } })); expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ unknown: 1, failed: 0, automaticRetry: false }); expect(state.sends).toBe(1); });
});
