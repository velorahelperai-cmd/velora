/**
 * Order + payment_attempt persistence with repair-on-retry.
 * Prefer resolveOrCreateAttempt (FIX-03 server txn: lock order → re-read → create-or-reuse).
 * Fallback findLatest+insert is non-atomic and only for in-memory unit doubles.
 *
 * VEL-SUBSCRIPTION-SINGLE-PRODUCT-FIX-01: 23505 handling is constraint-aware —
 * client_op fingerprint conflict rejects; open product+purpose race reuses winner
 * and re-evaluates blockNewCollection. Attempt-resolve path unchanged.
 */

import type { CreateOrderDecision } from "@/lib/billing/wiring/order-create";
import type { ResolveOrCreateAttemptResult } from "@/lib/billing/wiring/attempt-resolve-rpc";
import {
  blockNewCollectionForAttempt,
  type PurchasePurpose,
} from "@/lib/billing/wiring/purchase-gate";
import type { PaymentAttemptStatus } from "@/lib/billing/types";

export type OrderPersistResult =
  | {
      ok: true;
      action: "insert" | "reuse" | "repaired";
      orderId: string;
      specialReference: string;
      paymentAttemptId: string;
      /** Set when race-reused an open product-purpose winner (re-evaluated). */
      blockNewCollection?: boolean;
    }
  | { ok: false; code: string };

export type AttemptRow = {
  id: string;
  status?: string;
};

export type OpenOrderForPurposeRow = {
  id: string;
  specialReference: string;
  inputFingerprint: string;
  attemptStatus?: PaymentAttemptStatus | null;
};

export type OrderPersistDeps = {
  insertOrder: (row: Record<string, unknown>) => Promise<
    | { ok: true; id: string; specialReference: string }
    | { ok: false; code: string; constraint?: string }
  >;
  findOrderByClientOp: (
    companyId: string,
    clientOpId: string,
  ) => Promise<
    | {
        id: string;
        specialReference: string;
        inputFingerprint: string;
        attemptStatus?: PaymentAttemptStatus | null;
      }
    | null
  >;
  /**
   * Open order for company + product + purchase purpose (any plan_version).
   * Used when insert races on billing_orders_open_product_purpose_uidx.
   */
  findOpenOrderForPurpose?: (
    companyId: string,
    productCode: string,
    purchasePurpose: PurchasePurpose,
  ) => Promise<OpenOrderForPurposeRow | null>;
  /**
   * FIX-03 preferred path: single server transaction (lock order → re-read → create-or-reuse).
   * When present, findLatestAttempt/insertAttempt are not used for resolve.
   */
  resolveOrCreateAttempt?: (
    orderId: string,
    companyId: string,
  ) => Promise<ResolveOrCreateAttemptResult>;
  findLatestAttempt: (orderId: string, companyId: string) => Promise<AttemptRow | null>;
  /**
   * Insert bootstrap attempt (intent_created, provider_order_id null).
   * Fallback only when resolveOrCreateAttempt is absent.
   */
  insertAttempt: (
    orderId: string,
    companyId: string,
  ) => Promise<{ ok: true; id: string } | { ok: false; code: string }>;
};

function isUniqueViolation(code: string): boolean {
  return code === "23505" || code === "unique_violation";
}

function constraintLooksLikeClientOp(constraint: string | undefined): boolean {
  if (!constraint) return false;
  const c = constraint.toLowerCase();
  return c.includes("client_op") || c.includes("company_client_op");
}

function constraintLooksLikeOpenPurpose(constraint: string | undefined): boolean {
  if (!constraint) return false;
  const c = constraint.toLowerCase();
  return c.includes("open_product_purpose");
}

function constraintLooksLikeSpecialReference(constraint: string | undefined): boolean {
  if (!constraint) return false;
  return constraint.toLowerCase().includes("special_reference");
}

/**
 * Resolve existing attempt or create bootstrap.
 * Unresolved / failed / any prior row → reuse identity (no second bootstrap).
 * Confirmed-failed → new attempt is a separate explicit RPC, not this path.
 */
export async function resolveAttemptForOrder(input: {
  deps: Pick<
    OrderPersistDeps,
    "findLatestAttempt" | "insertAttempt" | "resolveOrCreateAttempt"
  >;
  orderId: string;
  companyId: string;
}): Promise<
  | { ok: true; action: "reuse" | "repaired"; paymentAttemptId: string }
  | { ok: false; code: string }
> {
  if (input.deps.resolveOrCreateAttempt) {
    return input.deps.resolveOrCreateAttempt(input.orderId, input.companyId);
  }

  const existing = await input.deps.findLatestAttempt(input.orderId, input.companyId);
  if (existing) {
    // Any row (failed = confirmed reject; unresolved = unknown collection) —
    // do not invent another attempt on client_op repair/reuse.
    return { ok: true, action: "reuse", paymentAttemptId: existing.id };
  }

  const inserted = await input.deps.insertAttempt(input.orderId, input.companyId);
  if (inserted.ok) {
    return { ok: true, action: "repaired", paymentAttemptId: inserted.id };
  }

  if (isUniqueViolation(inserted.code)) {
    const raced = await input.deps.findLatestAttempt(input.orderId, input.companyId);
    if (raced) {
      return { ok: true, action: "repaired", paymentAttemptId: raced.id };
    }
  }

  return { ok: false, code: "attempt_insert_failed" };
}

export async function persistOrderWithAttempt(input: {
  deps: OrderPersistDeps;
  companyId: string;
  decision: Extract<CreateOrderDecision, { ok: true }>;
  orderInsertRow: Record<string, unknown>;
  /** Required for open product-purpose race resolution (SINGLE-PRODUCT-FIX-01). */
  productCode?: string;
  purchasePurpose?: PurchasePurpose;
}): Promise<OrderPersistResult> {
  const { deps, companyId, decision, orderInsertRow } = input;
  const productCode = input.productCode ?? "velora_ai_staff";
  const purchasePurpose: PurchasePurpose = input.purchasePurpose ?? "initial";

  if (decision.action === "reuse") {
    const resolved = await resolveAttemptForOrder({
      deps,
      orderId: decision.order.id,
      companyId,
    });
    if (!resolved.ok) return resolved;
    return {
      ok: true,
      action: resolved.action === "reuse" ? "reuse" : "repaired",
      orderId: decision.order.id,
      specialReference: decision.order.specialReference,
      paymentAttemptId: resolved.paymentAttemptId,
    };
  }

  const inserted = await deps.insertOrder(orderInsertRow);
  if (!inserted.ok) {
    if (isUniqueViolation(inserted.code)) {
      const sameOp = await deps.findOrderByClientOp(companyId, decision.clientOpId);

      // Same client_op, different fingerprint → CONTENT_MISMATCH (never return another order).
      if (sameOp && sameOp.inputFingerprint !== decision.inputFingerprint) {
        return { ok: false, code: "CONTENT_MISMATCH" };
      }

      if (sameOp && sameOp.inputFingerprint === decision.inputFingerprint) {
        const resolved = await resolveAttemptForOrder({
          deps,
          orderId: sameOp.id,
          companyId,
        });
        if (!resolved.ok) return resolved;
        const attemptStatus =
          sameOp.attemptStatus ??
          (await deps.findLatestAttempt(sameOp.id, companyId))?.status ??
          null;
        return {
          ok: true,
          action: resolved.action === "reuse" ? "reuse" : "repaired",
          orderId: sameOp.id,
          specialReference: sameOp.specialReference,
          paymentAttemptId: resolved.paymentAttemptId,
          blockNewCollection: blockNewCollectionForAttempt(
            (attemptStatus as PaymentAttemptStatus | null) ?? null,
          ),
        };
      }

      // client_op unique hit but row missing / constraint named client_op without matching fp
      if (constraintLooksLikeClientOp(inserted.constraint) && !sameOp) {
        return { ok: false, code: "client_op_conflict" };
      }

      // Open product+purpose race ONLY when that constraint is named.
      // special_reference / other uniques must not become successful reuse.
      if (deps.findOpenOrderForPurpose != null && constraintLooksLikeOpenPurpose(inserted.constraint)) {
        const purposeWinner = await deps.findOpenOrderForPurpose(
          companyId,
          productCode,
          purchasePurpose,
        );
        if (purposeWinner) {
          const winnerAsOp = await deps.findOrderByClientOp(companyId, decision.clientOpId);
          if (
            winnerAsOp &&
            winnerAsOp.id === purposeWinner.id &&
            winnerAsOp.inputFingerprint !== decision.inputFingerprint
          ) {
            return { ok: false, code: "CONTENT_MISMATCH" };
          }
          const resolved = await resolveAttemptForOrder({
            deps,
            orderId: purposeWinner.id,
            companyId,
          });
          if (!resolved.ok) return resolved;
          const attemptStatus =
            purposeWinner.attemptStatus ??
            (await deps.findLatestAttempt(purposeWinner.id, companyId))?.status ??
            null;
          return {
            ok: true,
            action: "reuse",
            orderId: purposeWinner.id,
            specialReference: purposeWinner.specialReference,
            paymentAttemptId: resolved.paymentAttemptId,
            blockNewCollection: blockNewCollectionForAttempt(
              (attemptStatus as PaymentAttemptStatus | null) ?? null,
            ),
          };
        }
        return { ok: false, code: "open_purpose_conflict" };
      }

      if (constraintLooksLikeSpecialReference(inserted.constraint)) {
        return { ok: false, code: "special_reference_conflict" };
      }
      if (constraintLooksLikeClientOp(inserted.constraint)) {
        return { ok: false, code: "client_op_conflict" };
      }
      return {
        ok: false,
        code: inserted.constraint ? "unique_constraint_conflict" : "client_op_conflict",
      };
    }
    return { ok: false, code: inserted.code };
  }

  const resolved = await resolveAttemptForOrder({
    deps,
    orderId: inserted.id,
    companyId,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      code: resolved.code === "attempt_insert_failed" ? "attempt_insert_failed" : resolved.code,
    };
  }

  return {
    ok: true,
    action: "insert",
    orderId: inserted.id,
    specialReference: inserted.specialReference,
    paymentAttemptId: resolved.paymentAttemptId,
    blockNewCollection: false,
  };
}
