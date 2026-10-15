import type { Business } from "@/lib/demo-state";
import type { CompanyDraft } from "@/lib/company-draft";
import { normalizeBusinessEmail, normalizeBusinessPhone } from "./business-contacts";

export type SetupDraftScope = { expectedUserId: string; expectedCompanyId: string | null; allowNewBusiness?: boolean; expectedDraftId?: string; expectedGeneration?: number };
export type SetupDraftState = "active" | "completed" | "cancelled" | "deletion_pending" | "legacy_conflict";
export type SetupDraftLifecycleRecord = { draftId: string; revision: number; generation: number; state: SetupDraftState; updatedAt: string; expiresAt: string | null; paidProtected: boolean; cleanupPolicy: "UNCONFIGURED" };
export type SetupDraftRecord = { draft: CompanyDraft; revision: number; updatedAt: string } & Partial<SetupDraftLifecycleRecord>;
export type SetupDraftCancellationPreview = { confirmationToken: string; scopedFileCount: number; unscopedFilesIncluded: false; cleanupPolicy: "UNCONFIGURED"; scope: "draft_payload_only" | "draft_and_setup_files"; companyPreserved: true };
export type SetupDraftCode = "UNAUTHENTICATED" | "UNVERIFIED" | "FORBIDDEN" | "UNAVAILABLE" | "UNCONFIGURED" | "INVALID_INPUT" | "CONFLICT" | "ACTIVE_DRAFT_EXISTS" | "LEGACY_DRAFT_CONFLICT" | "DRAFT_CLOSED" | "DRAFT_EXPIRED" | "DRAFT_BINDING_REQUIRED" | "CONFIRMATION_REQUIRED" | "COMPANY_REQUIRED";
export type SetupDraftResult<T> = { ok: true; data: T } | { ok: false; code: SetupDraftCode };
const limits: Record<keyof Business, number> = {
  name: 120, type: 80, replyLanguage: 4, country: 80, city: 160, hours: 2000, contactPhone: 40, contactEmail: 254,
};

/** A partial profile is valid progress; malformed contacts never receive a save receipt. */
export function validDraftBusiness(value: unknown): value is Business {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const business = value as Business;
  return Object.keys(business).every(key => Object.hasOwn(limits, key))
    && Object.entries(limits).every(([key, limit]) => typeof business[key as keyof Business] === "string"
    && business[key as keyof Business].length <= limit
    && !/[\u0000-\u001f\u007f]/.test(business[key as keyof Business]))
    && ["ar", "en", "both"].includes(business.replyLanguage)
    && normalizeBusinessEmail(business.contactEmail) !== null
    && normalizeBusinessPhone(business.contactPhone) !== null;
}

/** Persist only editable progress. Completion and activation are always server facts. */
export function setupDraftPayload(value: unknown): { business: Business; businessBaseline?: Business; setupStep: number } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as CompanyDraft;
  if (!validDraftBusiness(draft.business) || !Number.isInteger(draft.setupStep) || draft.setupStep < 0 || draft.setupStep > 7
    || (draft.businessBaseline !== undefined && !validDraftBusiness(draft.businessBaseline))) return null;
  return { business: { ...draft.business }, ...(draft.businessBaseline ? { businessBaseline: { ...draft.businessBaseline } } : {}), setupStep: draft.setupStep };
}

export function setupDraftFromRow(row: unknown, scope: SetupDraftScope): SetupDraftRecord | null {
  if (!row || typeof row !== "object") return null;
  const record = row as { user_id: string; company_id: string | null; payload: unknown; revision: number; updated_at: string; state?: string };
  const payload = setupDraftPayload(record.payload);
  if (!payload || record.user_id !== scope.expectedUserId || record.company_id !== scope.expectedCompanyId
    || !Number.isSafeInteger(record.revision) || record.revision < 1 || typeof record.updated_at !== "string"
    || (record.state !== undefined && record.state !== "active")) return null;
  const lifecycle = record.state === undefined ? null : setupDraftLifecycleFromRow(row, scope);
  if (record.state !== undefined && !lifecycle) return null;
  return { draft: { version: 1, userId: scope.expectedUserId, companyId: scope.expectedCompanyId, setupDone: [], businessSaved: false, ...payload }, revision: record.revision, updatedAt: record.updated_at, ...(lifecycle ?? {}) };
}

export function setupDraftLifecycleFromRow(row: unknown, scope: SetupDraftScope): SetupDraftLifecycleRecord | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (r.user_id !== scope.expectedUserId || r.company_id !== scope.expectedCompanyId
    || typeof r.draft_id !== "string" || !r.draft_id || (scope.expectedDraftId && r.draft_id !== scope.expectedDraftId)
    || !Number.isSafeInteger(r.revision) || Number(r.revision) < 1 || !Number.isSafeInteger(r.generation) || Number(r.generation) < 1
    || typeof r.updated_at !== "string" || !["active", "completed", "cancelled", "deletion_pending", "legacy_conflict"].includes(String(r.state))
    || !(r.expires_at === null || typeof r.expires_at === "string") || r.cleanup_policy !== "UNCONFIGURED"
    || !(r.paid_protected_at === null || typeof r.paid_protected_at === "string")) return null;
  return { draftId: r.draft_id, revision: Number(r.revision), generation: Number(r.generation), state: r.state as SetupDraftState,
    updatedAt: r.updated_at, expiresAt: r.expires_at as string | null, paidProtected: r.paid_protected_at !== null, cleanupPolicy: "UNCONFIGURED" };
}

export function setupDraftScopeAllowed(scope: SetupDraftScope, context: {
  userId: string; company: { id: string } | null; membership: { role: string } | null; needsCompanyContext: boolean; isPlatformAdmin: boolean;
}): boolean {
  const explicitAdditional = scope.expectedCompanyId === null && scope.allowNewBusiness && context.membership?.role === "owner";
  return Boolean(scope && scope.expectedUserId === context.userId && (scope.expectedCompanyId === (context.company?.id ?? null) || explicitAdditional)
    && !context.needsCompanyContext && (!context.membership || context.membership.role === "owner")
    && (!context.isPlatformAdmin || context.company));
}
