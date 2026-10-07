"use server";

import { createClient } from "@/lib/supabase/server";
import {
  COMPANY_CAPABILITIES,
  accessMigrationCompatEnabled,
  type CompanyCapability,
  type ConversationScope,
  isCompanyCapability,
  type PlatformAccessRole,
} from "@/lib/access/capabilities";
import { requirePlatformAdmin } from "@/lib/tenancy/access";
import type { Json } from "@/lib/database.types";

type ActionOk<T> = { ok: true; data: T };
type ActionFail = {
  ok: false;
  code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT" | "UNAVAILABLE" | "NOT_FOUND" | "CONFLICT";
  message?: string;
};

function asRecord(value: Json | null | undefined): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isMissingRpc(message: string, functionName: string): boolean {
  // Compat only when a specific RPC name is absent — not generic "pgrst" matching.
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `could not find the function[^\\n]*${escaped}|function\\s+${escaped}\\s+does not exist`,
    "i",
  ).test(message);
}

export type AccessUserSnapshot = {
  userId: string;
  email: string;
  emailConfirmed: boolean;
  platform: {
    role: PlatformAccessRole;
    status: "active" | "disabled";
    revision: number;
    note: string;
  } | null;
  memberships: Array<{
    companyId: string;
    displayName: string;
    role: "owner" | "staff";
    status: string;
    companyStatus: string;
  }>;
  grants: Array<{
    companyId: string;
    capabilities: CompanyCapability[];
    conversationScope: ConversationScope;
    managerUserId: string | null;
    status: string;
    revision: number;
  }>;
  adminScopes: Array<{
    companyId: string;
    usable: string[];
    delegable: string[];
    revision: number;
  }>;
  catalog: { platform: string[]; company: string[] };
};

export async function accessGetUserSnapshot(
  userId: string,
): Promise<ActionOk<AccessUserSnapshot> | ActionFail> {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    if (gate.code === "UNAUTHENTICATED" || gate.code === "UNVERIFIED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    return { ok: false, code: gate.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FORBIDDEN" };
  }
  const id = userId.trim();
  if (!id) return { ok: false, code: "INVALID_INPUT" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("access_get_user_snapshot", { p_user_id: id });
    if (error) {
      if (isMissingRpc(error.message, "access_get_user_snapshot")) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "DEPENDENCY_MISSING:access_get_user_snapshot:20261006120000_vel_access_management_01",
        };
      }
      return { ok: false, code: "UNAVAILABLE", message: error.message };
    }
    const row = asRecord(data as Json);
    if (!row) return { ok: false, code: "UNAVAILABLE" };
    if (row.ok !== true) {
      if (String(row.code) === "not_found") return { ok: false, code: "NOT_FOUND" };
      if (String(row.code) === "forbidden") return { ok: false, code: "FORBIDDEN" };
      return { ok: false, code: "UNAVAILABLE", message: String(row.code ?? "") };
    }

    const platformRaw = asRecord(row.platform as Json);
    const membershipsRaw = Array.isArray(row.memberships) ? row.memberships : [];
    const grantsRaw = Array.isArray(row.grants) ? row.grants : [];
    const scopesRaw = Array.isArray(row.admin_scopes) ? row.admin_scopes : [];
    const catalogRaw = asRecord(row.catalog as Json);

    return {
      ok: true,
      data: {
        userId: String(row.user_id),
        email: String(row.email ?? ""),
        emailConfirmed: Boolean(row.email_confirmed),
        platform: platformRaw
          ? {
            role: platformRaw.role === "owner" ? "owner" : "delegated",
            status: platformRaw.status === "disabled" ? "disabled" : "active",
            revision: Number(platformRaw.revision ?? 1),
            note: String(platformRaw.note ?? ""),
          }
          : null,
        memberships: membershipsRaw.flatMap((item) => {
          const m = asRecord(item as Json);
          if (!m || typeof m.company_id !== "string") return [];
          return [{
            companyId: m.company_id,
            displayName: String(m.display_name ?? ""),
            role: m.role === "owner" ? "owner" as const : "staff" as const,
            status: String(m.status ?? ""),
            companyStatus: String(m.company_status ?? ""),
          }];
        }),
        grants: grantsRaw.flatMap((item) => {
          const g = asRecord(item as Json);
          if (!g || typeof g.company_id !== "string") return [];
          const caps = Array.isArray(g.capabilities)
            ? g.capabilities.map(String).filter(isCompanyCapability)
            : [];
          return [{
            companyId: g.company_id,
            capabilities: caps,
            conversationScope: g.conversation_scope === "assigned_only" ? "assigned_only" as const : "all_company" as const,
            managerUserId: typeof g.manager_user_id === "string" ? g.manager_user_id : null,
            status: String(g.status ?? ""),
            revision: Number(g.revision ?? 1),
          }];
        }),
        adminScopes: scopesRaw.flatMap((item) => {
          const s = asRecord(item as Json);
          if (!s || typeof s.company_id !== "string") return [];
          return [{
            companyId: s.company_id,
            usable: Array.isArray(s.usable_capabilities) ? s.usable_capabilities.map(String) : [],
            delegable: Array.isArray(s.delegable_capabilities) ? s.delegable_capabilities.map(String) : [],
            revision: Number(s.revision ?? 1),
          }];
        }),
        catalog: {
          platform: Array.isArray(catalogRaw?.platform) ? catalogRaw!.platform.map(String) : [],
          company: Array.isArray(catalogRaw?.company)
            ? catalogRaw!.company.map(String)
            : [...COMPANY_CAPABILITIES],
        },
      },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function accessSetMemberGrants(input: {
  companyId: string;
  userId: string;
  capabilities: string[];
  conversationScope: ConversationScope;
  expectedRevision: number;
  reason?: string;
}): Promise<ActionOk<{ revision: number }> | ActionFail> {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    if (gate.code === "UNAUTHENTICATED" || gate.code === "UNVERIFIED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    return { ok: false, code: gate.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FORBIDDEN" };
  }
  if (!Number.isFinite(input.expectedRevision)) {
    return { ok: false, code: "INVALID_INPUT", message: "revision_required" };
  }
  const caps = input.capabilities.filter(isCompanyCapability);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("access_set_member_grants", {
      p_company_id: input.companyId,
      p_user_id: input.userId,
      p_capabilities: caps,
      p_conversation_scope: input.conversationScope,
      p_manager_user_id: null,
      p_expected_revision: input.expectedRevision,
      p_reason: input.reason ?? "",
    });
    if (error) {
      if (isMissingRpc(error.message, "access_set_member_grants")) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "DEPENDENCY_MISSING:access_set_member_grants:20261006120000_vel_access_management_01",
        };
      }
      return { ok: false, code: "UNAVAILABLE", message: error.message };
    }
    const row = asRecord(data as Json);
    if (!row) return { ok: false, code: "UNAVAILABLE" };
    if (row.ok === true) return { ok: true, data: { revision: Number(row.revision ?? 1) } };
    const code = String(row.code ?? "");
    if (code === "revision_conflict") return { ok: false, code: "CONFLICT", message: code };
    if (code === "not_member" || code === "owner_grants_implicit") {
      return { ok: false, code: "INVALID_INPUT", message: code };
    }
    return { ok: false, code: "FORBIDDEN", message: code };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function accessAddCompanyStaff(input: {
  companyId: string;
  userId: string;
  capabilities: string[];
  conversationScope: ConversationScope;
  expectedGrantRevision: number;
  reason?: string;
}): Promise<ActionOk<{ revision: number; createdMembership: boolean }> | ActionFail> {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    if (gate.code === "UNAUTHENTICATED" || gate.code === "UNVERIFIED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    return { ok: false, code: gate.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FORBIDDEN" };
  }
  if (!Number.isFinite(input.expectedGrantRevision)) {
    return { ok: false, code: "INVALID_INPUT", message: "revision_required" };
  }
  const caps = input.capabilities.filter(isCompanyCapability);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("access_add_company_staff", {
      p_company_id: input.companyId,
      p_user_id: input.userId,
      p_capabilities: caps,
      p_conversation_scope: input.conversationScope,
      p_expected_grant_revision: input.expectedGrantRevision,
      p_reason: input.reason ?? "",
    });
    if (error) {
      if (isMissingRpc(error.message, "access_add_company_staff")) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "DEPENDENCY_MISSING:access_add_company_staff:20261006120000_vel_access_management_01",
        };
      }
      if (/forbidden|42501/i.test(error.message)) return { ok: false, code: "FORBIDDEN" };
      if (/revision_conflict|grant_failed:revision_conflict/i.test(error.message)) {
        return { ok: false, code: "CONFLICT", message: error.message };
      }
      if (/already_owner|not_found|invalid_input|revision_required/i.test(error.message)) {
        return { ok: false, code: "INVALID_INPUT", message: error.message };
      }
      return { ok: false, code: "UNAVAILABLE", message: error.message };
    }
    const row = asRecord(data as Json);
    if (!row) return { ok: false, code: "UNAVAILABLE" };
    if (row.ok === true) {
      return {
        ok: true,
        data: {
          revision: Number(row.revision ?? 1),
          createdMembership: Boolean(row.created_membership),
        },
      };
    }
    return { ok: false, code: "UNAVAILABLE", message: String(row.code ?? "") };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function accessSetPlatformRole(input: {
  userId: string;
  role: PlatformAccessRole;
  status: "active" | "disabled";
  expectedRevision: number;
  note?: string;
  reason?: string;
}): Promise<ActionOk<{ revision: number }> | ActionFail> {
  const gate = await requirePlatformAdmin();
  if (!gate.ok) {
    if (gate.code === "UNAUTHENTICATED" || gate.code === "UNVERIFIED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    return { ok: false, code: gate.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FORBIDDEN" };
  }
  if (!Number.isFinite(input.expectedRevision)) {
    return { ok: false, code: "INVALID_INPUT", message: "revision_required" };
  }
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("access_set_platform_role", {
      p_user_id: input.userId,
      p_role: input.role,
      p_status: input.status,
      p_expected_revision: input.expectedRevision,
      p_note: input.note ?? "",
      p_reason: input.reason ?? "",
    });
    if (error) {
      if (isMissingRpc(error.message, "access_set_platform_role")) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "DEPENDENCY_MISSING:access_set_platform_role:20261006120000_vel_access_management_01",
        };
      }
      if (/forbidden|42501/i.test(error.message)) return { ok: false, code: "FORBIDDEN" };
      return { ok: false, code: "UNAVAILABLE", message: error.message };
    }
    const row = asRecord(data as Json);
    if (!row) return { ok: false, code: "UNAVAILABLE" };
    if (row.ok === true) return { ok: true, data: { revision: Number(row.revision ?? 1) } };
    const code = String(row.code ?? "");
    if (code === "revision_conflict") return { ok: false, code: "CONFLICT", message: code };
    if (code === "last_owner" || code === "cannot_demote_self") {
      return { ok: false, code: "FORBIDDEN", message: code };
    }
    if (code === "not_found") return { ok: false, code: "NOT_FOUND" };
    return { ok: false, code: "UNAVAILABLE", message: code };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/**
 * Capability check for the current session.
 * - true / false: authoritative after migration
 * - null: migration RPC missing AND VEL_ACCESS_MIGRATION_COMPAT=1 (legacy membership path only)
 * Missing RPC without compat → false (fail closed). Errors → false. Never invents all_company.
 */
export async function sessionHasCompanyCapability(
  companyId: string,
  capability: CompanyCapability,
): Promise<boolean | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("has_company_capability", {
      p_company_id: companyId,
      p_capability: capability,
    });
    if (error) {
      if (isMissingRpc(error.message, "has_company_capability") && accessMigrationCompatEnabled()) {
        return null;
      }
      return false;
    }
    return data === true;
  } catch {
    return false;
  }
}

/**
 * Conversation scope for the current session.
 * null = deny / unknown (caller must not treat as all_company).
 * Compat-only: missing RPC + VEL_ACCESS_MIGRATION_COMPAT=1 → null for legacy membership path.
 */
export async function sessionConversationScope(
  companyId: string,
): Promise<ConversationScope | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("company_conversation_scope", {
      p_company_id: companyId,
    });
    if (error) {
      if (isMissingRpc(error.message, "company_conversation_scope") && accessMigrationCompatEnabled()) {
        return null;
      }
      return null;
    }
    if (data === "assigned_only") return "assigned_only";
    if (data === "all_company") return "all_company";
    return null;
  } catch {
    return null;
  }
}
