import type { Business } from "@/lib/demo-state";
import { emptyCompanyDraft, type CompanyDraft } from "@/lib/company-draft";
import type { CompanyRecord, CompanyReviewRequest } from "@/lib/tenancy/types";
import type { CustomerReadinessSnapshot } from "@/lib/tenancy/customer-readiness";
import type { WhatsappCompanyLink } from "@/lib/whatsapp/connection";
import type { WhatsappInboxLoad } from "@/lib/whatsapp/inbox";
import type { WhatsappInboxPage } from "@/lib/whatsapp/inbox-contracts";

export type DashboardInboxLoad =
  | (Extract<WhatsappInboxLoad, { ok: true }> & { page?: WhatsappInboxPage })
  | Extract<WhatsappInboxLoad, { ok: false }>
  | { ok: false; code: "FORBIDDEN" };

export function dashboardInboxMetrics(load: DashboardInboxLoad, expectedCompanyId?: string | null) {
  if (!load.ok || (expectedCompanyId && load.meta.companyId !== expectedCompanyId)) {
    return { total: null, loadedAutomationPermitted: null, loadedAwaitingStaff: null };
  }
  return {
    total: load.page?.total ?? load.meta.counts.all,
    loadedAutomationPermitted: load.conversations.filter(c => c.automationAllowed && !c.assistantPaused).length,
    // A partial timeline cannot classify older unanswered messages. Durable
    // intervention totals come from SQL across the authorized workspace.
    loadedAwaitingStaff: load.page ? load.page.interventionTotal : load.meta.counts.awaiting_staff,
  };
}

export function companyBusiness(company: CompanyRecord): Business {
  return {
    name: company.display_name, type: company.business_type as Business["type"],
    replyLanguage: company.reply_language, country: company.country, city: company.city,
    hours: company.hours, contactPhone: company.contact_phone, contactEmail: company.contact_email,
  };
}

/** Local storage remembers navigation and an uncreated draft, never saved company facts. */
export function hydrateOnboardingDraft(stored: CompanyDraft | null, userId: string, company: CompanyRecord | null): CompanyDraft {
  const sameScope = stored?.userId === userId && stored.companyId === (company?.id ?? null);
  const draft = sameScope && stored ? { ...stored } : emptyCompanyDraft(userId);
  if (company) return { ...draft, companyId: company.id, business: companyBusiness(company), businessSaved: true };
  return { ...draft, companyId: null, businessSaved: false, setupTestPassed: false, setupTestCompanyId: null, setupTestKnowledgeKey: null };
}

/** A denied save or a response for another workspace cannot advance local progress. */
export function finishCompanySave(
  result: { ok: boolean; data?: CompanyRecord }, expectedCompanyId: string | null,
  adopt: (company: CompanyRecord) => void, advance: () => void,
): boolean {
  if (!result.ok || !result.data?.id || (expectedCompanyId && result.data.id !== expectedCompanyId)) return false;
  adopt(result.data);
  advance();
  return true;
}

/** Verification, current authorization, test evidence and deployment are separate claims. */
export function whatsappUiState(link: WhatsappCompanyLink | null, liveOpsReady: boolean, now = Date.now()) {
  const verified = link?.status === "verified";
  const expires = link?.authorizationExpiresAt;
  const authorizationReady = verified && link?.authorizationReady === true
    && (!expires || (Number.isFinite(Date.parse(expires)) && Date.parse(expires) > now));
  const tested = verified && link?.receptionSendTested === true;
  return { verified, authorizationReady, tested, rolloutReady: authorizationReady && tested && liveOpsReady };
}

/** Only server records complete persisted milestones. The trial marker stays local navigation. */
export function setupMilestones(input: {
  company: CompanyRecord | null; knowledgeComplete: boolean; readiness: CustomerReadinessSnapshot | null;
  link: WhatsappCompanyLink | null; review: CompanyReviewRequest | null; reviewLoadFailed: boolean;
}): boolean[] {
  const company = input.company;
  const readiness = input.readiness?.companyId === company?.id ? input.readiness : null;
  const link = input.link?.companyId === company?.id ? input.link : null;
  const review = input.review?.company_id === company?.id ? input.review : null;
  return [
    Boolean(company?.display_name.trim()),
    readiness?.items.some(item => item.id === "subscription" && item.detail === "subscription_active" && item.tone === "complete") ?? false,
    Boolean(company?.hours.trim()),
    Boolean(company) && input.knowledgeComplete,
    Boolean(company?.reply_language),
    whatsappUiState(link, false).authorizationReady,
    false,
    !input.reviewLoadFailed && review?.status === "approved" && review.proof_current === true,
  ];
}

/** Initial navigation resolver; completion remains entirely server-derived. */
export function resolveSetupResumeStep(stored: CompanyDraft | null, userId: string, company: CompanyRecord | null, done: boolean[]): number {
  if (!company) return 0;
  if (stored?.userId === userId && stored.companyId === company.id && Number.isInteger(stored.setupStep) && stored.setupStep >= 0 && stored.setupStep <= 7) return stored.setupStep;
  const firstOpen = done.findIndex(value => !value);
  return firstOpen === -1 ? 7 : Math.min(7, firstOpen);
}
