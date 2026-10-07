/**
 * observation_key from HMAC-signed fields only — never unsigned merchant_order_id / is_live.
 */

import { createHash } from "node:crypto";
import type { VerifiedTransactionObservation } from "@/lib/billing/paymob/callback";

export type SignedObservationIdentity = Pick<
  VerifiedTransactionObservation,
  | "providerTransactionId"
  | "amountCents"
  | "currency"
  | "integrationId"
  | "signedOrderId"
  | "signedOwner"
  | "pending"
  | "success"
  | "errorOccured"
  | "eventStatus"
> & {
  isAuth: boolean;
  isCapture: boolean;
  isVoided: boolean;
  isRefunded: boolean;
  is3dSecure: boolean;
  hasParentTransaction: boolean;
  isStandalonePayment: boolean;
};

/** Stable key for billing_provider_events.observation_key (max 128 chars). */
export function buildVerifiedObservationKey(identity: SignedObservationIdentity): string {
  const material = [
    identity.providerTransactionId,
    identity.eventStatus,
    String(identity.amountCents),
    identity.currency,
    String(identity.integrationId),
    identity.signedOrderId,
    identity.signedOwner,
    String(identity.pending),
    String(identity.success),
    String(identity.errorOccured),
    String(identity.isAuth),
    String(identity.isCapture),
    String(identity.isVoided),
    String(identity.isRefunded),
    String(identity.is3dSecure),
    String(identity.hasParentTransaction),
    String(identity.isStandalonePayment),
  ].join("|");
  const digest = createHash("sha256").update(material, "utf8").digest("hex").slice(0, 48);
  return `v1_${digest}`;
}

export function observationKeyFromVerified(obs: VerifiedTransactionObservation): string {
  return buildVerifiedObservationKey({
    providerTransactionId: obs.providerTransactionId,
    amountCents: obs.amountCents,
    currency: obs.currency,
    integrationId: obs.integrationId,
    signedOrderId: obs.signedOrderId,
    signedOwner: obs.signedOwner,
    pending: obs.pending,
    success: obs.success,
    errorOccured: obs.errorOccured,
    eventStatus: obs.eventStatus,
    isAuth: obs.isAuth,
    isCapture: obs.isCapture,
    isVoided: obs.isVoided,
    isRefunded: obs.isRefunded,
    is3dSecure: obs.is3dSecure,
    hasParentTransaction: obs.hasParentTransaction,
    isStandalonePayment: obs.isStandalonePayment,
  });
}
