/**
 * ES02 Area B — account-bound order / provision / recovery.
 * Synthetic settlement is NOT exported here (fixture-only module).
 * PAYMOB_EXTERNAL_VERIFICATION: Deferred.
 */
"use server";

import { randomUUID } from "crypto";
import { logEvent, withLogContext } from "@/lib/logging/logger.mjs";
import { createClient } from "@/lib/supabase/server";
import { checkAppSession } from "@/lib/auth/session-guard";
import { normalizeOptionalBranchContactPhone, validatePreparation, type Preparation } from "@/lib/tenancy/prepayment-preparation";
import { billingUuid } from "@/lib/billing/wiring/public-offer-policy";
import {
  es02Uuid,
  type Es02AccountOrderView,
  type Es02ActionCode,
  type Es02ActivationFoundation,
  type Es02OwnedRecoveryView,
  type Es02Result,
} from "./contracts";
import {
  resolveEs02Offer,
  offersEqual,
  type Es02LegacySingleSelection,
  type Es02OfferSelection,
} from "./commercial-offer";
import { sanitizeCheckoutPayload } from "./preparation-handoff";
import { parseAccountOrderRow, parseOwnedRecoveryRow } from "./account-order";
import { paymobExternalSettlementStatus } from "./synthetic-settlement";
import { classifyEs02RpcFailure, type Es02RpcObservation } from "./rpc-classify";
import { classifyCreateOrderWriteAck, classifyProvisionWriteAck } from "./write-ack";
import { singleBranchCountAllowed } from "@/lib/tenancy/single-branch-policy";
import { beginAccountTestCheckout, type AccountCheckoutData } from "./account-checkout";

function es02Log(
  severity: "info" | "warn" | "error",
  event: string,
  fields: Record<string, unknown>,
): void {
  withLogContext(
    {
      ...(typeof fields.request_id === "string" ? { request_id: fields.request_id } : {}),
      ...(typeof fields.user_id === "string" ? { user_id: fields.user_id } : {}),
    },
    () => {
      logEvent(severity, event, {
        module: "billing.es02",
        stage: "es02",
        ...fields,
      });
    },
  );
}

async function readAuthenticatedAccount(
  expectedAccountId: string,
): Promise<{ ok: true; accountId: string; sessionId: string } | { ok: false; code: "UNAUTHENTICATED" }> {
  try {
    if (!es02Uuid(expectedAccountId)) return { ok: false, code: "UNAUTHENTICATED" };
    const client = await createClient();
    const { data, error } = await client.auth.getClaims();
    const claims = data?.claims;
    if (error || claims?.sub !== expectedAccountId || !billingUuid(claims?.session_id)) {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    const session = await checkAppSession(client);
    if (!session.ok) return { ok: false, code: "UNAUTHENTICATED" };
    return { ok: true, accountId: expectedAccountId, sessionId: claims.session_id as string };
  } catch {
    return { ok: false, code: "UNAUTHENTICATED" };
  }
}

function mapFailCode(code: unknown): Es02ActionCode {
  const allowed: readonly Es02ActionCode[] = [
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "INVALID_INPUT",
    "OFFER_TAMPER",
    "STALE_CAPTURE",
    "FOREIGN_OWNER",
    "ALREADY_PROVISIONED",
    "NOT_SETTLED",
    "DUPLICATE_SETTLEMENT",
    "SYNTHETIC_DISABLED",
    "PAYMOB_EXTERNAL_DEFERRED",
    "UNKNOWN",
    "UNAVAILABLE",
    "UNCONFIGURED",
    "CONFLICT",
    "RECONCILIATION_REQUIRED",
  ];
  if (typeof code === "string" && (allowed as readonly string[]).includes(code)) {
    return code as Es02ActionCode;
  }
  return "UNAVAILABLE";
}

function asObservation(result: {
  data: unknown;
  error: unknown;
  status?: number;
  statusText?: string;
}): Es02RpcObservation {
  return {
    data: result.data,
    error: result.error,
    status: result.status,
    statusText: result.statusText,
  };
}

/**
 * Explicit payment-initiation boundary. Review itself is local. The gated Test
 * adapter durably binds the operation, canonical offer and preparation before
 * contacting Paymob. Disabled configuration performs no writes.
 */
export async function beginAccountPaymentAction(input: {
  expectedAccountId: string;
  selection: Es02OfferSelection;
  consentAccepted: boolean;
  clientOpId: string;
  preparation?: Preparation;
}): Promise<Es02Result<AccountCheckoutData>> {
  const auth = await readAuthenticatedAccount(input?.expectedAccountId);
  if (!auth.ok) return auth;
  const sanitized = sanitizeCheckoutPayload({
    selection: input.selection,
    consentAccepted: input.consentAccepted,
    clientOpId: input.clientOpId,
  });
  if (!sanitized) return { ok: false, code: "INVALID_INPUT" };
  const resolved = resolveEs02Offer(sanitized.selection);
  if (!resolved.ok) return { ok: false, code: resolved.code };
  if (!singleBranchCountAllowed(resolved.offer.branchSlots)) return { ok: false, code: "SECOND_BRANCH_DEFERRED" };
  return beginAccountTestCheckout({ accountId: auth.accountId, sessionId: auth.sessionId, clientOpId: sanitized.clientOpId, selection: sanitized.selection, preparation: input.preparation });
}

/** Existing financial-order primitive; NOT a prepayment-review action. */
export async function createAccountBoundOrderAction(input: {
  expectedAccountId: string;
  selection: Es02OfferSelection | Es02LegacySingleSelection;
  consentAccepted: boolean;
  clientOpId: string;
  /** Ignored — not authority. */
  captureGeneration?: number;
}): Promise<Es02Result<{ order: Es02AccountOrderView; action: "insert" | "reuse" }>> {
  const requestId = randomUUID();
  const auth = await readAuthenticatedAccount(input?.expectedAccountId);
  if (!auth.ok) return auth;

  const sanitized = sanitizeCheckoutPayload({
    selection: input.selection,
    consentAccepted: input.consentAccepted,
    clientOpId: input.clientOpId,
  });
  if (!sanitized) {
    es02Log("warn", "es02.order.create.rejected", {
      request_id: requestId,
      user_id: auth.accountId,
      error_code: "INVALID_INPUT",
      operation: "create_account_order",
    });
    return { ok: false, code: "INVALID_INPUT" };
  }

  const resolved = resolveEs02Offer(sanitized.selection);
  if (!resolved.ok) {
    return { ok: false, code: resolved.code };
  }
  const offer = resolved.offer;
  if (!singleBranchCountAllowed(offer.branchSlots)) {
    es02Log("warn", "es02.order.create.rejected", {
      request_id: requestId,
      user_id: auth.accountId,
      error_code: "SECOND_BRANCH_DEFERRED",
      operation: "create_account_order",
    });
    return { ok: false, code: "SECOND_BRANCH_DEFERRED" };
  }
  const slotsPayload = offer.slots.map((s) => ({
    persona: s.persona,
    package: s.package,
  }));

  try {
    const client = await createClient();
    const observation = asObservation(
      await client.rpc("es02_create_account_order" as never, {
        p_expected_account_id: auth.accountId,
        p_client_op_id: sanitized.clientOpId,
        p_term: offer.term,
        p_slots: slotsPayload,
        p_consent_accepted: true,
      } as never),
    );
    if (observation.error) {
      const code = classifyEs02RpcFailure(observation, true);
      es02Log("error", "es02.order.create.rpc_uncertain", {
        request_id: requestId,
        user_id: auth.accountId,
        error_code: code,
        operation: "create_account_order",
        client_op_id: sanitized.clientOpId,
      });
      return { ok: false, code };
    }
    const ack = classifyCreateOrderWriteAck(observation.data);
    if (ack.status === "unknown") {
      es02Log("error", "es02.order.create.ack_uncertain", {
        request_id: requestId,
        user_id: auth.accountId,
        error_code: "UNKNOWN",
        operation: "create_account_order",
        client_op_id: sanitized.clientOpId,
      });
      return { ok: false, code: "UNKNOWN" };
    }
    if (ack.status === "denied") {
      return { ok: false, code: ack.code };
    }
    // Ambiguous/malformed success body after attempted write → UNKNOWN (retain op identity).
    const order = parseAccountOrderRow(ack.data, auth.accountId);
    if (!order || !offersEqual(order.offer, offer)) {
      es02Log("error", "es02.order.create.ack_malformed", {
        request_id: requestId,
        user_id: auth.accountId,
        error_code: "UNKNOWN",
        operation: "create_account_order",
        client_op_id: sanitized.clientOpId,
      });
      return { ok: false, code: "UNKNOWN" };
    }
    es02Log("info", "es02.order.create.ok", {
      request_id: requestId,
      user_id: auth.accountId,
      operation: "create_account_order",
      action: ack.action,
      order_id: order.orderId,
    });
    return {
      ok: true,
      data: { order, action: ack.action },
    };
  } catch {
    es02Log("error", "es02.order.create.throw", {
      request_id: requestId,
      user_id: auth.accountId,
      error_code: "UNKNOWN",
      operation: "create_account_order",
      client_op_id: sanitized.clientOpId,
    });
    return { ok: false, code: "UNKNOWN" };
  }
}

/** Explicit Deferred boundary — never claims Paymob success. */
export async function settleAccountOrderPaymobAction(): Promise<Es02Result<never>> {
  const deferred = paymobExternalSettlementStatus();
  return { ok: false, code: deferred.code };
}

/**
 * @deprecated Customer-callable synthetic settle removed (C3).
 * Fixture harness must import fixture-synthetic-settlement.ts only.
 */
export async function settleAccountOrderSyntheticAction(): Promise<Es02Result<never>> {
  return { ok: false, code: "SYNTHETIC_DISABLED" };
}

/** Find owned paid purchase for browser-loss recovery (no recharge). */
export async function readOwnedPurchaseRecoveryAction(input: {
  expectedAccountId: string;
}): Promise<Es02Result<{ purchase: Es02OwnedRecoveryView | null }>> {
  const auth = await readAuthenticatedAccount(input?.expectedAccountId);
  if (!auth.ok) return auth;
  try {
    const client = await createClient();
    const observation = asObservation(
      await client.rpc("es02_read_owned_purchase" as never, {
        p_expected_account_id: auth.accountId,
      } as never),
    );
    if (observation.error) {
      return { ok: false, code: classifyEs02RpcFailure(observation, false) };
    }
    const row = observation.data as { ok?: boolean; code?: string; data?: unknown };
    if (row?.ok !== true) return { ok: false, code: mapFailCode(row?.code) };
    if (row.data == null) return { ok: true, data: { purchase: null } };
    const purchase = parseOwnedRecoveryRow(row.data, auth.accountId);
    if (!purchase) {
      es02Log("warn", "es02.recovery.identity_mismatch", {
        user_id: auth.accountId,
        error_code: "FOREIGN_OWNER",
        operation: "read_owned_purchase",
      });
      return { ok: false, code: "FOREIGN_OWNER" };
    }
    return { ok: true, data: { purchase } };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/** Finish provisioning with re-entered business fields against owned settled purchase. */
export async function completeOwnedProvisioningAction(input: {
  expectedAccountId: string;
  orderId: string;
  idempotencyKey: string;
  preparation: Preparation;
}): Promise<
  Es02Result<{ companyId: string; orderId: string; orderGroupId: string; action: "provisioned" | "reuse" }>
> {
  const requestId = randomUUID();
  const auth = await readAuthenticatedAccount(input?.expectedAccountId);
  if (!auth.ok) return auth;
  if (!es02Uuid(input.orderId) || !es02Uuid(input.idempotencyKey)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const prepErrors = validatePreparation(input.preparation);
  if (prepErrors.length) return { ok: false, code: "INVALID_INPUT" };

  const business = {
    name: input.preparation.name.trim(),
    type: input.preparation.type.trim(),
    country: input.preparation.country.trim(),
    city: input.preparation.city.trim(),
    phone: input.preparation.phone.trim(),
    replyLanguage: "both",
    hours: "",
    email: "",
  };
  const branches = [];
  for (const branch of input.preparation.branches) {
    const contact = normalizeOptionalBranchContactPhone(branch.contactPhone);
    if (!contact.ok) return { ok: false, code: "INVALID_INPUT" };
    branches.push({ name: branch.name.trim(), city: branch.city.trim(), contact_phone: contact.value });
  }

  try {
    const client = await createClient();
    const observation = asObservation(
      await client.rpc("es02_provision_owned_purchase" as never, {
        p_expected_account_id: auth.accountId,
        p_order_id: input.orderId,
        p_idempotency_key: input.idempotencyKey,
        p_business: business,
        p_branches: branches,
      } as never),
    );
    if (observation.error) {
      const code = classifyEs02RpcFailure(observation, true);
      es02Log("error", "es02.provision.rpc_uncertain", {
        request_id: requestId,
        user_id: auth.accountId,
        error_code: code,
        operation: "provision_owned",
        order_id: input.orderId,
      });
      return { ok: false, code };
    }
    const ack = classifyProvisionWriteAck(observation.data);
    if (ack.status === "unknown") {
      return { ok: false, code: "UNKNOWN" };
    }
    if (ack.status === "denied") {
      return { ok: false, code: ack.code };
    }
    const body = ack.data as {
      companyId?: string;
      orderId?: string;
      orderGroupId?: string;
    } | null;
    if (
      !es02Uuid(body?.companyId) ||
      !es02Uuid(body?.orderId) ||
      !es02Uuid(body?.orderGroupId)
    ) {
      return { ok: false, code: "UNKNOWN" };
    }
    es02Log("info", "es02.provision.ok", {
      request_id: requestId,
      user_id: auth.accountId,
      operation: "provision_owned",
      action: ack.action,
      order_id: body.orderId,
      company_id: body.companyId,
    });
    return {
      ok: true,
      data: {
        companyId: body.companyId,
        orderId: body.orderId,
        orderGroupId: body.orderGroupId,
        action: ack.action,
      },
    };
  } catch {
    return { ok: false, code: "UNKNOWN" };
  }
}

export async function readEs02ActivationFoundationAction(input: {
  expectedAccountId: string;
  companyId: string;
}): Promise<Es02Result<Es02ActivationFoundation>> {
  const auth = await readAuthenticatedAccount(input?.expectedAccountId);
  if (!auth.ok) return auth;
  if (!es02Uuid(input.companyId)) return { ok: false, code: "INVALID_INPUT" };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("es02_read_activation_foundation" as never, {
      p_expected_account_id: auth.accountId,
      p_company_id: input.companyId,
    } as never);
    if (error) return { ok: false, code: "UNAVAILABLE" };
    const row = data as { ok?: boolean; code?: string; data?: Es02ActivationFoundation };
    if (row?.ok !== true || !row.data) {
      return { ok: false, code: row?.ok === false ? mapFailCode(row?.code) : "UNAVAILABLE" };
    }
    return { ok: true, data: row.data };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

/**
 * Readiness reconcile — does not accept owner browser readiness claims.
 * Server/native operational facts only; otherwise fail-closed UNCONFIGURED.
 */
export async function reconcileEs02ActivationReadinessAction(input: {
  expectedAccountId: string;
  companyId: string;
}): Promise<Es02Result<Es02ActivationFoundation>> {
  const auth = await readAuthenticatedAccount(input?.expectedAccountId);
  if (!auth.ok) return auth;
  if (!es02Uuid(input.companyId)) return { ok: false, code: "INVALID_INPUT" };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("es02_reconcile_activation_readiness" as never, {
      p_expected_account_id: auth.accountId,
      p_company_id: input.companyId,
    } as never);
    if (error) return { ok: false, code: "UNAVAILABLE" };
    const row = data as { ok?: boolean; code?: string; data?: Es02ActivationFoundation };
    if (row?.ok !== true || !row.data) {
      return { ok: false, code: row?.ok === false ? mapFailCode(row?.code) : "UNAVAILABLE" };
    }
    return { ok: true, data: row.data };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
