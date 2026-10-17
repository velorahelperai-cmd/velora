import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn(), verified: vi.fn(), revalidate: vi.fn(), cookies: vi.fn(), bound: vi.fn(), deleteCookie: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.cookies, get: () => undefined, delete: mocks.deleteCookie }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }), createBrokerBoundClient: mocks.bound }));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: mocks.access, requireVerifiedUser: mocks.verified, WORKSPACE_COMPANY_COOKIE: "velora_workspace_company" }));
vi.mock("@/lib/auth/site-url", () => ({ siteUrl: () => "https://velora.example" }));

import { acceptStaffInvitation, createStaffInvitation, listCompanyTeam, readStaffInvitation, replaceStaffInvitation, cancelStaffInvitation } from "./staff-invitations";

const actorA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const invitation = () => ({ id: "invite", name: "Member", email: "member@example.com", status: "invited", revision: 1, expiresAt: "2026-10-15T00:00:00Z" });

describe("persistent staff invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockReset();
    mocks.bound.mockReset();
    mocks.bound.mockResolvedValue({bound:{ok:true,resolve:{boundary:{userId:actorA,generation:"synthetic-generation-a"}}}});
    mocks.revalidate.mockReset();
    mocks.access.mockResolvedValue({ ok: true, context: { userId: actorA, company: { id: "company", status: "active" }, membership: { role: "owner" } } });
    mocks.verified.mockResolvedValue({ ok: true, context: { userId: actorA, emailConfirmed: true } });
  });
  it("never calls the database for a denied owner", async () => {
    mocks.access.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    expect(await createStaffInvitation({ expectedUserId: actorA, companyId: "company", operationId: "11111111-1111-4111-8111-111111111111", email: "member@example.com", name: "Member" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not create a B invitation from a stale A form", async () => {
    mocks.access.mockResolvedValue({ ok: true, context: { userId: actorA, company: { id: "company-b", status: "active" }, membership: { role: "owner" } } });
    mocks.rpc.mockResolvedValue({ data: { ok: true, expiresAt: "2099-01-01T00:00:00Z" }, error: null });
    expect(await createStaffInvitation({ expectedUserId: actorA, companyId: "company-a", operationId: "11111111-1111-4111-8111-111111111111", email: "member@example.com", name: "Member" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects an unbound legacy invitation request", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, expiresAt: "2099-01-01T00:00:00Z" }, error: null });
    expect((await createStaffInvitation({ expectedUserId: actorA, companyId: undefined as unknown as string, operationId: "11111111-1111-4111-8111-111111111111", email: "member@example.com", name: "Member" })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns a 256-bit share link while sending only its SHA256 hash to persistence", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, outcome: "created", replayed: false, tokenMatched: true, invitation: invitation() }, error: null });
    const result = await createStaffInvitation({ expectedUserId: actorA, companyId: "company", operationId: "11111111-1111-4111-8111-111111111111", email: " MEMBER@example.com ", name: " Member " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const token = new URL(result.data.inviteUrl!).searchParams.get("token")!;
    expect(Buffer.from(token, "base64url").length).toBe(32);
    expect(mocks.rpc).toHaveBeenCalledWith("mutate_staff_invitation", {
      p_operation_id: "11111111-1111-4111-8111-111111111111", p_action: "create", p_invitation_id: null, p_expected_revision: null, p_company_id: "company", p_email: "member@example.com", p_name: "Member", p_token_hash: createHash("sha256").update(token).digest("hex"),
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token);
  });
  it("does not fabricate a link when persistence fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "missing rpc" } });
    expect(await createStaffInvitation({ expectedUserId: actorA, companyId: "company", operationId: "11111111-1111-4111-8111-111111111111", email: "member@example.com", name: "Member" })).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("rejects invalid database dates before exposing an invitation", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, expiresAt: "not a date" }, error: null });
    expect(await createStaffInvitation({ expectedUserId: actorA, companyId: "company", operationId: "11111111-1111-4111-8111-111111111111", email: "member@example.com", name: "Member" })).toEqual({ ok: false, code: "UNAVAILABLE" });
    mocks.rpc.mockResolvedValue({ data: { ok: true, business: "Business", maskedEmail: "m***@example.com", expiresAt: "not a date" }, error: null });
    expect(await readStaffInvitation("a".repeat(43))).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("rejects another company projection and omits secret fields from a valid list", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true, companyId: "other", members: [], invitations: [] }, error: null });
    expect(await listCompanyTeam(actorA)).toEqual({ ok: false, code: "UNAVAILABLE" });
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true, companyId: "company", members: [], invitations: [{ id: "invite", name: "Member", email: "member@example.com", status: "invited", revision: 1, expiresAt: "2026-10-15T00:00:00Z", token_hash: "secret-hash" }] }, error: null });
    const result = await listCompanyTeam(actorA);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-hash");
    expect(JSON.stringify(result)).not.toContain("token_hash");
  });
  it("returns a truthful missing link on operation replay", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, outcome: "created", replayed: true, tokenMatched: false, invitation: invitation() }, error: null });
    const result = await createStaffInvitation({ expectedUserId: actorA, companyId: "company", operationId: "11111111-1111-4111-8111-111111111111", email: "member@example.com", name: "Member" });
    expect(result).toEqual({ ok: true, data: { outcome: "created", replayed: true, invitation: invitation(), inviteUrl: null } });
  });
  it("preserves a confirmed link even when cache refresh fails", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, outcome: "created", replayed: false, tokenMatched: true, invitation: invitation() }, error: null });
    mocks.revalidate.mockImplementationOnce(() => { throw Error("refresh failed"); });
    const result = await createStaffInvitation({ expectedUserId: actorA, companyId: "company", operationId: "11111111-1111-4111-8111-111111111111", email: "member@example.com", name: "Member" });
    expect(result.ok).toBe(true);
  });
  it("rejects a fabricated token on replay instead of returning a fresh invalid link", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, outcome: "created", replayed: true, tokenMatched: true, invitation: invitation() }, error: null });
    expect(await createStaffInvitation({ expectedUserId: actorA, companyId: "company", operationId: "11111111-1111-4111-8111-111111111111", email: "member@example.com", name: "Member" })).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("preserves accepted membership success when cache refresh fails", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, companyId: "company" }, error: null });
    mocks.revalidate.mockImplementationOnce(() => { throw Error("refresh failed"); });
    expect(await acceptStaffInvitation("a".repeat(43))).toEqual({ ok: true, data: { companyId: "company" } });
  });
  it("binds replacement and cancellation to target, revision and operation UUID", async () => {
    const input = { expectedUserId: actorA, companyId: "company", invitationId: "22222222-2222-4222-8222-222222222222", expectedRevision: 1, operationId: "11111111-1111-4111-8111-111111111111" };
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true, outcome: "replaced", replayed: false, tokenMatched: true, invitation: invitation() }, error: null });
    expect((await replaceStaffInvitation(input)).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenLastCalledWith("mutate_staff_invitation", expect.objectContaining({ p_action: "replace", p_invitation_id: input.invitationId, p_expected_revision: 1, p_operation_id: input.operationId, p_email: null, p_name: null }));
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true, outcome: "cancelled", replayed: false, tokenMatched: false, invitation: { ...invitation(), status: "cancelled", revision: 2 } }, error: null });
    expect((await cancelStaffInvitation(input)).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenLastCalledWith("mutate_staff_invitation", expect.objectContaining({ p_action: "cancel", p_token_hash: null }));
    expect(await cancelStaffInvitation({ ...input, expectedRevision: 0 })).toEqual({ ok: false, code: "INVALID_INPUT" });
  });
  it("rejects malformed operation UUIDs before reaching persistence", async () => {
    expect(await createStaffInvitation({ expectedUserId: actorA, companyId: "company", operationId: "bad", email: "member@example.com", name: "Member" })).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects malformed tokens before reading or accepting", async () => {
    expect(await readStaffInvitation("u2")).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await acceptStaffInvitation("u2")).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires a confirmed email before acceptance", async () => {
    mocks.verified.mockResolvedValue({ ok: true, context: { emailConfirmed: false } });
    expect(await acceptStaffInvitation("a".repeat(43))).toEqual({ ok: false, code: "UNVERIFIED" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes the token hash to atomic acceptance and selects the real workspace only on success", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ok: false, code: "EMAIL_MISMATCH" }, error: null });
    expect(await acceptStaffInvitation("a".repeat(43))).toEqual({ ok: false, code: "EMAIL_MISMATCH" });
    expect(mocks.cookies).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true, companyId: "company" }, error: null });
    expect(await acceptStaffInvitation("a".repeat(43))).toEqual({ ok: true, data: { companyId: "company" } });
    expect(mocks.cookies).toHaveBeenCalledWith("velora_ws_synthetic-generation-a", `${actorA}:company`, expect.objectContaining({ httpOnly: true }));
  });
});

it("review regression: reject an originating-actor mismatch before first operation transport", async () => {
 vi.clearAllMocks();
 const actorA="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",actorB="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
 mocks.access.mockResolvedValue({ok:true,context:{userId:actorB,company:{id:"company",status:"active"},membership:{role:"owner"}}});
 mocks.rpc.mockResolvedValue({data:{ok:true,outcome:"created",replayed:false,tokenMatched:true,invitation:invitation()},error:null});
 const response=await createStaffInvitation({companyId:"company",operationId:"11111111-1111-4111-8111-111111111111",email:"member@example.com",name:"Member",expectedUserId:actorA} as never);
 expect(response).toEqual({ok:false,code:"UNAUTHENTICATED"});
 expect(mocks.rpc).not.toHaveBeenCalled();
});

for (const action of ["create", "replace", "cancel"] as const) {
  const input = { expectedUserId: actorA, companyId: "company", operationId: "11111111-1111-4111-8111-111111111111", invitationId: "22222222-2222-4222-8222-222222222222", expectedRevision: 1, name: "Member", email: "member@example.com" };
  const mutate = action === "create" ? createStaffInvitation : action === "replace" ? replaceStaffInvitation : cancelStaffInvitation;
  it(action + ": review regression: rejects missing or malformed originating actors before transport", async () => {
    vi.clearAllMocks();
    for (const expectedUserId of [undefined, null, "", "bad", 42]) {
      expect(await mutate({ ...input, expectedUserId } as never)).toEqual({ ok: false, code: "INVALID_INPUT" });
    }
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it(action + ": review regression: rejects same-company cookie switch on first attempt and uncertain retry", async () => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ ok: true, context: { userId: actorA, company: { id: "company", status: "active" }, membership: { role: "owner" } } });
    mocks.rpc.mockRejectedValueOnce(Error("LOST_RESPONSE"));
    expect(await mutate(input)).toEqual({ ok: false, code: "UNAVAILABLE" });
    mocks.access.mockResolvedValue({ ok: true, context: { userId: actorB, company: { id: "company", status: "active" }, membership: { role: "owner" } } });
    expect(await mutate(input)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(await mutate({ ...input, operationId: "33333333-3333-4333-8333-333333333333" })).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
}
it("review regression: fresh roster authority cannot be restored by another same-company actor", async () => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ ok: true, context: { userId: actorB, company: { id: "company", status: "active" }, membership: { role: "owner" } } });
  expect(await listCompanyTeam(actorA)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("committed membership remains accepted when bound cookie setup throws",async()=>{mocks.verified.mockResolvedValue({ok:true,context:{userId:actorA,emailConfirmed:true}});mocks.rpc.mockResolvedValue({data:{ok:true,companyId:"company"},error:null});mocks.bound.mockRejectedValue(Error("SYNTHETIC_COOKIE_BOUNDARY_UNAVAILABLE"));expect(await acceptStaffInvitation("a".repeat(43))).toEqual({ok:true,data:{companyId:"company"}});});
it("committed membership remains accepted when optional workspace cookie write fails",async()=>{mocks.verified.mockResolvedValue({ok:true,context:{userId:actorA,emailConfirmed:true}});mocks.rpc.mockResolvedValue({data:{ok:true,companyId:"company"},error:null});mocks.bound.mockResolvedValue({bound:{ok:true,resolve:{boundary:{userId:actorA,generation:"synthetic-generation-a"}}}});mocks.cookies.mockImplementation(()=>{throw Error("SYNTHETIC_COOKIE_WRITE_FAILED");});expect(await acceptStaffInvitation("a".repeat(43))).toEqual({ok:true,data:{companyId:"company"}});});
