/**
 * VEL-BILLING-FOUNDATION-01 — shared billing domain types (P1, no Paymob I/O).
 */

export type BillingProviderEnvironment = "test" | "live";

export type SubscriptionStatusB =
  | "unprovisioned"
  | "awaiting_payment"
  | "active"
  | "cancel_at_period_end"
  | "ended"
  | "past_due";

export type CompanyOperationalStatus = "setup" | "active" | "suspended";

export type ProviderEventStatus = "pending" | "success" | "failed" | "other";

export type PaymentAttemptStatus =
  | "intent_created"
  | "provider_submitted"
  | "paid"
  | "failed"
  | "unresolved";

export type InboundStorageOutcome =
  | { outcome: "stored"; reason: "within_paid_period" | "within_retention_window" }
  | {
      outcome: "rejected_by_policy";
      reason:
        | "never_paid"
        | "retention_window_elapsed"
        | "retention_cap_reached"
        | "retention_cap_not_configured"
        | "security_suspended"
        | "not_eligible";
      policyCode: "inbound_rejected_unpaid_retention" | "inbound_rejected_security" | "inbound_rejected_limit";
    }
  | { outcome: "retryable_failure"; reason: "storage_failed" };

/** Commercial money: Omani baisa. Never equate to Paymob amount units. */
export type CommercialMoneyOmr = {
  currency: "OMR";
  amountBaisa: number;
};

export type SubscriptionSnapshot = {
  companyId: string;
  status: SubscriptionStatusB;
  paidThrough: Date | null;
  cancelAtPeriodEnd: boolean;
  planVersionId: string | null;
};

export type LockedOrderSnapshot = {
  companyId: string;
  planVersionId: string;
  amountBaisa: number;
  currency: "OMR";
  /** Day-count when periodUnit is day; kept for foundation compat. */
  periodDays: number;
  /** Calendar unit pinned on the locked order (default day). */
  periodUnit?: "day" | "month" | "year";
  /** Count of periodUnit units; defaults to periodDays when unit is day. */
  periodCount?: number;
  providerAccountRef: string;
  providerEnvironment: BillingProviderEnvironment;
  specialReference: string;
  clientOpId: string;
  inputFingerprint: string;
  /** Null until Paymob conversion is configured and set. */
  providerAmount: number | null;
  providerAmountUnit: "unconfigured" | "paymob_amount" | null;
};
