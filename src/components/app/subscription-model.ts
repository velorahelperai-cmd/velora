import type { EntitlementSnapshot } from "@/lib/billing/entitlement";

export type SubscriptionTier = "level_1" | "level_2" | "level_3";
export type SubscriptionCycle = "monthly" | "yearly";
export type SubscriptionDisplayState = "loading" | "error" | "empty" | "unconfigured" | "pending" | "active" | "expired" | "suspended";
export type SubscriptionView = {
  state: SubscriptionDisplayState;
  currentTier: SubscriptionTier | null;
  cycle: SubscriptionCycle | null;
  paidThrough: string | null;
  pendingOrderId?: string;
  currentPackage?: "basic" | "premium" | null;
  planVersionId?: string | null;
  operationalReady?: boolean;
};

/** Display-only adapter. Boolean entitlement cannot supply a catalog, tier, or period. */
export function subscriptionViewFromEntitlement(
  entitlement: EntitlementSnapshot,
  companyStatus: string | null,
): SubscriptionView {
  return {
    state: companyStatus === "suspended" ? "suspended"
      : entitlement.status === "not_configured" ? "unconfigured"
      : entitlement.paid ? "active" : "empty",
    currentTier: null,
    cycle: null,
    paidThrough: null,
  };
}
