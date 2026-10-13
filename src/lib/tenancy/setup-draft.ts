import type { Business } from "@/lib/demo-state";
import type { CompanyDraft } from "@/lib/company-draft";
import { normalizeBusinessEmail, normalizeBusinessPhone } from "./business-contacts";

export type SetupDraftScope = { expectedUserId: string; expectedCompanyId: string | null };
export type SetupDraftRecord = { draft: CompanyDraft; revision: number; updatedAt: string };
export type SetupDraftCode = "UNAUTHENTICATED" | "UNVERIFIED" | "FORBIDDEN" | "UNAVAILABLE" | "INVALID_INPUT" | "CONFLICT";
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
  const record = row as { user_id: string; company_id: string | null; payload: unknown; revision: number; updated_at: string };
  const payload = setupDraftPayload(record.payload);
  if (!payload || record.user_id !== scope.expectedUserId || record.company_id !== scope.expectedCompanyId
    || !Number.isSafeInteger(record.revision) || record.revision < 1 || typeof record.updated_at !== "string") return null;
  return { draft: { version: 1, userId: scope.expectedUserId, companyId: scope.expectedCompanyId, setupDone: [], businessSaved: false, ...payload }, revision: record.revision, updatedAt: record.updated_at };
}

export function setupDraftScopeAllowed(scope: SetupDraftScope, context: {
  userId: string; company: { id: string } | null; membership: { role: string } | null; needsCompanyContext: boolean; isPlatformAdmin: boolean;
}): boolean {
  return Boolean(scope && scope.expectedUserId === context.userId && scope.expectedCompanyId === (context.company?.id ?? null)
    && !context.needsCompanyContext && (!context.membership || context.membership.role === "owner")
    && (!context.isPlatformAdmin || context.company));
}
