import "server-only";
import {readCompanyBillingDisplay} from "./display-read";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { SubscriptionView } from "@/components/app/subscription-model";
import {masterJourneyEnabled} from '@/lib/master-journey/rollout';

type Es02FoundationRow = {
  clockState?: unknown;
  paymentConfirmedAt?: unknown;
  paidThroughAt?: unknown;
  termUnit?: unknown;
  operationalReady?: unknown;
};

/** ES02 paid ledger uses plan_version_id NULL; commercial display may still report empty. */
async function readEs02PaidSubscriptionView(
  companyId: string,
  userId: string,
  master: boolean,
): Promise<SubscriptionView | null> {
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("es02_read_activation_foundation", {
      p_expected_account_id: userId,
      p_company_id: companyId,
    });
    if (error) return null;
    const envelope = data as { ok?: boolean; data?: Es02FoundationRow } | null;
    if (envelope?.ok !== true || !envelope.data) return null;
    const row = envelope.data;
    const paidThrough = typeof row.paidThroughAt === "string" ? row.paidThroughAt : null;
    const paymentConfirmed = typeof row.paymentConfirmedAt === "string" ? row.paymentConfirmedAt : null;
    if (!paymentConfirmed) return null;
    const cycle: SubscriptionView["cycle"] =
      row.termUnit === "year" ? "yearly" : row.termUnit === "month" ? "monthly" : null;
    const paidTimestamp = paidThrough === null ? null : new Date(paidThrough).getTime();
    if (paidTimestamp !== null && !Number.isFinite(paidTimestamp)) return null;
    const future = paidTimestamp !== null && paidTimestamp > Date.now();
    const clock = typeof row.clockState === "string" ? row.clockState : null;
    if (paidTimestamp !== null && !future) {
      return { state: "expired", currentTier: null, cycle, paidThrough };
    }
    if (clock === "active" && future) {
      return {
        state: "active",
        currentTier: null,
        cycle,
        paidThrough,
        ...(master
          ? {
              operationalReady: row.operationalReady === true,
              currentPackage: null,
              planVersionId: null,
            }
          : {}),
      };
    }
    if (clock === "waiting_readiness" && paymentConfirmed) {
      return {
        state: future ? "active" : "pending",
        currentTier: null,
        cycle,
        paidThrough,
        ...(master
          ? {
              operationalReady: false,
              currentPackage: null,
              planVersionId: null,
            }
          : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function loadOwnerBillingSubscription(fallback: SubscriptionView): Promise<SubscriptionView> {
  const access = await getCompanyAccess("owner");
  if (!access.ok || !access.context.company || access.context.membership?.role !== "owner") return fallback;
  const company = access.context.company;
  const userId = access.context.userId;
  if (company.status === "suspended") return { ...fallback, state: "suspended" };
  const unavailable: SubscriptionView = { state: "error", currentTier: null, cycle: null, paidThrough: null };
  const client = createAdminClient();
  if (!client) return unavailable;
  // The reviewed Billing RPC is additive; generated Database types are shared
  // with P1 and are deliberately not changed in this isolated acceptance patch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = client as any;
  const master = masterJourneyEnabled();
  try {
    const result=await readCompanyBillingDisplay(company.id);
    if(!result.ok){
      const es02 = await readEs02PaidSubscriptionView(company.id, userId, master);
      return es02 ?? unavailable;
    }
    const evidence=result.data,subscription=evidence.journey.subscription;
    if(typeof evidence.billing_paid!=="boolean"||typeof evidence.operational_eligible!=="boolean"){
      const es02 = await readEs02PaidSubscriptionView(company.id, userId, master);
      return es02 ?? unavailable;
    }
    const row=subscription&&typeof subscription==="object"&&!Array.isArray(subscription)?subscription as Record<string,unknown>:null;
    const data={environment:evidence.environment,active:evidence.billing_paid===true&&(master||evidence.operational_eligible===true),
      status:row?row.status:"none",paid_through:evidence.qualified_paid_through,plan_version_id:row?.plan_version_id??null};
    if(typeof data.status!=="string"||(data.paid_through!==null&&typeof data.paid_through!=="string")
      ||(data.plan_version_id!==null&&typeof data.plan_version_id!=="string")){
      const es02 = await readEs02PaidSubscriptionView(company.id, userId, master);
      return es02 ?? unavailable;
    }

    const paidThrough: string | null = data.paid_through;
    const paidTimestamp = paidThrough === null ? null : new Date(paidThrough).getTime();
    if (paidTimestamp !== null && !Number.isFinite(paidTimestamp)) return unavailable;
    const future = paidTimestamp !== null && paidTimestamp > Date.now();
    const active = data.active === true && future && (data.status === "active" || data.status === "cancel_at_period_end");
    let tier: SubscriptionView["currentTier"] = null;
    let cycle: SubscriptionView["cycle"] = null;
    let currentPackage: SubscriptionView["currentPackage"] = null;
    if (data.plan_version_id) {
      const { data: version } = await admin.from("billing_plan_versions").select("plan_id,period_unit,period_count")
        .eq("id", data.plan_version_id).maybeSingle();
      if (version) {
        cycle = version.period_unit === "year" && version.period_count === 1 ? "yearly"
          : version.period_unit === "month" && version.period_count === 1 ? "monthly" : null;
        const { data: plan } = await admin.from("billing_plans").select("code").eq("id", version.plan_id).maybeSingle();
        const code = String(plan?.code ?? "");
        currentPackage = /_basic$/.test(code) ? 'basic' : /_premium$/.test(code) ? 'premium' : null;
        tier = code.startsWith("noor_") ? "level_1" : code.startsWith("lina_") ? "level_2" : code.startsWith("dana_") ? "level_3" : null;
      }
    }
    const { data: openOrder, error: orderError } = await admin.from("billing_orders").select("id")
      .eq("company_id", company.id).eq("provider_environment", "live").in("status", ["locked", "submitted"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (orderError) return unavailable;
    // An open order or a future date alone never proves operational entitlement.
    const commercial: SubscriptionView = {
      state: data.status === "suspended" ? "suspended" : active ? "active"
        : paidTimestamp !== null && !future ? "expired" : openOrder ? "pending" : "empty",
      currentTier: tier, cycle, paidThrough,
      ...(master ? {currentPackage,planVersionId:data.plan_version_id,operationalReady:evidence.operational_eligible===true} : {}),
      ...(openOrder ? { pendingOrderId: String(openOrder.id) } : {}),
    };
    if (commercial.state === "active" || commercial.state === "expired" || commercial.state === "suspended" || commercial.state === "pending") {
      return commercial;
    }
    // Commercial proof empty/unproven: check ES02 paid ledger before claiming "no subscription".
    const es02 = await readEs02PaidSubscriptionView(company.id, userId, master);
    return es02 ?? commercial;
  } catch {
    const es02 = await readEs02PaidSubscriptionView(company.id, userId, master);
    return es02 ?? unavailable;
  }
}
