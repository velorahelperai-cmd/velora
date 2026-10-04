import type { Business } from "@/lib/demo-state";
import { emptyBusiness } from "@/lib/demo-state";

export const COMPANY_DRAFT_PREFIX = "velora_company_draft_v1:";

export type CompanyDraft = {
  version: 1;
  userId: string;
  companyId: string | null;
  business: Business;
  setupStep: number;
  setupDone: boolean[];
  businessSaved: boolean;
};

function keyFor(userId: string) {
  return `${COMPANY_DRAFT_PREFIX}${userId}`;
}

export function emptyCompanyDraft(userId: string): CompanyDraft {
  return {
    version: 1,
    userId,
    companyId: null,
    business: { ...emptyBusiness },
    setupStep: 0,
    setupDone: [false, false, false, false],
    businessSaved: false,
  };
}

export function readCompanyDraft(userId: string): CompanyDraft | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CompanyDraft>;
    if (parsed.version !== 1 || parsed.userId !== userId) return null;
    return {
      ...emptyCompanyDraft(userId),
      ...parsed,
      userId,
      business: { ...emptyBusiness, ...(parsed.business ?? {}) },
      setupDone: Array.isArray(parsed.setupDone) ? parsed.setupDone : [false, false, false, false],
    };
  } catch {
    return null;
  }
}

export function writeCompanyDraft(draft: CompanyDraft): void {
  if (typeof window === "undefined" || !draft.userId) return;
  try {
    window.localStorage.setItem(keyFor(draft.userId), JSON.stringify(draft));
  } catch {
    /* storage unavailable */
  }
}

/** Remove one user's company draft. No-op when userId is missing (never wipe all drafts). */
export function clearCompanyDrafts(userId: string | null | undefined): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.removeItem(keyFor(userId));
  } catch {
    /* ignore */
  }
}

/** Draft may be used only for the signed-in user, and only for their company (or none yet). */
export function draftAllowedFor(
  draft: CompanyDraft | null,
  userId: string,
  companyId: string | null,
): draft is CompanyDraft {
  if (!draft || draft.userId !== userId) return false;
  if (companyId && draft.companyId && draft.companyId !== companyId) return false;
  return true;
}
