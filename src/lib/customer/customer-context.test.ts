import { describe, expect, it } from "vitest";
import { buildCustomerContextFromPrepDraft, CUSTOMER_CONTEXT_VERSION } from "./customer-context";
import type { AccountPrepDraftRecord } from "@/lib/tenancy/account-prep-draft";

const ACCOUNT = "22222222-2222-4222-8222-222222222222";

const draft: AccountPrepDraftRecord = {
  draftId: "11111111-1111-4111-8111-111111111111",
  accountId: ACCOUNT,
  payload: { name: "Cafe", type: "broad:food", goals: ["support"] },
  version: 2,
  state: "active",
  createdAt: "2026-10-25T00:00:00.000Z",
  updatedAt: "2026-10-25T01:00:00.000Z",
  expiresAt: "2027-02-25T00:00:00.000Z",
};

describe("CustomerContext v1 contract", () => {
  it("keeps declared sources separate from derived hints and forbids AI dispatch", () => {
    const ctx = buildCustomerContextFromPrepDraft(ACCOUNT, draft, "2026-10-25T02:00:00.000Z");
    expect(ctx.version).toBe(CUSTOMER_CONTEXT_VERSION);
    expect(ctx.derived.businessId).toBeNull();
    expect(ctx.derived.displayNameHint).toBe("Cafe");
    expect(ctx.derived.goalHints).toEqual(["support"]);
    expect(ctx.aiEligibility.maySendToProvider).toBe(false);
    expect(ctx.sources.some((s) => s.kind === "account_prep_draft")).toBe(true);
  });

  it("ignores a draft owned by another account", () => {
    const ctx = buildCustomerContextFromPrepDraft("33333333-3333-4333-8333-333333333333", draft);
    expect(ctx.sources.some((s) => s.kind === "account_prep_draft")).toBe(false);
    expect(ctx.derived.displayNameHint).toBeNull();
  });
});

it.each(['linked','expired_pending_cleanup','cancelled'] as const)('excludes inactive %s draft from both source and derived hints',state=>{
 const ctx=buildCustomerContextFromPrepDraft(ACCOUNT,{...draft,state},'2026-10-25T02:00:00.000Z');expect(ctx.sources.some(s=>s.kind==='account_prep_draft')).toBe(false);expect(ctx.derived.displayNameHint).toBeNull();expect(ctx.derived.goalHints).toEqual([]);expect(ctx.aiEligibility.declaredFieldKeys).toEqual([]);
});
it.each(['2027-02-25T00:00:00.000Z','2027-02-26T00:00:00.000Z','invalid'])('excludes expired or unverifiable draft context at %s',asOf=>{
 const ctx=buildCustomerContextFromPrepDraft(ACCOUNT,draft,asOf);expect(ctx.sources.some(s=>s.kind==='account_prep_draft')).toBe(false);expect(ctx.derived.sectorHint).toBeNull();expect(ctx.aiEligibility.maySendToProvider).toBe(false);expect(ctx.aiEligibility.declaredFieldKeys).toEqual([]);
});
