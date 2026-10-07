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

  const result = await receivePaymobWebhook({
    rawBody,
    hmacQueryParam: hmacQuery,
    deps: {
      webhookEnabled: flags.webhookEnabled,
      hmacSecret: process.env.PAYMOB_HMAC_SECRET?.trim() ?? "",
      findOrderByProviderOrderId,
      insertProviderEvent,
    },
  });

  logWebhookDiag("done", { status: result.status, body: result.body });
  return new Response(result.body, {
    status: result.status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
