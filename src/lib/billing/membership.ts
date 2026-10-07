/**
 * Reuse company membership / owner gates for billing actions (no ACCESS matrix changes).
 */

import type { CompanyRole } from "@/lib/tenancy/types";

export type BillingMembershipView = {
  companyId: string;
  role: CompanyRole;
  status: "active" | "disabled";
};

/** Only an active company owner may manage that company's subscription purchase/renew/cancel. */
export function canManageCompanyBilling(membership: BillingMembershipView | null | undefined): boolean {
  if (!membership) return false;
  return membership.status === "active" && membership.role === "owner";
}

/** Staff/delegated admin never get financial powers from membership alone in v1. */
export function membershipImpliesBillingPower(role: CompanyRole): boolean {
  return role === "owner";
}
