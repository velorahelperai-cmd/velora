import { processStoredPaymobEvent, type StoredProviderEvent } from "@/lib/billing/wiring/event-process";
import { settleHmacVerifiedViaRpc } from "@/lib/billing/wiring/store";
import type { SavedOrderForWebhook } from "@/lib/billing/wiring/webhook-receive";
import { receivePaymobWebhook } from "@/lib/billing/wiring/webhook-receive";
import {
  blocksWebhookReceive,
  readBillingPaymobWiringFlags,
  readWiringSecretsPresence,
} from "@/lib/billing/wiring/flags";
import { findOrderByProviderOrderId, insertProviderEvent } from "@/lib/billing/wiring/store";

export const runtime = "nodejs";

/** Limited diagnostics — no secrets, PANs, or raw bodies. */
function logWebhookDiag(
  stage: string,
  fields: Record<string, string | number | boolean | undefined>,
) {
  const safe = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  console.info(JSON.stringify({ scope: "paymob_webhook", stage, ...safe }));
}

export async function POST(request: Request) {
  const flags = readBillingPaymobWiringFlags();
  const secrets = readWiringSecretsPresence();
  const block = blocksWebhookReceive(flags, secrets);
  if (block) {
    logWebhookDiag("blocked", { block });
    return new Response(block, { status: 503 });
  }

  const url = new URL(request.url);
  const hmacQuery = url.searchParams.get("hmac");
  const rawBody = await request.text();

  const trusted: {order:SavedOrderForWebhook|null;event:StoredProviderEvent|null} = {order:null,event:null};
  const result = await receivePaymobWebhook({
    rawBody,
    hmacQueryParam: hmacQuery,
    deps: {
      webhookEnabled: flags.webhookEnabled,
      hmacSecret: process.env.PAYMOB_HMAC_SECRET?.trim() ?? "",
      findOrderByProviderOrderId: async id => { const order=await findOrderByProviderOrderId(id);trusted.order=order;return order; },
      insertProviderEvent: async row => {
        const saved=await insertProviderEvent(row);
        if(saved.ok && trusted.order && row.providerEnvironment === "test" && row.eventStatus === "success") {
          trusted.event={id:saved.eventId,companyId:row.companyId,orderId:trusted.order.orderId,paymentAttemptId:row.paymentAttemptId,providerTransactionId:row.providerTransactionId,eventStatus:"success",providerAccountRef:row.providerAccountRef,specialReference:trusted.order.specialReference,amountBaisa:trusted.order.amountBaisa,observationKey:row.observationKey};
        }
        return saved;
      },
    },
  });

  let responseBody=result.body;
  if(result.status===200 && trusted.event && flags.settleEnabled) {
    try {
      const processed=await processStoredPaymobEvent({event:trusted.event,deps:{settleEnabled:true,settleHmacVerified:settleHmacVerifiedViaRpc}});
      if(processed.ok && ["granted","idempotent_replay"].includes(processed.outcome))responseBody=result.body==="duplicate"?"duplicate":"stored";
      else logWebhookDiag("settlement_pending", {code:processed.ok?processed.outcome:processed.code});
    } catch { logWebhookDiag("settlement_pending", {code:"processing_unavailable"}); }
  }
  logWebhookDiag("done", { status: result.status, body: responseBody });
  return new Response(responseBody, {
    status: result.status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
