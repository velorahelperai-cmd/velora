import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), access: vi.fn(), verified: vi.fn(), revalidate: vi.fn(), cookies: vi.fn(), deleteCookie: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.cookies, delete: mocks.deleteCookie }) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: mocks.access, requireVerifiedUser: mocks.verified, WORKSPACE_COMPANY_COOKIE: "velora_workspace_company" }));
vi.mock("@/lib/auth/site-url", () => ({ siteUrl: () => "https://velora.example" }));

import { acceptStaffInvitation, createStaffInvitation, listCompanyTeam, readStaffInvitation } from "./staff-invitations";

describe("persistent staff invitations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue({ ok: true, context: { company: { id: "company", status: "active" }, membership: { role: "owner" } } });
    mocks.verified.mockResolvedValue({ ok: true, context: { emailConfirmed: true } });
  });
  it("never calls the database for a denied owner", async () => {
    mocks.access.mockResolvedValue({ ok: false, code: "FORBIDDEN" });
    expect(await createStaffInvitation({ companyId: "company", email: "member@example.com", name: "Member" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not create a B invitation from a stale A form", async () => {
    mocks.access.mockResolvedValue({ ok: true, context: { company: { id: "company-b", status: "active" }, membership: { role: "owner" } } });
    mocks.rpc.mockResolvedValue({ data: { ok: true, expiresAt: "2099-01-01T00:00:00Z" }, error: null });
    expect(await createStaffInvitation({ companyId: "company-a", email: "member@example.com", name: "Member" })).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects an unbound legacy invitation request", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, expiresAt: "2099-01-01T00:00:00Z" }, error: null });
    expect((await createStaffInvitation({ companyId: undefined as unknown as string, email: "member@example.com", name: "Member" })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns a 256-bit share link while sending only its SHA256 hash to persistence", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, expiresAt: "2026-10-15T00:00:00Z" }, error: null });
    const result = await createStaffInvitation({ companyId: "company", email: " MEMBER@example.com ", name: " Member " });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const token = new URL(result.data.inviteUrl).searchParams.get("token")!;
    expect(Buffer.from(token, "base64url").length).toBe(32);
    expect(mocks.rpc).toHaveBeenCalledWith("create_staff_invitation", {
      p_company_id: "company", p_email: "member@example.com", p_name: "Member", p_token_hash: createHash("sha256").update(token).digest("hex"),
    });
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token);
  });
  it("does not fabricate a link when persistence fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "missing rpc" } });
    expect(await createStaffInvitation({ companyId: "company", email: "member@example.com", name: "Member" })).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("rejects invalid database dates before exposing an invitation", async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, expiresAt: "not a date" }, error: null });
    expect(await createStaffInvitation({ companyId: "company", email: "member@example.com", name: "Member" })).toEqual({ ok: false, code: "UNAVAILABLE" });
    mocks.rpc.mockResolvedValue({ data: { ok: true, business: "Business", maskedEmail: "m***@example.com", expiresAt: "not a date" }, error: null });
    expect(await readStaffInvitation("a".repeat(43))).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
  it("rejects another company projection and omits secret fields from a valid list", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true, companyId: "other", members: [], invitations: [] }, error: null });
    expect(await listCompanyTeam()).toEqual({ ok: false, code: "UNAVAILABLE" });
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true, companyId: "company", members: [], invitations: [{ id: "invite", name: "Member", email: "member@example.com", status: "invited", expiresAt: "2026-10-15T00:00:00Z", token_hash: "secret-hash" }] }, error: null });
    const result = await listCompanyTeam();
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-hash");
    expect(JSON.stringify(result)).not.toContain("token_hash");
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
    expect(mocks.cookies).toHaveBeenCalledWith("velora_workspace_company", "company", expect.objectContaining({ httpOnly: true }));
  });
});
