import { qualifyFinancialOrder } from "../financial-truth";
export function financialFixture(environment = "live", suffix = "a") {
  const date = new Date().toISOString(), paid = "2099-01-01T00:00:00.000Z";
  const scope = { company_id: `company-${suffix}`, provider: "paymob", provider_account_ref: "71610", provider_environment: environment };
  const period = { period_days: 30, period_unit: "day", period_count: 30 };
  const order = { ...scope, ...period, id: `order-${suffix}`, status: "closed", plan_version_id: `plan-${suffix}`, amount_baisa: 9000, currency: "OMR", provider_amount: 900, provider_amount_unit: "paymob_amount", created_at: date };
  const attempt = { ...scope, id: `attempt-${suffix}`, order_id: order.id, provider_order_id: "order-at-provider", status: "paid", created_at: date };
  const event = { ...scope, financial_integration_ref: "71610", id: `event-${suffix}`, payment_attempt_id: attempt.id, provider_transaction_id: `tx-${suffix}`, event_status: "success", amount_baisa_expected: 9000, currency_expected: "OMR", observation_key: "signed-collection", received_at: date,
    raw_summary: { hmac_verified: true, signed_owner: "70101", integration_id: 71610, amount_cents: 900, currency: "OMR", provider_order_id: attempt.provider_order_id, provider_transaction_id: `tx-${suffix}`, pending: false, success: true, error_occured: false, is_auth: false, is_capture: false, is_refunded: false, is_voided: false, has_parent_transaction: false, is_standalone_payment: true } };
  const grant = { ...scope, ...period, id: `grant-${suffix}`, order_id: order.id, payment_attempt_id: attempt.id, provider_event_id: event.id, provider_transaction_id: event.provider_transaction_id, status: "active", applied_paid_through: paid, applied_at: date };
  const outcome = { ...scope, id: `outcome-${suffix}`, order_id: order.id, payment_attempt_id: attempt.id, provider_event_id: event.id, provider_transaction_id: event.provider_transaction_id, entitlement_application_id: grant.id, outcome: "granted", applied_paid_through: paid, evidence_marker: "VEL_PAYMOB_SERVER_HMAC_VERIFIED", authenticity_method: "paymob_hmac_verified" };
  const plan = { ...period, id: order.plan_version_id, amount_baisa: 9000, currency: "OMR" };
  return { order, attempt, event, grant, outcome, plan };
}

export function provenReturnQualification(companyId:string, orderId:string, paidThrough:string) {
 const f=financialFixture("test"); for(const r of [f.order,f.attempt,f.event,f.grant,f.outcome]) r.company_id=companyId;
 f.order.id=orderId; f.attempt.order_id=orderId; f.grant.order_id=orderId; f.outcome.order_id=orderId;
 f.grant.applied_paid_through=paidThrough; f.outcome.applied_paid_through=paidThrough;
 return qualifyFinancialOrder(companyId,f.order,{attempts:[f.attempt],events:[f.event],grants:[f.grant],outcomes:[f.outcome],plans:[f.plan]});
}
