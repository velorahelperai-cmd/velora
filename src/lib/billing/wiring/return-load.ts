/**
 * Load return-page DB row for display only.
 * Query params never grant entitlement.
 *
 * paid_through for a settled purchase: billing_entitlement_applications.applied_paid_through
 * (per order grant). billing_subscriptions.paid_through is company operational state only.
 */

import type { BillingReturnDbRow } from "@/lib/billing/wiring/return-status";

export type BillingReturnDbParts = {
  order: { id: string; company_id: string; status: string } | null;
  attempt: { id: string; status: string } | null;
  latestEvent: { event_status: string; observation_key: string } | null;
  grant: { id: string; applied_paid_through: string } | null;
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

  return {
    companyId: parts.order.company_id,
    orderId: parts.order.id,
    orderStatus: parts.order.status,
    attemptStatus: parts.attempt ? parts.attempt.status : null,
    latestEventStatus,
    hasGrant,
    /** Grant row is authoritative for this order's settlement period. */
    paidThrough: parts.grant ? parts.grant.applied_paid_through : null,
    successEventStored,
    awaitingProcessing,
  };
}

export async function loadBillingReturnRow(input: {
  requestCompanyId: string;
  orderId: string;
}): Promise<BillingReturnDbRow | null> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  if (!admin) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any;

  const { data: order } = await db
    .from("billing_orders")
    .select("id, company_id, status")
    .eq("id", input.orderId)
    .eq("company_id", input.requestCompanyId)
    .maybeSingle();

  if (!order) return null;

  const { data: attempt } = await db
    .from("billing_payment_attempts")
    .select("id, status")
    .eq("order_id", order.id)
    .eq("company_id", order.company_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let latestEvent: BillingReturnDbParts["latestEvent"] = null;
  if (attempt) {
    const { data: event } = await db
      .from("billing_provider_events")
      .select("event_status, observation_key")
      .eq("payment_attempt_id", attempt.id)
      .eq("company_id", order.company_id)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (event) {
      latestEvent = {
        event_status: String(event.event_status),
        observation_key: String(event.observation_key),
      };
    }
  }

  const { data: grant } = await db
    .from("billing_entitlement_applications")
    .select("id, applied_paid_through")
    .eq("order_id", order.id)
    .eq("company_id", order.company_id)
    .maybeSingle();

  return mapBillingReturnDbParts(input.requestCompanyId, {
    order: {
      id: String(order.id),
      company_id: String(order.company_id),
      status: String(order.status),
    },
    attempt: attempt
      ? { id: String(attempt.id), status: String(attempt.status) }
      : null,
    latestEvent,
    grant: grant
      ? {
          id: String(grant.id),
          applied_paid_through: String(grant.applied_paid_through),
        }
      : null,
  });
}
