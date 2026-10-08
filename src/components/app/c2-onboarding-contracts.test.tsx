import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyCompanyDraft } from "@/lib/company-draft";
import type { CompanyRecord, CompanyReviewRequest } from "@/lib/tenancy/types";
import type { WhatsappCompanyLink } from "@/lib/whatsapp/connection";
import { dashboardInboxMetrics, finishCompanySave, hydrateOnboardingDraft, setupMilestones, whatsappUiState, type DashboardInboxLoad } from "./onboarding-contracts";
import { SubscriptionCompareTable, SubscriptionOfferCards } from "./subscription-offer-cards";
import { isPurchasableOffer, type SubscriptionOfferView } from "./subscription-offers-view";

const company: CompanyRecord = {
  id: "11111111-1111-4111-8111-111111111111", display_name: "Actual Company", status: "setup",
  business_type: "retail", reply_language: "en", country: "OM", city: "Sohar", hours: "10–18",
  contact_phone: "+96890000000", contact_email: "owner@example.test", created_by: "owner",
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-08T00:00:00Z",
};
const link: WhatsappCompanyLink = {
  id: "link", companyId: company.id, requestedDisplayNumber: "+96890000000", keepOnPhone: false,
  status: "verified", verifiedDisplayNumber: "+96890000000", inboundTestedAt: "2026-10-01T00:00:00Z",
  outboundTestedAt: "2026-10-01T00:00:00Z", receptionSendTested: true, priorLinkEvidence: false,
  lastErrorCode: null, createdAt: null, updatedAt: null, authorizationReady: true,
  authorizationExpiresAt: "2026-11-01T00:00:00Z",
};
const offer: SubscriptionOfferView = {
  versionId: "version", planId: "plan", persona: "level_1", package: "basic", term: "monthly",
  amountBaisa: 45000, currency: "OMR", automatedOutboundPerMonth: 734,
  quotaEnforcement: "not_verified", features: [],
};

describe("authoritative onboarding state", () => {
  it("replaces stale saved local company facts with the current server company", () => {
    const draft = emptyCompanyDraft("owner");
    draft.companyId = company.id; draft.businessSaved = true; draft.business.name = "Old name";
    draft.business.hours = "invented hours";
    expect(hydrateOnboardingDraft(draft, "owner", company).business).toMatchObject({ name: "Actual Company", hours: "10–18", replyLanguage: "en" });
  });
  it("does not carry another company's saved facts or test progress into an empty workspace", () => {
    const draft = emptyCompanyDraft("owner"); draft.companyId = company.id;
    draft.businessSaved = true; draft.setupTestPassed = true;
    const reset = hydrateOnboardingDraft(draft, "owner", null);
    expect(reset.businessSaved).toBe(false); expect(reset.setupTestPassed).toBe(false);
  });
  it("does not mark plan, Meta verification or trials complete from local progress", () => {
    const done = setupMilestones({ company, knowledgeComplete: true, readiness: null, link: { ...link, status: "request_saved" }, review: null, reviewLoadFailed: false });
    expect(done).toEqual([true, false, true, true, true, false, false, false]);
  });
  it("does not count another company's review or Meta authorization toward this journey", () => {
    const review = { company_id: "another-company", status: "approved" } as CompanyReviewRequest;
    const done = setupMilestones({ company, knowledgeComplete: true, readiness: null, link: { ...link, companyId: "another-company" }, review, reviewLoadFailed: false });
    expect(done[5]).toBe(false); expect(done[7]).toBe(false);
  });
  it("does not adopt a failed save or advance the journey", () => {
    const adopt = vi.fn(), advance = vi.fn();
    expect(finishCompanySave({ ok: false }, company.id, adopt, advance)).toBe(false);
    expect(adopt).not.toHaveBeenCalled(); expect(advance).not.toHaveBeenCalled();
  });
  it("rejects a different company response and advances only after a scoped server save", () => {
    const order: string[] = [];
    expect(finishCompanySave({ ok: true, data: company }, "another-company", () => order.push("adopt"), () => order.push("advance"))).toBe(false);
    expect(order).toEqual([]);
    expect(finishCompanySave({ ok: true, data: company }, company.id, () => order.push("adopt"), () => order.push("advance"))).toBe(true);
    expect(order).toEqual(["adopt", "advance"]);
  });
});

describe("Meta verification and rollout boundaries", () => {
  const now = Date.parse("2026-10-08T00:00:00Z");
  it("keeps pending external action unverified even with historical tests", () => {
    expect(whatsappUiState({ ...link, status: "needs_external_action" }, true, now)).toMatchObject({ verified: false, tested: false, rolloutReady: false });
  });
  it("retains verification while the deployment rollout is disabled", () => {
    expect(whatsappUiState(link, false, now)).toMatchObject({ verified: true, authorizationReady: true, tested: true, rolloutReady: false });
  });
  it("blocks expired or absent authorization despite verification and tests", () => {
    expect(whatsappUiState({ ...link, authorizationExpiresAt: "2026-10-07T00:00:00Z" }, true, now).rolloutReady).toBe(false);
    expect(whatsappUiState({ ...link, authorizationReady: undefined }, true, now).rolloutReady).toBe(false);
  });
});

describe("catalog evidence", () => {
  it("never uses a mismatched or differently priced offer for approved test checkout", () => {
    expect(isPurchasableOffer("level_1", "basic", "monthly", { ...offer, persona: "level_2" }, "ready")).toBe(false);
    expect(isPurchasableOffer("level_1", "basic", "monthly", { ...offer, amountBaisa: 46000 }, "ready")).toBe(false);
  });
  it("does not invent message capacity or available capabilities when the catalog is missing", () => {
    const markup = renderToStaticMarkup(createElement(SubscriptionCompareTable, { locale: "en", term: "monthly", offers: [], catalogStatus: "unconfigured", selectedPersona: null }));
    expect(markup).not.toContain("1,000"); expect(markup).not.toContain(">Available<");
  });
  it("shows the authoritative quota once without a fixed tier quota", () => {
    const markup = renderToStaticMarkup(createElement(SubscriptionOfferCards, { locale: "en", term: "monthly", offers: [offer], catalogStatus: "ready", selectedPersona: null, onSelect: () => {} }));
    expect(markup).toContain("734"); expect(markup).not.toContain("1,000");
  });
  it("does not carry monthly availability into the unpublished annual matrix", () => {
    const monthly = { ...offer, features: [{ id: "faq", label: { ar: "أسئلة", en: "FAQ" }, availability: "ready" as const }] };
    const markup = renderToStaticMarkup(createElement(SubscriptionCompareTable, { locale: "en", term: "yearly", offers: [monthly], catalogStatus: "ready", selectedPersona: null }));
    expect(markup).not.toContain('data-availability="ready"');
  });
});

describe("bounded dashboard totals", () => {
  const page = { ok: true, conversations: [], meta: { companyId: company.id, counts: { all: 40, awaiting_staff: 3 } }, page: { total: 473, interventionTotal: 55 } } as unknown as DashboardInboxLoad;
  it("uses the database total without promoting loaded worklists to company-wide counts", () => {
    expect(dashboardInboxMetrics(page)).toEqual({ total: 473, loadedAutomationPermitted: 0, loadedAwaitingStaff: 55 });
  });
  it("hides stale workspace metrics when readiness belongs to another company", () => {
    expect(dashboardInboxMetrics(page, "another-company").total).toBeNull();
  });
});
