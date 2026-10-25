/**
 * CustomerContext v1 — contract only (DEC-PREP-SERVER-DRAFT-001 Phase D).
 * No AI provider calls. Declared sources vs derived fields stay separate.
 */

import type { AccountPrepDraftPayload, AccountPrepDraftRecord } from "@/lib/tenancy/account-prep-draft";
import type { OnboardingAnswers } from "@/lib/tenancy/onboarding-answers";

export const CUSTOMER_CONTEXT_VERSION = 1 as const;

/** Originals: persisted or user-entered sources. Never invent derived facts here. */
export type CustomerContextSource =
  | { kind: "account_prep_draft"; draftId: string; accountId: string; version: number; payload: AccountPrepDraftPayload; expiresAt: string }
  | { kind: "onboarding_answers"; answers: OnboardingAnswers }
  | { kind: "account_identity"; accountId: string };

/** Derived projections — must cite source keys; not authoritative for entitlements. */
export type CustomerContextDerived = {
  /** Display hint only; not a business_id. */
  displayNameHint: string | null;
  /** Sector/type hint from prep draft; not catalog authority. */
  sectorHint: string | null;
  /** Goal codes from prep/answers; not campaign authorization. */
  goalHints: string[];
  /** Explicitly not linked until settlement. */
  businessId: null;
  branchId: null;
  orderId: null;
  subscriptionId: null;
};

export type CustomerContextV1 = {
  version: typeof CUSTOMER_CONTEXT_VERSION;
  accountId: string;
  asOf: string; // UTC ISO Z
  sources: CustomerContextSource[];
  derived: CustomerContextDerived;
  /** AI eligibility: declared fields only; no provider dispatch from this contract. */
  aiEligibility: {
    maySendToProvider: false;
    declaredFieldKeys: string[];
  };
};

export function buildCustomerContextFromPrepDraft(
  accountId: string,
  draft: AccountPrepDraftRecord | null,
  asOf: string = new Date().toISOString(),
): CustomerContextV1 {
  const sources: CustomerContextSource[] = [{ kind: "account_identity", accountId }];
  const currentDraft=draft&&draft.accountId===accountId&&draft.state==="active"&&Number.isFinite(Date.parse(asOf))&&Date.parse(draft.expiresAt)>Date.parse(asOf)?draft:null;
  if (currentDraft) {
    sources.push({
      kind: "account_prep_draft",
      draftId: currentDraft.draftId,
      accountId: currentDraft.accountId,
      version: currentDraft.version,
      payload: currentDraft.payload,
      expiresAt: currentDraft.expiresAt,
    });
  }
  const payload = currentDraft?.payload;
  return {
    version: CUSTOMER_CONTEXT_VERSION,
    accountId,
    asOf,
    sources,
    derived: {
      displayNameHint: payload?.name?.trim() || null,
      sectorHint: payload?.type?.trim() || null,
      goalHints: payload?.goals ? [...payload.goals] : [],
      businessId: null,
      branchId: null,
      orderId: null,
      subscriptionId: null,
    },
    aiEligibility: {
      maySendToProvider: false,
      declaredFieldKeys: payload
        ? Object.keys(payload).filter((key) => payload[key as keyof AccountPrepDraftPayload] !== undefined)
        : [],
    },
  };
}
