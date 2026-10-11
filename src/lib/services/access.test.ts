import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const s = vi.hoisted(() => ({ access: vi.fn(), capability: vi.fn(), rpc: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: s.access }));
vi.mock("@/lib/access/actions", () => ({ sessionHasCompanyCapability: s.capability }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => s.admin() }));
import { readSessionServiceAccess } from "./access";
import { GET } from "@/app/api/company/service-access/route";
const id = "11111111-1111-4111-8111-111111111111";
const actor = () => ({ ok: true, context: { userId: "owner", emailConfirmed: true, needsCompanyContext: false, company: { id, status: "active" }, membership: { company_id: id, user_id: "owner", role: "owner", status: "active" } } });
const paid = () => ({ ok: true, active: true, environment: "live", status: "active", paid_through: "2099-01-01T00:00:00Z", plan_version_id: id });
beforeEach(() => { vi.clearAllMocks(); s.access.mockResolvedValue(actor()); s.capability.mockResolvedValue(true); s.admin.mockReturnValue({ rpc: s.rpc }); s.rpc.mockResolvedValue({ data: paid(), error: null }); });
describe("session service access readiness", () => {
  it("does not convert a proven generic paid subscription into a service grant", async () => {
    expect(await readSessionServiceAccess("noura.knowledge.read")).toEqual({ allowed: false, code: "UNAVAILABLE" });
    expect(s.rpc).toHaveBeenCalledWith("billing_read_service_access", { p_company_id: id, p_capability: "noura.knowledge.read" });
    expect(s.capability).toHaveBeenCalledWith(id, "knowledge.read");
  });
  it.each(["lina.website.read", "dana.reports.read", "dana.pos.read"])("does not expose unimplemented %s or read billing evidence", async capability => {
    expect(await readSessionServiceAccess(capability)).toEqual({ allowed: false, code: "UNSUPPORTED_CAPABILITY" });
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it.each([false, null])("requires authoritative RBAC true, received %s", async value => {
    s.capability.mockResolvedValue(value);
    expect(await readSessionServiceAccess("noura.knowledge.read")).toEqual({ allowed: false, code: "FORBIDDEN" });
    expect(s.admin).not.toHaveBeenCalled();
  });
  it.each(["revoked", "cross-tenant", "different-actor", "unconfirmed", "suspended", "end-customer"])("denies %s before any billing read", async scenario => {
    const a = actor();
    if (scenario === "revoked") a.context.membership.status = "disabled";
    if (scenario === "cross-tenant") a.context.membership.company_id = "other";
    if (scenario === "different-actor") a.context.membership.user_id = "other";
    if (scenario === "unconfirmed") a.context.emailConfirmed = false;
    if (scenario === "suspended") a.context.company.status = "suspended";
    if (scenario === "end-customer") s.access.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    else s.access.mockResolvedValue(a);
    expect((await readSessionServiceAccess("noura.knowledge.read")).allowed).toBe(false);
    expect(s.capability).not.toHaveBeenCalled(); expect(s.admin).not.toHaveBeenCalled();
  });
  it("denies expired sessions", async () => {
    s.access.mockResolvedValue({ ok: false, code: "UNAUTHENTICATED", sessionExpired: true });
    expect(await readSessionServiceAccess("noura.knowledge.read")).toEqual({ allowed: false, code: "UNAUTHENTICATED" });
    expect(s.admin).not.toHaveBeenCalled();
  });
  it.each([{ active: false }, { environment: "test" }, { paid_through: "2000-01-01T00:00:00Z" }, { plan_version_id: null }, { status: "revoked" }])("denies inactive or unproven billing %j", async change => {
    s.rpc.mockResolvedValue({ data: { ...paid(), ...change }, error: null });
    expect((await readSessionServiceAccess("noura.knowledge.read")).allowed).toBe(false);
  });
  it("fails closed on unavailable evidence without leaking errors", async () => {
    s.rpc.mockRejectedValue(Error("private details"));
    expect(await readSessionServiceAccess("noura.knowledge.read")).toEqual({ allowed: false, code: "UNAVAILABLE" });
  });
  it("exercises the real HTTP boundary, ignores caller persona and prevents response caching", async () => {
    s.rpc.mockResolvedValue({ data: { ok: false, code: "SERVICE_CONTRACT_MISSING" }, error: null });
    const response = await GET(new Request("https://local/api/company/service-access?capability=noura.knowledge.read&persona=dana&company_id=other"));
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ allowed: false, code: "SERVICE_CONTRACT_MISSING" });
    expect(s.rpc).toHaveBeenCalledWith("billing_read_service_access", { p_company_id: id, p_capability: "noura.knowledge.read" });
  });
  it("rejects unknown requests without actor or billing access", async () => {
    const response = await GET(new Request("https://local/api/company/service-access?capability=all"));
    expect(response.status).toBe(400); expect(s.access).not.toHaveBeenCalled(); expect(s.rpc).not.toHaveBeenCalled();
  });
});

describe("adversarial service API sequence", () => {
  const grant = (tier: "basic" | "premium", extra: Record<string, unknown> = {}) => ({
    ok: true, allowed: true, company_id: id, capability: "noura.knowledge.read",
    service_code: "noura", tier, environment: "live", expires_at: "2099-01-01T00:00:00Z",
    plan_version_id: id, ...extra,
  });
  const request = (extra = "") => new Request("https://local/api/company/service-access?capability=noura.knowledge.read" + extra);
  it.each(["basic", "premium"] as const)("reads actual %s grant without adopting query tier/company", async tier => {
    s.rpc.mockResolvedValue({ data: grant(tier), error: null });
    const response = await GET(request("&tier=premium&company_id=foreign"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ allowed: true, tier });
    expect(s.rpc).toHaveBeenCalledWith("billing_read_service_access", { p_company_id: id, p_capability: "noura.knowledge.read" });
  });
  it("does not cache Premium across downgrade, revocation or later Basic grant", async () => {
    s.rpc.mockResolvedValueOnce({ data: grant("premium"), error: null })
      .mockResolvedValueOnce({ data: { ok: false, code: "SERVICE_NOT_ACTIVE" }, error: null })
      .mockResolvedValueOnce({ data: grant("basic"), error: null });
    const results = [];
    for (let n = 0; n < 3; n++) {
      const response = await GET(request("&tier=premium"));
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      results.push(await response.json());
    }
    expect(results[0]).toMatchObject({ allowed: true, tier: "premium" });
    expect(results[1]).toEqual({ allowed: false, code: "SERVICE_NOT_ACTIVE" });
    expect(results[2]).toMatchObject({ allowed: true, tier: "basic" });
    expect(s.rpc).toHaveBeenCalledTimes(3);
  });
  it("concurrent Test and Live RPC evidence cannot share an authorization result", async () => {
    s.rpc.mockResolvedValueOnce({ data: grant("basic", { environment: "test" }), error: null })
      .mockResolvedValueOnce({ data: grant("premium"), error: null });
    const responses = await Promise.all([GET(request()), GET(request())]);
    const results = await Promise.all(responses.map(r => r.json()));
    expect(results.filter(r => r.allowed === true)).toHaveLength(1);
    expect(results[0]).toEqual({ allowed: false, code: "UNAVAILABLE" });
    expect(results[1]).toMatchObject({ allowed: true, tier: "premium" });
  });
  it.each(["lina.website.read", "dana.reports.read", "dana.pos.read"])("Premium query never activates unsupported %s", async capability => {
    const r = await GET(new Request("https://local/api/company/service-access?capability=" + capability + "&tier=premium"));
    expect(await r.json()).toEqual({ allowed: false, code: "UNSUPPORTED_CAPABILITY" });
    expect(s.rpc).not.toHaveBeenCalled();
  });
  it("rejects a foreign authoritative grant repeatedly and concurrently", async () => {
    s.rpc.mockResolvedValue({ data: grant("premium", { company_id: "22222222-2222-4222-8222-222222222222" }), error: null });
    const results = await Promise.all(Array.from({ length: 8 }, () => GET(request("&company_id=foreign")).then(r => r.json())));
    expect(results.every(r => r.allowed === false)).toBe(true);
    expect(s.rpc.mock.calls.every(([, args]) => args.p_company_id === id)).toBe(true);
  });
});
