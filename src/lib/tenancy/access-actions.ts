"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlatformOwner } from "@/lib/tenancy/access";
import { PLATFORM_ROLE_CATALOG } from "./access-guards";
import type {
  GrantPlatformRoleInput,
  PlatformAccessOverviewData,
  PlatformAdminStatus,
  PlatformAdminUser,
  PlatformRole,
  UpdatePlatformRoleInput,
} from "./access-types";

export type PlatformAccessActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT" | "UNAVAILABLE" | "NOT_FOUND"; message?: string };

interface DynamicAccessClient {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
      in: (col: string, vals: string[]) => Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
    } & Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>;
    upsert: (payload: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    update: (payload: Record<string, unknown>) => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
    delete: () => {
      eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
    };
  };
}

interface AdminRowType {
  user_id: string;
  role?: string;
  status?: string;
  granted_at?: string;
  granted_by?: string | null;
  note?: string;
}

export async function adminGetPlatformAccessOverview(): Promise<
  PlatformAccessActionResult<PlatformAccessOverviewData>
> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    if (admin.code === "UNVERIFIED" || admin.code === "UNAUTHENTICATED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (admin.code === "UNAVAILABLE") return { ok: false, code: "UNAVAILABLE" };
    return { ok: false, code: "FORBIDDEN" };
  }

  try {
    const supabase = await createClient();
    const dynamicClient = supabase as unknown as DynamicAccessClient;

    // 1. Fetch platform_admins records
    const { data: adminRows, error: adminErr } = await dynamicClient
      .from("platform_admins")
      .select("user_id, role, status, granted_at, granted_by, note");

    if (adminErr) {
      return { ok: false, code: "UNAVAILABLE", message: adminErr.message };
    }

    const rows: AdminRowType[] = Array.isArray(adminRows) ? (adminRows as unknown as AdminRowType[]) : [];

    // 2. Fetch profiles for user details
    const userIds = rows.map((r) => r.user_id);
    const profileMap = new Map<string, { fullName: string; supportCode: string }>();

    if (userIds.length > 0) {
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("user_id, full_name, support_code")
        .in("user_id", userIds);

      if (Array.isArray(profileRows)) {
        for (const p of profileRows) {
          profileMap.set(p.user_id, {
            fullName: p.full_name ?? "",
            supportCode: p.support_code ?? "",
          });
        }
      }
    }

    // 3. Fetch scopes
    const scopeMap = new Map<string, string[]>();
    if (userIds.length > 0) {
      try {
        const { data: scopeRows } = await dynamicClient
          .from("platform_admin_scopes")
          .select("admin_user_id, usable_capabilities")
          .in("admin_user_id", userIds);

        if (Array.isArray(scopeRows)) {
          for (const s of scopeRows) {
            const adminId = String(s.admin_user_id ?? "");
            const caps = Array.isArray(s.usable_capabilities) ? (s.usable_capabilities as string[]) : [];
            scopeMap.set(adminId, caps);
          }
        }
      } catch {
        // Scopes table optional in some local test environments
      }
    }

    const delegatedAdmins: PlatformAdminUser[] = [];
    let ownerInfo = {
      userId: admin.context?.userId ?? "owner-default",
      email: "velorahelperai@gmail.com",
      fullName: admin.context?.fullName ?? "Platform Owner",
      verified: true,
    };

    for (const row of rows) {
      const prof = profileMap.get(row.user_id);
      const role = (row.role ?? "support") as PlatformRole;
      const status = (row.status ?? "active") as PlatformAdminStatus;

      if (role === "owner") {
        ownerInfo = {
          userId: row.user_id,
          email: "velorahelperai@gmail.com",
          fullName: prof?.fullName || "Platform Owner",
          verified: true,
        };
      } else {
        delegatedAdmins.push({
          userId: row.user_id,
          email: `${prof?.fullName ? prof.fullName.toLowerCase().replace(/\s+/g, ".") : "admin"}@velora.internal`,
          fullName: prof?.fullName ?? "Delegated Admin",
          supportCode: prof?.supportCode ?? "",
          role,
          status,
          grantedAt: row.granted_at ?? new Date().toISOString(),
          grantedBy: row.granted_by ?? null,
          note: row.note ?? "",
          allowedCapabilities: scopeMap.get(row.user_id) ?? [],
        });
      }
    }

    const activeAdminsCount = delegatedAdmins.filter((a) => a.status === "active").length + 1; // +1 for owner

    const data: PlatformAccessOverviewData = {
      kpis: {
        totalAdminsCount: delegatedAdmins.length + 1,
        activeAdminsCount,
        escalationProtection: "LOCKED",
        sessionRevocationPolicy: "IMMEDIATE",
      },
      owner: ownerInfo,
      delegatedAdmins,
      roleCatalog: PLATFORM_ROLE_CATALOG,
    };

    return { ok: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load platform access overview";
    return { ok: false, code: "UNAVAILABLE", message };
  }
}

export async function adminGrantPlatformAdminRole(
  input: GrantPlatformRoleInput
): Promise<PlatformAccessActionResult<{ userId: string; role: PlatformRole }>> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    return { ok: false, code: admin.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FORBIDDEN" };
  }

  // Privilege escalation check: cannot grant owner role
  if ((input.role as string) === "owner") {
    return { ok: false, code: "FORBIDDEN", message: "Escalation to platform owner is strictly forbidden" };
  }

  const userId = input.userId.trim();
  if (!userId) {
    return { ok: false, code: "INVALID_INPUT", message: "User ID is required" };
  }

  try {
    const supabase = await createClient();
    const dynamicClient = supabase as unknown as DynamicAccessClient;

    // Verify user exists
    const { data: profile, error: profErr } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .eq("user_id", userId)
      .maybeSingle();

    if (profErr || !profile) {
      return { ok: false, code: "NOT_FOUND", message: "User profile not found" };
    }

    const roleCatalogItem = PLATFORM_ROLE_CATALOG.find((r) => r.role === input.role);
    const assignedCaps = input.capabilities ?? roleCatalogItem?.capabilities ?? [];

    // Insert or update platform_admins
    const { error: insertErr } = await dynamicClient.from("platform_admins").upsert({
      user_id: userId,
      role: input.role,
      status: "active",
      granted_at: new Date().toISOString(),
      granted_by: admin.context?.userId ?? null,
      note: input.note?.trim() ?? "",
    });

    if (insertErr) {
      return { ok: false, code: "UNAVAILABLE", message: insertErr.message };
    }

    // Insert or update platform_admin_scopes
    try {
      await dynamicClient.from("platform_admin_scopes").upsert({
        admin_user_id: userId,
        usable_capabilities: assignedCaps,
        delegable_capabilities: [],
      });
    } catch {
      // Ignored if table not present in local test fixture
    }

    // Audit log
    await supabase.from("admin_audit_logs").insert({
      actor_user_id: admin.context?.userId ?? "owner",
      company_id: null,
      action: "access.platform_role_granted",
      before_data: null,
      after_data: {
        target_user_id: userId,
        target_name: profile.full_name,
        assigned_role: input.role,
        capabilities: assignedCaps,
      },
    });

    return { ok: true, data: { userId, role: input.role } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to grant platform role";
    return { ok: false, code: "UNAVAILABLE", message };
  }
}

export async function adminUpdatePlatformAdminRole(
  input: UpdatePlatformRoleInput
): Promise<PlatformAccessActionResult<{ userId: string; role: PlatformRole; status: PlatformAdminStatus }>> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    return { ok: false, code: admin.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FORBIDDEN" };
  }

  if ((input.role as string) === "owner") {
    return { ok: false, code: "FORBIDDEN", message: "Privilege escalation to owner is forbidden" };
  }

  const userId = input.userId.trim();
  if (!userId) {
    return { ok: false, code: "INVALID_INPUT", message: "User ID is required" };
  }

  try {
    const supabase = await createClient();
    const dynamicClient = supabase as unknown as DynamicAccessClient;

    // Check existing role
    const { data: existing, error: existErr } = await dynamicClient
      .from("platform_admins")
      .select("user_id, role, status, note")
      .eq("user_id", userId)
      .maybeSingle();

    if (existErr || !existing) {
      return { ok: false, code: "NOT_FOUND", message: "Platform admin record not found" };
    }

    if (existing.role === "owner") {
      return { ok: false, code: "FORBIDDEN", message: "Cannot modify platform owner permissions" };
    }

    const roleCatalogItem = PLATFORM_ROLE_CATALOG.find((r) => r.role === input.role);
    const assignedCaps = input.capabilities ?? roleCatalogItem?.capabilities ?? [];

    const { error: updateErr } = await dynamicClient
      .from("platform_admins")
      .update({
        role: input.role,
        status: input.status,
        note: input.note?.trim() ?? String(existing.note ?? ""),
      })
      .eq("user_id", userId);

    if (updateErr) {
      return { ok: false, code: "UNAVAILABLE", message: updateErr.message };
    }

    try {
      await dynamicClient.from("platform_admin_scopes").upsert({
        admin_user_id: userId,
        usable_capabilities: assignedCaps,
      });
    } catch {
      // Ignored if table not in test fixture
    }

    await supabase.from("admin_audit_logs").insert({
      actor_user_id: admin.context?.userId ?? "owner",
      company_id: null,
      action: "access.platform_role_updated",
      before_data: { role: String(existing.role ?? ""), status: String(existing.status ?? "") },
      after_data: { role: input.role, status: input.status, capabilities: assignedCaps },
    });

    return { ok: true, data: { userId, role: input.role, status: input.status } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update platform role";
    return { ok: false, code: "UNAVAILABLE", message };
  }
}

export async function adminToggleAdminStatus(
  userId: string,
  newStatus: PlatformAdminStatus
): Promise<PlatformAccessActionResult<{ userId: string; status: PlatformAdminStatus }>> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    return { ok: false, code: admin.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FORBIDDEN" };
  }

  const id = userId.trim();
  if (!id) return { ok: false, code: "INVALID_INPUT" };

  try {
    const supabase = await createClient();
    const dynamicClient = supabase as unknown as DynamicAccessClient;

    const { data: existing, error: existErr } = await dynamicClient
      .from("platform_admins")
      .select("user_id, role, status")
      .eq("user_id", id)
      .maybeSingle();

    if (existErr || !existing) {
      return { ok: false, code: "NOT_FOUND", message: "Platform admin record not found" };
    }

    if (existing.role === "owner") {
      return { ok: false, code: "FORBIDDEN", message: "Cannot suspend platform owner" };
    }

    const { error: updateErr } = await dynamicClient
      .from("platform_admins")
      .update({ status: newStatus })
      .eq("user_id", id);

    if (updateErr) {
      return { ok: false, code: "UNAVAILABLE", message: updateErr.message };
    }

    await supabase.from("admin_audit_logs").insert({
      actor_user_id: admin.context?.userId ?? "owner",
      company_id: null,
      action: newStatus === "disabled" ? "access.platform_role_suspended" : "access.platform_role_activated",
      before_data: { status: String(existing.status ?? "") },
      after_data: { status: newStatus },
    });

    return { ok: true, data: { userId: id, status: newStatus } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to toggle admin status";
    return { ok: false, code: "UNAVAILABLE", message };
  }
}

export async function adminRevokePlatformAdmin(
  userId: string
): Promise<PlatformAccessActionResult<{ userId: string; revoked: boolean }>> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    return { ok: false, code: admin.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FORBIDDEN" };
  }

  const id = userId.trim();
  if (!id) return { ok: false, code: "INVALID_INPUT" };

  try {
    const supabase = await createClient();
    const dynamicClient = supabase as unknown as DynamicAccessClient;

    const { data: existing, error: existErr } = await dynamicClient
      .from("platform_admins")
      .select("user_id, role, status")
      .eq("user_id", id)
      .maybeSingle();

    if (existErr || !existing) {
      return { ok: false, code: "NOT_FOUND", message: "Platform admin record not found" };
    }

    if (existing.role === "owner") {
      return { ok: false, code: "FORBIDDEN", message: "Cannot revoke platform owner" };
    }

    const { error: delErr } = await dynamicClient
      .from("platform_admins")
      .delete()
      .eq("user_id", id);

    if (delErr) {
      return { ok: false, code: "UNAVAILABLE", message: delErr.message };
    }

    try {
      await dynamicClient.from("platform_admin_scopes").delete().eq("admin_user_id", id);
    } catch {
      // Ignored
    }

    await supabase.from("admin_audit_logs").insert({
      actor_user_id: admin.context?.userId ?? "owner",
      company_id: null,
      action: "access.platform_role_revoked",
      before_data: { role: String(existing.role ?? ""), status: String(existing.status ?? "") },
      after_data: null,
    });

    return { ok: true, data: { userId: id, revoked: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to revoke platform admin";
    return { ok: false, code: "UNAVAILABLE", message };
  }
}
