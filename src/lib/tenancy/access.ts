import { allowedReturnPath, pathAtOrUnder, safeInternalPath } from "@/lib/auth/safe-next";
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

function emptyContext(
  partial: Partial<CompanyContext> & Pick<CompanyContext, "userId" | "email" | "phone" | "identityVerified" | "isPlatformAdmin">,
): CompanyContext {
  return {
    fullName: "",
    supportCode: partial.supportCode ?? "",
    needsProfileName: true,
    emailConfirmed: partial.identityVerified,
    company: null,
    membership: null,
    ...partial,
  };
}

type LoadAuthOk = {
  ok: true;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string;
  phone: string;
  identityVerified: boolean;
  isPlatformAdmin: boolean;
  fullName: string;
  supportCode: string;
  needsProfileName: boolean;
};

type LoadAuthFail = {
  ok: false;
  code: "UNAUTHENTICATED" | "UNAVAILABLE";
  supabase?: Awaited<ReturnType<typeof createClient>>;
};

async function loadAuth(): Promise<LoadAuthOk | LoadAuthFail> {
  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }

  try {
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError) return { ok: false, code: "UNAVAILABLE", supabase };
    if (!claimsData?.claims?.sub) return { ok: false, code: "UNAUTHENTICATED", supabase };

    const userId = String(claimsData.claims.sub);
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) return { ok: false, code: "UNAVAILABLE", supabase };
    const user = userData.user;
    if (!user || user.id !== userId) {
      return { ok: false, code: "UNAUTHENTICATED", supabase };
    }

    const identityVerified = Boolean(user.email_confirmed_at || user.phone_confirmed_at);
    const { data: adminFlag, error: adminError } = await supabase.rpc("is_platform_admin");
    if (adminError) return { ok: false, code: "UNAVAILABLE", supabase };

    const metaName = String(
      user.user_metadata?.full_name || user.user_metadata?.name || "",
    ).trim();

    // Profile bootstrap: retry only support_code unique collisions; do not swallow other 23505.
    for (let attempt = 0; attempt < 4; attempt++) {
      const { error: upsertError } = await supabase.from("profiles").upsert(
        { user_id: userId, full_name: metaName.slice(0, 120) },
        { onConflict: "user_id", ignoreDuplicates: true },
      );
      if (!upsertError) break;
      const msg = upsertError.message || "";
      const isSupportCodeClash =
        upsertError.code === "23505"
        && /support_code/i.test(msg);
      if (isSupportCodeClash && attempt < 3) continue;
      if (upsertError.code === "23505") {
        // user_id (or other) conflict — profile should already exist; continue to select.
        break;
      }
      // Non-unique errors: leave select to surface empty profile; do not invent guest.
      break;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, support_code")
      .eq("user_id", userId)
      .maybeSingle();

    const fullName = (profile?.full_name || metaName || "").trim();
    const supportCode = (profile?.support_code || "").trim();
    const needsProfileName = fullName.length < 2;

    return {
      ok: true,
      supabase,
      userId,
      email: user.email ?? "",
      phone: user.phone ?? "",
      identityVerified,
      isPlatformAdmin: Boolean(adminFlag),
      fullName,
      supportCode,
      needsProfileName,
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE", supabase };
  }
}

export async function getCompanyAccess(
  requiredRole?: CompanyRole,
): Promise<AccessResult> {
  try {
    const auth = await loadAuth();
    if (!auth.ok) return { ok: false, code: auth.code };
    const {
      supabase,
      userId,
      email,
      phone,
      identityVerified,
      isPlatformAdmin,
      fullName,
      supportCode,
      needsProfileName,
    } = auth;
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
        context: emptyContext({
          userId,
          email,
          phone,
          fullName,
          supportCode,
          needsProfileName,
          identityVerified,
          isPlatformAdmin,
        }),
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
        fullName: fullName || member.member_name || "",
        supportCode,
        needsProfileName: (fullName || member.member_name || "").trim().length < 2,
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
    const auth = await loadAuth();
    if (!auth.ok) return { ok: false, code: auth.code };
    if (!auth.identityVerified) return { ok: false, code: "UNVERIFIED" };
    return {
      ok: true,
      context: emptyContext({
        userId: auth.userId,
        email: auth.email,
        phone: auth.phone,
        fullName: auth.fullName,
        supportCode: auth.supportCode,
        needsProfileName: auth.needsProfileName,
        identityVerified: auth.identityVerified,
        isPlatformAdmin: auth.isPlatformAdmin,
      }),
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/**
 * Post-auth destination. Priority: confirmation → profile → setup → role home.
 * FORBIDDEN / UNAVAILABLE are never treated as a missing session.
 */
export function pathForAccess(
  result: AccessResult,
  preferredNext?: string | null,
): string {
  if (!result.ok) {
    if (result.code === "UNVERIFIED") return "/verify-email";
    if (result.code === "FORBIDDEN") return "/access?code=FORBIDDEN";
    if (result.code === "UNAVAILABLE") return "/access?code=UNAVAILABLE";
    return "/login";
  }
  if (result.context.needsProfileName) return "/complete-profile";
  if (result.context.isPlatformAdmin) {
    return allowedReturnPath(preferredNext, {
      isPlatformAdmin: true,
      hasCompany: Boolean(result.context.company),
      role: result.context.membership?.role ?? null,
    }, "/admin");
  }
  if (!result.context.company) return "/setup";
  if (result.context.membership?.role === "staff") {
    return allowedReturnPath(preferredNext, {
      isPlatformAdmin: false,
      hasCompany: true,
      role: "staff",
    }, "/app/conversations");
  }
  if (result.context.company.status === "setup") {
    // Setup companies must not skip provisioning via next=/app — /account remains allowed.
    const preferred = allowedReturnPath(preferredNext, {
      isPlatformAdmin: false,
      hasCompany: true,
      role: "owner",
    }, "");
    const pathOnly = preferred ? preferred.split(/[?#]/)[0]! : "";
    if (preferred && pathAtOrUnder(pathOnly, "/account")) {
      return preferred;
    }
    return "/setup";
  }
  return allowedReturnPath(preferredNext, {
    isPlatformAdmin: false,
    hasCompany: true,
    role: "owner",
  }, "/app");
}

export function loginPathForReturn(pathname: string, search = ""): string {
  const raw = `${pathname}${search || ""}`;
  const next = safeInternalPath(raw, "");
  if (!next) return "/login";
  return `/login?next=${encodeURIComponent(next)}`;
}
