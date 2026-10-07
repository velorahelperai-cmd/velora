/**
 * Server action: create billing order for session company owner.
 * Money from published plan only. Never opens Paymob when OMR/merchant/settings block.
 *
 * VEL-SUBSCRIPTION-SINGLE-PRODUCT-FIX-01: one product per company; open purpose =
 * company + product + purpose (not plan_version). Upgrade collection not configured.
 */

"use server";

import { getPaymobOmrConversionState } from "@/lib/billing/paymob/config";
import { canManageCompanyBilling } from "@/lib/billing/membership";
import { createAtomicPurchasePersistRpc } from "@/lib/billing/wiring/purchase-persist-rpc";
import {
  decidePurchaseGate,
  normalizePurchasePurpose,
  VELORA_SUBSCRIPTION_PRODUCT_CODE,
  type EarlyRenewConfirmation,
  type OpenPurchaseOrder,
  type PurchaseKind,
  type PurchasePurpose,
} from "@/lib/billing/wiring/purchase-gate";
import {
  decideCreateBillingOrder,
  fingerprintBillingOrderInputs,
  type PublishedPlanVersionSnapshot,
} from "@/lib/billing/wiring/order-create";
import {
  buildEarlyRenewQuote,
} from "@/lib/billing/wiring/renew-gate";
import {
  blocksPaymobConnection,
  readBillingPaymobWiringFlags,
  readWiringSecretsPresence,
} from "@/lib/billing/wiring/flags";
import type { PaymentAttemptStatus, SubscriptionSnapshot } from "@/lib/billing/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCompanyAccess } from "@/lib/tenancy/access";

export type CreateBillingOrderActionResult =
  | {
      ok: true;
      action: "insert" | "reuse" | "repaired";
      orderId: string;
      specialReference: string;
      paymentAttemptId: string;
      providerConnection: "blocked";
      providerConnectionBlock: string;
      blockNewCollection: boolean;
      purchaseKind: PurchasePurpose;
      purchasePurpose: PurchasePurpose;
      productCode: typeof VELORA_SUBSCRIPTION_PRODUCT_CODE;
    }
  | {
      ok: false;
      code: string;
      blockNewCollection?: boolean;
      manageSubscriptionHint?: true;
      purchasePurpose?: PurchasePurpose;
    };

function mapPlanRow(row: {
  id: string;
  status: string;
  amount_baisa: number;
  currency: string;
  period_days: number;
  period_unit: string;
  period_count: number;
}): PublishedPlanVersionSnapshot | null {
  if (row.currency !== "OMR") return null;
  if (row.period_unit !== "day" && row.period_unit !== "month" && row.period_unit !== "year") {
    return null;
  }
  if (row.status !== "published" && row.status !== "draft" && row.status !== "retired") {
    return null;
  }
  return {
    id: row.id,
    status: row.status,
    amountBaisa: row.amount_baisa,
    currency: "OMR",
    periodDays: row.period_days,
    periodUnit: row.period_unit,
    periodCount: row.period_count,
  };
}

/**
 * Owner-only order create. Company from session selection.
 * Does not call Paymob (OMR factor NOT_CONFIGURED in this package).
 * Purchase purpose gated server-side (ALREADY_SUBSCRIBED / open-order reuse / upgrade blocked).
 */
export async function createBillingOrderAction(input: {
  planVersionId: string;
  clientOpId: string;
  /** Default initial. renew requires confirmation. upgrade returns UPGRADE_NOT_CONFIGURED. */
  purchaseKind?: PurchaseKind;
  purchasePurpose?: PurchasePurpose;
  earlyRenewConfirmation?: EarlyRenewConfirmation;
  /** Rejected if any financial field present. */
  untrustedBrowserMoney?: {
    amountBaisa?: number;
    currency?: string;
    periodDays?: number;
  };
}): Promise<CreateBillingOrderActionResult> {
  const purchasePurpose = normalizePurchasePurpose(
    input.purchasePurpose ?? input.purchaseKind ?? "initial",
  );
  const productCode = VELORA_SUBSCRIPTION_PRODUCT_CODE;
  const flags = readBillingPaymobWiringFlags();
  if (!flags.createEnabled) {
    return { ok: false, code: "create_disabled" };
  }
  if (flags.liveEnabled) {
    return { ok: false, code: "live_rejected" };
  }

  const access = await getCompanyAccess("owner");
  if (!access.ok || !access.context.company || !access.context.membership) {
    return { ok: false, code: "not_owner" };
  }
  if (access.context.company.status === "suspended") {
    return { ok: false, code: "not_owner" };
  }

  const companyId = access.context.company.id;
  const companyStatus =
    access.context.company.status === "setup"
      ? ("setup" as const)
      : access.context.company.status === "suspended"
        ? ("suspended" as const)
        : ("active" as const);
  const membership = {
    companyId,
    role: access.context.membership.role,
    status: access.context.membership.status === "active" ? ("active" as const) : ("disabled" as const),
  };
  if (!canManageCompanyBilling(membership)) {
    return { ok: false, code: "not_owner" };
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return { ok: false, code: "admin_not_configured" };
  }
  // Billing tables not yet in generated Database types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = adminClient as any;

  const { data: planRow, error: planErr } = await admin
    .from("billing_plan_versions")
    .select("id, plan_id, status, amount_baisa, currency, period_days, period_unit, period_count")
    .eq("id", input.planVersionId)
    .maybeSingle();

  if (planErr) {
    return { ok: false, code: "plan_lookup_failed" };
  }
  const planVersion = planRow
    ? mapPlanRow({
        id: String(planRow.id),
        status: String(planRow.status),
        amount_baisa: Number(planRow.amount_baisa),
        currency: String(planRow.currency),
        period_days: Number(planRow.period_days),
        period_unit: String(planRow.period_unit),
        period_count: Number(planRow.period_count),
      })
    : null;
  const requestedPlanId = planRow?.plan_id ? String(planRow.plan_id) : null;

  const { data: subRow } = await admin
    .from("billing_subscriptions")
    .select("company_id, status, paid_through, cancel_at_period_end, plan_version_id")
    .eq("company_id", companyId)
    .maybeSingle();

  const subscription: SubscriptionSnapshot | null = subRow
    ? {
        companyId: String(subRow.company_id),
        status: String(subRow.status) as SubscriptionSnapshot["status"],
        paidThrough: subRow.paid_through ? new Date(String(subRow.paid_through)) : null,
        cancelAtPeriodEnd: Boolean(subRow.cancel_at_period_end),
        planVersionId: subRow.plan_version_id ? String(subRow.plan_version_id) : null,
      }
    : null;

  let subscriptionPlanId: string | null = null;
  if (subscription?.planVersionId) {
    const { data: subPlan } = await admin
      .from("billing_plan_versions")
      .select("plan_id")
      .eq("id", subscription.planVersionId)
      .maybeSingle();
    subscriptionPlanId = subPlan?.plan_id ? String(subPlan.plan_id) : null;
  }

  // Open orders for company + product + purpose — any plan_version (tier/cycle).
  const { data: openOrderRows } = await admin
    .from("billing_orders")
    .select(
      "id, company_id, plan_version_id, client_op_id, input_fingerprint, amount_baisa, currency, special_reference, status, product_code, purchase_purpose",
    )
    .eq("company_id", companyId)
    .eq("product_code", productCode)
    .eq("purchase_purpose", purchasePurpose)
    .in("status", ["locked", "submitted"]);

  const openOrdersForPurpose: OpenPurchaseOrder[] = [];
  for (const row of openOrderRows ?? []) {
    const { data: attempt } = await admin
      .from("billing_payment_attempts")
      .select("id, status")
      .eq("order_id", row.id)
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    openOrdersForPurpose.push({
      id: String(row.id),
      companyId: String(row.company_id),
      planVersionId: String(row.plan_version_id),
      clientOpId: String(row.client_op_id),
      inputFingerprint: String(row.input_fingerprint),
      amountBaisa: Number(row.amount_baisa),
      currency: "OMR",
      specialReference: String(row.special_reference),
      status: String(row.status),
      productCode: row.product_code ? String(row.product_code) : productCode,
      purchasePurpose: purchasePurpose,
      attemptStatus: attempt?.status
        ? (String(attempt.status) as PaymentAttemptStatus)
        : null,
    });
  }

  const clientOpId = input.clientOpId.trim();
  const inputFingerprint =
    planVersion != null
      ? fingerprintBillingOrderInputs({
          companyId,
          planVersionId: planVersion.id,
          amountBaisa: planVersion.amountBaisa,
          currency: planVersion.currency,
          periodUnit: planVersion.periodUnit,
          periodCount: planVersion.periodCount,
        })
      : "";

  let serverProjectedPaidThroughIso: string | null = null;
  if (purchasePurpose === "renew" && planVersion) {
    const quote = buildEarlyRenewQuote({
      amountBaisa: planVersion.amountBaisa,
      period: { unit: planVersion.periodUnit, count: planVersion.periodCount },
      currentPaidThrough: subscription?.paidThrough ?? null,
    });
    serverProjectedPaidThroughIso = quote.projectedPaidThroughIso;
  }

  const gate = decidePurchaseGate({
    companyId,
    planVersionId: input.planVersionId,
    requestedPlanId,
    subscriptionPlanId,
    purchasePurpose,
    productCode,
    subscription,
    companyStatus,
    openOrdersForPurpose,
    clientOpId,
    inputFingerprint: inputFingerprint || undefined,
    earlyRenewConfirmation: input.earlyRenewConfirmation ?? null,
    serverProjectedPaidThroughIso,
    publishedAmountBaisa: planVersion?.amountBaisa,
    publishedPeriodUnit: planVersion?.periodUnit,
    publishedPeriodCount: planVersion?.periodCount,
  });

  if (!gate.ok) {
    return {
      ok: false,
      code: gate.code,
      purchasePurpose: gate.purchasePurpose ?? purchasePurpose,
      ...(gate.manageSubscriptionHint ? { manageSubscriptionHint: true as const } : {}),
      ...(gate.blockNewCollection !== undefined
        ? { blockNewCollection: gate.blockNewCollection }
        : {}),
    };
  }

  void getPaymobOmrConversionState();
  const secrets = readWiringSecretsPresence();
  const connectionBlock =
    blocksPaymobConnection(flags, secrets) ?? "omr_conversion_not_configured";

  const decision = decideCreateBillingOrder({
    companyId,
    planVersionId: input.planVersionId,
    clientOpId,
    membership,
    planVersion,
    existingSameClientOp: null,
    untrustedBrowserMoney: input.untrustedBrowserMoney,
  });

  if (!decision.ok) {
    const code = decision.code === "client_op_conflict" ? "CONTENT_MISMATCH" : decision.code;
    return { ok: false, code, purchasePurpose };
  }
  if (decision.action !== "insert") {
    return { ok: false, code: "unexpected_decision", purchasePurpose };
  }

  const providerAccountRef =
    process.env.PAYMOB_INTEGRATION_ID_TEST?.trim() || "unconfigured-integration";

  const persistAtomic = createAtomicPurchasePersistRpc(admin);
  const persisted = await persistAtomic({
    companyId,
    productCode,
    purchasePurpose,
    planVersionId: decision.planVersionId,
    requestedPlanId,
    clientOpId: decision.clientOpId,
    inputFingerprint: decision.inputFingerprint,
    specialReference: decision.specialReference,
    amountBaisa: decision.amountBaisa,
    currency: decision.currency,
    periodDays: decision.periodDays,
    periodUnit: decision.periodUnit,
    periodCount: decision.periodCount,
    providerAccountRef,
    providerEnvironment: "test",
    createdBy: access.context.userId,
  });

  if (!persisted.ok) {
    return {
      ok: false,
      code: persisted.code,
      purchasePurpose,
      ...(persisted.manageSubscriptionHint ? { manageSubscriptionHint: true as const } : {}),
      ...(persisted.blockNewCollection !== undefined
        ? { blockNewCollection: persisted.blockNewCollection }
        : {}),
    };
  }

  return {
    ok: true,
    action: persisted.action === "reuse" ? "reuse" : "insert",
    orderId: persisted.orderId,
    specialReference: persisted.specialReference,
    paymentAttemptId: persisted.paymentAttemptId,
    providerConnection: "blocked",
    providerConnectionBlock: connectionBlock,
    blockNewCollection: persisted.blockNewCollection,
    purchaseKind: purchasePurpose,
    purchasePurpose,
    productCode,
  };
}
