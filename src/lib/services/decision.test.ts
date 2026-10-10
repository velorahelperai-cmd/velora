import { describe, expect, it } from "vitest";
import { decideLegacyServiceAccess } from "./decision";
const now = Date.parse("2026-10-10T00:00:00Z");
const evidence = { ok: true, active: true, environment: "live", status: "active", paid_through: "2026-11-10T00:00:00Z", plan_version_id: "11111111-1111-4111-8111-111111111111" };
describe("legacy subscription is never an implicit service grant", () => {
  it.each(["noor_basic", "noor_premium", "lina_basic", "lina_premium", "dana_basic", "dana_premium"])("ignores persona and catalog claims for %s", plan_code => {
    expect(decideLegacyServiceAccess({ ...evidence, plan_code, persona: "dana", capabilities: ["reports.read"], feature_availability: { reports: "target" } }, now)).toEqual({ allowed: false, code: "SERVICE_CONTRACT_MISSING" });
  });
  it("preserves cancellation at period end without pretending it is a service grant", () => {
    expect(decideLegacyServiceAccess({ ...evidence, status: "cancel_at_period_end" }, now).code).toBe("SERVICE_CONTRACT_MISSING");
  });
  it("denies at the exact paid expiry boundary", () => {
    expect(decideLegacyServiceAccess({ ...evidence, paid_through: "2026-10-10T00:00:00Z" }, now).code).toBe("SUBSCRIPTION_INACTIVE");
  });
  it.each([null, [], true, { ...evidence, paid_through: "invalid" }, { ...evidence, plan_version_id: "invalid" }, { ...evidence, active: "true" }, { ...evidence, ok: false }])("fails closed on malformed evidence %j", input => {
    expect(decideLegacyServiceAccess(input, now).code).toBe("UNAVAILABLE");
  });
  it("requires a valid server time", () => expect(decideLegacyServiceAccess(evidence, NaN).code).toBe("UNAVAILABLE"));
});
