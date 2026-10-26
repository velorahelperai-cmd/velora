
/**
 * Map billing_create_or_reuse_subscription_order RPC JSONB.
 */

export type AtomicPurchasePersistResult =
  | {
      ok: true;
      action: "insert" | "reuse";
      orderId: string;
      specialReference: string;
      paymentAttemptId: string;
      blockNewCollection: boolean;
      planVersionId?: string;
    }
  | { ok: false; code: string; manageSubscriptionHint?: true; blockNewCollection?: boolean };

export function mapAtomicPurchasePersistPayload(payload: unknown): AtomicPurchasePersistResult {
  if (payload == null || typeof payload !== "object") {
    return { ok: false, code: "purchase_persist_rpc_invalid" };
  }
  const row = payload as Record<string, unknown>;
  if (row.ok !== true) {
    const code = typeof row.code === "string" ? row.code : "purchase_persist_rejected";
    return {
      ok: false,
      code,
      ...(row.manage_subscription_hint === true ? { manageSubscriptionHint: true as const } : {}),
      ...(row.block_new_collection === true ? { blockNewCollection: true as const } : {}),
    };
  }
  const orderId = row.order_id;
  const special = row.special_reference;
  const attemptId = row.payment_attempt_id;
  if (
    typeof orderId !== "string" ||
    typeof special !== "string" ||
    typeof attemptId !== "string"
  ) {
    return { ok: false, code: "purchase_persist_rpc_incomplete" };
  }
  return {
    ok: true,
    action: row.action === "reuse" ? "reuse" : "insert",
    orderId,
    specialReference: special,
    paymentAttemptId: attemptId,
    blockNewCollection: row.block_new_collection === true,
    planVersionId: typeof row.plan_version_id === "string" ? row.plan_version_id : undefined,
  };
}

export function createAtomicPurchasePersistRpc(admin: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
}) {
  return async (args: {
    companyId: string;
    productCode: string;
    purchasePurpose: string;
    planVersionId: string;
    requestedPlanId: string | null;
    clientOpId: string;
    inputFingerprint: string;
    specialReference: string;
    amountBaisa: number;
    currency: string;
    periodDays: number;
    periodUnit: string;
    periodCount: number;
    providerAccountRef: string;
    providerEnvironment: string;
    createdBy: string | null;
  }): Promise<AtomicPurchasePersistResult> => {
    void admin; void args; return {ok:false,code:"provider_retired"};
  };
}
