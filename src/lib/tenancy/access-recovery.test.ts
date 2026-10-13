import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), upsert: vi.fn(), profile: vi.fn(), memberships: vi.fn(), guard: vi.fn(), claims: vi.fn(), user: vi.fn(), cookie: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/auth/session-guard", () => ({ checkAppSession: mocks.guard }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
import { getCompanyAccess } from "./access";
const user = { id: "synthetic-user", email: "qa@example.test", email_confirmed_at: "confirmed", user_metadata: { full_name: "Metadata Name" } };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true });
  mocks.claims.mockResolvedValue({ data: { claims: { sub: user.id } }, error: null });
  mocks.user.mockResolvedValue({ data: { user }, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.profile.mockResolvedValue({ data: { full_name: "Saved Name", support_code: "SYNTHETIC" }, error: null });
  mocks.memberships.mockResolvedValue({ data: [], error: null });
  mocks.cookie.mockReturnValue(undefined);
  mocks.client.mockResolvedValue({ auth: { getClaims: mocks.claims, getUser: mocks.user }, rpc: async () => ({ data: false, error: null }),
    from: (table: string) => { const query = { upsert: mocks.upsert, select: () => query, eq: () => query, maybeSingle: mocks.profile, order: mocks.memberships }; return table === "profiles" ? query : query; },
  });
});
describe("persisted profile is required for company access", () => {
  it("ignores an old account's workspace selection even when both accounts belong to it", async () => {
    mocks.memberships.mockResolvedValue({ data: [{ company_id: "company-a", role: "owner" }, { company_id: "company-b", role: "staff" }], error: null });
    mocks.cookie.mockReturnValue({ value: "old-user:company-a" });
    // No company query should run before an explicit selection for the new user.
    const client = await mocks.client();
    const originalFrom = client.from;
    client.from = (table: string) => table === "companies" ? { select: () => ({ in: async () => ({ data: [], error: null }) }) } : originalFrom(table);
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: { company: null, needsCompanyContext: true } });
  });
  it("an email change keeps the same persisted user identity", async () => {
    mocks.user.mockResolvedValue({ data: { user: { ...user, email: "changed@example.test" } }, error: null });
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: { userId: user.id, email: "changed@example.test", fullName: "Saved Name" } });
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: user.id }), expect.anything());
  });
  it.each(["missing", "error"])("fails closed on %s profile without using metadata as a saved profile", async mode => {
    mocks.upsert.mockResolvedValue({ error: { code: "42501" } });
    mocks.profile.mockResolvedValue({ data: null, error: mode === "error" ? { code: "503" } : null });
    expect(await getCompanyAccess()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(mocks.memberships).not.toHaveBeenCalled();
  });
  it("retries persistence on a later read without another Auth signup", async () => {
    mocks.profile.mockResolvedValueOnce({ data: null, error: { code: "503" } });
    expect(await getCompanyAccess()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: { userId: user.id, fullName: "Saved Name" } });
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
  });
  it("requires profile completion when the saved name is blank despite OAuth metadata", async () => {
    mocks.profile.mockResolvedValue({ data: { full_name: "", support_code: "SYNTHETIC" }, error: null });
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: { fullName: "", needsProfileName: true } });
  });
  it("does not bootstrap or read memberships before identity confirmation", async () => {
    mocks.user.mockResolvedValue({ data: { user: { ...user, email_confirmed_at: null } }, error: null });
    expect(await getCompanyAccess()).toEqual({ ok: false, code: "UNVERIFIED" });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.memberships).not.toHaveBeenCalled();
  });
});
