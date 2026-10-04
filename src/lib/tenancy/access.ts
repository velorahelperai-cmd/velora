import { createClient } from "@/lib/supabase/server";
import type {
  AccessCode,
  CompanyContext,
  CompanyRecord,
  CompanyRole,
  MembershipRecord,
} from "@/lib/tenancy/types";

export type AccessResult =
  | { ok: true; context: CompanyContext }
  | { ok: false; code: AccessCode };

async function loadAuth() {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData?.claims?.sub) {
    return {
      supabase,
      userId: null as string | null,
      email: "",
      phone: "",
      identityVerified: false,
      isPlatformAdmin: false,
    };
  }
  const userId = String(claimsData.claims.sub);
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user || user.id !== userId) {
    return {
      supabase,
      userId: null,
      email: "",
      phone: "",
      identityVerified: false,
      isPlatformAdmin: false,
    };
  }

  const identityVerified = Boolean(user.email_confirmed_at || user.phone_confirmed_at);
  const { data: adminFlag } = await supabase.rpc("is_platform_admin");

  return {
    supabase,
    userId,
    email: user.email ?? "",
    phone: user.phone ?? "",
    identityVerified,
    isPlatformAdmin: Boolean(adminFlag),
  };
}

export async function getCompanyAccess(
  requiredRole?: CompanyRole,
): Promise<AccessResult> {
  try {
    const { supabase, userId, email, phone, identityVerified, isPlatformAdmin } = await loadAuth();
    if (!userId) return { ok: false, code: "UNAUTHENTICATED" };
    if (!identityVerified) return { ok: false, code: "UNVERIFIED" };

    const { data: membership, error: memberError } = await supabase
      .from("company_members")
      .select("company_id, user_id, role, status, member_name, created_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (memberError) return { ok: false, code: "UNAVAILABLE" };

    if (!membership) {
      return {
        ok: true,
        context: {
          userId,
          email,
          phone,
          emailConfirmed: identityVerified,
          identityVerified,
          isPlatformAdmin,
          company: null,
          membership: null,
        },
      };
    }

    const member = membership as MembershipRecord;
    if (requiredRole === "owner" && member.role !== "owner") {
      return { ok: false, code: "FORBIDDEN" };
    }

    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select(
        "id, display_name, status, business_type, reply_language, country, city, hours, contact_phone, contact_email, created_by, created_at, updated_at",
      )
      .eq("id", member.company_id)
      .maybeSingle();

    if (companyError) return { ok: false, code: "UNAVAILABLE" };
    if (!company) return { ok: false, code: "FORBIDDEN" };

    return {
      ok: true,
      context: {
        userId,
        email,
        phone,
        emailConfirmed: identityVerified,
        identityVerified,
        isPlatformAdmin,
        company: company as CompanyRecord,
        membership: member,
      },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function requirePlatformAdmin(): Promise<AccessResult> {
  const access = await getCompanyAccess();
  if (!access.ok) return access;
  if (!access.context.isPlatformAdmin) return { ok: false, code: "FORBIDDEN" };
  return access;
}

export async function requireVerifiedUser(): Promise<AccessResult> {
  try {
    const { userId, email, phone, identityVerified, isPlatformAdmin } = await loadAuth();
    if (!userId) return { ok: false, code: "UNAUTHENTICATED" };
    if (!identityVerified) return { ok: false, code: "UNVERIFIED" };
    return {
      ok: true,
      context: {
        userId,
        email,
        phone,
        emailConfirmed: identityVerified,
        identityVerified,
        isPlatformAdmin,
        company: null,
        membership: null,
      },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export function pathForAccess(result: AccessResult): string {
  if (!result.ok) {
    if (result.code === "UNVERIFIED") return "/verify-email";
    return "/login";
  }
  if (result.context.isPlatformAdmin) return "/admin";
  if (!result.context.company) return "/setup";
  if (result.context.membership?.role === "staff") return "/app/conversations";
  if (result.context.company.status === "setup") return "/setup";
  return "/app";
}
