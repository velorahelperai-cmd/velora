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
): Promise<SavedOrderForWebhook | null> {
  const admin = billingAdmin();
  if (!admin) return null;

  const { data: attempt } = await admin
    .from("billing_payment_attempts")
    .select("id, order_id, company_id, provider_order_id, status")
    .eq("provider_order_id", providerOrderId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!attempt) return null;

  const { data: order } = await admin
    .from("billing_orders")
    .select(
      "id, company_id, special_reference, amount_baisa, currency, provider_amount, provider_account_ref, provider_environment, status",
    )
    .eq("id", attempt.order_id)
    .eq("company_id", attempt.company_id)
    .maybeSingle();

  if (!order) return null;

  const merchantOwnerId = process.env.PAYMOB_MERCHANT_OWNER_ID?.trim() || null;
  const integrationIdRaw = process.env.PAYMOB_INTEGRATION_ID_TEST?.trim();
  const accountRef = String(order.provider_account_ref);
  const integrationId = integrationIdRaw ? Number(integrationIdRaw) : Number(accountRef);

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
      .select("id")
      .eq("provider", "paymob")
      .eq("provider_account_ref", row.providerAccountRef)
      .eq("provider_environment", row.providerEnvironment)
      .eq("provider_transaction_id", row.providerTransactionId)
      .eq("event_status", row.eventStatus)
      .eq("observation_key", row.observationKey)
      .maybeSingle();
    if (existing) {
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
  const admin = billingAdmin();
  if (!admin) return { ok: false, code: "admin_not_configured" };

  const { data, error } = await admin.rpc("billing_settle_paymob_hmac_verified", {
    p_evidence: evidence,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("idempotent") || msg.includes("already")) {
      return { ok: false, code: "already_settled" };
    }
    return { ok: false, code: error.code ?? "settle_rpc_failed" };
  }

  const outcome =
    data && typeof data === "object" && "outcome" in data
      ? String((data as { outcome: unknown }).outcome)
      : "granted";
  return { ok: true, outcome };
}
