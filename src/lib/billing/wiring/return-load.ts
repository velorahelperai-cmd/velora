/**
 * Load return-page DB row for display only.
 * Query params never grant entitlement.
 *
 * paid_through for a settled purchase: billing_entitlement_applications.applied_paid_through
 * (per order grant). billing_subscriptions.paid_through is company operational state only.
 */

import type { BillingReturnDbRow } from "@/lib/billing/wiring/return-status";
import type { FinancialQualification, FinancialRecord } from "@/lib/billing/financial-truth";
import { qualifyFinancialOrder } from "@/lib/billing/financial-truth";
import { logPaymobSandboxEvent } from "@/lib/billing/paymob/intention";

export type BillingReturnDbParts = {
  order: { id: string; company_id: string; status: string; plan_version_id?: string; amount_baisa?: number; currency?: string; provider_environment?: string } | null;
  attempt: { id: string; status: string } | null;
  latestEvent: { event_status: string; observation_key: string } | null;
  grant: { id: string; applied_paid_through: string } | null;
  financial?: FinancialQualification;
};

/** Pure mapper — unit-tested against schema field names. */
export function mapBillingReturnDbParts(
  requestCompanyId: string,
  parts: BillingReturnDbParts,
): BillingReturnDbRow | null {
  if (!parts.order || parts.order.company_id !== requestCompanyId) {
    return null;
  }

  let latestEventStatus: BillingReturnDbRow["latestEventStatus"] = null;
  const es = parts.latestEvent?.event_status;
  if (es === "pending" || es === "success" || es === "failed" || es === "other") {
    latestEventStatus = es;
  }

  const hasGrant = Boolean(parts.grant);
  const successEventStored = latestEventStatus === "success";
  const awaitingProcessing = successEventStored && !hasGrant;
  const order = parts.order;
  const selection = typeof order.plan_version_id === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(order.plan_version_id)
    && Number.isSafeInteger(order.amount_baisa) && order.amount_baisa! > 0 && order.currency === "OMR"
    ? { planVersionId: order.plan_version_id, amountBaisa: order.amount_baisa!, currency: "OMR" as const } : null;

  return {
    companyId: parts.order.company_id,
    orderId: parts.order.id,
    orderStatus: parts.order.status,
    attemptStatus: parts.attempt ? parts.attempt.status : null,
    latestEventStatus,
    hasGrant,
    /** A grant is history; only qualified proof can supply a confirmed period. */
    paidThrough: parts.financial?.paidThrough ?? null,
    financial: parts.financial,
    successEventStored,
    awaitingProcessing,
    ...(selection ? { selection } : {}),
    ...(["test","live"].includes(order.provider_environment??"") ? {providerEnvironment:order.provider_environment as "test"|"live"} : {}),
  };
}

export async function loadBillingReturnRow(input: {
  requestCompanyId: string;
  orderId: string;
}): Promise<BillingReturnDbRow | null> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  if (!admin) return null;

  const { data: order, error } = await admin
    .from("billing_orders")
    .select("*")
    .eq("id", input.orderId)
    .eq("company_id", input.requestCompanyId)
    .returns<FinancialRecord[]>()
    .maybeSingle();

  if (error || !order || order.company_id !== input.requestCompanyId) {
    logPaymobSandboxEvent({
      stage: "return",
      code: "order_not_found",
    });
    return null;
  }
  const displayOrder: NonNullable<BillingReturnDbParts["order"]> = {
    id: String(order.id), company_id: String(order.company_id), status: String(order.status),
    plan_version_id: typeof order.plan_version_id === "string" ? order.plan_version_id : undefined,
    amount_baisa: Number(order.amount_baisa), currency: typeof order.currency === "string" ? order.currency : undefined,
    provider_environment:typeof order.provider_environment==="string"?order.provider_environment:undefined,
  };
  const { financialDb, readFinancialEvidence } = await import("@/lib/billing/financial-read");
  let evidence;
  try { evidence = await readFinancialEvidence(financialDb(admin), [order], input.requestCompanyId); }
  catch {
    logPaymobSandboxEvent({
      stage: "return",
      code: "evidence_unknown",
      orderId: input.orderId,
    });
    // Missing evidence is unknown, never success, failed or a zero collection.
    return mapBillingReturnDbParts(input.requestCompanyId, { order: displayOrder, attempt: null, latestEvent: null, grant: null,
      financial: { companyId: input.requestCompanyId, orderId: input.orderId, state: "unknown", collectionProven: false, paidThrough: null, collectedAt: null, environment: null } });
  }
  const attempt = [...evidence.attempts].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id)))[0];
  const event = evidence.events.filter(e => e.payment_attempt_id === attempt?.id)
    .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)) || String(b.id).localeCompare(String(a.id)))[0];
  const grant = evidence.grants[0];

  const mapped = mapBillingReturnDbParts(input.requestCompanyId, {
    order: displayOrder,
    attempt: attempt
      ? { id: String(attempt.id), status: String(attempt.status) }
      : null,
    latestEvent: event ? { event_status: String(event.event_status), observation_key: String(event.observation_key) } : null,
    grant: grant
      ? {
          id: String(grant.id),
          applied_paid_through: String(grant.applied_paid_through),
        }
      : null,
    financial: qualifyFinancialOrder(input.requestCompanyId, order, evidence),
  });
  logPaymobSandboxEvent({
    stage: "return",
    code: mapped?.orderStatus ?? "loaded",
    orderId: input.orderId,
    paymentAttemptId: attempt ? String(attempt.id) : undefined,
  });
  return mapped;
}
