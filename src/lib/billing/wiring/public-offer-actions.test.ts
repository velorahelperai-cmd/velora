import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("Retired checkout must not access the database"); } }));
import { createBillingOrderAction } from "./order-actions";
describe("retired public checkout", () => {
  it("rejects order creation without persistence", async () => {
    expect(await createBillingOrderAction({ planVersionId: "version", clientOpId: "operation" })).toEqual({ ok: false, code: "provider_retired" });
  });
});
