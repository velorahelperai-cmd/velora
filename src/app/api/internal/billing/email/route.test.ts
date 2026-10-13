import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/billing/email/internal", () => ({ processEmailOutbox: state.run }));
import { POST } from "./route";
beforeEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.stubEnv("BILLING_EMAIL_WORKER_TOKEN", "synthetic-worker-token-with-at-least-32-characters"); });
it("requires internal authorization before processing any data", async () => {
  expect((await POST(new Request("https://example.test/api/internal/billing/email", { method: "POST" }))).status).toBe(401); expect(state.run).not.toHaveBeenCalled();
});
it("keeps email processing default off even for authorized requests", async () => {
  expect((await POST(new Request("https://example.test/api/internal/billing/email", { method: "POST", headers: { authorization: "Bearer synthetic-worker-token-with-at-least-32-characters" } }))).status).toBe(503); expect(state.run).not.toHaveBeenCalled();
});
it("returns aggregate acceptance only, never recipient or provider secrets", async () => {
  vi.stubEnv("BILLING_EMAIL_WORKER_ENABLED", "true"); state.run.mockResolvedValue({ ok: true, processed: 1, accepted: 1, delivered: 0, reconciliationRequired: false });
  const response = await POST(new Request("https://example.test/api/internal/billing/email", { method: "POST", headers: { authorization: "Bearer synthetic-worker-token-with-at-least-32-characters" } }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, processed: 1, accepted: 1, delivered: 0, reconciliationRequired: false }); expect(state.run).toHaveBeenCalledOnce();
});
