/**
 * Webhook receive: verify HMAC + structure, resolve saved order, durable event insert.
 * Never logs secrets or card PANs. Save failure must not be reported as HTTP success.
 */

import {
  verifyAndMapProcessedCallback,
  classifyNotificationPayload,
  type VerifiedTransactionObservation,
} from "@/lib/billing/paymob/callback";
import { matchVerifiedObservationToOrder, type ServerOrderBinding } from "@/lib/billing/paymob/match";
import { observationKeyFromVerified } from "@/lib/billing/wiring/observation-key";

export type WebhookHttpResult = {
  status: number;
  body: string;
  /** Event durable; settlement may still be pending. */
  eventStored?: boolean;
  awaitingProcessing?: boolean;
};

export type SavedOrderForWebhook = ServerOrderBinding & {
  paymentAttemptId: string;
  status: string;
};

export type DurableEventInsert = {
  companyId: string;
  paymentAttemptId: string;
  providerTransactionId: string;
  eventStatus: "pending" | "success" | "failed" | "other" | "refunded" | "voided";
  observationKey: string;
  providerAccountRef: string;
  providerEnvironment: "test" | "live";
  amountBaisaExpected: number | null;
  currencyExpected: "OMR";
  /** Redacted summary — no PAN, no secrets. */
  rawSummary: Record<string, unknown>;
};

export type WebhookReceiveDeps = {
  webhookEnabled: boolean;
  hmacSecret: string;
  /** Trusted receiver configuration, never callback is_live or a query parameter. */
  providerEnvironment?: "test" | "live";
  findOrderByProviderOrderId: (providerOrderId: string, scope?: {providerAccountRef:string;providerEnvironment:"test"|"live"}) => Promise<SavedOrderForWebhook | null>;
  insertProviderEvent: (
    row: DurableEventInsert,
  ) => Promise<{ ok: true; inserted: boolean; eventId: string } | { ok: false; code: string }>;
};

function redactObservation(obs: VerifiedTransactionObservation): Record<string, unknown> {
  return {
    hmac_verified: true,
    provider_transaction_id: obs.providerTransactionId,
    provider_order_id: obs.providerOrderId,
    event_status: obs.eventStatus,
    amount_cents: obs.amountCents,
    currency: obs.currency,
    integration_id: obs.integrationId,
    signed_owner: obs.signedOwner,
    pending: obs.pending,
    success: obs.success,
    is_auth: obs.isAuth,
    is_capture: obs.isCapture,
    error_occured: obs.errorOccured,
    is_voided: obs.isVoided,
    is_refunded: obs.isRefunded,
    has_parent_transaction: obs.hasParentTransaction,
    is_standalone_payment: obs.isStandalonePayment,
  };
}

function httpBody(stored: boolean, duplicate: boolean, awaitingProcessing: boolean): string {
  if (duplicate) return "duplicate";
  if (stored && awaitingProcessing) return "stored_awaiting_processing";
  if (stored) return "stored";
  return "ignored";
}

/**
 * Process a Paymob notification POST.
 * Returns HTTP status: 200 only when durable save succeeded or exact duplicate already stored.
 * 200 does not mean entitlement — success events may still await internal processing.
 */
export async function receivePaymobWebhook(input: {
  deps: WebhookReceiveDeps;
  rawBody: string;
  hmacQueryParam: string | null;
}): Promise<WebhookHttpResult> {
  if (!input.deps.webhookEnabled) {
    return { status: 503, body: "webhook_disabled" };
  }
  if (!input.deps.hmacSecret) {
    return { status: 503, body: "hmac_not_configured" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: "bad_json" };
  }

  const kind = classifyNotificationPayload(payload);
  if (kind === "card_token") {
    return { status: 202, body: "card_token_ignored" };
  }

  const verified = verifyAndMapProcessedCallback({
    body: payload,
    hmacQueryParam: input.hmacQueryParam,
    hmacSecret: input.deps.hmacSecret,
  });
  if (!verified.ok) {
    if (verified.reason === "hmac_failed" || verified.reason === "isolated_incomplete_fields") {
      return { status: 401, body: verified.reason };
    }
    return { status: 400, body: verified.reason };
  }

  const obs = verified.observation;
  const observationKey = observationKeyFromVerified(obs);

  const environment=input.deps.providerEnvironment??"test";
  const order = await input.deps.findOrderByProviderOrderId(obs.signedOrderId,{providerAccountRef:String(obs.integrationId),providerEnvironment:environment});
  if (!order) {
    return { status: 409, body: "order_not_bound" };
  }

  if(order.providerEnvironment!==environment)return {status:409,body:"environment_mismatch"};
  const lifecycle=obs.pending===false&&obs.success===true&&obs.errorOccured===false&&(obs.isRefunded===true||obs.isVoided===true);
  const match = matchVerifiedObservationToOrder({ observation: obs, order, allowLiveEnvironment:environment==="live", lifecycleReviewOnly:lifecycle });
  if (!match.ok) {
    return { status: 409, body: match.reason };
  }

  const eventStatus=lifecycle?(obs.isVoided?"voided":"refunded"):obs.eventStatus;
  const insert = await input.deps.insertProviderEvent({
    companyId: order.companyId,
    paymentAttemptId: order.paymentAttemptId,
    providerTransactionId: obs.providerTransactionId,
    eventStatus,
    observationKey,
    providerAccountRef: order.providerAccountRef,
    providerEnvironment: environment,
    amountBaisaExpected: order.amountBaisa,
    currencyExpected: "OMR",
    rawSummary: {...redactObservation(obs),event_status:eventStatus},
  });

  if (!insert.ok) {
    return { status: 500, body: "persist_failed" };
  }

  const awaitingProcessing = eventStatus === "success" || lifecycle;
  return {
    status: 200,
    body: httpBody(true, !insert.inserted, awaitingProcessing),
    eventStored: true,
    awaitingProcessing: awaitingProcessing && insert.inserted,
  };
}
