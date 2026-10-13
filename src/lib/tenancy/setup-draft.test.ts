import { describe, it, expect } from "vitest";
import { setupDraftPayload, setupDraftFromRow, setupDraftScopeAllowed } from "./setup-draft";
import { emptyCompanyDraft, draftAllowedFor } from "../company-draft";
import { hydrateOnboardingDraft, companyBusiness } from "@/components/app/onboarding-contracts";
import type { CompanyRecord } from "./types";

const scope = { expectedUserId: "owner", expectedCompanyId: null };
const context = { userId: "owner", company: null, membership: null, needsCompanyContext: false, isPlatformAdmin: false };
const company: CompanyRecord = { id: "company", display_name: "Saved", status: "setup", business_type: "other", reply_language: "both", country: "OM", city: "Muscat", hours: "9–5", contact_phone: "", contact_email: "", created_by: "owner", created_at: "", updated_at: "" };

describe("server setup progress contract", () => {
  it("allows a valid partial draft without claiming company completion", () => {
    const draft = emptyCompanyDraft("owner");
    draft.business.city = "Muscat";
    expect(setupDraftPayload(draft)?.business.city).toBe("Muscat");
    expect(setupDraftPayload(draft)).not.toHaveProperty("setupDone");
    expect(setupDraftPayload({ ...draft, business: { ...draft.business, contactEmail: "invalid" } })).toBeNull();
    expect(setupDraftPayload({ ...draft, setupStep: 9 })).toBeNull();
    expect(setupDraftPayload({ ...draft, business: { ...draft.business, password: "secret" } })).toBeNull();
  });
  it("rejects changed accounts, company scopes, staff, and unresolved workspaces", () => {
    expect(setupDraftScopeAllowed(scope, context)).toBe(true);
    expect(setupDraftScopeAllowed({ ...scope, expectedUserId: "previous" }, context)).toBe(false);
    expect(setupDraftScopeAllowed(scope, { ...context, company: { id: "new-company" } })).toBe(false);
    expect(setupDraftScopeAllowed(scope, { ...context, needsCompanyContext: true })).toBe(false);
    expect(setupDraftScopeAllowed(scope, { ...context, membership: { role: "staff" } })).toBe(false);
    expect(draftAllowedFor({ ...emptyCompanyDraft("owner"), companyId: "company" }, "owner", null)).toBe(false);
  });
  it("validates durable receipts against the rendered account and exact company", () => {
    const row = { user_id: "owner", company_id: null, payload: setupDraftPayload(emptyCompanyDraft("owner")), revision: 1, updated_at: "2026-10-14" };
    expect(setupDraftFromRow(row, scope)?.revision).toBe(1);
    expect(setupDraftFromRow(row, { ...scope, expectedUserId: "other" })).toBeNull();
    expect(setupDraftFromRow({ ...row, company_id: "company" }, scope)).toBeNull();
    expect(setupDraftFromRow({ ...row, revision: 0 }, scope)).toBeNull();
  });
  it("restores unsaved company edits while refreshing untouched server fields", () => {
    const baseline = companyBusiness(company);
    const draft = { ...emptyCompanyDraft("owner"), companyId: company.id, businessBaseline: baseline,
      business: { ...baseline, city: "Salalah" }, setupStep: 4 };
    const restored = hydrateOnboardingDraft(draft, "owner", { ...company, hours: "10–6" });
    expect(restored.business.city).toBe("Salalah");
    expect(restored.business.hours).toBe("10–6");
    expect(restored.setupStep).toBe(4);
    expect(hydrateOnboardingDraft(draft, "other", company).business.city).toBe("Muscat");
  });
});
