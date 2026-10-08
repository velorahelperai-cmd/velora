import { randomUUID } from "node:crypto";
import { lit, sql } from "./postgres.mjs";

export async function fixture({ environment = "test", account = "74001", providerOrderId = "99001", expiresAt, companyId, deadlinePolicyApproved = false } = {}) {
  const f = { userId: randomUUID(), companyId: companyId ?? randomUUID(), planId: randomUUID(), versionId: randomUUID(), orderId: randomUUID(), attemptId: randomUUID(), specialReference: `ACCEPTANCE_${randomUUID()}`, environment, account, providerOrderId };
  await sql(`
    INSERT INTO auth.users(id,email) VALUES (${lit(f.userId)},'synthetic@acceptance.invalid');
    INSERT INTO public.companies(id,display_name,status,created_by) VALUES(${lit(f.companyId)},'Synthetic acceptance fixture','active',${lit(f.userId)}) ON CONFLICT DO NOTHING;
    INSERT INTO public.company_members(company_id,user_id,role,status) VALUES (${lit(f.companyId)},${lit(f.userId)},'owner','active');
    INSERT INTO public.billing_plans(id,code,name,status) VALUES(${lit(f.planId)},${lit(`fixture_${randomUUID()}`)},'Synthetic plan','active');
    INSERT INTO public.billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status)
      VALUES(${lit(f.versionId)},${lit(f.planId)},1,5000,'OMR',30,'day',30,'published');
    INSERT INTO public.billing_orders(id,company_id,plan_version_id,amount_baisa,currency,period_days,period_unit,period_count,provider,provider_account_ref,provider_environment,provider_amount,provider_amount_unit,special_reference,client_op_id,input_fingerprint,status,product_code,purchase_purpose,created_by${expiresAt ? ",expires_at" : ""}${deadlinePolicyApproved ? ",deadline_policy_approved" : ""})
      VALUES(${lit(f.orderId)},${lit(f.companyId)},${lit(f.versionId)},5000,'OMR',30,'day',30,'paymob',${lit(account)},${lit(environment)},5000,'paymob_amount',${lit(f.specialReference)},${lit(randomUUID())},${lit(randomUUID())},'locked','velora_ai_staff','initial',${lit(f.userId)}${expiresAt ? `,${lit(expiresAt)}` : ""}${deadlinePolicyApproved ? ",true" : ""});
    INSERT INTO public.billing_payment_attempts(id,order_id,company_id,status,provider_order_id)
      VALUES(${lit(f.attemptId)},${lit(f.orderId)},${lit(f.companyId)},'provider_submitted',${lit(providerOrderId)});
  `);
  return f;
}

export function evidence(f, tx, { observationKey = `obs_${tx}`, eventStatus = "success", flags = {} } = {}) {
  return {
    evidence_marker: "VEL_PAYMOB_SERVER_HMAC_VERIFIED",
    authenticity: { source: "server_adapter_attestation", verified: true, method: "paymob_hmac_sha512" },
    company_id: f.companyId, order_id: f.orderId, payment_attempt_id: f.attemptId,
    provider: "paymob", provider_account_ref: f.account, provider_environment: f.environment,
    provider_transaction_id: tx, special_reference: f.specialReference, amount_baisa: 5000,
    currency: "OMR", currency_expected: "OMR", event_status: eventStatus, observation_key: observationKey,
    raw: {
      provider_transaction_id: tx, provider_order_id: f.providerOrderId, hmac_verified: true,
      event_status: eventStatus, amount_cents: 5000, currency: "OMR", integration_id: Number(f.account), signed_owner: "84001",
      pending: false, success: true, error_occured: false, is_auth: false, is_capture: false,
      is_voided: false, is_refunded: false, has_parent_transaction: false, is_standalone_payment: true,
      ...flags,
    },
  };
}
export async function storedEvent(f, tx, options) {
  const e = evidence(f, tx, options);
  await sql(`INSERT INTO public.billing_provider_events(payment_attempt_id,company_id,provider,provider_account_ref,provider_environment,provider_transaction_id,event_status,observation_key,amount_baisa_expected,currency_expected,raw_summary)
    VALUES(${lit(f.attemptId)},${lit(f.companyId)},'paymob',${lit(f.account)},${lit(f.environment)},${lit(tx)},${lit(e.event_status)},${lit(e.observation_key)},5000,'OMR',${lit(JSON.stringify(e.raw))}::jsonb)
    ON CONFLICT DO NOTHING;`);
  return e;
}
export function settleSql(e) {
  const payload = { ...e };
  delete payload.raw;
  return `SELECT public.billing_settle_paymob_hmac_verified(${lit(JSON.stringify(payload))}::jsonb);`;
}
export async function settle(e) {
  const output = await sql(`SET ROLE service_role; ${settleSql(e)}`);
  return JSON.parse(output.split("\n").filter((line) => line.startsWith("{"))[0]);
}
export function purchaseSql(f, { environment = f.environment, clientOp = randomUUID() } = {}) {
  return `SELECT public.billing_create_or_reuse_subscription_order(
    ${lit(f.companyId)}::uuid,'velora_ai_staff','initial',${lit(f.versionId)}::uuid,${lit(f.planId)}::uuid,
    ${lit(clientOp)},${lit(`fp_${clientOp}`)},${lit(`special_${clientOp}`)},5000,'OMR',30,'day',30,
    ${lit(f.account)},${lit(environment)},${lit(f.userId)}::uuid);`;
}
