import { describe, expect, it } from "vitest";
import { decideServiceAccess } from "./decision";
const id = "11111111-1111-4111-8111-111111111111";
const now = Date.parse("2026-10-10T00:00:00Z");
const evidence = { ok: true, allowed: true, company_id: id, capability: "noura.knowledge.read", service_code: "noura", tier: "basic", environment: "live", expires_at: "2026-11-10T00:00:00Z", plan_version_id: id };
const decide = (e: unknown) => decideServiceAccess(e, id, "noura.knowledge.read", now);
describe("authoritative service read result", () => {
  it("projects only bound service grants", () => expect(decide(evidence)).toMatchObject({ allowed: true, service: "noura", tier: "basic" }));
  it.each([{ company_id: "other" }, { service_code: "dana" }, { capability: "reports.read" }, { environment: "test" }, { tier: "invented" }, { plan_version_id: "invalid" }, { expires_at: "invalid" }, { allowed: "true" }, { allowed: false }])("denies malformed or cross-scope evidence %j", extra => {
    expect(decide({ ...evidence, ...extra })).toEqual({ allowed: false, code: "UNAVAILABLE" });
  });
  it("does not convert generic paid evidence into a service grant", () => expect(decide({ok:true,active:true,paid_through:"2099-01-01T00:00:00Z",plan_version_id:id,plan_code:"dana_premium"})).toEqual({allowed:false,code:"UNAVAILABLE"}));
  it("denies at the expiry boundary", () => expect(decide({ ...evidence, expires_at: "2026-10-10T00:00:00Z" })).toEqual({ allowed: false, code: "SERVICE_NOT_ACTIVE" }));
  it.each([null, [], true, {ok:false,code:"private-details"}])("fails closed on unknown evidence %j", e => expect(decide(e)).toEqual({allowed:false,code:"UNAVAILABLE"}));
  it("does not reflect metadata on denial", () => expect(decide({...evidence,ok:false,code:"FORBIDDEN"})).toEqual({allowed:false,code:"FORBIDDEN"}));
  it("requires valid server time", () => expect(decideServiceAccess(evidence,id,"noura.knowledge.read",NaN)).toEqual({allowed:false,code:"UNAVAILABLE"}));
});
