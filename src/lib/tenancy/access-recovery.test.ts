import {afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ client: vi.fn(), upsert: vi.fn(), profile: vi.fn(), memberships: vi.fn(), guard: vi.fn(), claims: vi.fn(), user: vi.fn(), cookie: vi.fn(), resolve: vi.fn(), admin: vi.fn(), company: vi.fn(), choices: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/auth/session-guard", () => ({ checkAppSession: mocks.guard }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie, getAll: () => [] }) }));
vi.mock("@/lib/auth/broker", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth/broker")>(),
  resolveBrokerSession: mocks.resolve,
}));
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
  mocks.resolve.mockResolvedValue({ ok: false, code: "UNAUTHENTICATED" });
  mocks.admin.mockResolvedValue({ data: false, error: null });
  mocks.company.mockResolvedValue({ data: { id: "company-a", display_name: "Saved Company" }, error: null });
  mocks.choices.mockResolvedValue({ data: [{ id: "company-a", display_name: "Saved Company" }], error: null });
  mocks.client.mockResolvedValue({ auth: { getClaims: mocks.claims, getUser: mocks.user }, rpc: mocks.admin,
    from: (table: string) => {
      const query = { upsert: mocks.upsert, select: () => query, eq: () => query, maybeSingle: mocks.profile, order: mocks.memberships };
      const companyQuery = { select: () => companyQuery, eq: () => companyQuery, maybeSingle: mocks.company, in: mocks.choices };
      return table === "companies" ? companyQuery : query;
    },
  });
});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
describe("persisted profile is required for company access", () => {
  it("overlaps independent identity/session and admin/profile reads without publishing access early", async () => {
    vi.useFakeTimers();
    const delayed=<T,>(value:T)=>new Promise<T>(resolve=>setTimeout(()=>resolve(value),50));
    mocks.user.mockImplementation(()=>delayed({data:{user},error:null}));
    mocks.guard.mockImplementation(()=>delayed({ok:true}));
    mocks.admin.mockImplementation(()=>delayed({data:false,error:null}));
    mocks.profile.mockImplementation(()=>delayed({data:{full_name:'Saved Name',support_code:'SYNTHETIC'},error:null}));
    let settled=false;
    const started=Date.now();
    const pending=getCompanyAccess().then(value=>{settled=true;return value;});
    await vi.advanceTimersByTimeAsync(0);
    const guardStartedWithIdentity=mocks.guard.mock.calls.length===1;
    expect(mocks.memberships).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ok:true,context:{fullName:'Saved Name'}});
    expect(settled).toBe(true);
    console.info('isolated read-only access benchmark',{hopDelayMs:50,elapsedMs:Date.now()-started});
    expect(guardStartedWithIdentity).toBe(true);
    expect(Date.now()-started).toBe(100);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("keeps revocation authoritative when independent reads finish in either order",async()=>{
    mocks.guard.mockResolvedValue({ok:false,code:'UNAUTHENTICATED',expired:true});
    expect(await getCompanyAccess()).toEqual({ok:false,code:'UNAUTHENTICATED',sessionExpired:true});
    expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.memberships).not.toHaveBeenCalled();expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("reads an existing profile without attempting to insert or replace it", async () => {
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: { fullName: "Saved Name", supportCode: "SYNTHETIC" } });
    expect(mocks.profile).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("recovers a missing profile and returns only the persisted result", async () => {
    mocks.profile.mockResolvedValueOnce({ data: null, error: null });
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: { fullName: "Saved Name", supportCode: "SYNTHETIC" } });
    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: user.id, full_name: "Metadata Name" },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
    expect(mocks.profile).toHaveBeenCalledTimes(2);
  });
  it("does not write when a failed read leaves profile existence unknown", async () => {
    mocks.profile.mockResolvedValue({ data: null, error: { code: "503" } });
    expect(await getCompanyAccess()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.memberships).not.toHaveBeenCalled();
  });
  it("retries only support-code collisions when bootstrapping a missing profile", async () => {
    mocks.profile.mockResolvedValueOnce({ data: null, error: null });
    mocks.upsert.mockResolvedValueOnce({ error: { code: "23505", message: "profiles_support_code_key" } });
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: { fullName: "Saved Name" } });
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
  });
  it("accepts a concurrently persisted profile after a user-id conflict without replacing it", async () => {
    mocks.profile.mockResolvedValueOnce({ data: null, error: null });
    mocks.upsert.mockResolvedValue({ error: { code: "23505", message: "profiles_user_id_key" } });
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: { fullName: "Saved Name" } });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.profile).toHaveBeenCalledTimes(2);
  });
  it("stops after four support-code collisions and fails closed without a saved profile", async () => {
    mocks.profile.mockResolvedValue({ data: null, error: null });
    mocks.upsert.mockResolvedValue({ error: { code: "23505", message: "profiles_support_code_key" } });
    expect(await getCompanyAccess()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(mocks.upsert).toHaveBeenCalledTimes(4);
    expect(mocks.memberships).not.toHaveBeenCalled();
  });
  it("rejects a native identity change before reading or creating a profile", async () => {
    mocks.user.mockResolvedValue({ data: { user: { ...user, id: "other-user" } }, error: null });
    expect(await getCompanyAccess()).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.memberships).not.toHaveBeenCalled();
  });
  it.each(["owner", "staff"])("auto-selects a sole %s membership without resolving an unused workspace hint", async role => {
    mocks.memberships.mockResolvedValue({ data: [{ company_id: "company-a", role }], error: null });
    mocks.cookie.mockReturnValue({ value: "old-user:other-company" });
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: {
      company: { id: "company-a" }, membership: { role }, needsCompanyContext: false,
      workspaceChoices: [{ companyId: "company-a", displayName: "Saved Company", role }],
    } });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.company).toHaveBeenCalledTimes(1);
    expect(mocks.choices).not.toHaveBeenCalled();
  });
  it("retains the company-ID fallback when the selected company name is blank", async () => {
    mocks.memberships.mockResolvedValue({ data: [{ company_id: "company-a", role: "staff" }], error: null });
    mocks.company.mockResolvedValue({ data: { id: "company-a", display_name: "" }, error: null });
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: {
      workspaceChoices: [{ companyId: "company-a", displayName: "company-a", role: "staff" }],
    } });
  });
  it.each(["missing", "error"])("does not invent a workspace when its selected company is %s", async mode => {
    mocks.memberships.mockResolvedValue({ data: [{ company_id: "company-a", role: "owner" }], error: null });
    mocks.company.mockResolvedValue({ data: null, error: mode === "error" ? { code: "503" } : null });
    expect(await getCompanyAccess()).toEqual({ ok: false, code: mode === "error" ? "UNAVAILABLE" : "FORBIDDEN" });
    expect(mocks.choices).not.toHaveBeenCalled();
  });
  it("reuses the verified company name after an admin explicitly selects their sole workspace", async () => {
    mocks.admin.mockResolvedValue({ data: true, error: null });
    mocks.memberships.mockResolvedValue({ data: [{ company_id: "company-a", role: "owner" }], error: null });
    mocks.resolve.mockResolvedValue({ ok: true, boundary: { generation: "current-generation" } });
    mocks.cookie.mockImplementation((name: string) => name === "velora_ws_current-generation"
      ? { value: `${user.id}:company-a` } : undefined);
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: {
      isPlatformAdmin: true, company: { id: "company-a" }, needsCompanyContext: false,
      workspaceChoices: [{ companyId: "company-a", displayName: "Saved Company", role: "owner" }],
    } });
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
    expect(mocks.company).toHaveBeenCalledTimes(1);
    expect(mocks.choices).not.toHaveBeenCalled();
  });
  it.each(["UNAUTHENTICATED", "UNAVAILABLE"])("does not auto-select an admin workspace after resolution is %s", async code => {
    mocks.admin.mockResolvedValue({ data: true, error: null });
    mocks.memberships.mockResolvedValue({ data: [{ company_id: "company-a", role: "owner" }], error: null });
    mocks.resolve.mockResolvedValue({ ok: false, code });
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: {
      isPlatformAdmin: true, company: null, needsCompanyContext: true,
    } });
    expect(mocks.company).not.toHaveBeenCalled();
  });
  it("does not use a previous generation's selection for an admin's sole workspace", async () => {
    mocks.admin.mockResolvedValue({ data: true, error: null });
    mocks.memberships.mockResolvedValue({ data: [{ company_id: "company-a", role: "owner" }], error: null });
    mocks.resolve.mockResolvedValue({ ok: true, boundary: { generation: "current-generation" } });
    mocks.cookie.mockImplementation((name: string) => name === "velora_ws_old-generation"
      ? { value: `${user.id}:company-a` } : undefined);
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: { company: null, needsCompanyContext: true } });
    expect(mocks.company).not.toHaveBeenCalled();
  });
  it("fails closed when platform-admin status cannot be verified", async () => {
    mocks.admin.mockResolvedValue({ data: null, error: { code: "503" } });
    expect(await getCompanyAccess()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(mocks.memberships).not.toHaveBeenCalled();
  });
  it.each([false, true])("keeps concurrent profile recovery isolated (different users: %s)", async differentUsers => {
    type Profile = { full_name: string; support_code: string };
    const persisted = new Map<string, Profile>();
    let absentReads = 0;
    let release!: () => void;
    const bothAbsent = new Promise<void>(resolve => { release = resolve; });
    const secondId = differentUsers ? "second-user" : user.id;
    const clientFor = (id: string, name: string) => ({
      auth: {
        getClaims: async () => ({ data: { claims: { sub: id } }, error: null }),
        getUser: async () => ({ data: { user: { ...user, id, user_metadata: { full_name: name } } }, error: null }),
      },
      rpc: async () => ({ data: false, error: null }),
      from: (table: string) => {
        let selectedUser = "";
        const query = {
          select: () => query,
          eq: (column: string, value: string) => { if (column === "user_id") selectedUser = value; return query; },
          order: async () => ({ data: [], error: null }),
          maybeSingle: async () => {
            if (selectedUser !== id) throw new Error("cross-user profile read");
            if (!persisted.has(id) && absentReads < 2) {
              if (++absentReads === 2) release();
              await bothAbsent;
              return { data: null, error: null };
            }
            return { data: persisted.get(id) ?? null, error: null };
          },
          upsert: async (value: { user_id: string; full_name: string }, options: { onConflict: string; ignoreDuplicates: boolean }) => {
            if (table !== "profiles" || value.user_id !== id || options.onConflict !== "user_id" || !options.ignoreDuplicates) {
              throw new Error("unsafe profile bootstrap");
            }
            if (!persisted.has(id)) persisted.set(id, { full_name: value.full_name, support_code: `saved-${id}` });
            return { error: null };
          },
        };
        return query;
      },
    });
    mocks.client.mockResolvedValueOnce(clientFor(user.id, "First Name"))
      .mockResolvedValueOnce(clientFor(secondId, "Second Name"));
    const results = await Promise.all([getCompanyAccess(), getCompanyAccess()]);
    expect(results[0]).toMatchObject({ ok: true, context: { userId: user.id, fullName: "First Name", supportCode: `saved-${user.id}` } });
    expect(results[1]).toMatchObject({ ok: true, context: {
      userId: secondId, fullName: differentUsers ? "Second Name" : "First Name", supportCode: `saved-${secondId}`,
    } });
    expect(persisted.size).toBe(differentUsers ? 2 : 1);
  });
  it("does not wait for workspace selection when verified memberships are empty", async () => {
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: {
      userId: user.id, company: null, membership: null,
      needsCompanyContext: false, workspaceChoices: [], ownedBusinessCount: 0,
    } });
    expect(mocks.guard).toHaveBeenCalledTimes(1);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each(["UNAUTHENTICATED", "UNAVAILABLE"])("still denies an empty-business account when its session is %s", async code => {
    mocks.guard.mockResolvedValue({ ok: false, code });
    expect(await getCompanyAccess()).toEqual({ ok: false, code });
    expect(mocks.memberships).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("fails closed when membership lookup fails instead of treating it as no business", async () => {
    mocks.memberships.mockResolvedValue({ data: null, error: { code: "503" } });
    expect(await getCompanyAccess()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each([false, true])("keeps generation-bound selection with multiple workspaces (admin: %s)", async isAdmin => {
    mocks.admin.mockResolvedValue({ data: isAdmin, error: null });
    mocks.memberships.mockResolvedValue({ data: [
      { company_id: "company-a", role: "owner" }, { company_id: "company-b", role: "staff" },
    ], error: null });
    mocks.resolve.mockResolvedValue({ ok: true, boundary: { generation: "current-generation" } });
    mocks.cookie.mockImplementation((name: string) => name === "velora_ws_current-generation"
      ? { value: `${user.id}:company-b` } : undefined);
    const client = await mocks.client(), originalFrom = client.from;
    const selected = vi.fn().mockResolvedValue({ data: { id: "company-b", display_name: "B" }, error: null });
    client.from = (table: string) => table === "companies" ? { select: () => ({
      eq: () => ({ maybeSingle: selected }),
      in: async () => ({ data: [{ id: "company-a", display_name: "A" }, { id: "company-b", display_name: "B" }], error: null }),
    }) } : originalFrom(table);
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: {
      company: { id: "company-b" }, membership: { role: "staff" }, needsCompanyContext: false,
    } });
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });
  it("keeps explicit workspace selection required for a platform admin with one membership", async () => {
    mocks.memberships.mockResolvedValue({ data: [{ company_id: "company-a", role: "owner" }], error: null });
    const client = await mocks.client(), originalFrom = client.from;
    client.rpc = async () => ({ data: true, error: null });
    client.from = (table: string) => table === "companies" ? { select: () => ({
      in: async () => ({ data: [{ id: "company-a", display_name: "A" }], error: null }),
    }) } : originalFrom(table);
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: {
      company: null, needsCompanyContext: true, isPlatformAdmin: true,
    } });
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });
  it('filters archived workspaces while retaining verified ownership history',async()=>{
    vi.stubEnv('VELORA_MASTER_JOURNEY_ENABLED','true');
    mocks.memberships.mockResolvedValue({data:[{company_id:'old',role:'owner',status:'active'}],error:null});
    const client=await mocks.client(),originalFrom=client.from;
    client.from=(table:string)=>table==='companies'?{select:()=>({in:async()=>({data:[{id:'old',archived_at:'2026-10-14T00:00:00Z'}],error:null})})}:originalFrom(table);
    expect(await getCompanyAccess()).toMatchObject({ok:true,context:{company:null,workspaceChoices:[],ownedBusinessCount:1,hasBusinessMemberships:true}});
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it('does not turn failed archive evidence into an empty business account',async()=>{
    vi.stubEnv('VELORA_MASTER_JOURNEY_ENABLED','true');
    mocks.memberships.mockResolvedValue({data:[{company_id:'old',role:'owner',status:'active'}],error:null});
    const client=await mocks.client(),originalFrom=client.from;
    client.from=(table:string)=>table==='companies'?{select:()=>({in:async()=>({data:null,error:{code:'503'}})})}:originalFrom(table);
    expect(await getCompanyAccess()).toEqual({ok:false,code:'UNAVAILABLE'});
  });
  it("ignores an old account's workspace selection even when both accounts belong to it", async () => {
    mocks.memberships.mockResolvedValue({ data: [{ company_id: "company-a", role: "owner" }, { company_id: "company-b", role: "staff" }], error: null });
    mocks.resolve.mockResolvedValue({ ok: true, boundary: { generation: "current-generation" } });
    mocks.cookie.mockReturnValue({ value: "old-user:company-a" });
    // No company query should run before an explicit selection for the new user.
    const client = await mocks.client();
    const originalFrom = client.from;
    client.from = (table: string) => table === "companies" ? { select: () => ({ in: async () => ({ data: [], error: null }) }) } : originalFrom(table);
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: { company: null, needsCompanyContext: true } });
    expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });
  it("an email change keeps the same persisted user identity", async () => {
    mocks.user.mockResolvedValue({ data: { user: { ...user, email: "changed@example.test" } }, error: null });
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: { userId: user.id, email: "changed@example.test", fullName: "Saved Name" } });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it.each(["missing", "error"])("fails closed on %s profile without using metadata as a saved profile", async mode => {
    mocks.upsert.mockResolvedValue({ error: { code: "42501" } });
    mocks.profile.mockResolvedValue({ data: null, error: mode === "error" ? { code: "503" } : null });
    expect(await getCompanyAccess()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(mocks.memberships).not.toHaveBeenCalled();
  });
  it("recovers from a failed profile read on a later request without writes or signup", async () => {
    mocks.profile.mockResolvedValueOnce({ data: null, error: { code: "503" } });
    expect(await getCompanyAccess()).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(await getCompanyAccess()).toMatchObject({ ok: true, context: { userId: user.id, fullName: "Saved Name" } });
    expect(mocks.upsert).not.toHaveBeenCalled();
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
