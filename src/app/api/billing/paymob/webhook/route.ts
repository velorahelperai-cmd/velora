import { hostedTestCompanyAllowed } from "@/lib/billing/wiring/hosted-test";
import { observeWebhookIngress } from "@/lib/logging/ingress-observation-server";
import { processStoredPaymobEvent, type StoredProviderEvent } from "@/lib/billing/wiring/event-process";
import { settleHmacVerifiedViaRpc } from "@/lib/billing/wiring/store";
import type { SavedOrderForWebhook } from "@/lib/billing/wiring/webhook-receive";
import { receivePaymobWebhook } from "@/lib/billing/wiring/webhook-receive";
import { resolvePaymobCorrelationId } from "@/lib/billing/paymob/intention";
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
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      scope: "paymob_webhook",
      stage,
      ...safe,
    }),
  );
}

export async function POST(request: Request) {
  return observeWebhookIngress("paymob", () => handlePost(request));
}
async function handlePost(request: Request) {
  const headerCorrelationId = request.headers.get("x-velora-correlation-id");
  const flags = readBillingPaymobWiringFlags();
  const secrets = readWiringSecretsPresence();
  const block = blocksWebhookReceive(flags, secrets);
  if (block) {
    logWebhookDiag("blocked", {
      correlationId: resolvePaymobCorrelationId({ correlationId: headerCorrelationId }),
      code: block,
      block,
    });
    return new Response(block, { status: 503 });
  }

  const url = new URL(request.url);
  const hmacQuery = url.searchParams.get("hmac");
  const rawBody = await request.text();

  const trusted: {order:SavedOrderForWebhook|null;event:StoredProviderEvent|null} = {order:null,event:null};
  const result = await receivePaymobWebhook({
    rawBody,
    hmacQueryParam: hmacQuery,
    correlationId: headerCorrelationId,
    deps: {
      webhookEnabled: flags.webhookEnabled,
      hmacSecret: process.env.PAYMOB_HMAC_SECRET?.trim() ?? "",
      providerEnvironment:flags.liveEnabled?"live":"test",
      findOrderByProviderOrderId: async (id,scope) => { const order=await findOrderByProviderOrderId(id,scope); if(order?.providerEnvironment === "test" && !hostedTestCompanyAllowed(order.companyId)) return null; trusted.order=order;return order; },
      insertProviderEvent: async row => {
        const saved=await insertProviderEvent(row);
        if(saved.ok && trusted.order && ["success","refunded","voided"].includes(row.eventStatus)) {
          trusted.event={id:saved.eventId,companyId:row.companyId,orderId:trusted.order.orderId,paymentAttemptId:row.paymentAttemptId,providerTransactionId:row.providerTransactionId,eventStatus:row.eventStatus,providerEnvironment:row.providerEnvironment,providerAccountRef:row.providerAccountRef,specialReference:trusted.order.specialReference,amountBaisa:trusted.order.amountBaisa,observationKey:row.observationKey};
        }
        return saved;
      },
    },
  });

  const correlationId = resolvePaymobCorrelationId({
    correlationId: headerCorrelationId,
    orderId: trusted.order?.orderId,
    providerOrderId: trusted.order?.providerOrderId,
    specialReference: trusted.order?.specialReference,
  });

  let responseBody=result.body;
  let responseStatus=result.status;
  // Verified Test evidence is durable, but cannot enter the entitlement processor.
  if(result.status===200 && result.eventStored && trusted.order?.providerEnvironment === "test") {
    responseBody=result.body==="duplicate"?"duplicate_test_no_entitlement":"stored_test_no_entitlement";
  }
  if(result.status===200 && trusted.event?.providerEnvironment === "live" && flags.settleEnabled) {
    try {
      const processed=await processStoredPaymobEvent({event:trusted.event,deps:{settleEnabled:true,settleHmacVerified:settleHmacVerifiedViaRpc}});
      if(processed.ok && ["granted","idempotent_replay"].includes(processed.outcome))responseBody=result.body==="duplicate"?"duplicate":"stored";
      else {
        if(!processed.ok) {
          responseStatus=503;
          responseBody="stored_awaiting_processing";
        }
        logWebhookDiag("settlement_pending", {
          correlationId,
          orderId: trusted.order?.orderId,
          code: processed.ok ? processed.outcome : processed.code,
        });
      }
    } catch {
      responseStatus=503;
      responseBody="stored_awaiting_processing";
      logWebhookDiag("settlement_pending", {
        correlationId,
        orderId: trusted.order?.orderId,
        code: "processing_unavailable",
      });
    }
  }
  logWebhookDiag("done", {
    correlationId,
    orderId: trusted.order?.orderId,
    status: responseStatus,
    code: responseBody,
    body: responseBody,
  });
  return new Response(responseBody, {
    status: responseStatus,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-velora-correlation-id": correlationId,
    },
  });
}
