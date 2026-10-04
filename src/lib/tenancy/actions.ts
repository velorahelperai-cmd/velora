"use server";

import { revalidatePath } from "next/cache";
import { authCallbackUrl, siteUrl } from "@/lib/auth/site-url";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess, pathForAccess, requirePlatformAdmin } from "@/lib/tenancy/access";
import type { AccessCode, AdminCompanyListItem, CompanyRecord, CompanyStatus } from "@/lib/tenancy/types";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: AccessCode | "AUTH_ERROR"; message?: string };

export async function signUpWithEmail(input: {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}): Promise<ActionResult<{ needsVerification: boolean; email: string }>> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!name || name.length < 2 || !email || password.length < 8) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  if (password !== input.confirmPassword) {
    return { ok: false, code: "INVALID_INPUT", message: "password_mismatch" };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        // Callback resolves /setup vs /app (or /admin) from real membership state.
        emailRedirectTo: authCallbackUrl("/setup"),
      },
    });
    if (error) {
      return { ok: false, code: "AUTH_ERROR", message: error.message };
    }
    if (data.user?.id) {
      await supabase.from("profiles").upsert(
        { user_id: data.user.id, full_name: name.slice(0, 120) },
        { onConflict: "user_id" },
      );
    }
    const needsVerification = !data.user?.email_confirmed_at && !data.session;
    return { ok: true, data: { needsVerification, email } };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function signInWithEmail(input: {
  email: string;
  password: string;
}): Promise<ActionResult<{ next: string }>> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email || !password) return { ok: false, code: "INVALID_INPUT" };

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      return { ok: false, code: "AUTH_ERROR", message: error.message };
    }
    const access = await getCompanyAccess();
    return { ok: true, data: { next: pathForAccess(access) } };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function resolvePostAuthPath(): Promise<ActionResult<{ next: string }>> {
  try {
    const access = await getCompanyAccess();
    return { ok: true, data: { next: pathForAccess(access) } };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function signOut(): Promise<ActionResult> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function resendVerificationEmail(email: string): Promise<ActionResult> {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned) return { ok: false, code: "INVALID_INPUT" };
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: cleaned,
      options: { emailRedirectTo: authCallbackUrl("/setup") },
    });
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function requestPasswordReset(email: string): Promise<ActionResult> {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned) return { ok: false, code: "INVALID_INPUT" };
  try {
    const supabase = await createClient();
    // Always return a generic success to avoid revealing whether the email exists.
    await supabase.auth.resetPasswordForEmail(cleaned, {
      redirectTo: authCallbackUrl("/reset-password"),
    });
    return { ok: true, data: undefined };
  } catch {
    return { ok: true, data: undefined };
  }
}

export async function updatePassword(password: string): Promise<ActionResult> {
  if (password.length < 8) return { ok: false, code: "INVALID_INPUT" };
  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return { ok: false, code: "UNAUTHENTICATED" };
    // Do not invent passwords for Google-only accounts from the app; only recovery sessions update password.
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function completeProfileName(name: string): Promise<ActionResult<{ next: string }>> {
  const fullName = name.trim();
  if (fullName.length < 2 || fullName.length > 120) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return { ok: false, code: "UNAUTHENTICATED" };
    if (!user.email_confirmed_at && !user.phone_confirmed_at) {
      return { ok: false, code: "UNVERIFIED" };
    }

    const { error } = await supabase.from("profiles").upsert(
      { user_id: user.id, full_name: fullName },
      { onConflict: "user_id" },
    );
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };

    // Keep member_name in sync when membership already exists (no new company).
    await supabase
      .from("company_members")
      .update({ member_name: fullName })
      .eq("user_id", user.id)
      .eq("status", "active");

    const access = await getCompanyAccess();
    return { ok: true, data: { next: pathForAccess(access) } };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function saveOwnerBusiness(input: {
  displayName: string;
  businessType: string;
  replyLanguage: "ar" | "en" | "both";
  country: string;
  city: string;
  hours: string;
  contactPhone: string;
  contactEmail: string;
  memberName?: string;
}): Promise<ActionResult<CompanyRecord>> {
  const access = await getCompanyAccess();
  if (!access.ok) return { ok: false, code: access.code };
  if (access.context.membership && access.context.membership.role !== "owner") {
    return { ok: false, code: "FORBIDDEN" };
  }

  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 120 || !input.hours.trim()) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("upsert_owner_company", {
      p_display_name: displayName,
      p_business_type: input.businessType,
      p_reply_language: input.replyLanguage,
      p_country: input.country,
      p_city: input.city,
      p_hours: input.hours,
      p_contact_phone: input.contactPhone,
      p_contact_email: input.contactEmail,
      p_member_name:
        input.memberName
        ?? access.context.membership?.member_name
        ?? access.context.fullName
        ?? "",
    });
    if (error || !data) {
      return { ok: false, code: "AUTH_ERROR", message: error?.message };
    }
    revalidatePath("/setup");
    revalidatePath("/app");
    revalidatePath("/app/settings");
    return { ok: true, data: data as CompanyRecord };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function adminListCompanies(search = ""): Promise<ActionResult<AdminCompanyListItem[]>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_list_companies", { p_search: search });
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    return { ok: true, data: (data ?? []) as AdminCompanyListItem[] };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function adminGetCompany(companyId: string): Promise<ActionResult<unknown>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_get_company", { p_company_id: companyId });
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    return { ok: true, data };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function adminUpdateCompany(input: {
  companyId: string;
  displayName: string;
  businessType: string;
  replyLanguage: "ar" | "en" | "both";
  country: string;
  city: string;
  hours: string;
  contactPhone: string;
  contactEmail: string;
}): Promise<ActionResult<CompanyRecord>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_update_company", {
      p_company_id: input.companyId,
      p_display_name: input.displayName,
      p_business_type: input.businessType,
      p_reply_language: input.replyLanguage,
      p_country: input.country,
      p_city: input.city,
      p_hours: input.hours,
      p_contact_phone: input.contactPhone,
      p_contact_email: input.contactEmail,
    });
    if (error || !data) return { ok: false, code: "AUTH_ERROR", message: error?.message };
    revalidatePath("/admin");
    revalidatePath(`/admin/companies/${input.companyId}`);
    return { ok: true, data: data as CompanyRecord };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function adminSetCompanyStatus(
  companyId: string,
  status: CompanyStatus,
): Promise<ActionResult<CompanyRecord>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_set_company_status", {
      p_company_id: companyId,
      p_status: status,
    });
    if (error || !data) return { ok: false, code: "AUTH_ERROR", message: error?.message };
    revalidatePath("/admin");
    revalidatePath(`/admin/companies/${companyId}`);
    return { ok: true, data: data as CompanyRecord };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function adminSetMemberStatus(input: {
  companyId: string;
  userId: string;
  status: "active" | "disabled";
  role?: "owner" | "staff";
  memberName?: string;
}): Promise<ActionResult> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  try {
    const supabase = await createClient();
    // Protect owner membership from disable/role changes via admin UI path.
    const { data: member } = await supabase
      .from("company_members")
      .select("role")
      .eq("company_id", input.companyId)
      .eq("user_id", input.userId)
      .maybeSingle();
    if (member?.role === "owner" && (input.status === "disabled" || (input.role && input.role !== "owner"))) {
      return { ok: false, code: "FORBIDDEN" };
    }
    const { error } = await supabase.rpc("admin_set_member_status", {
      p_company_id: input.companyId,
      p_user_id: input.userId,
      p_status: input.status,
      p_role: input.role ?? null,
      p_member_name: input.memberName ?? null,
    });
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    revalidatePath("/admin");
    revalidatePath(`/admin/companies/${input.companyId}`);
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function getPublicSiteUrl(): Promise<string> {
  return siteUrl();
}
