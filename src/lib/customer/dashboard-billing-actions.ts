"use server";

import { getCompanyAccess } from "@/lib/tenancy/access";
import { readSubscriptionJourneyAction, readSubscriptionUsageAction } from "@/lib/billing/operations/actions";
import { dashboardBillingSnapshot, type DashboardBillingLoad } from "./dashboard-billing-model";

/** Session-authorized reads only; no checkout, provider call, or activation. */
export async function readDashboardBilling(): Promise<DashboardBillingLoad> {
  try {
    const access = await getCompanyAccess("owner");
    if (!access.ok) return { status: access.code === "UNAVAILABLE" ? "unavailable" : "forbidden" };
    if (!access.context.company || access.context.membership?.role !== "owner") return { status: "forbidden" };
    // Parallel work belongs inside one server action: client actions dispatch sequentially.
    const [journey, usage] = await Promise.all([
      readSubscriptionJourneyAction(), readSubscriptionUsageAction(),
    ]);
    if (journey.status !== "ready") return { status: journey.status };
    if (!usage.ok && journey.data?.subscription !== null) {
      return { status: usage.code === "forbidden" ? "forbidden" : "unavailable" };
    }
    return dashboardBillingSnapshot(access.context.company.id, journey.data, usage.ok ? usage.data : null);
  } catch {
    return { status: "unavailable" };
  }
}
