"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { siteUrl } from "@/lib/auth/site-url";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess, requireVerifiedUser } from "@/lib/tenancy/access";

type InvitationResult<T> = { ok: true; data: T } | { ok: false; code: string; message?: string };
export type StaffInvitationView = { business: string; maskedEmail: string; expiresAt: string; role: "staff" };
export type CompanyStaffInvitation = {
  id: string; name: string; email: string;
  status: "invited" | "expired" | "accepted" | "cancelled" | "conflicted";
  expiresAt: string; revision: number;
};
export type StaffInvitationMutation = {
  outcome: "created" | "existing" | "replaced" | "cancelled";
  replayed: boolean; invitation: CompanyStaffInvitation; inviteUrl: string | null;
};
export type StaffInvitationChangeInput = { expectedUserId: string; companyId: string; operationId: string; invitationId: string; expectedRevision: number };
export type CompanyTeamView = {
  companyId: string;
  members: Array<{ id: string; name: string; email: string; role: "owner" | "staff"; status: "active" | "disabled" }>;
  invitations: CompanyStaffInvitation[];
};

function tokenHash(token: string) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token)
    ? createHash("sha256").update(token).digest("hex") : null;
}

async function callInvitationRpc(name: string, args: Record<string, string | number | null>) {
  const client = await createClient();
  // The new migration adds these RPCs; generated shared DB types follow deployment.
  const rpc = client.rpc as unknown as (name: string, args: Record<string, string | number | null>) => PromiseLike<{ data: unknown; error: unknown }>;
  const result = await rpc.call(client, name, args);
  if (result.error || !result.data || typeof result.data !== "object") return null;
  return result.data as Record<string, unknown>;
}

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function invitationProjection(value: unknown): CompanyStaffInvitation | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.email !== "string"
    || !["invited", "expired", "accepted", "cancelled", "conflicted"].includes(row.status as string)
    || typeof row.expiresAt !== "string" || !Number.isFinite(Date.parse(row.expiresAt))
    || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1) return null;
  return { id: row.id, name: row.name, email: row.email, status: row.status as CompanyStaffInvitation["status"], expiresAt: row.expiresAt, revision: row.revision };
}

async function mutateInvitation(expectedUserId: string, companyId: string, operationId: string, action: "create" | "replace" | "cancel", args: Record<string, string | number | null>): Promise<InvitationResult<StaffInvitationMutation>> {
  try {
    const gate = await getCompanyAccess("owner");
    if (!gate.ok) return { ok: false, code: gate.code };
    // Origin binding detects stale account forms; the verified session and SQL
    // still derive authority independently of this caller-supplied identifier.
    if (gate.context.userId !== expectedUserId.toLowerCase()) return { ok: false, code: "UNAUTHENTICATED" };
    if (!gate.context.company || gate.context.company.status === "suspended" || gate.context.membership?.role !== "owner"
      || gate.context.company.id !== companyId.trim()) return { ok: false, code: "FORBIDDEN" };
    const token = action === "cancel" ? null : randomBytes(32).toString("base64url");
    const result = await callInvitationRpc("mutate_staff_invitation", {
      p_company_id: gate.context.company.id, p_operation_id: operationId, p_action: action,
      ...args, p_token_hash: token ? tokenHash(token)! : null,
    });
    if (!result) return { ok: false, code: "UNAVAILABLE" };
    if (result.ok !== true) return { ok: false, code: typeof result.code === "string" ? result.code : "UNAVAILABLE" };
    const invitation = invitationProjection(result.invitation);
    const outcomes = action === "create" ? ["created", "existing"] : action === "replace" ? ["replaced"] : ["cancelled"];
    if (!invitation || !outcomes.includes(result.outcome as string) || typeof result.replayed !== "boolean"
      || typeof result.tokenMatched !== "boolean" || (result.tokenMatched && (result.replayed || result.outcome === "existing" || !token || invitation.status !== "invited"))) return { ok: false, code: "UNAVAILABLE" };
    // Hashes cannot recover a lost response. Only the freshly committed token is
    // returned; replays and existing records require an explicit replacement.
    const inviteUrl = result.tokenMatched && token ? `${siteUrl()}/accept-invite?token=${encodeURIComponent(token)}` : null;
    // Cache failure is independent of the durable mutation outcome.
    try { revalidatePath("/app/settings"); } catch { /* UI refresh has its own status. */ }
    return { ok: true, data: { outcome: result.outcome as StaffInvitationMutation["outcome"], replayed: result.replayed, invitation, inviteUrl } };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}

export async function createStaffInvitation(input: { expectedUserId: string; companyId: string; operationId: string; email: string; name: string }): Promise<InvitationResult<StaffInvitationMutation>> {
  if (!input || !uuid(input.expectedUserId) || typeof input.companyId !== "string" || !input.companyId.trim() || !uuid(input.operationId)
    || typeof input.email !== "string" || typeof input.name !== "string") return { ok: false, code: "INVALID_INPUT" };
  const email = input.email.trim().toLowerCase(), name = input.name.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || name.length < 2 || name.length > 120) return { ok: false, code: "INVALID_INPUT" };
  return mutateInvitation(input.expectedUserId, input.companyId, input.operationId, "create", { p_email: email, p_name: name, p_invitation_id: null, p_expected_revision: null });
}

function validChange(input: StaffInvitationChangeInput) {
  return input && uuid(input.expectedUserId) && typeof input.companyId === "string" && input.companyId.trim() && uuid(input.operationId)
    && uuid(input.invitationId) && Number.isSafeInteger(input.expectedRevision) && input.expectedRevision > 0 && input.expectedRevision <= 2147483647;
}
export async function replaceStaffInvitation(input: StaffInvitationChangeInput): Promise<InvitationResult<StaffInvitationMutation>> {
  if (!validChange(input)) return { ok: false, code: "INVALID_INPUT" };
  return mutateInvitation(input.expectedUserId, input.companyId, input.operationId, "replace", { p_email: null, p_name: null, p_invitation_id: input.invitationId, p_expected_revision: input.expectedRevision });
}
export async function cancelStaffInvitation(input: StaffInvitationChangeInput): Promise<InvitationResult<StaffInvitationMutation>> {
  if (!validChange(input)) return { ok: false, code: "INVALID_INPUT" };
  return mutateInvitation(input.expectedUserId, input.companyId, input.operationId, "cancel", { p_email: null, p_name: null, p_invitation_id: input.invitationId, p_expected_revision: input.expectedRevision });
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

export async function listCompanyTeam(expectedUserId: string): Promise<InvitationResult<CompanyTeamView>> {
  if (!uuid(expectedUserId)) return { ok: false, code: "INVALID_INPUT" };
  try {
    const gate = await getCompanyAccess("owner");
    if (!gate.ok) return { ok: false, code: gate.code };
    if (gate.context.userId !== expectedUserId.toLowerCase()) return { ok: false, code: "UNAUTHENTICATED" };
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
      const projection = invitationProjection(row);
      if (!projection) return { ok: false, code: "UNAVAILABLE" };
      invitations.push(projection);
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
    // Membership is already committed by the atomic RPC. Cookie/navigation hints
    // cannot turn that durable acceptance into an apparent total failure.
    try {
    const cookieStore = await cookies();
    {
      const { createBrokerBoundClient } = await import("@/lib/supabase/server");
      const { clearAuthReturnForGeneration, commitWorkspaceForGeneration } = await import("@/lib/auth/broker");
      const bound = await createBrokerBoundClient();
      if (bound.bound.ok && bound.bound.resolve.boundary.userId === gate.context.userId) {
        const generation = bound.bound.resolve.boundary.generation;
        commitWorkspaceForGeneration(
          {
            set: (name, value, options) => cookieStore.set(name, value, options as never),
            get: (name) => { const v = cookieStore.get(name)?.value; return v ? { value: v } : undefined; },
            delete: (name) => cookieStore.delete(name),
          },
          generation,
          gate.context.userId,
          result.companyId,
        );
        // Generation-scoped return clear only — never global AUTH_RETURN wipe (C2-R6).
        clearAuthReturnForGeneration(
          {
            get: (name) => { const v = cookieStore.get(name)?.value; return v ? { value: v } : undefined; },
            set: (name, value, options) => cookieStore.set(name, value, options as never),
            delete: (name) => cookieStore.delete(name),
          },
          generation,
        );
      }
    }
    } catch { /* Later requests still reauthorize; no workspace grant is synthesized. */ }
    try { revalidatePath("/app", "layout"); } catch { /* Acceptance is already durable; refresh can be retried. */ }
    return { ok: true, data: { companyId: result.companyId } };
  } catch { return { ok: false, code: "UNAVAILABLE" }; }
}
