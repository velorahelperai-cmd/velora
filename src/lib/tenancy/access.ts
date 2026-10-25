import { cache } from "react";
import { checkAppSession } from "@/lib/auth/session-guard";
import { authFlowHref } from "@/lib/auth/auth-journey";
import { setupPathForReturn } from "@/lib/auth/setup-return";
import { allowedReturnPath, pathAtOrUnder, safeInternalPath, staffInvitationReturnPath } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/server";
import {masterJourneyEnabled} from '@/lib/master-journey/rollout';
import { readAccountPlatformIdentity, unavailablePlatformIdentity, type AccountPlatformIdentity } from "./account-platform-identity";
import type {
  AccessCode,
  CompanyContext,
  CompanyRecord,
  CompanyRole,
  MembershipRecord,
} from "@/lib/tenancy/types";

export const WORKSPACE_COMPANY_COOKIE = "velora_workspace_company";

export function pickWorkspaceMembership<T extends { company_id: string }>(
  memberships: T[],
  selectedCompanyId: string | null,
  opts?: { requireExplicit?: boolean },
): { ok: true; membership: T } | { ok: false; needsContext: boolean } {
  if (memberships.length === 0) return { ok: false, needsContext: false };
  // Platform admins must pick explicitly — never auto-select the only/first company.
  if (!opts?.requireExplicit && memberships.length === 1) {
    return { ok: true, membership: memberships[0]! };
  }
  const selected = selectedCompanyId?.trim() ?? "";
  const match = memberships.find((row) => row.company_id === selected);
  if (!match) return { ok: false, needsContext: true };
  return { ok: true, membership: match };
}

/** Operational workspace home from membership only — never /admin. */
export function workspaceHomeHref(ctx: CompanyContext): string | null {
  if (ctx.workspaceChoices.length === 0) return null;
  if (ctx.needsCompanyContext) return "/app";
  if (!ctx.company || !ctx.membership) return null;
  if (ctx.membership.role === "staff") return "/app/conversations";
  if (ctx.company.status === "setup") return "/setup";
  return "/app";
}

export type AccountProfileView = {
  /** Persisted display metadata; isPlatformAdmin and RPCs remain authoritative. */
  platformIdentity: AccountPlatformIdentity;
  emailConfirmed?: boolean;
  sessionExpiresAt?: string;
  accessUnavailable?: boolean;
  ownedBusinessCount?: number;
  hasBusinessMemberships?: boolean;
  userId: string;
  fullName: string;
  email: string;
  supportCode: string;
  /** Platform-admin flag — independent of business membership. */
  isPlatformAdmin: boolean;
  /** Active membership role only — never "admin". */
  role: CompanyRole | null;
  companyName: string | null;
  companyId: string | null;
  needsCompanyContext: boolean;
  /** /admin when platform admin; otherwise null. */
  adminHref: string | null;
  /** Membership workspace home; null when the user has no company memberships. */
  workspaceHref: string | null;
  /** Default post-auth landing (admin → /admin unless preferred operational next). */
  workHref: string;
};

export function buildAccountProfileView(
  access: { ok: true; context: CompanyContext },
  platformIdentity: AccountPlatformIdentity = unavailablePlatformIdentity(),
): AccountProfileView {
  const ctx = access.context;
  return {
    platformIdentity,
    ownedBusinessCount:ctx.ownedBusinessCount,
    hasBusinessMemberships:ctx.hasBusinessMemberships,
    userId: ctx.userId,
    fullName: ctx.fullName,
    email: ctx.email,
    supportCode: ctx.supportCode,
    isPlatformAdmin: ctx.isPlatformAdmin,
    role: ctx.membership?.role ?? null,
    companyName: ctx.company?.display_name ?? null,
    companyId: ctx.company?.id ?? null,
    needsCompanyContext: ctx.needsCompanyContext,
    adminHref: ctx.isPlatformAdmin ? "/admin" : null,
    workspaceHref: workspaceHomeHref(ctx),
    workHref: pathForAccess(access),
  };
}

export type AccessResult =
  | { ok: true; context: CompanyContext }
  | { ok: false; code: AccessCode; sessionExpired?: true };

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
    needsCompanyContext: false,
    workspaceChoices: [],
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
  emailConfirmed: boolean;
  isPlatformAdmin: boolean;
  fullName: string;
  supportCode: string;
  needsProfileName: boolean;
};

type LoadAuthFail = {
  ok: false;
  code: "UNAUTHENTICATED" | "UNAVAILABLE";
  sessionExpired?: true;
  supabase?: Awaited<ReturnType<typeof createClient>>;
};

// React cache lasts only for this server render. Actions/handlers outside a
// render still read live authority; no identity survives into another request.
const loadAuth = cache(async (): Promise<LoadAuthOk | LoadAuthFail> => {
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
    // Claims are verified first. These read-only checks are independent;
    // neither can publish access before both identity and session pass.
    const [{ data: userData, error: userError }, sessionGuard] = await Promise.all([
      supabase.auth.getUser(),
      checkAppSession(supabase),
    ]);
    if (userError) return { ok: false, code: "UNAVAILABLE", supabase };
    const user = userData.user;
    if (!user || user.id !== userId) {
      return { ok: false, code: "UNAUTHENTICATED", supabase };
    }

    if(!sessionGuard.ok)return {ok:false,code:sessionGuard.code,...(sessionGuard.expired?{sessionExpired:true as const}:{}),supabase};
    const identityVerified = Boolean(user.email_confirmed_at || user.phone_confirmed_at);
    if (!identityVerified) {
      return { ok: true, supabase, userId, email: user.email ?? "", phone: user.phone ?? "",
        identityVerified: false, emailConfirmed: false, isPlatformAdmin: false, fullName: "", supportCode: "", needsProfileName: true };
    }
    const metaName = String(
      user.user_metadata?.full_name || user.user_metadata?.name || "",
    ).trim();

    const readProfile = () => supabase
      .from("profiles")
      .select("full_name, support_code")
      .eq("user_id", userId)
      .maybeSingle();
    // Both queries stay under the same authenticated client/RLS scope.
    // Bootstrap remains conditional on a confirmed missing persisted profile.
    const [adminResult, profileResult] = await Promise.all([
      supabase.rpc("is_platform_admin"),
      readProfile(),
    ]);
    const { data: adminFlag, error: adminError } = adminResult;
    if (adminError) return { ok: false, code: "UNAVAILABLE", supabase };
    let { data: profile, error: profileError } = profileResult;
    if (profileError) return { ok: false, code: "UNAVAILABLE", supabase };

    if (!profile) {
      // Bootstrap only a confirmed missing profile. Concurrent readers may race;
      // ignoreDuplicates preserves the winner's persisted name, then re-read it.
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
        // Read the persisted result even on a conflict or failed write; never
        // substitute OAuth metadata for an unavailable saved profile.
        break;
      }
      ({ data: profile, error: profileError } = await readProfile());
    }

    if (profileError || !profile) return { ok: false, code: "UNAVAILABLE", supabase };
    const fullName = (profile.full_name || "").trim();
    const supportCode = (profile?.support_code || "").trim();
    const needsProfileName = fullName.length < 2;

    return {
      ok: true,
      supabase,
      userId,
      email: user.email ?? "",
      phone: user.phone ?? "",
      identityVerified,
      emailConfirmed: Boolean(user.email_confirmed_at),
      isPlatformAdmin: Boolean(adminFlag),
      fullName,
      supportCode,
      needsProfileName,
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE", supabase };
  }
});

async function loadWorkspaceChoices(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: MembershipRecord[],
): Promise<CompanyContext["workspaceChoices"]> {
  if (!rows.length) return [];
  const { data,error } = await supabase
    .from("companies")
    .select("id, display_name")
    .in("id", rows.map((row) => row.company_id));
  if(error)throw new Error('WORKSPACE_READ_UNAVAILABLE');
  const names = new Map((data ?? []).map((row) => [row.id, row.display_name]));
  return rows.map((row) => ({
    companyId: row.company_id,
    displayName: names.get(row.company_id) || row.company_id,
    role: row.role,
  }));
}

const loadCompanyAccess = cache(async (): Promise<AccessResult> => {
  try {
    const auth = await loadAuth();
    if (!auth.ok) return { ok: false, code: auth.code, ...(auth.sessionExpired ? { sessionExpired: true as const } : {}) };
    const {
      supabase,
      userId,
      email,
      phone,
      identityVerified,
      emailConfirmed,
      isPlatformAdmin,
      fullName,
      supportCode,
      needsProfileName,
    } = auth;
    if (!identityVerified) return { ok: false, code: "UNVERIFIED" };

    const { data: memberships, error: memberError } = await supabase
      .from("company_members")
      .select("company_id, user_id, role, status, member_name, created_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (memberError) return { ok: false, code: "UNAVAILABLE" };

    const allRows = (memberships ?? []) as MembershipRecord[];
    let rows=allRows;
    const membershipHistory={ownedBusinessCount:allRows.filter(row=>row.role==='owner').length,hasBusinessMemberships:allRows.length>0};
    if(masterJourneyEnabled()&&allRows.length){
      const {data:history,error:historyError}=await supabase.from('companies').select('id,archived_at').in('id',allRows.map(row=>row.company_id));
      if(historyError||!history||history.length!==new Set(allRows.map(row=>row.company_id)).size)return {ok:false,code:'UNAVAILABLE'};
      const activeIds=new Set(history.filter(row=>row.archived_at===null).map(row=>row.id));
      rows=allRows.filter(row=>activeIds.has(row.company_id));
    }
    let selectedCookie: string | null = null;
    // Selection is unused for zero rows or a sole ordinary membership.
    // Admins still choose explicitly; loadAuth retains all session checks.
    if (rows.length > 1 || (rows.length === 1 && isPlatformAdmin)) {
      try {
        const { cookies } = await import("next/headers");
        const { readWorkspaceCompanyForGeneration, resolveBrokerSession } = await import("@/lib/auth/broker");
        const store = await cookies();
        const resolved = await resolveBrokerSession({
          getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
        });
        const generation = resolved.ok ? resolved.boundary.generation : null;
        // Generation-named cookie only - shared-name delayed writes cannot retarget B (C2-R6).
        selectedCookie = readWorkspaceCompanyForGeneration(
          { get: (name) => { const v = store.get(name)?.value; return v ? { value: v } : undefined; } },
          generation,
          userId,
        );
      } catch {
        selectedCookie = null;
      }
    }

    const picked = pickWorkspaceMembership(rows, selectedCookie, {
      requireExplicit: isPlatformAdmin,
    });
    if (!picked.ok) {
      const choices = await loadWorkspaceChoices(supabase, rows);
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
          emailConfirmed,
          isPlatformAdmin,
          needsCompanyContext: picked.needsContext,
          workspaceChoices: choices,
          ...membershipHistory,
        }),
      };
    }

    const member = picked.membership;
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select(
        "*",
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
        emailConfirmed,
        identityVerified,
        isPlatformAdmin,
        company: company as CompanyRecord,
        membership: member,
        needsCompanyContext: false,
        workspaceChoices: rows.length === 1 ? [{
          companyId: member.company_id,
          displayName: company.display_name || member.company_id,
          role: member.role,
        }] : await loadWorkspaceChoices(supabase, rows),
        ...membershipHistory,
      },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
});

export async function getCompanyAccess(requiredRole?: CompanyRole): Promise<AccessResult> {
  const access = await loadCompanyAccess();
  if (access.ok && requiredRole === "owner" && access.context.membership
    && access.context.membership.role !== "owner") return { ok: false, code: "FORBIDDEN" };
  return access;

}

export async function requirePlatformOwner(): Promise<AccessResult> {
  try {
    const auth = await loadAuth();
    if (!auth.ok) return { ok: false, code: auth.code, ...(auth.sessionExpired ? { sessionExpired: true as const } : {}) };
    if (!auth.identityVerified || !auth.emailConfirmed) return { ok: false, code: "UNVERIFIED" };
    const email = (auth.email || "").trim().toLowerCase();
    if (email !== "velorahelperai@gmail.com") return { ok: false, code: "FORBIDDEN" };
    const platform = await readAccountPlatformIdentity(auth.userId);
    if (platform.unavailable) return { ok: false, code: "UNAVAILABLE" };
    if (platform.role !== "owner" || platform.status !== "active") return { ok: false, code: "FORBIDDEN" };
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
        isPlatformAdmin: true,
      }),
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function requirePlatformAdmin(): Promise<AccessResult> {
  return requirePlatformOwner();
}


export async function requireVerifiedUser(): Promise<AccessResult> {
  try {
    const auth = await loadAuth();
    if (!auth.ok) return { ok: false, code: auth.code, ...(auth.sessionExpired ? { sessionExpired: true as const } : {}) };
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
    if (result.code === "UNVERIFIED") return authFlowHref("/verify-email",preferredNext);
    if (result.code === "FORBIDDEN") return "/access?code=FORBIDDEN";
    const preferred = safeInternalPath(preferredNext, "");
    if (result.code === "UNAVAILABLE") return `/access?code=UNAVAILABLE${preferred ? `&next=${encodeURIComponent(preferred)}` : ""}`;
    const login = result.sessionExpired ? "/login?reason=session_expired" : "/login";
    return preferred ? `${login}${result.sessionExpired ? "&" : "?"}next=${encodeURIComponent(preferred)}` : login;
  }
  if (result.context.needsProfileName) return authFlowHref("/complete-profile",preferredNext);
  const invitationReturn = staffInvitationReturnPath(preferredNext);
  if (invitationReturn) return invitationReturn;
  const preferredPath = safeInternalPath(preferredNext, "").split(/[?#]/)[0];
  if (result.context.isPlatformAdmin && result.context.needsCompanyContext
    && (pathAtOrUnder(preferredPath, "/setup") || pathAtOrUnder(preferredPath, "/app"))) {
    return `/app?next=${encodeURIComponent(safeInternalPath(preferredNext, "/app"))}`;
  }
  if (result.context.isPlatformAdmin) {
    if (preferredPath && pathAtOrUnder(preferredPath, "/admin")) {
      const isOwner = result.context.email?.trim().toLowerCase() === "velorahelperai@gmail.com";
      if (!isOwner) {
        return result.context.company ? "/app" : "/access?code=FORBIDDEN";
      }
    }
    return allowedReturnPath(preferredNext, {
      isPlatformAdmin: true,
      hasCompany: Boolean(result.context.company),
      role: result.context.membership?.role ?? null,
    }, "/admin");
  }
  if (result.context.needsCompanyContext) {
    const preferred = safeInternalPath(preferredNext, "");
    const pathOnly = preferred.split(/[?#]/)[0];
    if (pathAtOrUnder(pathOnly, "/account")) return preferred;
    // The existing /app workspace chooser verifies membership on selection.
    // Carry onboarding intent through it without choosing a company implicitly.
    if (preferred && (pathAtOrUnder(pathOnly, "/setup") || pathAtOrUnder(pathOnly, "/app")) && pathOnly !== "/app") {
      return `/app?next=${encodeURIComponent(preferred)}`;
    }
    return preferred && pathOnly === "/app" ? preferred : "/app";
  }
  if (!result.context.company) return setupPathForReturn(preferredNext);
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
    return setupPathForReturn(preferred);
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
