import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readScopedEmailStatus } from "./status";
it("passes exact authorized order scope and strips recipient/provider metadata", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null, data: { ok: true, companyId: "company", orderId: "order", email: { state: "accepted", queuedAt: "2026-10-13T00:00:00Z", acceptedAt: "2026-10-13T00:01:00Z", delivered: false, recipient: "private@example.test", providerId: "private-id" } } });
  expect(await readScopedEmailStatus({ rpc }, "company", "order")).toEqual({ state: "accepted", queuedAt: "2026-10-13T00:00:00Z", acceptedAt: "2026-10-13T00:01:00Z", delivered: false });
  expect(rpc).toHaveBeenCalledWith("billing_admin_read_subscription_email", { p_company_id: "company", p_order_id: "order" });
});
it.each([{ companyId: "other" }, { orderId: "other" }, { ok: false }, { email: { state: "delivered", delivered: true } }])("refuses mismatched scope or unsupported delivery claims", async change => {
  const rpc = vi.fn().mockResolvedValue({ error: null, data: { ok: true, companyId: "company", orderId: "order", email: { state: "queued", queuedAt: null, acceptedAt: null, delivered: false }, ...change } });
  expect((await readScopedEmailStatus({ rpc }, "company", "order")).state).toBe("unavailable");
});
