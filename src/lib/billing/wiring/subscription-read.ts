import "server-only";
import {readCompanyBillingDisplay} from "./display-read";
import { getCompanyAccess } from "@/lib/tenancy/access";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionView } from "@/components/app/subscription-model";
export async function loadOwnerBillingSubscription(fallback: SubscriptionView): Promise<SubscriptionView> {
  const access = await getCompanyAccess("owner");
  if (!access.ok || !access.context.company || access.context.membership?.role !== "owner") return fallback;
  const company = access.context.company;
  if (company.status === "suspended") return { ...fallback, state: "suspended" };
  const unavailable: SubscriptionView = { state: "error", currentTier: null, cycle: null, paidThrough: null };
  const client = createAdminClient();
  if (!client) return unavailable;
  // The reviewed Billing RPC is additive; generated Database types are shared
  // with P1 and are deliberately not changed in this isolated acceptance patch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = client as any;
  try {
    const result=await readCompanyBillingDisplay(company.id);
    if(!result.ok)return unavailable;
    const evidence=result.data,subscription=evidence.journey.subscription;
    if(typeof evidence.billing_paid!=="boolean"||typeof evidence.operational_eligible!=="boolean")return unavailable;
    const row=subscription&&typeof subscription==="object"&&!Array.isArray(subscription)?subscription as Record<string,unknown>:null;
    const data={environment:evidence.environment,active:evidence.billing_paid===true&&evidence.operational_eligible===true,
      status:row?row.status:"none",paid_through:evidence.qualified_paid_through,plan_version_id:row?.plan_version_id??null};
    if(typeof data.status!=="string"||(data.paid_through!==null&&typeof data.paid_through!=="string")
      ||(data.plan_version_id!==null&&typeof data.plan_version_id!=="string"))return unavailable;

    const paidThrough: string | null = data.paid_through;
    const paidTimestamp = paidThrough === null ? null : new Date(paidThrough).getTime();
    if (paidTimestamp !== null && !Number.isFinite(paidTimestamp)) return unavailable;
    const future = paidTimestamp !== null && paidTimestamp > Date.now();
    const active = data.active === true && future && (data.status === "active" || data.status === "cancel_at_period_end");
    let tier: SubscriptionView["currentTier"] = null;
    let cycle: SubscriptionView["cycle"] = null;
    if (data.plan_version_id) {
      const { data: version } = await admin.from("billing_plan_versions").select("plan_id,period_unit,period_count")
        .eq("id", data.plan_version_id).maybeSingle();
      if (version) {
        cycle = version.period_unit === "year" && version.period_count === 1 ? "yearly"
          : version.period_unit === "month" && version.period_count === 1 ? "monthly" : null;
        const { data: plan } = await admin.from("billing_plans").select("code").eq("id", version.plan_id).maybeSingle();
        const code = String(plan?.code ?? "");
        tier = code.startsWith("noor_") ? "level_1" : code.startsWith("lina_") ? "level_2" : code.startsWith("dana_") ? "level_3" : null;
      }
    }
    const { data: openOrder, error: orderError } = await admin.from("billing_orders").select("id")
      .eq("company_id", company.id).eq("provider_environment", "live").in("status", ["locked", "submitted"])
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (orderError) return unavailable;
    // An open order or a future date alone never proves operational entitlement.
    return {
      state: data.status === "suspended" ? "suspended" : active ? "active"
        : paidTimestamp !== null && !future ? "expired" : openOrder ? "pending" : "empty",
      currentTier: tier, cycle, paidThrough,
      ...(openOrder ? { pendingOrderId: String(openOrder.id) } : {}),
    };
  } catch {
    return unavailable;
  }
}


