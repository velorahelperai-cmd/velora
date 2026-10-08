import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { blocksSettlement, readBillingPaymobWiringFlags } from "./flags";
import { processStoredPaymobEvent } from "./event-process";
import { settleHmacVerifiedViaRpc } from "./store";
import { isStoredPaymobPaymentSuccess } from "./stored-observation";
/** SQL performs the full signed-evidence check; legacy success stays strict. */
export function isRecoverableStoredPaymobEvent(status: unknown, summary: unknown): boolean {
  if (status === "success") return isStoredPaymobPaymentSuccess(summary);
  if (status !== "refunded" && status !== "voided") return false;
  if (summary == null || typeof summary !== "object" || Array.isArray(summary)) return false;
  const row = summary as Record<string, unknown>;
  return row.hmac_verified === true && row.pending === false && row.success === true && row.error_occured === false &&
    (status === "refunded" ? row.is_refunded === true : row.is_voided === true);
}

/** Called only after owner access has been checked; never reads query-string evidence. */
export async function processOwnerOrderEvents(companyId: string, orderId: string): Promise<void> {
  const flags = readBillingPaymobWiringFlags();
  if (blocksSettlement(flags) !== null) return;
  const client = createAdminClient();
  if (!client) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = client as any;
  const { data: order } = await admin.from("billing_orders")
    .select("id,special_reference,amount_baisa,provider_account_ref,provider_environment,currency")
    .eq("id", orderId).eq("company_id", companyId).maybeSingle();
  if (!order || !["test", "live"].includes(order.provider_environment) ||
      (order.provider_environment === "live" && !flags.liveEnabled) || order.currency !== "OMR") return;
  const { data: attempts } = await admin.from("billing_payment_attempts")
    .select("id").eq("order_id", orderId).eq("company_id", companyId);
  for (const attempt of attempts ?? []) {
    const { data: events } = await admin.from("billing_provider_events")
      .select("id,provider_transaction_id,event_status,observation_key,raw_summary,provider_environment,provider_account_ref,amount_baisa_expected")
      .eq("payment_attempt_id", attempt.id).eq("company_id", companyId)
      .eq("provider_environment", order.provider_environment).in("event_status", ["success", "refunded", "voided"]).limit(20);
    for (const event of events ?? []) {
      if (!isRecoverableStoredPaymobEvent(event.event_status, event.raw_summary) ||
          event.provider_environment !== order.provider_environment || event.provider_account_ref !== order.provider_account_ref ||
          !Number.isSafeInteger(Number(order.amount_baisa)) || Number(order.amount_baisa) <= 0 ||
          Number(event.amount_baisa_expected) !== Number(order.amount_baisa)) continue;
      await processStoredPaymobEvent({
        deps: { settleEnabled: true, settleHmacVerified: settleHmacVerifiedViaRpc },
        event: {
          id: String(event.id), companyId, orderId, paymentAttemptId: String(attempt.id),
          providerTransactionId: String(event.provider_transaction_id), eventStatus: event.event_status,
          providerEnvironment: event.provider_environment, providerAccountRef: String(order.provider_account_ref),
          specialReference: String(order.special_reference), amountBaisa: Number(order.amount_baisa),
          observationKey: String(event.observation_key),
        },
      });
    }
  }
}
