import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ rpc: vi.fn(), abort: vi.fn(), log: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: fake.rpc }) }));
vi.mock("./logger.mjs", () => ({ logEvent: fake.log, withLogContext: (_ids: unknown, run: () => unknown) => run() }));
import { observeWebhookIngress } from "./ingress-observation-server";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("OPS_INGRESS_OBSERVATION_ENABLED", "false"); fake.abort.mockResolvedValue({ data: true, error: null }); fake.rpc.mockReturnValue({ abortSignal: fake.abort }); });
afterEach(() => vi.unstubAllEnvs());
it("keeps recorder disabled until reviewed rollout", async () => {
  expect((await observeWebhookIngress("whatsapp", async () => new Response())).status).toBe(200);
  expect(fake.rpc).not.toHaveBeenCalled();
});
it("records bounded metadata with abort signal when enabled", async () => {
  vi.stubEnv("OPS_INGRESS_OBSERVATION_ENABLED", "true");
  expect((await observeWebhookIngress("instagram", async () => new Response("rejected", { status: 403 }))).status).toBe(403);
  expect(fake.rpc).toHaveBeenCalledTimes(2);
  expect(fake.rpc).toHaveBeenLastCalledWith("ops_record_ingress_attempt", expect.objectContaining({ p_source: "instagram", p_stage: "finished", p_http_status: 403 }));
  expect(Object.keys(fake.rpc.mock.calls[0][1])).toHaveLength(6);
  expect(fake.abort).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it("does not retry or change acknowledgement on ambiguous recorder failure", async () => {
  vi.stubEnv("OPS_INGRESS_OBSERVATION_ENABLED", "true"); fake.abort.mockRejectedValue(Error("private database error"));
  expect((await observeWebhookIngress("paymob", async () => new Response("ok"))).status).toBe(200);
  expect(fake.rpc).toHaveBeenCalledTimes(2); // Two distinct phases, no retry of either.
  expect(JSON.stringify(fake.log.mock.calls)).not.toContain("private database error");
});
