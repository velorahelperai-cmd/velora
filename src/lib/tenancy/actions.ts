"use server";

import { revalidatePath } from "next/cache";
import { safeInternalPath } from "@/lib/auth/safe-next";
import { authCallbackUrl, siteUrl } from "@/lib/auth/site-url";
import { createClient } from "@/lib/supabase/server";
import { getCompanyAccess, pathForAccess, requirePlatformAdmin } from "@/lib/tenancy/access";
import type {
  AccessCode,
  AdminAccountSearchItem,
  AdminCompanyListItem,
  CompanyRecord,
  CompanyReviewEvent,
  CompanyReviewRequest,
  CompanyRole,
  CompanyStatus,
  ReviewStatus,
} from "@/lib/tenancy/types";

const REVIEW_SELECT =
  "company_id, requested_by, number_ownership, whatsapp_number, readiness_confirmed, requested_at, status, revision, decided_by, decided_at, owner_note";

type ReviewAction = "submit" | "resubmit" | "request_changes" | "approve";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: AccessCode | "AUTH_ERROR"; message?: string; data?: T };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asReviewRequest(value: unknown): CompanyReviewRequest | null {
  if (!isPlainObject(value)) return null;
  const status = value.status;
  const ownership = value.number_ownership;
  if (
    typeof value.company_id !== "string"
    || typeof value.requested_by !== "string"
    || (ownership !== "own" && ownership !== "new")
    || typeof value.whatsapp_number !== "string"
    || typeof value.readiness_confirmed !== "boolean"
    || typeof value.requested_at !== "string"
    || (status !== "pending_review" && status !== "changes_requested" && status !== "approved")
    || typeof value.revision !== "number"
  ) {
    return null;
  }
  return {
    company_id: value.company_id,
    requested_by: value.requested_by,
    requested_by_email: typeof value.requested_by_email === "string" ? value.requested_by_email : null,
    number_ownership: ownership,
    whatsapp_number: value.whatsapp_number,
    readiness_confirmed: value.readiness_confirmed,
    requested_at: value.requested_at,
    status: status as ReviewStatus,
    revision: value.revision,
    decided_by: typeof value.decided_by === "string" ? value.decided_by : null,
    decided_at: typeof value.decided_at === "string" ? value.decided_at : null,
    owner_note: typeof value.owner_note === "string" ? value.owner_note : "",
  };
}

type TransitionPayload = {
  ok?: unknown;
  code?: unknown;
  request?: unknown;
};

async function callTransitionCompanyReview(input: {
  action: ReviewAction;
  companyId: string;
  expectedRevision?: number | null;
  numberOwnership?: "own" | "new" | null;
  whatsappNumber?: string | null;
  ready?: boolean | null;
  ownerNote?: string | null;
}): Promise<ActionResult<CompanyReviewRequest>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("transition_company_review", {
      p_action: input.action,
      p_company_id: input.companyId,
      p_expected_revision: input.expectedRevision ?? null,
      p_number_ownership: input.numberOwnership ?? null,
      p_whatsapp_number: input.whatsappNumber ?? null,
      p_readiness_confirmed: input.ready ?? null,
      p_owner_note: input.ownerNote ?? null,
    });
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };

    const payload = (isPlainObject(data) ? data : null) as TransitionPayload | null;
    if (!payload) return { ok: false, code: "UNAVAILABLE" };

    const request = asReviewRequest(payload.request);
    if (payload.ok === false || payload.code === "CONFLICT") {
      return {
        ok: false,
        code: "CONFLICT",
        message: "CONFLICT",
        data: request ?? undefined,
      };
    }
    if (payload.ok !== true || !request) {
      return { ok: false, code: "UNAVAILABLE" };
    }
    return { ok: true, data: request };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

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
  next?: string | null;
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
    const preferred = input.next != null ? safeInternalPath(input.next, "") : "";
    return { ok: true, data: { next: pathForAccess(access, preferred || null) } };
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

export type AccountProfileView = {
  userId: string;
  fullName: string;
  email: string;
  supportCode: string;
  role: CompanyRole | "admin" | null;
  companyName: string | null;
  companyId: string | null;
  workHref: string;
};

export async function getAccountProfile(): Promise<ActionResult<AccountProfileView>> {
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return { ok: false, code: access.code };
    const ctx = access.context;
    const role: AccountProfileView["role"] = ctx.isPlatformAdmin
      ? "admin"
      : ctx.membership?.role ?? null;
    return {
      ok: true,
      data: {
        userId: ctx.userId,
        fullName: ctx.fullName,
        email: ctx.email,
        supportCode: ctx.supportCode,
        role,
        companyName: ctx.company?.display_name ?? null,
        companyId: ctx.company?.id ?? null,
        workHref: pathForAccess(access),
      },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function updateAccountName(name: string): Promise<ActionResult<AccountProfileView>> {
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

    // Capture prior role/company so optional sync failure cannot invent empty + /setup.
    const prior = await getAccountProfile();
    const priorView = prior.ok ? prior.data : null;

    const { data: saved, error } = await supabase
      .from("profiles")
      .upsert(
        { user_id: user.id, full_name: fullName },
        { onConflict: "user_id" },
      )
      .select("user_id, full_name, support_code")
      .single();
    if (error || !saved) {
      return { ok: false, code: "AUTH_ERROR", message: error?.message };
    }

    try {
      await supabase
        .from("company_members")
        .update({ member_name: saved.full_name })
        .eq("user_id", user.id)
        .eq("status", "active");
    } catch {
      /* membership sync is optional — profiles write already succeeded */
    }

    try {
      revalidatePath("/account");
      revalidatePath("/app");
      revalidatePath("/app/settings");
      revalidatePath("/admin");
      revalidatePath("/setup");
    } catch {
      /* revalidate optional */
    }

    let role: AccountProfileView["role"] = priorView?.role ?? null;
    let companyName: string | null = priorView?.companyName ?? null;
    let companyId: string | null = priorView?.companyId ?? null;
    let workHref = priorView?.workHref ?? "/account";
    try {
      const access = await getCompanyAccess();
      if (access.ok) {
        const ctx = access.context;
        role = ctx.isPlatformAdmin ? "admin" : ctx.membership?.role ?? null;
        companyName = ctx.company?.display_name ?? null;
        companyId = ctx.company?.id ?? null;
        workHref = pathForAccess(access);
      }
    } catch {
      /* keep write success + prior role/company */
    }

    return {
      ok: true,
      data: {
        userId: saved.user_id,
        fullName: saved.full_name,
        email: user.email ?? priorView?.email ?? "",
        supportCode: saved.support_code ?? priorView?.supportCode ?? "",
        role,
        companyName,
        companyId,
        workHref,
      },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

async function requireActiveOwnerCompany() {
  const access = await getCompanyAccess("owner");
  if (!access.ok) return { ok: false as const, code: access.code };
  if (!access.context.company || !access.context.membership) {
    return { ok: false as const, code: "FORBIDDEN" as const };
  }
  if (access.context.membership.status !== "active" || access.context.membership.role !== "owner") {
    return { ok: false as const, code: "FORBIDDEN" as const };
  }
  if (access.context.company.status === "suspended") {
    return { ok: false as const, code: "FORBIDDEN" as const };
  }
  return {
    ok: true as const,
    supabase: await createClient(),
    userId: access.context.userId,
    companyId: access.context.company.id,
  };
}

export async function getCompanyReviewRequest(): Promise<ActionResult<CompanyReviewRequest | null>> {
  const gate = await requireActiveOwnerCompany();
  if (!gate.ok) return { ok: false, code: gate.code };
  try {
    const { data, error } = await gate.supabase
      .from("company_review_requests")
      .select(REVIEW_SELECT)
      .eq("company_id", gate.companyId)
      .maybeSingle();
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    if (!data) return { ok: true, data: null };
    const parsed = asReviewRequest(data);
    if (!parsed) return { ok: false, code: "UNAVAILABLE" };
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function listCompanyReviewEvents(): Promise<ActionResult<CompanyReviewEvent[]>> {
  const gate = await requireActiveOwnerCompany();
  if (!gate.ok) return { ok: false, code: gate.code };
  try {
    const { data, error } = await gate.supabase.rpc("list_owner_company_review_events");
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    const rows = Array.isArray(data) ? data : [];
    const events: CompanyReviewEvent[] = rows.flatMap((row) => {
      if (!isPlainObject(row)) return [];
      if (typeof row.action !== "string" || typeof row.created_at !== "string") return [];
      return [{
        action: row.action,
        revision: typeof row.revision === "number" ? row.revision : 0,
        created_at: row.created_at,
        owner_note: typeof row.owner_note === "string" ? row.owner_note : "",
      }];
    });
    return { ok: true, data: events };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function submitCompanyReviewRequest(input: {
  numberOwnership: "own" | "new";
  whatsappNumber: string;
  ready: boolean;
  expectedRevision?: number;
}): Promise<ActionResult<CompanyReviewRequest>> {
  const gate = await requireActiveOwnerCompany();
  if (!gate.ok) return { ok: false, code: gate.code };
  if (typeof input.whatsappNumber !== "string") return { ok: false, code: "INVALID_INPUT" };
  if (input.ready !== true) return { ok: false, code: "INVALID_INPUT" };
  if (input.numberOwnership !== "own" && input.numberOwnership !== "new") {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const result = await callTransitionCompanyReview({
    action: "submit",
    companyId: gate.companyId,
    numberOwnership: input.numberOwnership,
    whatsappNumber: input.whatsappNumber,
    ready: true,
  });
  if (result.ok) {
    revalidatePath("/setup");
    revalidatePath("/admin");
    revalidatePath(`/admin/companies/${gate.companyId}`);
  }
  return result;
}

export async function resubmitCompanyReviewRequest(input: {
  numberOwnership: "own" | "new";
  whatsappNumber: string;
  ready: boolean;
  expectedRevision?: number;
}): Promise<ActionResult<CompanyReviewRequest>> {
  const gate = await requireActiveOwnerCompany();
  if (!gate.ok) return { ok: false, code: gate.code };
  if (typeof input.expectedRevision !== "number") return { ok: false, code: "INVALID_INPUT" };
  if (input.ready !== true) return { ok: false, code: "INVALID_INPUT" };
  if (input.numberOwnership !== "own" && input.numberOwnership !== "new") {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const result = await callTransitionCompanyReview({
    action: "resubmit",
    companyId: gate.companyId,
    expectedRevision: input.expectedRevision,
    numberOwnership: input.numberOwnership,
    whatsappNumber: input.whatsappNumber,
    ready: true,
  });
  if (result.ok) {
    revalidatePath("/setup");
    revalidatePath("/admin");
    revalidatePath(`/admin/companies/${gate.companyId}`);
  }
  return result;
}

export async function adminRequestReviewChanges(input: unknown): Promise<ActionResult<CompanyReviewRequest>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  if (!isPlainObject(input)) return { ok: false, code: "INVALID_INPUT" };
  if (typeof input.companyId !== "string" || !input.companyId) return { ok: false, code: "INVALID_INPUT" };
  if (typeof input.expectedRevision !== "number" || !Number.isInteger(input.expectedRevision)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const note = typeof input.ownerNote === "string" ? input.ownerNote.trim() : "";
  if (!note || note.length > 2000) return { ok: false, code: "INVALID_INPUT" };

  const result = await callTransitionCompanyReview({
    action: "request_changes",
    companyId: input.companyId,
    expectedRevision: input.expectedRevision,
    ownerNote: note,
  });
  if (result.ok) {
    revalidatePath("/setup");
    revalidatePath("/admin");
    revalidatePath(`/admin/companies/${input.companyId}`);
  }
  return result;
}

export async function adminApproveSetupReview(input: unknown): Promise<ActionResult<CompanyReviewRequest>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  if (!isPlainObject(input)) return { ok: false, code: "INVALID_INPUT" };
  if (typeof input.companyId !== "string" || !input.companyId) return { ok: false, code: "INVALID_INPUT" };
  if (typeof input.expectedRevision !== "number" || !Number.isInteger(input.expectedRevision)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const note = typeof input.ownerNote === "string" ? input.ownerNote.trim() : "";
  if (note.length > 2000) return { ok: false, code: "INVALID_INPUT" };

  const result = await callTransitionCompanyReview({
    action: "approve",
    companyId: input.companyId,
    expectedRevision: input.expectedRevision,
    ownerNote: note,
  });
  if (result.ok) {
    revalidatePath("/setup");
    revalidatePath("/admin");
    revalidatePath(`/admin/companies/${input.companyId}`);
  }
  return result;
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

export async function adminSearchAccounts(input: {
  query?: string;
  limit?: number;
  offset?: number;
}): Promise<ActionResult<AdminAccountSearchItem[]>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  const query = (input.query ?? "").trim().slice(0, 120);
  const limit = Math.max(1, Math.min(Number(input.limit) || 20, 50));
  const offset = Math.max(0, Math.min(Number(input.offset) || 0, 5000));
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_search_accounts", {
      p_query: query,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) {
      if (/rate_limited/i.test(error.message || "")) {
        return { ok: false, code: "INVALID_INPUT", message: "rate_limited" };
      }
      return { ok: false, code: "AUTH_ERROR", message: error.message };
    }
    const rows = (data ?? []).map((row) => {
      const companiesRaw = row.companies;
      const companies = Array.isArray(companiesRaw)
        ? companiesRaw.flatMap((item) => {
          if (!isPlainObject(item)) return [];
          if (typeof item.company_id !== "string" || typeof item.display_name !== "string") return [];
          if (item.role !== "owner" && item.role !== "staff") return [];
          if (item.status !== "active" && item.status !== "disabled") return [];
          return [{
            company_id: item.company_id,
            display_name: item.display_name,
            role: item.role as CompanyRole,
            status: item.status as "active" | "disabled",
            business_phone: typeof item.business_phone === "string" ? item.business_phone : null,
          }];
        })
        : [];
      return {
        user_id: row.user_id,
        support_code: row.support_code,
        full_name: row.full_name,
        email: row.email,
        account_phone: row.account_phone,
        companies,
      } satisfies AdminAccountSearchItem;
    });
    return { ok: true, data: rows };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export type AdminCompanyConversationsView = {
  companyId: string;
  companyName: string;
  reviewWhatsappNumber: string | null;
  selectedPhoneNumberId: string | null;
  phoneIdentities: string[];
  linkProvisioned: boolean;
  sendReceiveVerified: boolean;
  total: number;
  limit: number;
  offset: number;
  messageLimit: number;
  messageOffset: number;
  conversations: Array<{
    id: string;
    customerName: string;
    customerWaId: string;
    phoneNumberId: string;
    lastMessageAt: string;
    messageTotal: number;
    messages: Array<{
      id: string;
      body: string;
      sender: string;
      direction: string;
      receivedAt: string;
    }>;
  }>;
};

export async function adminListCompanyConversations(input: {
  companyId: string;
  phoneNumberId?: string | null;
  limit?: number;
  offset?: number;
  messageLimit?: number;
  messageOffset?: number;
}): Promise<ActionResult<AdminCompanyConversationsView>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  if (!input.companyId || typeof input.companyId !== "string") {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const limit = Math.max(1, Math.min(Number(input.limit) || 20, 50));
  const offset = Math.max(0, Math.min(Number(input.offset) || 0, 5000));
  const messageLimit = Math.max(1, Math.min(Number(input.messageLimit) || 50, 100));
  const messageOffset = Math.max(0, Math.min(Number(input.messageOffset) || 0, 5000));
  const phoneNumberId = typeof input.phoneNumberId === "string" && input.phoneNumberId.trim()
    ? input.phoneNumberId.trim()
    : null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_list_company_conversations", {
      p_company_id: input.companyId,
      p_phone_number_id: phoneNumberId,
      p_limit: limit,
      p_offset: offset,
      p_message_limit: messageLimit,
      p_message_offset: messageOffset,
    });
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    if (!isPlainObject(data) || data.ok !== true) {
      const code = isPlainObject(data) && data.code === "INVALID_PHONE" ? "INVALID_INPUT" : "FORBIDDEN";
      return { ok: false, code, message: isPlainObject(data) ? String(data.code ?? "not_found") : "not_found" };
    }
    const convs = Array.isArray(data.conversations) ? data.conversations : [];
    const identitiesRaw = Array.isArray(data.phone_identities) ? data.phone_identities : [];
    const phoneIdentities = identitiesRaw.flatMap((item) => {
      if (!isPlainObject(item) || typeof item.phone_number_id !== "string") return [];
      return [item.phone_number_id];
    });
    return {
      ok: true,
      data: {
        companyId: String(data.company_id ?? input.companyId),
        companyName: String(data.company_name ?? ""),
        reviewWhatsappNumber:
          typeof data.review_whatsapp_number === "string" ? data.review_whatsapp_number : null,
        selectedPhoneNumberId:
          typeof data.selected_phone_number_id === "string" ? data.selected_phone_number_id : null,
        phoneIdentities,
        linkProvisioned: data.link_provisioned === true,
        sendReceiveVerified: data.send_receive_verified === true,
        total: typeof data.total === "number" ? data.total : convs.length,
        limit: typeof data.limit === "number" ? data.limit : limit,
        offset: typeof data.offset === "number" ? data.offset : offset,
        messageLimit: typeof data.message_limit === "number" ? data.message_limit : messageLimit,
        messageOffset: typeof data.message_offset === "number" ? data.message_offset : messageOffset,
        conversations: convs.flatMap((c) => {
          if (!isPlainObject(c) || typeof c.id !== "string") return [];
          const messages = Array.isArray(c.messages) ? c.messages : [];
          return [{
            id: c.id,
            customerName: typeof c.customer_name === "string" ? c.customer_name : "",
            customerWaId: typeof c.customer_wa_id === "string" ? c.customer_wa_id : "",
            phoneNumberId: typeof c.phone_number_id === "string" ? c.phone_number_id : "",
            lastMessageAt: typeof c.last_message_at === "string" ? c.last_message_at : "",
            messageTotal: typeof c.message_total === "number" ? c.message_total : messages.length,
            messages: messages.flatMap((m) => {
              if (!isPlainObject(m) || typeof m.id !== "string") return [];
              return [{
                id: m.id,
                body: typeof m.body === "string" ? m.body : "",
                sender: typeof m.sender === "string" ? m.sender : "",
                direction: typeof m.direction === "string" ? m.direction : "",
                receivedAt: typeof m.received_at === "string" ? m.received_at : "",
              }];
            }),
          }];
        }),
      },
    };
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
