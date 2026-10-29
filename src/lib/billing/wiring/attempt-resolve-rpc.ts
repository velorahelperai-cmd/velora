/**
 * Server RPC wrappers for attempt resolve-or-create + lifecycle FIX-04/05.
 * FIX-05: confirm-failed matches server event identity (txn/obs/account/env) and
 * blocks when durable success (or other-txn pending) remains — settlement RPCs untouched.
 */

export type ResolveOrCreateAttemptResult =
  | {
      ok: true;
      action: "reuse" | "repaired";
      paymentAttemptId: string;
      status?: string;
      attemptSeq?: number;
      isCurrent?: boolean;
    }
  | { ok: false; code: string };

export type ConfirmFailedAttemptResult =
  | {
      ok: true;
      paymentAttemptId: string;
      status: "failed";
      providerEventId?: string;
    }
  | { ok: false; code: string };

export type OpenAfterFailedResult =
  | {
      ok: true;
      action: "opened_after_failed" | "reuse_opened";
      paymentAttemptId: string;
      priorAttemptId: string;
      created: boolean;
      attemptSeq?: number;
    }
  | { ok: false; code: string };

/** Map SQL JSONB from billing_resolve_or_create_payment_attempt. */
export function mapResolveOrCreateRpcPayload(
  payload: unknown,
): ResolveOrCreateAttemptResult {
  if (payload == null || typeof payload !== "object") {
    return { ok: false, code: "resolve_rpc_invalid" };
  }
  const row = payload as Record<string, unknown>;
  if (row.ok !== true) {
    return { ok: false, code: "resolve_rpc_rejected" };
  }
  const id = row.payment_attempt_id;
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, code: "resolve_rpc_missing_id" };
  }
  const created = row.created === true || row.action === "created";
  return {
    ok: true,
    action: created ? "repaired" : "reuse",
    paymentAttemptId: id,
    status: typeof row.status === "string" ? row.status : undefined,
    attemptSeq: typeof row.attempt_seq === "number" ? row.attempt_seq : undefined,
    isCurrent: row.is_current === true ? true : undefined,
  };
}

export function mapConfirmFailedRpcPayload(payload: unknown): ConfirmFailedAttemptResult {
  if (payload == null || typeof payload !== "object") {
    return { ok: false, code: "confirm_failed_rpc_invalid" };
  }
  const row = payload as Record<string, unknown>;
  if (row.ok !== true || typeof row.payment_attempt_id !== "string") {
    return { ok: false, code: "confirm_failed_rpc_rejected" };
  }
  return {
    ok: true,
    paymentAttemptId: row.payment_attempt_id,
    status: "failed",
    providerEventId:
      typeof row.provider_event_id === "string" ? row.provider_event_id : undefined,
  };
}

export function mapOpenAfterFailedRpcPayload(payload: unknown): OpenAfterFailedResult {
  if (payload == null || typeof payload !== "object") {
    return { ok: false, code: "open_after_failed_rpc_invalid" };
  }
  const row = payload as Record<string, unknown>;
  if (row.ok !== true) {
    return { ok: false, code: "open_after_failed_rpc_rejected" };
  }
  const id = row.payment_attempt_id;
  const prior = row.prior_attempt_id;
  if (typeof id !== "string" || typeof prior !== "string") {
    return { ok: false, code: "open_after_failed_rpc_missing_id" };
  }
  const action =
    row.action === "reuse_opened" ? ("reuse_opened" as const) : ("opened_after_failed" as const);
  return {
    ok: true,
    action,
    paymentAttemptId: id,
    priorAttemptId: prior,
    created: row.created === true,
    attemptSeq: typeof row.attempt_seq === "number" ? row.attempt_seq : undefined,
  };
}

/**
 * Build admin.rpc caller for resolve-or-create.
 * Uses untyped client (billing RPCs not in generated Database types yet).
 */
export function createResolveOrCreateAttemptRpc(admin: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
}): (orderId: string, companyId: string) => Promise<ResolveOrCreateAttemptResult> {
  return async (orderId, companyId) => {
    const { data, error } = await admin.rpc("billing_resolve_or_create_payment_attempt", {
      p_order_id: orderId,
      p_company_id: companyId,
    });
    if (error) {
      return { ok: false, code: "resolve_rpc_failed" };
    }
    return mapResolveOrCreateRpcPayload(data);
  };
}

export function createConfirmFailedAttemptRpc(admin: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
}): (
  attemptId: string,
  companyId: string,
  evidence: { provider_event_id?: string; provider_transaction_id?: string; observation_key?: string },
) => Promise<ConfirmFailedAttemptResult> {
  return async (attemptId, companyId, evidence) => {
    const { data, error } = await admin.rpc("billing_confirm_payment_attempt_failed", {
      p_attempt_id: attemptId,
      p_company_id: companyId,
      p_evidence: evidence,
    });
    if (error) {
      return { ok: false, code: "confirm_failed_rpc_failed" };
    }
    return mapConfirmFailedRpcPayload(data);
  };
}

export function createOpenAfterFailedAttemptRpc(admin: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
}): (
  orderId: string,
  companyId: string,
  priorAttemptId: string,
  openClientOpId: string,
) => Promise<OpenAfterFailedResult> {
  return async (orderId, companyId, priorAttemptId, openClientOpId) => {
    const { data, error } = await admin.rpc(
      "billing_open_payment_attempt_after_confirmed_failed",
      {
        p_order_id: orderId,
        p_company_id: companyId,
        p_prior_attempt_id: priorAttemptId,
        p_open_client_op_id: openClientOpId,
      },
    );
    if (error) {
      return { ok: false, code: "open_after_failed_rpc_failed" };
    }
    return mapOpenAfterFailedRpcPayload(data);
  };
}
