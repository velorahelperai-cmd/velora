"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { siteUrl } from "@/lib/auth/site-url";
import { AUTH_RETURN_COOKIE } from "@/lib/auth/auth-journey";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess, requireVerifiedUser, WORKSPACE_COMPANY_COOKIE } from "@/lib/tenancy/access";

type InvitationResult<T> = { ok: true; data: T } | { ok: false; code: string; message?: string };
export type StaffInvitationView = { business: string; maskedEmail: string; expiresAt: string; role: "staff" };
export type CompanyTeamView = {
  companyId: string;
  members: Array<{ id: string; name: string; email: string; role: "owner" | "staff"; status: "active" | "disabled" }>;
  invitations: Array<{ id: string; name: string; email: string; status: "invited" | "expired"; expiresAt: string }>;
};

function tokenHash(token: string) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)
    ? createHash("sha256").update(token).digest("hex") : null;
}

async function callInvitationRpc(name: string, args: Record<string, string>) {
  const client = await createClient();
  // The new migration adds these RPCs; generated shared DB types follow deployment.
  const rpc = client.rpc as unknown as (name: string, args: Record<string, string>) => PromiseLike<{ data: unknown; error: unknown }>;
  const result = await rpc.call(client, name, args);
  if (result.error || !result.data || typeof result.data !== "object") return null;
  return result.data as Record<string, unknown>;
}

export async function createStaffInvitation(input: { companyId: string; email: string; name: string }): Promise<InvitationResult<{ inviteUrl: string; expiresAt: string }>> {
  if (!input || typeof input.companyId !== "string" || !input.companyId.trim() || typeof input.email !== "string" || typeof input.name !== "string") return { ok: false, code: "INVALID_INPUT" };
  const email = input.email.trim().toLowerCase(), name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || name.length < 2 || name.length > 120) return { ok: false, code: "INVALID_INPUT" };
  try {
    const gate = await getCompanyAccess("owner");
    if (!gate.ok) return { ok: false, code: gate.code };
    if (!gate.context.company || gate.context.company.status === "suspended" || gate.context.membership?.role !== "owner") return { ok: false, code: "FORBIDDEN" };
    if (gate.context.company.id !== input.companyId.trim()) return { ok: false, code: "FORBIDDEN" };
    const token = randomBytes(32).toString("base64url");
    const result = await callInvitationRpc("create_staff_invitation", { p_company_id: gate.context.company.id, p_email: email, p_name: name, p_token_hash: tokenHash(token)! });
    if (!result) return { ok: false, code: "UNAVAILABLE" };
    if (result.ok !== true) return { ok: false, code: typeof result.code === "string" ? result.code : "UNAVAILABLE" };
    if (typeof result.expiresAt !== "string" || !Number.isFinite(Date.parse(result.expiresAt))) return { ok: false, code: "UNAVAILABLE" };
    revalidatePath("/app/settings");
    return { ok: true, data: { inviteUrl: `${siteUrl()}/accept-invite?token=${encodeURIComponent(token)}`, expiresAt: result.expiresAt } };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}

export async function readStaffInvitation(token: string): Promise<InvitationResult<StaffInvitationView>> {
  const hash = tokenHash(token);
  if (!hash) return { ok: false, code: "INVALID_INPUT" };
  try {
    const result = await callInvitationRpc("read_staff_invitation", { p_token_hash: hash });
    if (!result) return { ok: false, code: "UNAVAILABLE" };
    if (result.ok !== true) return { ok: false, code: typeof result.code === "string" ? result.code : "INVITE_INVALID" };
    if (typeof result.business !== "string" || typeof result.maskedEmail !== "string" || typeof result.expiresAt !== "string" || !Number.isFinite(Date.parse(result.expiresAt))) return { ok: false, code: "UNAVAILABLE" };
    return { ok: true, data: { business: result.business, maskedEmail: result.maskedEmail, expiresAt: result.expiresAt, role: "staff" } };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}

export async function listCompanyTeam(): Promise<InvitationResult<CompanyTeamView>> {
  try {
    const gate = await getCompanyAccess("owner");
    if (!gate.ok) return { ok: false, code: gate.code };
    if (!gate.context.company || gate.context.membership?.role !== "owner") return { ok: false, code: "FORBIDDEN" };
    const result = await callInvitationRpc("list_company_team", { p_company_id: gate.context.company.id });
    if (!result) return { ok: false, code: "UNAVAILABLE" };
    if (result.ok !== true) return { ok: false, code: typeof result.code === "string" ? result.code : "UNAVAILABLE" };
    if (result.companyId !== gate.context.company.id || !Array.isArray(result.members) || !Array.isArray(result.invitations)) return { ok: false, code: "UNAVAILABLE" };
    const members: CompanyTeamView["members"] = [];
    const invitations: CompanyTeamView["invitations"] = [];
    for (const row of result.members) {
      if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.name !== "string" || typeof row.email !== "string" || !["owner", "staff"].includes(row.role) || !["active", "disabled"].includes(row.status)) return { ok: false, code: "UNAVAILABLE" };
      members.push({ id: row.id, name: row.name, email: row.email, role: row.role, status: row.status });
    }
    for (const row of result.invitations) {
      if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.name !== "string" || typeof row.email !== "string" || typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt)) || !["invited", "expired"].includes(row.status)) return { ok: false, code: "UNAVAILABLE" };
      invitations.push({ id: row.id, name: row.name, email: row.email, status: row.status, expiresAt: row.expiresAt });
    }
    return { ok: true, data: { companyId: gate.context.company.id, members, invitations } };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}

export async function acceptStaffInvitation(token: string): Promise<InvitationResult<{ companyId: string }>> {
  const hash = tokenHash(token);
  if (!hash) return { ok: false, code: "INVALID_INPUT" };
  try {
    const gate = await requireVerifiedUser();
    if (!gate.ok) return { ok: false, code: gate.code };
    if (!gate.context.emailConfirmed) return { ok: false, code: "UNVERIFIED" };
    const result = await callInvitationRpc("accept_staff_invitation", { p_token_hash: hash });
    if (!result) return { ok: false, code: "UNAVAILABLE" };
    if (result.ok !== true) return { ok: false, code: typeof result.code === "string" ? result.code : "UNAVAILABLE" };
    if (typeof result.companyId !== "string") return { ok: false, code: "UNAVAILABLE" };
    const cookieStore = await cookies();
    cookieStore.set(WORKSPACE_COMPANY_COOKIE, result.companyId, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30 });
    cookieStore.delete(AUTH_RETURN_COOKIE);
    revalidatePath("/app", "layout");
    return { ok: true, data: { companyId: result.companyId } };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}
