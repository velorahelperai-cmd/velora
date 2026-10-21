import { hostedTestActorAllowed, hostedTestCompanyAllowed } from "./hosted-test";
/**
 * Durable webhook event persistence via service_role.
 * Exact duplicate (scope obs unique) → inserted:false, still ok.
 * Persistence failure → ok:false (caller must not HTTP 200).
 *
 * Billing tables are not yet in generated Database types — access via untyped admin.
 */

import type { DurableEventInsert, SavedOrderForWebhook } from "@/lib/billing/wiring/webhook-receive";
import { createAdminClient } from "@/lib/supabase/admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

function billingAdmin(): AnyClient | null {
  return createAdminClient();
}

export async function findOrderByProviderOrderId(
  providerOrderId: string,
  scope?:{providerAccountRef:string;providerEnvironment:"test"|"live"},
): Promise<SavedOrderForWebhook | null> {
  const admin = billingAdmin();
  if (!admin) return null;

  let query = admin
    .from("billing_payment_attempts")
    .select("id, order_id, company_id, provider_order_id, status")
    .eq("provider_order_id", providerOrderId);
  if(scope)query=query.eq("provider","paymob").eq("provider_account_ref",scope.providerAccountRef).eq("provider_environment",scope.providerEnvironment);
  const {data:attempt}=await query
    .order("created_at", { ascending: false })
    // Never choose one company's binding when the bare provider id is ambiguous.
    .limit(2)
    .maybeSingle();

  if (!attempt) return null;

  const { data: order } = await admin
    .from("billing_orders")
    .select(
      "id, company_id, special_reference, amount_baisa, currency, provider_amount, provider_account_ref, provider_environment, status, created_by",
    )
    .eq("id", attempt.order_id)
    .eq("company_id", attempt.company_id)
    .maybeSingle();

  if (!order || order.currency !== "OMR" || !["test", "live"].includes(order.provider_environment) ||
      !Number.isSafeInteger(Number(order.amount_baisa)) || Number(order.amount_baisa) <= 0 ||
      !Number.isSafeInteger(Number(order.provider_amount)) || Number(order.provider_amount) <= 0) return null;

  if(order.provider_environment === "test" && !hostedTestActorAllowed(order.created_by, order.company_id)) return null;

  const merchantOwnerId = process.env.PAYMOB_MERCHANT_OWNER_ID?.trim() || null;
  const integrationIdRaw = process.env[order.provider_environment==="live"?"PAYMOB_INTEGRATION_ID_LIVE":"PAYMOB_INTEGRATION_ID_TEST"]?.trim();
  const accountRef = String(order.provider_account_ref);
  const integrationId = integrationIdRaw ? Number(integrationIdRaw) : order.provider_environment==="live"?0:Number(accountRef);
  if(scope&&(accountRef!==scope.providerAccountRef||order.provider_environment!==scope.providerEnvironment))return null;
  // Shared HMAC credentials cannot authenticate unsigned is_live. Distinct
  // server-pinned integrations are required before accepting a Live receipt.
  if(order.provider_environment==="live"&&(!integrationIdRaw||integrationIdRaw===process.env.PAYMOB_INTEGRATION_ID_TEST?.trim()))return null;

  return {
    companyId: String(order.company_id),
    orderId: String(order.id),
    paymentAttemptId: String(attempt.id),
    status: String(attempt.status),
    providerOrderId: attempt.provider_order_id == null ? null : String(attempt.provider_order_id),
    specialReference: String(order.special_reference),
    amountBaisa: Number(order.amount_baisa),
    currency: "OMR",
    providerAmount: order.provider_amount == null ? null : Number(order.provider_amount),
    providerAccountRef: accountRef,
    providerEnvironment: order.provider_environment === "live" ? "live" : "test",
    integrationId: Number.isSafeInteger(integrationId) ? integrationId : 0,
    merchantOwnerId,
  };
}

export async function insertProviderEvent(
  row: DurableEventInsert,
): Promise<{ ok: true; inserted: boolean; eventId: string } | { ok: false; code: string }> {
  if(row.providerEnvironment === "test" && !hostedTestCompanyAllowed(row.companyId)) return {ok:false,code:"hosted_test_not_authorized"};
  const admin = billingAdmin();
  if (!admin) return { ok: false, code: "admin_not_configured" };

  const { data, error } = await admin
    .from("billing_provider_events")
    .insert({
      payment_attempt_id: row.paymentAttemptId,
      provider: "paymob",
      provider_account_ref: row.providerAccountRef,
      provider_environment: row.providerEnvironment,
      provider_transaction_id: row.providerTransactionId,
      event_status: row.eventStatus,
      observation_key: row.observationKey,
      company_id: row.companyId,
      amount_baisa_expected: row.amountBaisaExpected,
      currency_expected: row.currencyExpected,
      raw_summary: row.rawSummary,
    })
    .select("id")
    .single();

  if (!error && data) {
    return { ok: true, inserted: true, eventId: String(data.id) };
  }

  if (error?.code === "23505") {
    const { data: existing } = await admin
      .from("billing_provider_events")
      .select("id,company_id,payment_attempt_id,amount_baisa_expected,currency_expected")
      .eq("provider", "paymob")
      .eq("provider_account_ref", row.providerAccountRef)
      .eq("provider_environment", row.providerEnvironment)
      .eq("provider_transaction_id", row.providerTransactionId)
      .eq("event_status", row.eventStatus)
      .eq("observation_key", row.observationKey)
      .maybeSingle();
    if (existing) {
      if (existing.company_id !== row.companyId || existing.payment_attempt_id !== row.paymentAttemptId ||
          Number(existing.amount_baisa_expected) !== row.amountBaisaExpected || existing.currency_expected !== row.currencyExpected) {
        return { ok: false, code: "duplicate_binding_mismatch" };
      }
      return { ok: true, inserted: false, eventId: String(existing.id) };
    }
  }

  return { ok: false, code: error?.code ?? "persist_failed" };
}

/**
 * Invokes billing_settle_paymob_hmac_verified — never synthetic helper,
 * never billing_settle_verified_payment with fake attestation.
 */
export async function settleHmacVerifiedViaRpc(
  evidence: Record<string, unknown>,
): Promise<{ ok: true; outcome: string } | { ok: false; code: string }> {
  // A signed Test receipt is evidence only; never a subscription entitlement.
  if(evidence.provider_environment !== "live") return {ok:false,code:"hosted_test_no_entitlement"};
  const admin = billingAdmin();
  if (!admin) return { ok: false, code: "admin_not_configured" };

  const { data, error } = await admin.rpc(evidence.provider_environment === "live" ? "billing_settle_live_paymob_hmac_verified" : "billing_settle_paymob_hmac_verified", {
    p_evidence: evidence,
  });

  if (error) {
    return { ok: false, code: error.code ?? "settle_rpc_failed" };
  }

  if(data&&typeof data==="object"&&!Array.isArray(data)&&data.ok===false&&typeof data.code==="string"&&data.code.trim()) {
    return {ok:false,code:data.code};
  }

  if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.outcome !== "string") {
    return { ok: false, code: "settle_result_invalid" };
  }
  const outcome = data.outcome;
  return { ok: true, outcome };
}
