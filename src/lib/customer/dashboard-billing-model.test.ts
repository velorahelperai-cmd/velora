import { describe, expect, it } from "vitest";
import { dashboardBillingSnapshot } from "./dashboard-billing-model";

const companyId = "company-real";
const journey = { subscription: { company_id: companyId, status: "active", paid_through: "2026-11-01T00:00:00Z" } };
const usage = { month_start: "2026-10-01", successful_automated_outbound: 12, held_outbound_capacity: 3, cap: 20 };

describe("customer dashboard billing projection", () => {
  it("counts reserved capacity against remaining balance", () => {
    expect(dashboardBillingSnapshot(companyId, journey, usage)).toMatchObject({ status: "ready", sent: 12, held: 3, remaining: 5, usedPercent: 75 });
  });
  it("only reports empty when the subscription read explicitly confirms no row", () => {
    expect(dashboardBillingSnapshot(companyId, { subscription: null }, null)).toEqual({ status: "empty", companyId });
    expect(dashboardBillingSnapshot(companyId, {}, usage)).toEqual({ status: "unavailable" });
  });
  it("rejects another company's subscription", () => {
    expect(dashboardBillingSnapshot("other-company", journey, usage)).toEqual({ status: "unavailable" });
  });
  it.each([undefined, -1, 0.5, "12", Number.MAX_SAFE_INTEGER + 1])("never fabricates zero from invalid usage %s", (sent) => {
    expect(dashboardBillingSnapshot(companyId, journey, { ...usage, successful_automated_outbound: sent })).toEqual({ status: "unavailable" });
  });
  it("preserves a missing quota and clamps an exhausted quota", () => {
    expect(dashboardBillingSnapshot(companyId, journey, { ...usage, cap: null })).toMatchObject({ status: "ready", remaining: null, usedPercent: null });
    expect(dashboardBillingSnapshot(companyId, journey, { ...usage, cap: 10 })).toMatchObject({ status: "ready", remaining: 0, usedPercent: 100 });
  });
});
