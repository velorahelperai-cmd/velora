export {
  BILLING_WIRING_SETTING_NAMES,
  readBillingPaymobWiringFlags,
  readWiringSecretsPresence,
  blocksPaymobConnection,
  blocksWebhookReceive,
  blocksSettlement,
} from "@/lib/billing/wiring/flags";

export {
  decideCreateBillingOrder,
  fingerprintBillingOrderInputs,
} from "@/lib/billing/wiring/order-create";

export { createBillingOrderAction } from "@/lib/billing/wiring/order-actions";
export { persistOrderWithAttempt, resolveAttemptForOrder } from "@/lib/billing/wiring/order-create-persist";
/** Attempt lifecycle FIX-04/05 (evidence-bound failed + success precedence). */
export {
  createResolveOrCreateAttemptRpc,
  createConfirmFailedAttemptRpc,
  createOpenAfterFailedAttemptRpc,
  mapResolveOrCreateRpcPayload,
  mapConfirmFailedRpcPayload,
  mapOpenAfterFailedRpcPayload,
} from "@/lib/billing/wiring/attempt-resolve-rpc";
export type {
  ResolveOrCreateAttemptResult,
  ConfirmFailedAttemptResult,
  OpenAfterFailedResult,
} from "@/lib/billing/wiring/attempt-resolve-rpc";
export {
  createAtomicPurchasePersistRpc,
  mapAtomicPurchasePersistPayload,
} from "@/lib/billing/wiring/purchase-persist-rpc";
export {
  decidePurchaseGate,
  purchaseGateToUiState,
  purchasePurposeKey,
  selectOpenOrderForPurpose,
  normalizePurchasePurpose,
  blockNewCollectionForAttempt,
  VELORA_SUBSCRIPTION_PRODUCT_CODE,
} from "@/lib/billing/wiring/purchase-gate";
export type {
  PurchasePurpose,
  PurchaseKind,
  EarlyRenewConfirmation,
  OpenPurchaseOrder,
  PurchaseGateDecision,
} from "@/lib/billing/wiring/purchase-gate";
export {
  buildEarlyRenewQuote,
  confirmationFromQuote,
  earlyRenewClientOpFingerprint,
} from "@/lib/billing/wiring/renew-gate";
export { observationKeyFromVerified } from "@/lib/billing/wiring/observation-key";
export { mapBillingReturnDbParts } from "@/lib/billing/wiring/return-load";
export { runBillingEventProcessing } from "@/lib/billing/wiring/process-runner";

export { receivePaymobWebhook } from "@/lib/billing/wiring/webhook-receive";
export { processStoredPaymobEvent } from "@/lib/billing/wiring/event-process";
export {
  PAYMOB_HMAC_SETTLEMENT_EVIDENCE_MARKER,
  PAYMOB_HMAC_SETTLEMENT_RPC_CONTRACT,
  buildPaymobHmacSettlementEvidence,
} from "@/lib/billing/wiring/settlement-bridge";
export {
  mapBillingReturnDisplay,
  redirectionQueryGrantsEntitlement,
} from "@/lib/billing/wiring/return-status";
