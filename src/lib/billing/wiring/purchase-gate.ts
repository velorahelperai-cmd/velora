/**
 * VEL-SUBSCRIPTION-SINGLE-PRODUCT-FIX-01
 *
 * Product model (owner decision):
 * - One commercial product: Velora AI staff personas (3 tiers = catalog levels).
 * - One subscription per company.
 * - Tier change = upgrade/downgrade of the same subscription (not a second product).
 * - Monthly/yearly = billing cycle on a plan version, not a separate product.
 *
 * Open-purchase key: company + fixed product + operation purpose — NOT plan_version_id.
 * Changing price version / tier / cycle must not open a duplicate purchase or bypass pending/unknown.
 */

import type { Clock } from "@/lib/billing/clock";
import { systemClock } from "@/lib/billing/clock";
import {
  evaluateSubscriptionEntitlement,
} from "@/lib/billing/subscription-state";
import type {
  CompanyOperationalStatus,
  PaymentAttemptStatus,
  SubscriptionSnapshot,
} from "@/lib/billing/types";
import type { ExistingBillingOrder } from "@/lib/billing/wiring/order-create";

/** Fixed product identity for Velora AI staff subscription. */
export const VELORA_SUBSCRIPTION_PRODUCT_CODE = "velora_ai_staff" as const;

export type SubscriptionProductCode = typeof VELORA_SUBSCRIPTION_PRODUCT_CODE;

/**
 * Explicit purchase purposes for the single product.
 * - initial: first subscribe while not within paid period
 * - renew: explicit early/period renew while subscribed
 * - upgrade: tier/cycle change — collection NOT configured until proration approved
 */
export type PurchasePurpose = "initial" | "renew" | "upgrade";

/** @deprecated Prefer PurchasePurpose — kept for call-site compatibility. */
export type PurchaseKind = PurchasePurpose | "initial_subscribe" | "early_renew";

export function normalizePurchasePurpose(kind: PurchaseKind | undefined): PurchasePurpose {
  if (kind == null || kind === "initial_subscribe" || kind === "initial") return "initial";
  if (kind === "early_renew" || kind === "renew") return "renew";
  return "upgrade";
}

/** Open / in-flight order for company + product + purpose. */
export type OpenPurchaseOrder = ExistingBillingOrder & {
  attemptStatus: PaymentAttemptStatus | null;
  productCode?: string;
  purchasePurpose?: PurchasePurpose;
};

export type EarlyRenewConfirmation = {
  /** Must match published plan amount — server re-checks. */
  amountBaisa: number;
  periodUnit: "day" | "month" | "year";
  periodCount: number;
  /** ISO paid_through the client displayed; server recomputes and compares. */
  projectedPaidThroughIso: string;
};

export type PurchaseGateDecision =
  | {
      ok: true;
      action: "proceed_create" | "reuse_open_order";
      purchasePurpose: PurchasePurpose;
      /** Alias for older callers. */
      purchaseKind: PurchasePurpose;
      openOrder?: OpenPurchaseOrder;
      /** True when collection must not start a second charge until reconcile. */
      blockNewCollection: boolean;
    }
  | {
      ok: false;
      code:
        | "ALREADY_SUBSCRIBED"
        | "EARLY_RENEW_REQUIRED_EXPLICIT"
        | "EARLY_RENEW_CONFIRMATION_MISMATCH"
        | "EARLY_RENEW_NOT_ELIGIBLE"
        | "UPGRADE_NOT_CONFIGURED"
        | "CONTENT_MISMATCH"
        | "PENDING_COLLECTION_RECONCILE"
        | "OPEN_COLLECTION_UNRESOLVED"
        | "OPEN_ORDER_CONFLICT";
      manageSubscriptionHint?: true;
      openOrder?: OpenPurchaseOrder;
      purchasePurpose?: PurchasePurpose;
      blockNewCollection?: boolean;
    };

const BLOCKING_ATTEMPT: ReadonlySet<PaymentAttemptStatus> = new Set([
  "provider_submitted",
  "unresolved",
]);

const REUSABLE_OPEN_ORDER = new Set(["locked", "submitted"]);

/**
 * Open-purchase serialization key — company + fixed product + purpose.
 * Intentionally ignores plan_version_id (tier / cycle / price revision).
 */
export function purchasePurposeKey(
  companyId: string,
  purpose: PurchasePurpose,
  productCode: SubscriptionProductCode = VELORA_SUBSCRIPTION_PRODUCT_CODE,
): string {
  return `${companyId}|${productCode}|${purpose}`;
}

export function isBlockingAttemptStatus(status: PaymentAttemptStatus | null | undefined): boolean {
  if (status == null) return false;
  return BLOCKING_ATTEMPT.has(status);
}

/** Re-evaluate winner after race reuse — pending/unknown keep blockNewCollection. */
export function blockNewCollectionForAttempt(
  status: PaymentAttemptStatus | null | undefined,
): boolean {
  return isBlockingAttemptStatus(status);
}

/**
 * Pick the canonical open order for this company+product+purpose.
 * Prefer orders with blocking/unknown collection state, then earliest locked/submitted.
 */
export function selectOpenOrderForPurpose(
  openOrders: OpenPurchaseOrder[],
): OpenPurchaseOrder | null {
  const eligible = openOrders.filter((o) => REUSABLE_OPEN_ORDER.has(o.status));
  if (eligible.length === 0) return null;
  const blocking = eligible.find((o) => isBlockingAttemptStatus(o.attemptStatus));
  if (blocking) return blocking;
  return eligible[0] ?? null;
}

/**
 * Gate before create/reuse by client_op.
 * Same product purpose with different clientOpId / plan_version must not open a second charge.
 */
export function decidePurchaseGate(input: {
  companyId: string;
  /** Accepted for catalog lookup only — does not widen open-purpose key. */
  planVersionId?: string;
  /** Catalog plan_id of requested version (tier identity). */
  requestedPlanId?: string | null;
  /** Catalog plan_id of current subscription version (tier identity). */
  subscriptionPlanId?: string | null;
  purchaseKind?: PurchaseKind;
  purchasePurpose?: PurchasePurpose;
  productCode?: SubscriptionProductCode;
  subscription: SubscriptionSnapshot | null;
  companyStatus: CompanyOperationalStatus;
  /** Open orders for this company+product+purpose (any plan_version). */
  openOrdersForPurpose: OpenPurchaseOrder[];
  /** @deprecated use openOrdersForPurpose */
  openOrdersForPlan?: OpenPurchaseOrder[];
  /** Request client_op — checked against open order before reuse. */
  clientOpId?: string;
  /** Server fingerprint of this request — CONTENT_MISMATCH if same client_op differs. */
  inputFingerprint?: string;
  earlyRenewConfirmation?: EarlyRenewConfirmation | null;
  serverProjectedPaidThroughIso?: string | null;
  publishedAmountBaisa?: number;
  publishedPeriodUnit?: "day" | "month" | "year";
  publishedPeriodCount?: number;
  clock?: Clock;
}): PurchaseGateDecision {
  const purpose = input.purchasePurpose ?? normalizePurchasePurpose(input.purchaseKind);
  const openList = input.openOrdersForPurpose ?? input.openOrdersForPlan ?? [];

  const caps = evaluateSubscriptionEntitlement({
    subscription: input.subscription,
    companyStatus: input.companyStatus,
    clock: input.clock ?? systemClock,
  });

  // Upgrade/downgrade collection not configured — never invent a second subscription path.
  if (purpose === "upgrade") {
    return {
      ok: false,
      code: "UPGRADE_NOT_CONFIGURED",
      manageSubscriptionHint: true,
      purchasePurpose: purpose,
    };
  }

  if (purpose === "initial") {
    if (caps.withinPaidPeriod) {
      return {
        ok: false,
        code: "ALREADY_SUBSCRIBED",
        manageSubscriptionHint: true,
        purchasePurpose: purpose,
      };
    }
  }

  if (purpose === "renew") {
    if (!caps.withinPaidPeriod) {
      return { ok: false, code: "EARLY_RENEW_NOT_ELIGIBLE", purchasePurpose: purpose };
    }
    // Tier change labelled renew → upgrade not configured. Cycle-only keeps same plan_id.
    if (
      input.subscriptionPlanId != null &&
      input.requestedPlanId != null &&
      input.subscriptionPlanId !== input.requestedPlanId
    ) {
      return {
        ok: false,
        code: "UPGRADE_NOT_CONFIGURED",
        manageSubscriptionHint: true,
        purchasePurpose: "upgrade",
      };
    }
    const conf = input.earlyRenewConfirmation;
    if (!conf) {
      return { ok: false, code: "EARLY_RENEW_REQUIRED_EXPLICIT", purchasePurpose: purpose };
    }
    if (
      input.publishedAmountBaisa == null ||
      input.publishedPeriodUnit == null ||
      input.publishedPeriodCount == null ||
      input.serverProjectedPaidThroughIso == null
    ) {
      return { ok: false, code: "EARLY_RENEW_CONFIRMATION_MISMATCH", purchasePurpose: purpose };
    }
    if (
      conf.amountBaisa !== input.publishedAmountBaisa ||
      conf.periodUnit !== input.publishedPeriodUnit ||
      conf.periodCount !== input.publishedPeriodCount ||
      conf.projectedPaidThroughIso !== input.serverProjectedPaidThroughIso
    ) {
      return { ok: false, code: "EARLY_RENEW_CONFIRMATION_MISMATCH", purchasePurpose: purpose };
    }
  }

  const open = selectOpenOrderForPurpose(openList);
  if (!open) {
    return {
      ok: true,
      action: "proceed_create",
      purchasePurpose: purpose,
      purchaseKind: purpose,
      blockNewCollection: false,
    };
  }

  // Same client_op with different fingerprint on sequential reuse path.
  const reqOp = input.clientOpId?.trim();
  if (
    reqOp &&
    open.clientOpId === reqOp &&
    input.inputFingerprint != null &&
    open.inputFingerprint !== input.inputFingerprint
  ) {
    return {
      ok: false,
      code: "CONTENT_MISMATCH",
      openOrder: open,
      purchasePurpose: purpose,
    };
  }

  if (isBlockingAttemptStatus(open.attemptStatus)) {
    return {
      ok: true,
      action: "reuse_open_order",
      purchasePurpose: purpose,
      purchaseKind: purpose,
      openOrder: open,
      blockNewCollection: true,
    };
  }

  if (open.attemptStatus === "intent_created" || open.attemptStatus == null) {
    return {
      ok: true,
      action: "reuse_open_order",
      purchasePurpose: purpose,
      purchaseKind: purpose,
      openOrder: open,
      blockNewCollection: false,
    };
  }

  return {
    ok: false,
    code: "OPEN_ORDER_CONFLICT",
    openOrder: open,
    purchasePurpose: purpose,
  };
}

/** UI mapping hint — not a grant. */
export function purchaseGateToUiState(decision: PurchaseGateDecision): {
  code: string;
  showManageSubscription: boolean;
  blockCheckout: boolean;
  upgradeNotConfigured: boolean;
} {
  if (decision.ok) {
    return {
      code: decision.action,
      showManageSubscription: false,
      blockCheckout: decision.blockNewCollection,
      upgradeNotConfigured: false,
    };
  }
  return {
    code: decision.code,
    showManageSubscription:
      decision.code === "ALREADY_SUBSCRIBED"
      || decision.code === "UPGRADE_NOT_CONFIGURED"
      || decision.code === "OPEN_COLLECTION_UNRESOLVED"
      || decision.code === "PENDING_COLLECTION_RECONCILE",
    blockCheckout: true,
    upgradeNotConfigured: decision.code === "UPGRADE_NOT_CONFIGURED",
  };
}
