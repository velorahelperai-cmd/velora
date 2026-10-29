/** Read-only classification. A review result never authorizes cleanup. */
export type CheckoutRetentionInput = {
  checkoutState: string | null;
  orderStatus: string | null;
  paidAt: string | null;
  settlementApplied: boolean | null;
  provisionedCompanyId: string | null;
};

export type CheckoutRetentionDecision =
  | 'hold_unknown'
  | 'hold_unpaid'
  | 'hold_paid_unprovisioned'
  | 'hold_provisioned_obligations_unknown';

export function classifyCheckoutPreparationRetention(input: CheckoutRetentionInput): CheckoutRetentionDecision {
  const {checkoutState, orderStatus, paidAt, settlementApplied, provisionedCompanyId} = input;
  if (!checkoutState || !orderStatus || settlementApplied === null) return 'hold_unknown';
  if (checkoutState !== 'paid') {
    if (!['prepared', 'claimed', 'ready'].includes(checkoutState) || paidAt || settlementApplied || provisionedCompanyId || !['open', 'collection_pending'].includes(orderStatus)) return 'hold_unknown';
    return 'hold_unpaid';
  }
  if (!paidAt || Number.isNaN(Date.parse(paidAt)) || !settlementApplied) return 'hold_unknown';
  if (!provisionedCompanyId && ['settled', 'provisioning'].includes(orderStatus)) return 'hold_paid_unprovisioned';
  // Provisioning does not prove refund, dispute, operational or legal closure.
  if (provisionedCompanyId && orderStatus === 'provisioned') return 'hold_provisioned_obligations_unknown';
  return 'hold_unknown';
}
