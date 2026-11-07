import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const state = vi.hoisted(() => ({ code: "ACCEPTANCE_ACCOUNTING_PENDING", accepted: true, completed: false, sends: 0, rollout: true, pending: 0, claims: 0, scheduleValid: false, scheduleError: false, claimThrow: false, queue: null as number|null, failAfter: 0, executeFailAfter: 0 }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async (name: string) => {
  if (name === "whatsapp_redeem_worker_tick") { if (state.scheduleError) return { data: null, error: {} }; const ok = state.scheduleValid; state.scheduleValid = false; return { data: ok, error: null }; }
  if (name === "whatsapp_repair_accepted_jobs") return { data: { ok: true, repaired: 0, pending: state.pending }, error: null };
  state.claims++;
  if (state.claimThrow || (state.failAfter>0 && state.claims>state.failAfter)) throw Error("sensitive-synthetic-transport-detail");
  if(state.queue!==null){if(state.queue<=0)return {data:{ok:true,jobs:[]},error:null};state.queue--;}
  return { data: { ok: true, jobs: [{ job_id: "synthetic-job", claim_token: "synthetic-capability", company_id: "synthetic-company" }] }, error: null };
} }) }));
vi.mock("@/lib/whatsapp/integration-store", () => ({ createIntegrationPorts: () => ({}), workerRolloutEnabled: () => state.rollout }));
vi.mock("@/lib/whatsapp/fixed-ack", () => ({ fixedAckConfig: vi.fn(), runFixedAcknowledgementBatch: vi.fn() }));
vi.mock("@/lib/whatsapp/inbound-worker", () => ({ runInboundWorkerAnswer: async () => { state.sends++; if(state.executeFailAfter>0&&state.sends>state.executeFailAfter)throw Error("sensitive-synthetic-execution"); return { ok: state.code==="ACCEPTED", code: state.code, sendAccepted: state.accepted, jobCompleted: state.completed, delivered: false }; } }));
const syntheticSecret = "synthetic-test-worker-secret-at-least-thirty-two-characters";
beforeEach(() => { vi.stubEnv("WHATSAPP_WORKER_SECRET", syntheticSecret); vi.stubEnv("WHATSAPP_WORKER_ENABLED", "true"); vi.stubEnv("WHATSAPP_FIXED_ACK_ENABLED", "false"); state.code = "ACCEPTANCE_ACCOUNTING_PENDING"; state.accepted = true; state.completed = false; state.sends = 0; state.rollout = true; state.pending = 0; state.claims = 0; state.scheduleValid = false; state.scheduleError = false; state.claimThrow = false; state.queue=null; state.failAfter=0;state.executeFailAfter=0; });
afterEach(() => {vi.unstubAllEnvs();vi.restoreAllMocks();});
describe("worker response monitoring (synthetic ports, no provider calls)", () => {
  it("drains at most five independently claimed successful jobs",async()=>{
    state.code="ACCEPTED";state.completed=true;state.queue=8;
    const response=await POST(new Request("http://localhost/api/internal/whatsapp/worker",{method:"POST",headers:{authorization:"Bearer "+syntheticSecret}}));
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({processed:5,accepted:5,completed:5});expect(state.claims).toBe(5);expect(state.queue).toBe(3);
  });
  it("stops when the queue is empty",async()=>{
    state.code="ACCEPTED";state.completed=true;state.queue=2;
    const response=await POST(new Request("http://localhost/api/internal/whatsapp/worker",{method:"POST",headers:{authorization:"Bearer "+syntheticSecret}}));
    expect(await response.json()).toMatchObject({processed:2,accepted:2});expect(state.claims).toBe(3);
  });
  it("preserves accepted counts when a later claim is unavailable",async()=>{
    state.code="ACCEPTED";state.completed=true;state.queue=3;state.failAfter=1;
    const response=await POST(new Request("http://localhost/api/internal/whatsapp/worker",{method:"POST",headers:{authorization:"Bearer "+syntheticSecret}}));
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({processed:1,accepted:1,claimUnavailable:true,code:"WORKER_BATCH_FAILED"});expect(state.sends).toBe(1);
  });
  it("holds an unexpected later execution for reconciliation while preserving earlier acceptance",async()=>{
    state.code="ACCEPTED";state.completed=true;state.queue=3;state.executeFailAfter=1;
    const response=await POST(new Request("http://localhost/api/internal/whatsapp/worker",{method:"POST",headers:{authorization:"Bearer "+syntheticSecret}}));
    const body=await response.json();expect(response.status).toBe(202);expect(body).toMatchObject({accepted:1,unknown:1,executionUnavailable:true,code:"RECONCILIATION_REQUIRED"});expect(JSON.stringify(body)).not.toContain("sensitive-synthetic");expect(state.claims).toBe(2);
  });
  it("does not claim another job after its time budget expires",async()=>{
    state.code="ACCEPTED";state.completed=true;state.queue=3;vi.spyOn(performance,"now").mockReturnValueOnce(0).mockReturnValue(20_000);
    const response=await POST(new Request("http://localhost/api/internal/whatsapp/worker",{method:"POST",headers:{authorization:"Bearer "+syntheticSecret}}));
    expect(await response.json()).toMatchObject({processed:1});expect(state.claims).toBe(1);
  });
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
  it("reports the fixed transport stage without exposing thrown details", async () => { state.claimThrow=true; const response=await POST(new Request("http://localhost/api/internal/whatsapp/worker",{method:"POST",headers:{authorization:"Bearer "+syntheticSecret}})); const body=await response.json(); expect(response.status).toBe(503); expect(body).toEqual({code:"WORKER_UNAVAILABLE",stage:"claim"}); expect(JSON.stringify(body)).not.toContain("sensitive-synthetic"); expect(state.sends).toBe(0); });
});

const scheduledToken = "a".repeat(64);
const signedTick = () => `tick.${scheduledToken}.${createHmac("sha256", syntheticSecret).update(scheduledToken).digest("hex")}`;
describe("scheduled worker capabilities", () => {
  it("accepts one fresh scheduled capability and rejects its replay", async () => {
    const request = () => new Request("http://localhost/api/internal/whatsapp/worker", { method: "POST", headers: { authorization: "Bearer " + signedTick() } });
    state.scheduleValid = true;
    expect((await POST(request())).status).toBe(202);
    expect(state.scheduleValid).toBe(false);
    expect((await POST(request())).status).toBe(401);
    expect(state.sends).toBe(1);
  });
  it("fails closed when capability validation is unavailable", async () => {
    state.scheduleError = true;
    const response = await POST(new Request("http://localhost/api/internal/whatsapp/worker", { method: "POST", headers: { authorization: "Bearer " + signedTick() } }));
    expect(response.status).toBe(503);
    expect(state.claims).toBe(0);
    expect(state.sends).toBe(0);
  });
});

describe("scheduled worker disabled and malformed inputs", () => {
  it("does not redeem a tick or process messages when the worker is disabled", async () => {
    state.scheduleValid = true; vi.stubEnv("WHATSAPP_WORKER_ENABLED", "false");
    const response = await POST(new Request("http://localhost/api/internal/whatsapp/worker", { method: "POST", headers: { authorization: "Bearer " + signedTick() } }));
    expect(response.status).toBe(503); expect(state.scheduleValid).toBe(true); expect(state.claims).toBe(0); expect(state.sends).toBe(0);
  });
  it("keeps the worker disabled and does not dispatch an ack while the continuity gate is closed", async () => {
    vi.stubEnv("WHATSAPP_WORKER_ENABLED", "false");
    vi.stubEnv("WHATSAPP_CONTINUITY_ACK_ENABLED", "false");
    const response = await POST(new Request("http://localhost/api/internal/whatsapp/worker", { method: "POST", headers: { authorization: "Bearer " + syntheticSecret } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "WORKER_DISABLED" });
    expect(state.claims).toBe(0);
    expect(state.sends).toBe(0);
  });
  it("does not dispatch the continuity ack when the worker is disabled and external send is closed", async () => {
    vi.stubEnv("WHATSAPP_WORKER_ENABLED", "false");
    vi.stubEnv("WHATSAPP_CONTINUITY_ACK_ENABLED", "true");
    const response = await POST(new Request("http://localhost/api/internal/whatsapp/worker", { method: "POST", headers: { authorization: "Bearer " + syntheticSecret } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "WORKER_DISABLED", automaticRetry: false, ack: { scheduled: 0, claimed: 0, dispatched: 0, code: "SEND_DISABLED" } });
    expect(state.claims).toBe(0);
    expect(state.sends).toBe(0);
  });
  it.each(["tick.short", "tick." + "g".repeat(64), "tick." + "a".repeat(65)])("rejects malformed capability %s", async token => {
    state.scheduleValid = true;
    const response = await POST(new Request("http://localhost/api/internal/whatsapp/worker", { method: "POST", headers: { authorization: "Bearer " + token } }));
    expect(response.status).toBe(401); expect(state.scheduleValid).toBe(true); expect(state.sends).toBe(0);
  });
});

it("rejects an unsigned well-formed tick before any database lookup", async () => {
  state.scheduleValid = true;
  const response = await POST(new Request("http://localhost/api/internal/whatsapp/worker", { method: "POST", headers: { authorization: "Bearer tick." + scheduledToken } }));
  expect(response.status).toBe(401); expect(state.scheduleValid).toBe(true); expect(state.claims).toBe(0); expect(state.sends).toBe(0);
});

it("rejects an incorrectly signed tick without calling the database", async () => {
  state.scheduleValid = true;
  const response = await POST(new Request("http://localhost/api/internal/whatsapp/worker", { method: "POST", headers: { authorization: "Bearer tick." + scheduledToken + "." + "0".repeat(64) } }));
  expect(response.status).toBe(401); expect(state.scheduleValid).toBe(true); expect(state.claims).toBe(0);
});
