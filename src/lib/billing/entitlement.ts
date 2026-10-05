/**
 * Server entitlement snapshot. Account ≠ active company ≠ verified WhatsApp ≠ paid plan.
 * No payment provider is adopted. Browser success URLs never grant access.
 *
 * Recorded product decisions (not implemented as prices/grace/refund/deletion):
 * - Team-provisioned onboarding starts after payment.
 * - Self-serve pays after relevant Meta requirements are complete.
 */

export type EntitlementStatus = "not_configured";

export type EntitlementSnapshot = {
  status: EntitlementStatus;
  paid: false;
  liveSendAllowed: false;
  liveAnswerAllowed: false;
  source: "none";
};

export function readCompanyEntitlement(companyId: string | null): EntitlementSnapshot {
  void companyId;
  return {
    status: "not_configured",
    paid: false,
    liveSendAllowed: false,
    liveAnswerAllowed: false,
    source: "none",
  };
}

export function entitlementAllowsAutomation(snapshot: EntitlementSnapshot): boolean {
  return snapshot.paid && snapshot.liveSendAllowed && snapshot.liveAnswerAllowed;
}
