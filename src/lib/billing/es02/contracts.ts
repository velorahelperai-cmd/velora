/**
 * ES02 frozen shared contracts — account-bound purchase authority.
 * Server account ID owns orders; email/browser hints never authorize.
 * PAYMOB_EXTERNAL_VERIFICATION: Deferred. Synthetic settlement is fixture-only.
 */

import type { SubscriptionPackage, SubscriptionPersona, SubscriptionTerm } from "@/components/app/subscription-offers-view";
import { legacyCommercialCatalogRevision, type CommercialCatalogRevision } from "@/components/app/subscription-commercial-catalog";

export const ES02_PURPOSE_INITIAL_SUBSCRIPTION = "initial_subscription" as const;
export const ES02_CURRENCY = "OMR" as const;
export const ES02_PRODUCT_CODE = "velora_subscription" as const;
// Existing unaffected billing offers retain their frozen revision.
export const ES02_CATALOG_REVISION = legacyCommercialCatalogRevision;

/** Synthetic evidence marker — fixture-owned path only; never customer/Production authority. */
export const ES02_SYNTHETIC_EVIDENCE_MARKER = "VEL_ES02_SYNTHETIC_LOCAL_ONLY" as const;
export const ES02_PAYMOB_HMAC_EVIDENCE_MARKER = "VEL_PAYMOB_SERVER_HMAC_VERIFIED" as const;

export type Es02OrderStatus =
  | "open"
  | "collection_pending"
  | "settled"
  | "provisioning"
  | "provisioned"
  | "failed"
  | "cancelled";

/** One branch slot: independent persona/tier; order shares one term. */
export type Es02BranchSlotOffer = {
  slotIndex: number;
  persona: SubscriptionPersona;
  package: SubscriptionPackage;
  amountBaisa: number;
  repliesPerMonth: number;
  employees: number;
  channels: number;
};

export type Es02ImmutableOffer = {
  catalogRevision: CommercialCatalogRevision;
  term: SubscriptionTerm;
  /** Canonical per-branch slot map (quantity = branchSlots). */
  slots: readonly Es02BranchSlotOffer[];
  branchSlots: number;
  amountBaisa: number;
  currency: typeof ES02_CURRENCY;
  purpose: typeof ES02_PURPOSE_INITIAL_SUBSCRIPTION;
  productCode: typeof ES02_PRODUCT_CODE;
  /** Aggregates for display/compat; rights remain per-slot. */
  repliesPerMonth: number;
  employees: number;
  channels: number;
  /** Primary slot persona/package for single-slot compat views. */
  persona: SubscriptionPersona;
  package: SubscriptionPackage;
};

export type Es02CheckoutHandoff = {
  accountId: string;
  offer: Es02ImmutableOffer;
  consentAccepted: true;
  clientOpId: string;
};

export type Es02AccountOrderView = {
  orderId: string;
  accountId: string;
  status: Es02OrderStatus;
  offer: Es02ImmutableOffer;
  specialReference: string;
  paymentAttemptId: string;
  environment: "test" | "live";
  settledAt: string | null;
  provisionedCompanyId: string | null;
  originalOrderGroupId: string;
};

export type Es02OwnedRecoveryView = {
  orderId: string;
  accountId: string;
  status: "settled_unprovisioned" | "provisioned";
  specialReference: string;
  offer: Es02ImmutableOffer;
  companyId: string | null;
};

export type Es02ActivationFoundation = {
  companyId: string;
  orderGroupId: string;
  paymentConfirmedAt: string;
  entitlementCreatedAt: string;
  activationDeadlineAt: string;
  bonusDays: 7;
  renewalGraceDays: 3;
  termUnit: "month" | "year";
  termCount: 1;
  clockState: "waiting_readiness" | "active" | "ended";
  firstChannelReady: boolean;
  actualAiReady: boolean;
  operationalReady: boolean;
  subscriptionStartedAt: string | null;
  paidThroughAt: string | null;
};

export type Es02PurchasedCreditKind = "base" | "purchased";

export type Es02CreditBalanceView = {
  companyId: string;
  orderGroupId: string;
  kind: Es02PurchasedCreditKind;
  granted: number;
  remaining: number;
  ordinaryExpiry: null | string;
};

export const es02Uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export type Es02ActionCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_INPUT"
  | "OFFER_TAMPER"
  | "STALE_CAPTURE"
  | "FOREIGN_OWNER"
  | "ALREADY_PROVISIONED"
  | "NOT_SETTLED"
  | "DUPLICATE_SETTLEMENT"
  | "SYNTHETIC_DISABLED"
  | "PAYMOB_EXTERNAL_DEFERRED"
  | "UNKNOWN"
  | "UNAVAILABLE"
  | "UNCONFIGURED"
  | "CONFLICT"
  | "RECONCILIATION_REQUIRED"
  /** Current scope is one branch per business; multi-branch is deferred. */
  | "SECOND_BRANCH_DEFERRED";

export type Es02Result<T> =
  | { ok: true; data: T }
  | { ok: false; code: Es02ActionCode };
