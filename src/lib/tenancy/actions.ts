"use server";
import {masterJourneyEnabled} from '@/lib/master-journey/rollout';
import { normalizeBusinessEmail, normalizeBusinessPhone } from "@/lib/tenancy/business-contacts";
import { withAuthDiagnostic } from "@/lib/diagnostics/server-flow";
import { beginDiagnostic } from "@/lib/diagnostics/flow";
import type { DiagnosticDetail, DiagnosticStage } from "@/lib/diagnostics/contract";
import {readCompanyBillingDisplay} from "@/lib/billing/wiring/display-read";
import { readSessionIdentity } from "@/lib/auth/server-identity";
import { readAccountPlatformIdentity, unavailablePlatformIdentity } from "./account-platform-identity";
import { AUTH_RETURN_COOKIE, authFlowHref } from "@/lib/auth/auth-journey";
import { pathAtOrUnder, safeInternalPath } from "@/lib/auth/safe-next";
import { emailVerificationError, emailVerificationRetryAfterSeconds, normalizeEmailCode } from "@/lib/auth/email-code";

import { revalidatePath } from "next/cache";

import { siteUrl } from "@/lib/auth/site-url";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { prepareReviewProof, reviewStorageReader, KNOWLEDGE_BUCKET, type ReviewRpc } from "@/lib/tenancy/review-proof";
import { listKnowledgeSources } from "@/lib/knowledge/actions";
import {
  buildAccountProfileView,
  getCompanyAccess,
  pathForAccess,
  requirePlatformAdmin,
  type AccountProfileView,
  WORKSPACE_COMPANY_COOKIE,
} from "@/lib/tenancy/access";
import { ADMIN_ACCOUNT_JOURNEY_DEPENDENCY } from "@/lib/tenancy/admin-account-deps";
import { ADMIN_CONVERSATIONS_RPC_DEPENDENCY } from "@/lib/tenancy/admin-deps";
import {
  buildCustomerReadiness,
  type CustomerReadinessSnapshot,
} from "@/lib/tenancy/customer-readiness";
import type {
  AccessCode,
  AdminAccountSearchItem,
  AdminAccountSearchPage,
  AdminCompanyListItem,
  AdminCompanyListPage,
  AdminOverviewStats,
  CompanyRecord,
  CompanyReviewEvent,
  CompanyReviewRequest,
  CompanyRole,
  CompanyStatus,
  ReviewStatus,
} from "@/lib/tenancy/types";
import { ADMIN_ACCOUNT_SEARCH_MAX_OFFSET, ADMIN_COMPANIES_PAGE_DEFAULT_LIMIT, ADMIN_COMPANIES_PAGE_MAX_LIMIT, ADMIN_COMPANIES_PAGE_MIN_LIMIT, normalizeAdminAccountQuery } from "@/lib/tenancy/types";
import { getWhatsappCompanyLink } from "@/lib/whatsapp/connection-actions";
import { whatsappLiveOpsReady } from "@/lib/whatsapp/config";

export type { AccountProfileView };

type ReviewAction = "submit" | "resubmit" | "request_changes" | "approve";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; diagnostic?: DiagnosticDetail }
  | { ok: false; sessionExpired?:boolean; code: AccessCode | "AUTH_ERROR"; message?: string; data?: T; diagnostic?: DiagnosticDetail };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** A rendered company is an expectation; authorization still comes from current access. */
function renderedCompanyError(expected: unknown, companyId: string | null, allowNoCompany = false):
  { ok: false; code: "INVALID_INPUT" | "FORBIDDEN"; message: string } | null {
  if (!(expected === null && allowNoCompany)
    && (typeof expected !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expected))) {
    return { ok: false, code: "INVALID_INPUT", message: "invalid_company" };
  }
  return expected === companyId ? null : { ok: false, code: "FORBIDDEN", message: "workspace_changed" };
}

function asReviewRequest(value: unknown): CompanyReviewRequest | null {
  if (!isPlainObject(value)) return null;
  const status = value.status;
  const ownership = value.number_ownership;
  if (
    typeof value.company_id !== "string"
    || typeof value.requested_by !== "string"
    || (ownership !== "own" && ownership !== "new" && ownership !== "not_applicable")
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
    proof_current: value.proof_current === true,
    proof_checked_at: typeof value.proof_checked_at === "string" ? value.proof_checked_at : null,
    submitted_manifest_sha256: typeof value.submitted_manifest_sha256 === "string" ? value.submitted_manifest_sha256 : null,
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
  numberOwnership?: "own" | "new" | "not_applicable" | null;
  whatsappNumber?: string | null;
  ready?: boolean | null;
  ownerNote?: string | null;
}): Promise<ActionResult<CompanyReviewRequest>> {
  try {
    const supabase = await createClient();
    if (input.action !== "request_changes") {
      const admin = createAdminClient();
      const proof = await prepareReviewProof(supabase as unknown as ReviewRpc, admin as unknown as ReviewRpc | null,
        { ...input, action: input.action }, admin ? reviewStorageReader(admin.storage.from(KNOWLEDGE_BUCKET), { client: supabase, companyId: input.companyId, action: input.action }) : undefined);
      if (!proof.ok) return {
        ok: false, code: proof.code === "CONFLICT" ? "CONFLICT" : "UNAVAILABLE", message: proof.code,
        data: asReviewRequest(proof.request) ?? undefined,
      };
    }
    const { data, error } = await supabase.rpc("transition_company_review", {
      p_action: input.action,
      p_company_id: input.companyId,
      p_expected_revision: input.expectedRevision ?? null,
      p_number_ownership: input.numberOwnership ?? null,
      p_whatsapp_number: input.whatsappNumber ?? null,
      p_readiness_confirmed: input.ready ?? null,
      p_owner_note: input.ownerNote ?? null,
    });
    if (error) return { ok: false, code: "AUTH_ERROR", message: "review_authorization_failed" };

    const payload = (isPlainObject(data) ? data : null) as TransitionPayload | null;
    if (!payload) return { ok: false, code: "UNAVAILABLE" };

    const request = asReviewRequest(payload.request);
    if (payload.code === "CONFLICT") {
      return {
        ok: false,
        code: "CONFLICT",
        message: "CONFLICT",
        data: request ?? undefined,
      };
    }
    if (payload.ok === false) return { ok: false, code: "UNAVAILABLE", message: "PROOF_REQUIRED" };
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
  next?: string | null;
  requestNonce?: string | null;
  correlation?: unknown;
}): Promise<ActionResult<{ needsVerification: boolean; email: string; profilePending?: true }>> {
  return withAuthDiagnostic<Awaited<ReturnType<typeof signUpWithEmail>>>("auth_signup", input?.correlation, async (trace) => {
  let providerAttempted = false;

  trace.stage("input");
  if (!input || typeof input !== "object" || Array.isArray(input)
    || typeof input.name !== "string" || typeof input.email !== "string"
    || typeof input.password !== "string" || typeof input.confirmPassword !== "string"
    || (input.next != null && typeof input.next !== "string")) {
    return { ok: false, code: "INVALID_INPUT", diagnostic: trace.finish("INVALID_INPUT") };
  }
  const name = input.name.trim();
  if(!input||typeof input.email!=="string"||typeof input.password!=="string")return {ok:false,code:"INVALID_INPUT",diagnostic:trace.finish("INVALID_INPUT")};
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (name.length < 2 || name.length > 120 || email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8) {
    return { ok: false, code: "INVALID_INPUT", diagnostic: trace.finish("INVALID_INPUT") };
  }
  if (password !== input.confirmPassword) {
    return { ok: false, code: "INVALID_INPUT", message: "password_mismatch", diagnostic: trace.finish("INVALID_INPUT") };
  }

  try {
    trace.stage("session");
    const { admitNativeSession } = await import("@/lib/auth/broker");
    const { claimProviderAttempt } = await import("@/lib/auth/broker/registry");
    const requestNonce =
      typeof input.requestNonce === "string" && input.requestNonce.length >= 16
        ? input.requestNonce
        : null;
    if (!requestNonce) return { ok: false, code: "UNAVAILABLE", diagnostic: trace.finish("UNAVAILABLE") };
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const writer = {
      set(name: string, value: string, options?: Record<string, unknown>) {
        cookieStore.set(name, value, options as never);
      },
    };
    const reader = {
      getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
    };
    const { prepareEmailConfirmation } = await import("@/lib/auth/broker/email-confirmation");
    const prepared = await prepareEmailConfirmation({ purpose: "signup_email", requestNonce, next: input.next, reader, writer });
    if (!prepared.ok) return { ok: false, code: "UNAVAILABLE", diagnostic: trace.finish("UNAVAILABLE") };
    const { bundle, intent, lineageCtx, emailRedirectTo } = prepared;
    const { classifyProviderAuthFailure, actionCodeForProviderFailure } = await import(
      "@/lib/auth/provider-transport"
    );
    const supabase = bundle.client;
    let providerSession: import("@supabase/supabase-js").Session | null = null;
    try {
    trace.stage("provider");
    providerAttempted = true;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo,
      },
    });
    if (data.session) providerSession = data.session;
    if (error && error.code !== "user_already_exists" && error.code !== "email_exists") {
      const kind = classifyProviderAuthFailure(error);
      const code = actionCodeForProviderFailure(kind);
      return { ok: false, code, diagnostic: trace.finish(kind === "unknown_transport" ? "OUTCOME_UNKNOWN" : code) };
    }
    // Existing-user responses may be obfuscated. Only an actual matching,
    // confirmed session permits a client-scoped profile write.
    const userConfirmed = Boolean(data.user?.email_confirmed_at);
    const sessionMatchesUser = Boolean(data.session) && data.session?.user.id === data.user?.id;
    const confirmedSession = !error && userConfirmed && sessionMatchesUser;
    // Unconfirmed signup may still return a provider session. Never admit it;
    // clear it and continue as verification-required (C01), not AUTH_ERROR.
    if (!error && data.session && !confirmedSession) {
      const { signOutProviderSessionAfterAdmitFailure } = await import(
        "@/lib/auth/broker/provider-session"
      );
      const cleanup = await signOutProviderSessionAfterAdmitFailure(bundle, data.session, {
        intentId: intent.id,
        operationKey: intent.id,
      });
      providerSession = null;
      if (cleanup.outcome !== "confirmed" || !cleanup.durable) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "PROVIDER_CLEANUP_UNKNOWN",
          diagnostic: trace.finish("OUTCOME_UNKNOWN"),
        };
      }
      if (userConfirmed) {
        return { ok: false, code: "AUTH_ERROR", diagnostic: trace.finish("AUTH_ERROR") };
      }
    }
    if (confirmedSession && data.session) {
      const claim = await claimProviderAttempt(intent.id);
      const admitted = claim.ok && claim.claimed === true ? await admitNativeSession({
        session: data.session,
        writer,
        reader,
        authIntentId: intent.id,
        browserLineageId: intent.browserLineageId,
        bootstrapHash: lineageCtx.bootstrapHash,
      }) : { ok: false as const };
      if (!admitted.ok) {
        const { signOutProviderSessionAfterAdmitFailure } = await import(
          "@/lib/auth/broker/provider-session"
        );
        const cleanup = await signOutProviderSessionAfterAdmitFailure(bundle, data.session, {
          intentId: intent.id,
          operationKey: intent.id,
        });
        providerSession = null;
        if (cleanup.outcome !== "confirmed" || !cleanup.durable) {
          return {
            ok: false,
            code: "UNAVAILABLE",
            message: "PROVIDER_CLEANUP_UNKNOWN",
            diagnostic: trace.finish("OUTCOME_UNKNOWN"),
          };
        }
        return { ok: false, code: "UNAVAILABLE", diagnostic: trace.finish("UNAVAILABLE") };
      }
      providerSession = null;
    }
    let warning: DiagnosticDetail | undefined;
    if (confirmedSession && data.user) {
      trace.stage("profile");
      try {
        const bound = await createClient();
        const { error: profileError } = await bound.from("profiles").upsert(
          { user_id: data.user.id, full_name: name.slice(0, 120) },
          { onConflict: "user_id", ignoreDuplicates: true },
        );
        if (profileError) warning = trace.finish("UNAVAILABLE");
      } catch { warning = trace.finish("UNAVAILABLE"); }
    }
    const returnTo=safeInternalPath(input.next,"");
    if(returnTo){cookieStore.set(AUTH_RETURN_COOKIE,returnTo,{httpOnly:true,sameSite:"lax",path:"/",secure:process.env.NODE_ENV==="production",maxAge:7200});}
    const needsVerification = !confirmedSession;
    if (!warning) trace.finish("OK");
    // Auth already succeeded. A persistence outage must resume this same user
    // through loadAuth's idempotent bootstrap, never ask for a second signup.
    return { ok: true, data: { needsVerification, email, ...(warning ? { profilePending: true as const } : {}) }, ...(warning ? { diagnostic: warning } : {}) };
    } catch (err) {
      if (providerSession) {
        const { signOutProviderSessionAfterAdmitFailure } = await import(
          "@/lib/auth/broker/provider-session"
        );
        await signOutProviderSessionAfterAdmitFailure(bundle, providerSession, {
          intentId: intent.id,
          operationKey: intent.id,
        });
      }
      void err;
      return { ok: false, code: "UNAVAILABLE", diagnostic: trace.finish("OUTCOME_UNKNOWN") };
    }
  } catch {
    return { ok: false, code: "UNAVAILABLE", diagnostic: trace.finish(providerAttempted ? "OUTCOME_UNKNOWN" : "UNAVAILABLE") };
  }

  });
}

export async function signInWithEmail(input: {
  email: string;
  password: string;
  next?: string | null;
  requestNonce?: string | null;
  correlation?: unknown;
}): Promise<ActionResult<{ next: string }>> {
  return withAuthDiagnostic<Awaited<ReturnType<typeof signInWithEmail>>>("auth_login", input?.correlation, async (trace) => {

  let providerAttempted = false;
  trace.stage("input");
  if(!input||typeof input.email!=="string"||typeof input.password!=="string")return {ok:false,code:"INVALID_INPUT",diagnostic:trace.finish("INVALID_INPUT")};
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password) return { ok: false, code: "INVALID_INPUT", diagnostic: trace.finish("INVALID_INPUT") };

  try {
    trace.stage("session");
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const writer = {
      set(name: string, value: string, options?: Record<string, unknown>) {
        cookieStore.set(name, value, options as never);
      },
    };
    const { brokerPasswordLogin, commitAuthReturnForGeneration, resolveBrokerSession } = await import("@/lib/auth/broker");
    trace.stage("provider");
    providerAttempted = true;
    const reader = {
      getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
    };
    const admitted = await brokerPasswordLogin({
      email,
      password,
      writer,
      reader,
      requestNonce: input.requestNonce,
    });
    if (!admitted.ok) {
      const code = admitted.code === "AUTH_ERROR" || admitted.code === "INVALID_INPUT" ? admitted.code : "UNAVAILABLE";
      return { ok: false, code, diagnostic: trace.finish(code === "AUTH_ERROR" ? "AUTH_ERROR" : code === "INVALID_INPUT" ? "INVALID_INPUT" : "UNAVAILABLE") };
    }
    const resolved = await resolveBrokerSession({
      getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
    });
    if (resolved.ok) {
      const preferred = input.next != null ? safeInternalPath(input.next, "") : "";
      if (preferred) commitAuthReturnForGeneration(writer, resolved.boundary.generation, preferred);
    }
    trace.stage("access");
    const access = await getCompanyAccess();
    const preferred = input.next != null ? safeInternalPath(input.next, "") : "";
    trace.finish("OK");
    return { ok: true, data: { next: pathForAccess(access, preferred || null) } };
  } catch {
    return { ok: false, code: "UNAVAILABLE", diagnostic: trace.finish(providerAttempted ? "OUTCOME_UNKNOWN" : "UNAVAILABLE") };
  }

  });
}

export async function resolvePostAuthPath(next?:string|null, correlation?: unknown): Promise<ActionResult<{ next: string }>> {
  return withAuthDiagnostic<Awaited<ReturnType<typeof resolvePostAuthPath>>>("auth_login", correlation, async (trace) => {
trace.stage("access");
 try {
  const access=await getCompanyAccess();
  trace.stage("handoff");
  const {cookies}=await import("next/headers");
  const store=await cookies();
  const {readAuthReturnForGeneration,resolveBrokerSession}=await import("@/lib/auth/broker");
  const resolved=await resolveBrokerSession({getAll:()=>store.getAll().map(c=>({name:c.name,value:c.value}))});
  const gen=resolved.ok?resolved.boundary.generation:null;
  // Generation-named return only — never fall back to shared legacy cookie that may be B's (C3-8).
  const stored=readAuthReturnForGeneration(
    {get:(name)=>{const v=store.get(name)?.value;return v?{value:v}:undefined;}},
    gen,
  );
  trace.finish("OK");
  return {ok:true,data:{next:pathForAccess(access,safeInternalPath(next||stored,""))}};
 }catch{return {ok:false,code:"UNAVAILABLE",diagnostic:trace.finish("UNAVAILABLE")};}

  });
}
export async function signOut(
  expectedUserId?: string,
  expectedBoundaryFingerprint?: string | null,
  operationKey?: string,
): Promise<ActionResult<{ operationId?: string; status?: string }>> {
  try {
    const { createBrokerBoundClient } = await import("@/lib/supabase/server");
    const {
      brokerLogoutOriginal,
      resolveBrokerSessionByFingerprint,
      clearAuthReturnForGeneration,
      clearWorkspaceHintForGeneration,
    } = await import("@/lib/auth/broker");
    const { cookies } = await import("next/headers");
    const store = await cookies();
    const reader = {
      getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    };
    const writer = {
      set(name: string, value: string, options?: Record<string, unknown>) {
        store.set(name, value, options as never);
      },
    };

    // Prefer the captured boundary — never retarget logout to newer same-user B (C2).
    let resolved =
      expectedBoundaryFingerprint
        ? await resolveBrokerSessionByFingerprint(reader, expectedBoundaryFingerprint)
        : null;
    if (!resolved || !resolved.ok) {
      const bound = await createBrokerBoundClient();
      if (!bound.bound.ok) {
        // No broker session and no capture: do not wipe gen-scoped ancillary belonging to another tab.
        return bound.bound.code === "UNAVAILABLE"
          ? { ok: false, code: "UNAVAILABLE" }
          : { ok: true, data: { status: "confirmed" } };
      }
      if (expectedBoundaryFingerprint
        && bound.bound.resolve.boundary.boundaryFingerprint !== expectedBoundaryFingerprint) {
        return { ok: false, code: "UNAUTHENTICATED" };
      }
      resolved = bound.bound.resolve;
    }
    if (expectedUserId !== undefined && resolved.boundary.userId !== expectedUserId) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    const result = await brokerLogoutOriginal({
      resolved,
      operationKey,
      writer,
      expectedUserId,
      expectedBoundaryFingerprint: expectedBoundaryFingerprint ?? resolved.boundary.boundaryFingerprint,
    });
    // Ancillary cleanup bound to THIS generation only (C8).
    if (result.status === "confirmed" || result.status === "unknown" || result.status === "pending") {
      clearWorkspaceHintForGeneration(
        store,
        WORKSPACE_COMPANY_COOKIE,
        resolved.boundary.userId,
        result.generation,
      );
      clearAuthReturnForGeneration(store, result.generation);
    }
    if (result.status === "confirmed") {
      return { ok: true, data: { operationId: result.operationId, status: result.status } };
    }
    return {
      ok: false,
      code: result.code ?? "UNAVAILABLE",
      message: result.message ?? "LOGOUT_REVOCATION_PENDING",
      data: { operationId: result.operationId, status: result.status },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function resendVerificationEmail(
  email: string,
  next?: string | null,
  requestNonce?: string | null,
  correlation?: unknown,
): Promise<ActionResult<{ retryAfterSeconds?: number } | undefined>> {
  return withAuthDiagnostic<Awaited<ReturnType<typeof resendVerificationEmail>>>("auth_verification_resend", correlation, async (trace) => {
  let providerAttempted = false;

  trace.stage("input");
  const cleaned = typeof email==="string"?email.trim().toLowerCase():"";
  if (cleaned.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) {
    return { ok: false, code: "INVALID_INPUT", diagnostic: trace.finish("INVALID_INPUT") };
  }
  if (typeof requestNonce !== "string" || requestNonce.length < 16) return { ok: false, code: "UNAVAILABLE", diagnostic: trace.finish("UNAVAILABLE") };
  try {
    trace.stage("session");
    const { cookies } = await import("next/headers");
    const store = await cookies();
    const { prepareEmailConfirmation } = await import("@/lib/auth/broker/email-confirmation");
    const prepared = await prepareEmailConfirmation({
      purpose: "signup_resend", requestNonce, next,
      reader: { getAll: () => store.getAll().map(c => ({ name: c.name, value: c.value })) },
      writer: { set: (name, value, options) => store.set(name, value, options as never) },
    });
    // gesture_spent = this nonce already bound PKCE; Auth was never re-entered. Fresh gesture required.
    if (!prepared.ok) {
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: prepared.reason === "gesture_spent" ? "verification_gesture_spent" : "verification_unavailable",
        diagnostic: trace.finish("UNAVAILABLE"),
      };
    }
    trace.stage("provider");
    providerAttempted = true;
    const { error } = await prepared.bundle.client.auth.resend({
      type: "signup",
      email: cleaned,
      options: { emailRedirectTo: prepared.emailRedirectTo },
    });
    if (error) {
      const { classifyProviderAuthFailure, actionCodeForProviderFailure } = await import("@/lib/auth/provider-transport");
      const kind = classifyProviderAuthFailure(error), code = actionCodeForProviderFailure(kind);
      const message = kind === "unknown_transport" ? "verification_unavailable" : emailVerificationError(error);
      const retryAfterSeconds = message === "verification_rate_limited" ? emailVerificationRetryAfterSeconds(error) : null;
      return {
        ok: false,
        code,
        message,
        data: retryAfterSeconds ? { retryAfterSeconds } : undefined,
        diagnostic: trace.finish(kind === "unknown_transport" ? "OUTCOME_UNKNOWN" : code),
      };
    }
    trace.finish("OK");
    return { ok: true, data: undefined };
  } catch {
    return { ok: false, code: "UNAVAILABLE", diagnostic: trace.finish(providerAttempted ? "OUTCOME_UNKNOWN" : "UNAVAILABLE") };
  }

  });
}

export async function verifyEmailCode(input: {
  email: string;
  code: string;
  next?: string | null;
  requestNonce?: string | null;
  correlation?: unknown;
}): Promise<ActionResult<{ next: string; userId: string; boundaryFingerprint: string }>> {
  return withAuthDiagnostic<Awaited<ReturnType<typeof verifyEmailCode>>>("auth_verification", input?.correlation, async (trace) => {
  let providerAttempted = false;

  trace.stage("input");
  const email = typeof input?.email === "string" ? input.email.trim().toLowerCase() : "";
  const token = typeof input?.code === "string" ? normalizeEmailCode(input.code) : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[0-9]{6}$/.test(token)) {
    return { ok: false, code: "INVALID_INPUT", diagnostic: trace.finish("INVALID_INPUT") };
  }
  try {
    // Provider client + broker admit — no shared sb-* cookie write.
    trace.stage("session");
    const { createProviderAuthClient } = await import("@/lib/auth/broker/provider");
    const { admitNativeSession, prepareBrokerAdmissionLineage } = await import("@/lib/auth/broker");
    const { reserveBoundAuthIntent, claimProviderAttempt } = await import("@/lib/auth/broker/registry");
    const requestNonce =
      typeof input.requestNonce === "string" && input.requestNonce.length >= 16
        ? input.requestNonce
        : null;
    if (!requestNonce) {
      return { ok: false, code: "UNAVAILABLE", message: "verification_unavailable", diagnostic: trace.finish("UNAVAILABLE") };
    }
    const bundle = createProviderAuthClient();
    if (!bundle) return { ok: false, code: "UNAVAILABLE", diagnostic: trace.finish("UNAVAILABLE") };
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const writer = {
      set(name: string, value: string, options?: Record<string, unknown>) {
        cookieStore.set(name, value, options as never);
      },
    };
    const reader = {
      getAll: () => cookieStore.getAll().map((c) => ({ name: c.name, value: c.value })),
    };
    const lineageCtx = await prepareBrokerAdmissionLineage(reader, writer);
    if (!lineageCtx.ok) {
      return { ok: false, code: "UNAVAILABLE", message: "verification_unavailable", diagnostic: trace.finish("UNAVAILABLE") };
    }
    const intent = await reserveBoundAuthIntent({
      bootstrapHash: lineageCtx.bootstrapHash,
      requestNonce,
      purpose: "verify_email",
    });
    if (!intent) {
      return { ok: false, code: "UNAVAILABLE", message: "verification_unavailable", diagnostic: trace.finish("UNAVAILABLE") };
    }
    const claim = await claimProviderAttempt(intent.id);
    if (!claim.ok || claim.claimed !== true) {
      return { ok: false, code: "UNAVAILABLE", message: "verification_unavailable", diagnostic: trace.finish("UNAVAILABLE") };
    }
    trace.stage("provider");
    providerAttempted = true;
    const { data, error } = await bundle.client.auth.verifyOtp({ email, token, type: "email" });
    if (error) {
      const { classifyProviderAuthFailure, actionCodeForProviderFailure } = await import(
        "@/lib/auth/provider-transport"
      );
      const kind = classifyProviderAuthFailure(error);
      const code = actionCodeForProviderFailure(kind);
      return {
        ok: false,
        code,
        message: kind === "unknown_transport" ? "verification_unavailable" : emailVerificationError(error),
        diagnostic: trace.finish(kind === "unknown_transport" ? "OUTCOME_UNKNOWN" : code),
      };
    }
    const user = data.user;
    if (!user?.email_confirmed_at || user.email?.toLowerCase() !== email
      || !data.session || data.session.user.id !== user.id) {
      if (data.session) {
        const { signOutProviderSessionAfterAdmitFailure } = await import(
          "@/lib/auth/broker/provider-session"
        );
        await signOutProviderSessionAfterAdmitFailure(bundle, data.session, {
          intentId: intent.id,
          operationKey: intent.id,
        });
      }
      return { ok: false, code: "AUTH_ERROR", message: "verification_incomplete", diagnostic: trace.finish("AUTH_ERROR") };
    }
    trace.stage("session");
    let admitted: Awaited<ReturnType<typeof admitNativeSession>>;
    try {
      admitted = await admitNativeSession({
        session: data.session, writer, reader, authIntentId: intent.id,
        browserLineageId: intent.browserLineageId, bootstrapHash: lineageCtx.bootstrapHash,
      });
    } catch {
      const {signOutProviderSessionAfterAdmitFailure} = await import("@/lib/auth/broker/provider-session");
      // Atomic disposition refuses revocation if admission committed before cookie-write failure.
      await signOutProviderSessionAfterAdmitFailure(bundle,data.session,{intentId:intent.id,operationKey:intent.id});
      return {ok:false,code:"UNAVAILABLE",message:"verification_confirmed_session_unavailable",diagnostic:trace.finish("OUTCOME_UNKNOWN")};
    }
    if (!admitted.ok) {
      const { signOutProviderSessionAfterAdmitFailure } = await import(
        "@/lib/auth/broker/provider-session"
      );
      const cleanup = await signOutProviderSessionAfterAdmitFailure(bundle, data.session, {
        intentId: intent.id,
        operationKey: intent.id,
      });
      if (cleanup.outcome !== "confirmed" || !cleanup.durable) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: "verification_confirmed_session_unavailable",
          diagnostic: trace.finish("OUTCOME_UNKNOWN"),
        };
      }
      return { ok: false, code: "UNAVAILABLE", message: "verification_confirmed_session_unavailable", diagnostic: trace.finish("UNAVAILABLE") };
    }
    trace.stage("access");
    const access = await getCompanyAccess();
    if (access.ok && access.context.userId !== user.id) {
      return { ok: false, code: "AUTH_ERROR", message: "verification_incomplete", diagnostic: trace.finish("AUTH_ERROR") };
    }
    let preferred = safeInternalPath(input.next, "");
    if (access.ok && !access.context.isPlatformAdmin && pathAtOrUnder(preferred.split(/[?#]/)[0], "/admin")) {
      preferred = "";
    }
    trace.finish("OK");
    return { ok: true, data: { next: pathForAccess(access, preferred || null), userId: user.id, boundaryFingerprint: admitted.committed.boundaryFingerprint } };
  } catch {
    // A timeout may have consumed the OTP. Leave recovery to the user; never retry automatically.
    return { ok: false, code: "UNAVAILABLE", message: "verification_unavailable", diagnostic: trace.finish(providerAttempted ? "OUTCOME_UNKNOWN" : "UNAVAILABLE") };
  }

  });
}

function recordPasswordResetFailure(stage: "provider" | "request") {
  try {
    // Never log the mailbox, provider error, tokens or account-existence details.
    console.warn("auth.password_reset_request_failed", { stage, retry: "manual_only" });
  } catch {
    // Logging must not change the non-enumerating public recovery response.
  }
}

export async function requestPasswordReset(email: string, requestNonce?: string | null): Promise<ActionResult> {
 const cleaned=typeof email==="string"?email.trim().toLowerCase():"";
 if(!cleaned)return {ok:false,code:"INVALID_INPUT"};
 try{
  const {cookies}=await import("next/headers");
  const {brokerRequestPasswordReset}=await import("@/lib/auth/broker/password-reset");
  const store=await cookies();
  const result=await brokerRequestPasswordReset({email:cleaned,requestNonce,reader:{getAll:()=>store.getAll().map(c=>({name:c.name,value:c.value}))},writer:{set:(name,value,options)=>store.set(name,value,options as never)}});
  return result.ok?{ok:true,data:undefined}:{ok:false,code:"UNAVAILABLE"};
 }catch{recordPasswordResetFailure("request");return {ok:false,code:"UNAVAILABLE"};}
}

export async function updatePassword(
  password: string,
  expectedUserId?: string,
  expectedBoundaryFingerprint?: string | null,
  operationKey?: string,
): Promise<ActionResult<{ operationId?: string }>> {
  const trace = beginDiagnostic("auth_password_update");
  if (typeof password !== "string" || password.length < 8) return { ok: false, code: "INVALID_INPUT", diagnostic: trace.finish("INVALID_INPUT") };
  // Boundary capture required for every password mutation (C2-R7).
  if (!expectedBoundaryFingerprint || !/^[a-f0-9]{16}$/i.test(expectedBoundaryFingerprint)) {
    return { ok: false, code: "UNAUTHENTICATED", diagnostic: trace.finish("UNAUTHENTICATED") };
  }
  try {
    trace.stage("session");
    const {
      brokerUpdatePassword,
      resolveAuthoritativeForMutation,
      clearAuthReturnForGeneration,
      clearWorkspaceHintForGeneration,
    } = await import("@/lib/auth/broker");
    const { cookies } = await import("next/headers");
    const store = await cookies();
    const reader = {
      getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
    };
    // Password requires current active tip — not recovery capture resolve (C3-4).
    const resolved = await resolveAuthoritativeForMutation(reader, expectedBoundaryFingerprint);
    if (!resolved.ok) {
      const code = resolved.code === "QUARANTINED" ? "UNAUTHENTICATED" : resolved.code;
      return { ok: false, code, diagnostic: trace.finish(code) };
    }
    if (expectedUserId !== undefined && resolved.boundary.userId !== expectedUserId) {
      return { ok: false, code: "UNAUTHENTICATED", diagnostic: trace.finish("UNAUTHENTICATED") };
    }
    trace.stage("access");
    const identity = await readSessionIdentity();
    if (!identity.ok) return { ok: false, code: identity.code, diagnostic: trace.finish(identity.code) };
    // Tip + identity must agree — fingerprint cleanup resolve is not password authority (C3-4).
    if (identity.userId !== resolved.boundary.userId) {
      return { ok: false, code: "UNAUTHENTICATED", diagnostic: trace.finish("UNAUTHENTICATED") };
    }
    const writer = {
      set(name: string, value: string, options?: Record<string, unknown>) {
        store.set(name, value, options as never);
      },
    };
    trace.stage("provider");
    const result = await brokerUpdatePassword({
      resolved,
      operationKey,
      password,
      writer,
      expectedUserId,
      expectedBoundaryFingerprint: expectedBoundaryFingerprint ?? resolved.boundary.boundaryFingerprint,
    });
    if (!result.ok) {
      return {
        ok: false,
        code: result.code ?? "UNAVAILABLE",
        message: result.message,
        data: { operationId: result.operationId },
        diagnostic: trace.finish(result.code === "AUTH_ERROR" ? "AUTH_ERROR" : result.code === "INVALID_INPUT" ? "INVALID_INPUT" : "UNAVAILABLE"),
      };
    }
    clearWorkspaceHintForGeneration(
      store,
      WORKSPACE_COMPANY_COOKIE,
      resolved.boundary.userId,
      resolved.boundary.generation,
    );
    clearAuthReturnForGeneration(store, resolved.boundary.generation);
    trace.stage("completed");
    trace.finish("OK");
    return { ok: true, data: { operationId: result.operationId } };
  } catch {
    return { ok: false, code: "UNAVAILABLE", diagnostic: trace.finish("UNAVAILABLE") };
  }
}

export async function completeProfileName(name: string, next?:string|null, expectedUserId?: string): Promise<ActionResult<{ next: string }>> {
  if (typeof name !== "string") return { ok: false, code: "INVALID_INPUT" };
  const identity=await readSessionIdentity();if(!identity.ok)return {ok:false,code:identity.code};
  if (expectedUserId !== undefined && expectedUserId !== identity.userId) return { ok: false, code: "UNAUTHENTICATED" };
  const fullName = name.trim();
  if (fullName.length < 2 || fullName.length > 120) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  try {
    const supabase = await createClient();
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) return { ok: false, code: "UNAVAILABLE" };
    const user = userData.user;
    if (!user || user.id !== identity.userId) return { ok: false, code: "UNAUTHENTICATED" };
    if (!user.email_confirmed_at && !user.phone_confirmed_at) {
      return { ok: false, code: "UNVERIFIED" };
    }

    const { error } = await supabase.from("profiles").upsert(
      { user_id: user.id, full_name: fullName },
      { onConflict: "user_id" },
    );
    if (error) return { ok: false, code: "AUTH_ERROR" };

    // The profile write is confirmed. Membership display metadata and the
    // destination refresh must not turn that receipt into a failed save.
    try {
      await supabase
        .from("company_members")
        .update({ member_name: fullName })
        .eq("user_id", user.id)
        .eq("status", "active");
    } catch { /* A later profile edit can retry display synchronization. */ }

    const access = await getCompanyAccess().catch(() => ({ ok: false as const, code: "UNAVAILABLE" as const }));
    const scopedAccess = access.ok && access.context.userId !== user.id
      ? { ok: false as const, code: "UNAVAILABLE" as const }
      : access;
    return { ok: true, data: { next: pathForAccess(scopedAccess,safeInternalPath(next,"")) } };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function getAccountProfile(correlation?: unknown): Promise<ActionResult<AccountProfileView>> {
  return withAuthDiagnostic<Awaited<ReturnType<typeof getAccountProfile>>>("auth_session_check", correlation, async (trace) => {
trace.stage("session");
 const identity=await readSessionIdentity();if(!identity.ok){trace.finish(identity.code==="UNAUTHENTICATED"?"UNAUTHENTICATED":"UNAVAILABLE");return {ok:false,code:identity.code,...("expired" in identity&&identity.expired?{sessionExpired:true}:{})};}
 trace.stage("access");
 const [access,platformIdentity]=await Promise.all([
  getCompanyAccess(),
  identity.emailConfirmed?readAccountPlatformIdentity(identity.userId):Promise.resolve(unavailablePlatformIdentity()),
 ]);
 if(access.ok&&access.context.userId!==identity.userId){trace.finish("UNAVAILABLE");return {ok:false,code:"UNAVAILABLE"};}
 if(!access.ok&&access.code==="UNAUTHENTICATED"){trace.finish("UNAUTHENTICATED");return {ok:false,code:"UNAUTHENTICATED",...("sessionExpired" in access&&access.sessionExpired?{sessionExpired:true}:{})};}
 if("boundaryFingerprint" in identity||"generation" in identity){
  try{
   const {createBrokerBoundClient}=await import("@/lib/supabase/server");
   const postBound=await createBrokerBoundClient({fresh:true});
   if(!postBound.bound.ok){trace.finish(postBound.bound.code==="UNAUTHENTICATED"?"UNAUTHENTICATED":"UNAVAILABLE");return {ok:false,code:postBound.bound.code};}
   const postBoundary=postBound.bound.resolve.boundary;
   if(postBoundary.userId!==identity.userId||(identity.boundaryFingerprint&&postBoundary.boundaryFingerprint!==identity.boundaryFingerprint)||(identity.generation&&postBoundary.generation!==identity.generation)){trace.finish("UNAUTHENTICATED");return {ok:false,code:"UNAUTHENTICATED"};}
  }catch{
   trace.finish("UNAVAILABLE");
   return {ok:false,code:"UNAVAILABLE"};
  }
 }
 trace.finish(access.ok?"OK":access.code);
 if(access.ok)return {ok:true,data:{...buildAccountProfileView(access,platformIdentity),emailConfirmed:identity.emailConfirmed,sessionExpiresAt:identity.sessionExpiresAt}};
 // Auth identity survives company/profile outages; no role or company privilege is invented.
 return {ok:true,data:{platformIdentity,userId:identity.userId,email:identity.email,fullName:identity.fullName,supportCode:"",isPlatformAdmin:false,role:null,companyName:null,companyId:null,needsCompanyContext:false,adminHref:null,workspaceHref:null,workHref:identity.emailConfirmed?"/account":authFlowHref("/verify-email",null,identity.email),emailConfirmed:identity.emailConfirmed,sessionExpiresAt:identity.sessionExpiresAt,accessUnavailable:access.code==="UNAVAILABLE"}};

  });
}
export async function selectWorkspaceCompany(companyId: string, input?: { expectedUserId?: string; next?: string | null }): Promise<ActionResult<{ companyId: string; next: string }>> {
  if (typeof companyId !== "string") return { ok: false, code: "INVALID_INPUT" };
  const access = await getCompanyAccess();
  if (!access.ok) return { ok: false, code: access.code };
  if (input?.expectedUserId !== undefined && input.expectedUserId !== access.context.userId) return { ok: false, code: "UNAUTHENTICATED" };
  const id = companyId.trim();
  const allowed = access.context.workspaceChoices.some((row) => row.companyId === id)
    || access.context.membership?.company_id === id;
  if (!id || !allowed) return { ok: false, code: "FORBIDDEN" };
  try {
    const { cookies } = await import("next/headers");
    const { createBrokerBoundClient } = await import("@/lib/supabase/server");
    const { commitWorkspaceForGeneration } = await import("@/lib/auth/broker");
    const bound = await createBrokerBoundClient();
    if (!bound.bound.ok) return { ok: false, code: bound.bound.code };
    if (bound.bound.resolve.boundary.userId !== access.context.userId) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    // getCompanyAccess may be request-cached. Native membership authority must
    // be read at both sides of this hint write, using the captured user client.
    const nativeClient = bound.bound.client;
    const readSelectionMembership = async () => {
      const { data, error } = await nativeClient.from("company_members")
        .select("company_id,user_id,status")
        .eq("company_id", id).eq("user_id", access.context.userId)
        .eq("status", "active").maybeSingle();
      if (error) return { ok: false as const, code: "UNAVAILABLE" as const };
      if (!data || data.company_id !== id || data.user_id !== access.context.userId || data.status !== "active") {
        return { ok: false as const, code: "FORBIDDEN" as const };
      }
      return { ok: true as const };
    };
    const beforeSelection = await readSelectionMembership();
    if (!beforeSelection.ok) return beforeSelection;
    const generation = bound.bound.resolve.boundary.generation;
    const store = await cookies();
    commitWorkspaceForGeneration(
      {
        set: (name, value, options) => store.set(name, value, options as never),
        get: (name) => { const v = store.get(name)?.value; return v ? { value: v } : undefined; },
        delete: (name) => store.delete(name),
      },
      generation,
      access.context.userId,
      id,
    );
    revalidatePath("/app");
    revalidatePath("/admin");
    const selected = await getCompanyAccess();
    if (!selected.ok) return { ok: false, code: selected.code };
    if (selected.context.userId !== access.context.userId) return { ok: false, code: "UNAUTHENTICATED" };
    const afterSelection = await readSelectionMembership();
    if (!afterSelection.ok) return afterSelection;
    return { ok: true, data: { companyId: id, next: pathForAccess(selected, safeInternalPath(input?.next, "")) } };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function getWorkspaceSwitcher(): Promise<
  ActionResult<{
    needsContext: boolean;
    selectedCompanyId: string | null;
    isPlatformAdmin: boolean;
    choices: Array<{ companyId: string; displayName: string; role: CompanyRole }>;
  }>
> {
  const access = await getCompanyAccess();
  if (!access.ok) return { ok: false, code: access.code };
  return {
    ok: true,
    data: {
      needsContext: access.context.needsCompanyContext,
      selectedCompanyId: access.context.company?.id ?? null,
      isPlatformAdmin: access.context.isPlatformAdmin,
      choices: access.context.workspaceChoices,
    },
  };
}

/**
 * Customer readiness checklist from real server sources (same semantics as admin views).
 * Subscription status comes from persisted, confirmed live entitlements.
 */
export async function getCustomerReadiness(): Promise<ActionResult<CustomerReadinessSnapshot>> {
  const trace = beginDiagnostic("customer_readiness");
  trace.stage("access");
  try {
    const access = await getCompanyAccess();
    if (!access.ok) return { ok: false, code: access.code, diagnostic: trace.finish(access.code) };
    const ctx = access.context;
    const role: CompanyRole | null = ctx.membership?.role ?? null;
    const company = ctx.company;
    const hasCompany = Boolean(company);

    let knowledge: {
      loadFailed: boolean;
      sources: import("@/lib/knowledge/types").KnowledgeSourceRecord[];
      approvalFoundation: "ready" | "unavailable";
    } | null = null;
    let whatsapp: {
      loadFailed: boolean;
      status: import("@/lib/whatsapp/connection").WhatsappLinkStatus | null;
      suspended: boolean;
      liveOpsReady: boolean;
    } | null = null;
    let review: {
      loadFailed: boolean;
      status: ReviewStatus | null;
      proofCurrent?: boolean;
    } | null = null;
    let subscription:{loadFailed:boolean;status:string|null;paidThrough:string|null}|null=null;
    let diagnostic: DiagnosticDetail | undefined;
    const read = async <T extends { ok: boolean } | null>(stage: DiagnosticStage, work: () => Promise<T>): Promise<T> => {
      trace.event(stage, "STARTED");
      try {
        const result = await work();
        const detail = trace.event(stage, result === null || result.ok ? "OK" : "DEPENDENCY_FAILED");
        if (result !== null && !result.ok) diagnostic ??= detail;
        return result;
      } catch (error) {
        diagnostic ??= trace.event(stage, "OUTCOME_UNKNOWN");
        throw error;
      }
    };

    if (hasCompany) {
      // These sources are independent. Retain each source's failure state so one
      // unavailable service neither delays nor erases the rest of the checklist.
      const [knowledgeRead, whatsappRead, billingRead, reviewRead] = await Promise.allSettled([
        read("knowledge", () => listKnowledgeSources({ expectedCompanyId: company!.id })),
        read("channel", () => getWhatsappCompanyLink()),
        read("billing", () => role === "owner" ? readCompanyBillingDisplay(company!.id) : Promise.resolve(null)),
        read("review", () => role === "owner" ? getCompanyReviewRequest({ expectedCompanyId: company!.id }) : Promise.resolve(null)),
      ]);
      const listed = knowledgeRead.status === "fulfilled" ? knowledgeRead.value : { ok: false as const, code: "UNAVAILABLE" };
      knowledge = listed.ok
        ? {
          loadFailed: false,
          sources: listed.data.sources,
          approvalFoundation: listed.data.approvalFoundation,
        }
        : { loadFailed: true, sources: [], approvalFoundation: "unavailable" };

      const wa = whatsappRead.status === "fulfilled" ? whatsappRead.value : { ok: false as const, code: "UNAVAILABLE" };
      const liveOpsReady = whatsappLiveOpsReady();
      if (wa.ok) {
        whatsapp = { loadFailed: false, status: wa.data.status, suspended: false, liveOpsReady };
      } else if (wa.code === "COMPANY_SUSPENDED") {
        whatsapp = { loadFailed: false, status: null, suspended: true, liveOpsReady: false };
      } else if (wa.code === "FORBIDDEN" || wa.code === "UNAUTHENTICATED") {
        whatsapp = { loadFailed: true, status: null, suspended: false, liveOpsReady: false };
      } else {
        whatsapp = { loadFailed: true, status: null, suspended: false, liveOpsReady: false };
      }

      if (role === "owner") {
        const billing=billingRead.status === "fulfilled" ? billingRead.value : null;
        subscription=billing?.ok&&typeof billing.data.billing_paid==="boolean"&&typeof billing.data.operational_eligible==="boolean"?{loadFailed:false,status:billing.data.billing_paid===true&&billing.data.operational_eligible===true?"active":"inactive",
          paidThrough:typeof billing.data.qualified_paid_through==="string"?billing.data.qualified_paid_through:null}:{loadFailed:true,status:null,paidThrough:null};
        const rev = reviewRead.status === "fulfilled" ? reviewRead.value : null;
        review = rev?.ok
          ? { loadFailed: false, status: rev.data?.status ?? null, proofCurrent: rev.data?.proof_current === true }
          : { loadFailed: true, status: null };
      } else {
        review = { loadFailed: false, status: null };
      }
    }

    trace.event("readiness", diagnostic ? "DEPENDENCY_FAILED" : "OK");
    return {
      ok: true,
      ...(diagnostic ? { diagnostic } : {}),
      data: buildCustomerReadiness({
        fullName: ctx.fullName,
        email: ctx.email,
        needsProfileName: ctx.needsProfileName,
        role,
        companyId: company?.id ?? null,
        companyName: company?.display_name ?? null,
        companyStatus: company?.status ?? null,
        knowledge,
        whatsapp,
        review,
        subscription,
      }),
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE", diagnostic: trace.finish("UNAVAILABLE") };
  }
}

export async function updateAccountName(name: string, expectedUserId?: string): Promise<ActionResult<AccountProfileView>> {
  const verifiedIdentity=await readSessionIdentity();if(!verifiedIdentity.ok)return {ok:false,code:verifiedIdentity.code};
  if (expectedUserId !== undefined && expectedUserId !== verifiedIdentity.userId) {
    return { ok: false, code: "UNAUTHENTICATED" };
  }
  if(typeof name!=="string")return {ok:false,code:"INVALID_INPUT"};
  const fullName = name.trim();
  if (fullName.length < 2 || fullName.length > 120) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  try {
    const supabase = await createClient();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user || user.id !== verifiedIdentity.userId) return { ok: false, code: "UNAUTHENTICATED" };
    if (!user.email_confirmed_at && !user.phone_confirmed_at) {
      return { ok: false, code: "UNVERIFIED" };
    }

    // Capture prior role/company so optional sync failure cannot invent empty + /setup.
    const prior = await getAccountProfile();
    const priorView = prior.ok && prior.data.userId === user.id ? prior.data : null;

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

    let profile = priorView ?? {
      platformIdentity: unavailablePlatformIdentity(),
      userId: saved.user_id,
      fullName: saved.full_name,
      email: user.email ?? "",
      supportCode: saved.support_code ?? "",
      isPlatformAdmin: false,
      role: null as AccountProfileView["role"],
      companyName: null as string | null,
      companyId: null as string | null,
      needsCompanyContext: false,
      adminHref: null as string | null,
      workspaceHref: null as string | null,
      workHref: "/account",
    };
    try {
      const access = await getCompanyAccess();
      if (access.ok && access.context.userId === user.id) {
        profile = buildAccountProfileView(access, priorView?.platformIdentity);
        profile = { ...profile, fullName: saved.full_name, supportCode: saved.support_code ?? profile.supportCode };
      } else {
        profile = {
          ...profile,
          userId: saved.user_id,
          fullName: saved.full_name,
          supportCode: saved.support_code ?? profile.supportCode,
          email: user.email ?? profile.email,
        };
      }
    } catch {
      profile = {
        ...profile,
        userId: saved.user_id,
        fullName: saved.full_name,
        supportCode: saved.support_code ?? profile.supportCode,
        email: user.email ?? profile.email,
      };
    }

    return {
      ok: true,
      data: { ...profile, platformIdentity: await readAccountPlatformIdentity(user.id) },
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

export async function getCompanyReviewRequest(input?: { expectedCompanyId?: string }): Promise<ActionResult<CompanyReviewRequest | null>> {
  const gate = await requireActiveOwnerCompany();
  if (!gate.ok) return { ok: false, code: gate.code };
  if (input && "expectedCompanyId" in input) {
    const error = renderedCompanyError(input.expectedCompanyId, gate.companyId);
    if (error) return error;
  }
  try {
    const { data, error } = await gate.supabase.rpc("g03_read_review_request", { p_company_id: gate.companyId });
    if (error) return { ok: false, code: "AUTH_ERROR", message: error.message };
    if (!data) return { ok: true, data: null };
    const parsed = asReviewRequest(data);
    if (!parsed) return { ok: false, code: "UNAVAILABLE" };
    return { ok: true, data: parsed };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function listCompanyReviewEvents(input?: { expectedCompanyId?: string }): Promise<ActionResult<CompanyReviewEvent[]>> {
  const gate = await requireActiveOwnerCompany();
  if (!gate.ok) return { ok: false, code: gate.code };
  if (input && "expectedCompanyId" in input) {
    const error = renderedCompanyError(input.expectedCompanyId, gate.companyId);
    if (error) return error;
  }
  try {
    const { data, error } = await gate.supabase.rpc("list_owner_company_review_events_for_company", { p_company_id: gate.companyId });
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
  numberOwnership: "own" | "new" | "not_applicable";
  whatsappNumber: string;
  ready: boolean;
  expectedRevision?: number;
  expectedCompanyId?: string;
}): Promise<ActionResult<CompanyReviewRequest>> {
  const gate = await requireActiveOwnerCompany();
  if (!gate.ok) return { ok: false, code: gate.code };
  if ("expectedCompanyId" in input) {
    const error = renderedCompanyError(input.expectedCompanyId, gate.companyId);
    if (error) return error;
  }
  if (typeof input.whatsappNumber !== "string") return { ok: false, code: "INVALID_INPUT" };
  if (input.ready !== true) return { ok: false, code: "INVALID_INPUT" };
  if (input.numberOwnership !== "own" && input.numberOwnership !== "new"
    && !(input.numberOwnership === "not_applicable" && (masterJourneyEnabled()) && !input.whatsappNumber.trim())) {
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
  numberOwnership: "own" | "new" | "not_applicable";
  whatsappNumber: string;
  ready: boolean;
  expectedRevision?: number;
  expectedCompanyId?: string;
}): Promise<ActionResult<CompanyReviewRequest>> {
  const gate = await requireActiveOwnerCompany();
  if (!gate.ok) return { ok: false, code: gate.code };
  if ("expectedCompanyId" in input) {
    const error = renderedCompanyError(input.expectedCompanyId, gate.companyId);
    if (error) return error;
  }
  if (typeof input.expectedRevision !== "number") return { ok: false, code: "INVALID_INPUT" };
  if (input.ready !== true) return { ok: false, code: "INVALID_INPUT" };
  if (typeof input.whatsappNumber !== "string" || (input.numberOwnership !== "own" && input.numberOwnership !== "new"
    && !(input.numberOwnership === "not_applicable" && (masterJourneyEnabled()) && !input.whatsappNumber.trim()))) {
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
  expectedCompanyId?: string | null;
  expectedUserId?: string;
  expectedVersion?: number;
}): Promise<ActionResult<CompanyRecord>> {
  const trace = beginDiagnostic("company_save");
  trace.stage("input");
  trace.stage("access");
  try {
  const access = await getCompanyAccess();
  if (!access.ok) return { ok: false, code: access.code, diagnostic: trace.finish(access.code) };
  if (access.context.membership && access.context.membership.role !== "owner") {
    return { ok: false, code: "FORBIDDEN", diagnostic: trace.finish("FORBIDDEN") };
  }

  if(access.context.needsCompanyContext||access.context.isPlatformAdmin&&!access.context.company)return {ok:false,code:"FORBIDDEN",diagnostic:trace.finish("FORBIDDEN")};
  trace.stage("input");
  // Server actions receive runtime input; TypeScript does not validate the transport payload.
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, code: "INVALID_INPUT", diagnostic: trace.finish("INVALID_INPUT") };
  }
  if (input.expectedUserId !== undefined && input.expectedUserId !== access.context.userId) {
    return { ok: false, code: "UNAUTHENTICATED", diagnostic: trace.finish("UNAUTHENTICATED") };
  }
  const stringFields = ["displayName", "businessType", "replyLanguage", "country", "city", "hours", "contactPhone", "contactEmail"] as const;
  if (stringFields.some(field => typeof input[field] !== "string")
    || !["ar", "en", "both"].includes(input.replyLanguage)
    || (input.memberName !== undefined && typeof input.memberName !== "string")) {
    return { ok: false, code: "INVALID_INPUT", diagnostic: trace.finish("INVALID_INPUT") };
  }
  if ("expectedCompanyId" in input) {
    const error = renderedCompanyError(input.expectedCompanyId, access.context.company?.id ?? null, true);
    if (error) return { ...error, diagnostic: trace.finish(error.code) };
  }
  const displayName = input.displayName.trim();
  const contactPhone = normalizeBusinessPhone(input.contactPhone);
  const contactEmail = normalizeBusinessEmail(input.contactEmail);
  if (!displayName || displayName.length > 120 || !input.businessType.trim() || !input.country.trim()
    || contactPhone === null || contactEmail === null) {
    return { ok: false, code: "INVALID_INPUT", diagnostic: trace.finish("INVALID_INPUT") };
  }

    trace.stage("session");
    const supabase = await createClient();
    trace.stage("persistence");
    if(masterJourneyEnabled()&&access.context.company?.version===undefined)return {ok:false,code:'UNAVAILABLE',diagnostic:trace.finish('UNAVAILABLE')};
    if(access.context.company?.version!==undefined){
      if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion!<1)return {ok:false,code:'CONFLICT',diagnostic:trace.finish('CONFLICT')};
      const {data,error}=await supabase.rpc('update_owner_company_profile',{
        p_expected_user_id:access.context.userId,p_company_id:access.context.company.id,p_expected_version:input.expectedVersion!,
        p_patch:{name:displayName,type:input.businessType,replyLanguage:input.replyLanguage,country:input.country,city:input.city,hours:input.hours,contactPhone,contactEmail},
      });
      const receipt=data as {ok?:boolean;code?:string;data?:CompanyRecord}|null;
      if(error||!receipt)return {ok:false,code:'UNAVAILABLE',diagnostic:trace.finish('UNAVAILABLE')};
      if(!receipt.ok||!receipt.data){const code=receipt.code==='CONFLICT'?'CONFLICT':receipt.code==='INVALID_INPUT'?'INVALID_INPUT':receipt.code==='UNAUTHENTICATED'?'UNAUTHENTICATED':receipt.code==='UNVERIFIED'?'UNVERIFIED':'FORBIDDEN';return {ok:false,code,message:receipt.code==='REVIEW_REQUIRED'?'country_change_review_required':undefined,diagnostic:trace.finish(code)};}
      if(receipt.data.id!==access.context.company.id)return {ok:false,code:'UNAVAILABLE',diagnostic:trace.finish('UNAVAILABLE')};
      let warning:DiagnosticDetail|undefined;
      for(const path of ['/setup','/app','/app/settings']){try{revalidatePath(path);}catch{warning=trace.finish('REFRESH_FAILED');}}
      if(!warning)trace.finish('OK');return {ok:true,data:receipt.data,...(warning?{diagnostic:warning}:{})};
    }
    const { data, error } = await supabase.rpc(access.context.company?"upsert_selected_owner_company":"upsert_owner_company", {
      ...(access.context.company?{p_company_id:access.context.company.id}:{}),
      p_display_name: displayName,
      p_business_type: input.businessType,
      p_reply_language: input.replyLanguage,
      p_country: input.country,
      p_city: input.city,
      p_hours: input.hours,
      p_contact_phone: contactPhone,
      p_contact_email: contactEmail,
      p_member_name:
        input.memberName
        ?? access.context.membership?.member_name
        ?? access.context.fullName
        ?? "",
    });
    if (error || !data) {
      return { ok: false, code: "AUTH_ERROR", diagnostic: trace.finish("AUTH_ERROR") };
    }
    // The RPC has committed. Cache refresh must not turn its receipt into a
    // failed save, which could prompt the owner to repeat an already saved change.
    trace.stage("refresh");
    let warning: DiagnosticDetail | undefined;
    for (const path of ["/setup", "/app", "/app/settings"]) {
      try { revalidatePath(path); } catch { warning = trace.finish("REFRESH_FAILED"); }
    }
    if (!warning) trace.finish("OK");
    return { ok: true, data: data as CompanyRecord, ...(warning ? { diagnostic: warning } : {}) };
  } catch {
    return { ok: false, code: "UNAVAILABLE", diagnostic: trace.finish("UNAVAILABLE") };
  }
}

export async function adminListCompaniesPage(input?: {
  search?: string;
  status?: "all" | CompanyStatus | "pending_review";
  limit?: number;
  offset?: number;
}): Promise<ActionResult<AdminCompanyListPage>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };

  // Server Actions are directly callable; TypeScript annotations do not validate callers.
  if (input !== undefined && !isPlainObject(input)) return { ok: false, code: "INVALID_INPUT" };
  if (input?.search !== undefined && typeof input.search !== "string") return { ok: false, code: "INVALID_INPUT" };
  if (input?.status !== undefined && !["all", "setup", "active", "suspended", "pending_review"].includes(input.status)) return { ok: false, code: "INVALID_INPUT" };
  if (input?.limit !== undefined && typeof input.limit !== "number") return { ok: false, code: "INVALID_INPUT" };
  if (input?.offset !== undefined && (typeof input.offset !== "number" || !Number.isFinite(input.offset) || Math.floor(input.offset) > 2147483647)) return { ok: false, code: "INVALID_INPUT" };

  const rawLimit = input?.limit ?? ADMIN_COMPANIES_PAGE_DEFAULT_LIMIT;
  const limit = Math.min(
    Math.max(
      Number.isFinite(rawLimit) ? Math.floor(rawLimit) : ADMIN_COMPANIES_PAGE_DEFAULT_LIMIT,
      ADMIN_COMPANIES_PAGE_MIN_LIMIT
    ),
    ADMIN_COMPANIES_PAGE_MAX_LIMIT
  );
  const rawOffset = input?.offset ?? 0;
  const offset = Math.max(Number.isFinite(rawOffset) ? Math.floor(rawOffset) : 0, 0);
  const search = (input?.search ?? "").trim();
  const status = input?.status ?? "all";

  try {
    const supabase = await createClient();

    // Direct execution of admin_list_companies_page RPC (no silent fallback to legacy RPC)
    type PageRpcResponse = { rows?: unknown[]; total_count?: number };
    const pageRpc = await (supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>)("admin_list_companies_page", {
      p_search: search,
      p_status: status,
      p_limit: limit,
      p_offset: offset,
    });

    if (pageRpc.error) {
      const err = pageRpc.error as { message?: string };
      return { ok: false, code: "UNAVAILABLE", message: err.message };
    }

    if (!pageRpc.data || typeof pageRpc.data !== "object") {
      return { ok: false, code: "UNAVAILABLE", message: "bad_rpc_payload" };
    }

    const d = pageRpc.data as PageRpcResponse;
    if (!Array.isArray(d.rows) || typeof d.total_count !== "number") {
      return { ok: false, code: "UNAVAILABLE", message: "bad_rpc_payload" };
    }

    return {
      ok: true,
      data: {
        rows: d.rows as AdminCompanyListItem[],
        totalCount: d.total_count,
        offset,
        limit,
        hasMore: offset + d.rows.length < d.total_count,
      },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function adminListPendingReviews(): Promise<ActionResult<AdminCompanyListItem[]>> {
  const result = await adminListPendingReviewsPage();
  if (!result.ok) return { ok: false, code: result.code };
  return { ok: true, data: result.data.rows };
}

export async function adminListPendingReviewsPage(input?: { limit?: number; offset?: number }): Promise<ActionResult<AdminCompanyListPage>> {
  if (input !== undefined && !isPlainObject(input)) return { ok: false, code: "INVALID_INPUT" };
  return adminListCompaniesPage({ limit: input?.limit, offset: input?.offset, status: "pending_review" });
}

export async function adminListCompanies(search = ""): Promise<ActionResult<AdminCompanyListItem[]>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_list_companies", { p_search: search });
    if (error) return { ok: false, code: "UNAVAILABLE", message: error.message };
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
    if (error) return { ok: false, code: "UNAVAILABLE", message: error.message };
    if (!data) return { ok: false, code: "INVALID_INPUT", message: "NOT_FOUND" };
    return { ok: true, data };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

function isMissingAdminAccountJourneyError(message?: string | null): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    (m.includes("admin_overview_stats") && (m.includes("could not find") || m.includes("does not exist")))
    || (m.includes("email_confirmed") && m.includes("admin_search_accounts"))
    || m.includes("pgrst202")
  );
}

export async function adminGetOverviewStats(): Promise<ActionResult<AdminOverviewStats>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("admin_overview_stats");
    if (error) {
      if (isMissingAdminAccountJourneyError(error.message)) {
        return { ok: false, code: "UNAVAILABLE", message: ADMIN_ACCOUNT_JOURNEY_DEPENDENCY };
      }
      return { ok: false, code: "UNAVAILABLE", message: error.message };
    }
    if (!isPlainObject(data) || data.ok !== true) {
      return { ok: false, code: "UNAVAILABLE", message: "bad_rpc_payload" };
    }
    const required = [
      "accounts_total",
      "accounts_without_company",
      "accounts_without_active_company",
      "companies_total",
      "companies_setup",
      "companies_active",
      "companies_suspended",
    ] as const;
    for (const key of required) {
      if (typeof data[key] !== "number" || !Number.isFinite(data[key])) {
        return { ok: false, code: "UNAVAILABLE", message: `bad_stats_field:${key}` };
      }
    }
    return {
      ok: true,
      data: {
        accountsTotal: data.accounts_total as number,
        accountsWithoutCompany: data.accounts_without_company as number,
        accountsWithoutActiveCompany: data.accounts_without_active_company as number,
        companiesTotal: data.companies_total as number,
        companiesSetup: data.companies_setup as number,
        companiesActive: data.companies_active as number,
        companiesSuspended: data.companies_suspended as number,
      },
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export async function adminSearchAccounts(input: {
  query?: string;
  limit?: number;
  offset?: number;
}): Promise<ActionResult<AdminAccountSearchPage>> {
  const access = await requirePlatformAdmin();
  if (!access.ok) return { ok: false, code: access.code };
  const query = normalizeAdminAccountQuery(input.query);
  const limit = Math.max(1, Math.min(Number(input.limit) || 20, 50));
  const requestedOffset = Math.max(0, Number(input.offset) || 0);
  const offset = Math.min(requestedOffset, ADMIN_ACCOUNT_SEARCH_MAX_OFFSET);
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
      if (isMissingAdminAccountJourneyError(error.message)) {
        return { ok: false, code: "UNAVAILABLE", message: ADMIN_ACCOUNT_JOURNEY_DEPENDENCY };
      }
      return { ok: false, code: "UNAVAILABLE", message: error.message };
    }
    const rows = (data ?? []).map((row) => {
      const companiesRaw = row.companies;
      const companies = Array.isArray(companiesRaw)
        ? companiesRaw.flatMap((item) => {
          if (!isPlainObject(item)) return [];
          if (typeof item.company_id !== "string" || typeof item.display_name !== "string") return [];
          if (item.role !== "owner" && item.role !== "staff") return [];
          if (item.status !== "active" && item.status !== "disabled") return [];
          const rawStatus = item.company_status;
          const companyStatus: CompanyStatus | null =
            rawStatus === "setup" || rawStatus === "active" || rawStatus === "suspended"
              ? rawStatus
              : null;
          return [{
            company_id: item.company_id,
            display_name: item.display_name,
            role: item.role as CompanyRole,
            status: item.status as "active" | "disabled",
            company_status: companyStatus,
            business_phone: typeof item.business_phone === "string" ? item.business_phone : null,
          }];
        })
        : [];
      const rowRec = row as Record<string, unknown>;
      const emailConfirmed: boolean | null = Object.prototype.hasOwnProperty.call(rowRec, "email_confirmed")
        ? rowRec.email_confirmed === true
        : null;
      return {
        user_id: row.user_id,
        support_code: typeof row.support_code === "string" && row.support_code.trim()
          ? row.support_code
          : null,
        full_name: typeof row.full_name === "string" && row.full_name.trim()
          ? row.full_name
          : null,
        email: row.email,
        account_phone: row.account_phone,
        email_confirmed: emailConfirmed,
        companies,
      } satisfies AdminAccountSearchItem;
    });
    const nextOffset = offset + limit;
    const hasMore = rows.length >= limit && nextOffset <= ADMIN_ACCOUNT_SEARCH_MAX_OFFSET;
    const atBrowseWindowEnd = rows.length >= limit && nextOffset > ADMIN_ACCOUNT_SEARCH_MAX_OFFSET;
    return {
      ok: true,
      data: {
        query,
        offset,
        limit,
        rows,
        hasMore,
        atBrowseWindowEnd,
        maxOffset: ADMIN_ACCOUNT_SEARCH_MAX_OFFSET,
      },
    };
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

function isMissingAdminConversationsRpcError(message?: string | null): boolean {
  const m = (message ?? "").toLowerCase();
  return (
    (m.includes("admin_list_company_conversations")
      && (m.includes("could not find") || m.includes("does not exist") || m.includes("schema cache")))
    || m.includes("pgrst202")
  );
}

function mapConversationRows(
  convs: unknown[],
): AdminCompanyConversationsView["conversations"] {
  return convs.flatMap((c) => {
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
  });
}

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
    if (error) {
      if (isMissingAdminConversationsRpcError(error.message)) {
        return {
          ok: false,
          code: "UNAVAILABLE",
          message: ADMIN_CONVERSATIONS_RPC_DEPENDENCY,
        };
      }
      return { ok: false, code: "UNAVAILABLE", message: error.message };
    }
    if (!isPlainObject(data) || data.ok !== true) {
      if (isPlainObject(data) && data.code === "NOT_FOUND") {
        return { ok: false, code: "INVALID_INPUT", message: "NOT_FOUND" };
      }
      if (isPlainObject(data) && data.code === "INVALID_PHONE") {
        return { ok: false, code: "INVALID_INPUT", message: "INVALID_PHONE" };
      }
      if (isPlainObject(data) && (data.code === "FORBIDDEN" || data.code === "forbidden")) {
        return { ok: false, code: "FORBIDDEN", message: String(data.code) };
      }
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: isPlainObject(data) ? String(data.code ?? "bad_rpc_payload") : "bad_rpc_payload",
      };
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
        conversations: mapConversationRows(convs),
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
