import { beforeEach, describe, expect, it, vi } from "vitest";
const { access, journey, usage } = vi.hoisted(() => ({ access: vi.fn(), journey: vi.fn(), usage: vi.fn() }));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: access }));
vi.mock("@/lib/billing/operations/actions", () => ({ readSubscriptionJourneyAction: journey, readSubscriptionUsageAction: usage }));
import { readDashboardBilling } from "./dashboard-billing-actions";

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ ok: true, context: { company: { id: "real-company" }, membership: { role: "owner" } } });
});
describe("dashboard authorized database read", () => {
  it("does not query billing for staff or missing company contexts", async () => {
    access.mockResolvedValue({ ok: true, context: { company: { id: "real-company" }, membership: { role: "staff" } } });
    expect(await readDashboardBilling()).toEqual({ status: "forbidden" });
    expect(journey).not.toHaveBeenCalled();
    expect(usage).not.toHaveBeenCalled();
  });
  it("keeps a failed billing read unavailable", async () => {
    journey.mockResolvedValue({ status: "unavailable", reason: "schema_unavailable" });
    usage.mockResolvedValue({ ok: false, code: "schema_unavailable" });
    expect(await readDashboardBilling()).toEqual({ status: "unavailable" });
  });
  it("confirms an empty subscription even when its usage is unavailable", async () => {
    journey.mockResolvedValue({ status: "ready", data: { subscription: null, orders: [] } });
    usage.mockResolvedValue({ ok: false, code: "schema_unavailable" });
    expect(await readDashboardBilling()).toEqual({ status: "empty", companyId: "real-company" });
  });
  it("fails closed if the company in the returned subscription differs", async () => {
    journey.mockResolvedValue({ status: "ready", data: { subscription: { company_id: "other-company", status: "active", paid_through: null } } });
    usage.mockResolvedValue({ ok: true, data: { month_start: "2026-10-01", successful_automated_outbound: 0, held_outbound_capacity: 0, cap: null } });
    expect(await readDashboardBilling()).toEqual({ status: "unavailable" });
  });
});
