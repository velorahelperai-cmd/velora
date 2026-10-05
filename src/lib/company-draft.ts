import type { Business } from "@/lib/demo-state";
import { emptyBusiness } from "@/lib/demo-state";

export const COMPANY_DRAFT_PREFIX = "velora_company_draft_v1:";

/** Minimal knowledge snapshot for local setup-test binding (not a server proof). */
export type SetupTestKnowledgeSnap = {
  id: string;
  status: string;
  content_version: number | null;
  approved_version: number | null;
  approved_for_answers: boolean;
};

export type CompanyDraft = {
  version: 1;
  userId: string;
  companyId: string | null;
  business: Business;
  setupStep: number;
  setupDone: boolean[];
  businessSaved: boolean;
  /**
   * Local UI progress only after a successful tester answer (result.ok).
   * Not proof of live AI, billing, or WhatsApp. Requires company + knowledge key binding.
   */
  setupTestPassed?: boolean;
  /** Company id that was bound when the local test marker was set. */
  setupTestCompanyId?: string | null;
  /** Fingerprint of knowledge foundation + sources at test time. */
  setupTestKnowledgeKey?: string | null;
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
    setupTestPassed: false,
    setupTestCompanyId: null,
    setupTestKnowledgeKey: null,
  };
}

/** Stable local key for company + approval foundation + source versions/approvals. */
export function buildSetupTestKnowledgeKey(
  companyId: string | null,
  approvalFoundation: "ready" | "unavailable",
  sources: SetupTestKnowledgeSnap[],
): string {
  const parts = [...sources]
    .map((s) =>
      [
        s.id,
        s.status,
        s.content_version ?? "x",
        s.approved_version ?? "x",
        s.approved_for_answers ? "1" : "0",
      ].join(":"),
    )
    .sort();
  return `${companyId ?? ""}|${approvalFoundation}|${parts.join(",")}`;
}

/** Unbound or mismatched local markers do not count as a successful assistant test. */
export function isSetupTestStillValid(
  draft: Pick<
    CompanyDraft,
    "setupTestPassed" | "setupTestCompanyId" | "setupTestKnowledgeKey"
  >,
  companyId: string | null,
  knowledgeKey: string,
): boolean {
  if (draft.setupTestPassed !== true) return false;
  if (!draft.setupTestCompanyId || !draft.setupTestKnowledgeKey) return false;
  if (!companyId || draft.setupTestCompanyId !== companyId) return false;
  if (draft.setupTestKnowledgeKey !== knowledgeKey) return false;
  return true;
}

export function clearSetupTestProgress(draft: CompanyDraft): CompanyDraft {
  return {
    ...draft,
    setupTestPassed: false,
    setupTestCompanyId: null,
    setupTestKnowledgeKey: null,
    setupDone: draft.setupDone.map((done, i) => (i === 2 ? false : done)),
  };
}

export function markSetupTestPassed(
  draft: CompanyDraft,
  companyId: string,
  knowledgeKey: string,
): CompanyDraft {
  if (!companyId || !knowledgeKey) return clearSetupTestProgress(draft);
  return {
    ...draft,
    setupTestPassed: true,
    setupTestCompanyId: companyId,
    setupTestKnowledgeKey: knowledgeKey,
    setupDone: draft.setupDone.map((done, i) => (i === 2 ? true : done)),
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
      setupTestPassed: parsed.setupTestPassed === true,
      setupTestCompanyId:
        typeof parsed.setupTestCompanyId === "string" ? parsed.setupTestCompanyId : null,
      setupTestKnowledgeKey:
        typeof parsed.setupTestKnowledgeKey === "string" ? parsed.setupTestKnowledgeKey : null,
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
