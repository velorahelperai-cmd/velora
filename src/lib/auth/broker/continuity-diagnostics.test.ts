import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: m.rpc }) }));
vi.mock("./log", () => ({ brokerLog: m.log }));
import { bindBrowserContinuityFromAnchor } from "./continuity";
const anchor = "a".repeat(43);
beforeEach(() => { vi.clearAllMocks(); });
it.each([
  [{ code: "", message: "TypeError: fetch failed", details: "cause: UND_ERR_CONNECT_TIMEOUT private-payload" }, "transport", "UND_ERR_CONNECT_TIMEOUT"],
  [{ code: "PGRST202", message: "private-payload", details: "private-payload" }, "backend", "PGRST202"],
  [{ code: "private-payload", message: "private-payload" }, "unknown", "BIND_FAILED"],
])("records bounded bind failure diagnostics without private payloads", async (error, category, code) => {
  m.rpc.mockResolvedValue({ data: null, error });
  expect(await bindBrowserContinuityFromAnchor(anchor, anchor)).toEqual({ ok: false, code: "BIND_FAILED" });
  expect(m.log).toHaveBeenCalledOnce();
  const [severity, event, fields] = m.log.mock.calls[0];
  expect(severity).toBe("warn");
  expect(event).toBe("auth.broker.continuity.bind_failed");
  expect(fields).toEqual({ stage: "continuity_bind", error_category: category, error_code: code, duration_ms: expect.any(Number) });
  expect(fields.duration_ms).toBeGreaterThanOrEqual(0);
  expect(JSON.stringify(m.log.mock.calls)).not.toContain("private-payload");
  expect(JSON.stringify(m.log.mock.calls)).not.toContain(anchor);
  expect(fields).not.toHaveProperty("request_id"); // Preserve the inherited diagnostic scope.
});
it("records a rejected transport without changing its thrown outcome", async () => {
  const error = new Error("private-payload", { cause: { code: "ECONNREFUSED" } });
  m.rpc.mockRejectedValue(error);
  await expect(bindBrowserContinuityFromAnchor(anchor, anchor)).rejects.toBe(error);
  expect(m.log).toHaveBeenCalledWith("warn", "auth.broker.continuity.bind_failed", {
    stage: "continuity_bind", error_category: "transport", error_code: "ECONNREFUSED", duration_ms: expect.any(Number),
  });
  expect(JSON.stringify(m.log.mock.calls)).not.toContain("private-payload");
});
it("keeps successful enrollment quiet", async () => {
  m.rpc.mockResolvedValue({ data: { ok: true, browser_lineage_id: "synthetic" }, error: null });
  expect(await bindBrowserContinuityFromAnchor(anchor, anchor)).toMatchObject({ ok: true });
  expect(m.log).not.toHaveBeenCalled();
});
