"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { billingOwnerGate, recheckBillingOwner } from "@/lib/billing/admin/owner-gate";
import { financialDb, readFinancialEvidence } from "@/lib/billing/financial-read";
import { qualifyFinancialOrder, type FinancialRecord } from "@/lib/billing/financial-truth";
import { logEvent } from "@/lib/logging/logger.mjs";
import type { FinancialAnalyticsData, MonthlyRevenuePoint, PlanTierMetric } from "./analytics-types";

export type AnalyticsResult =
  | { ok: true; data: FinancialAnalyticsData }
  | { ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" | "UNAVAILABLE"; message?: string };

export async function adminGetFinancialAnalytics(): Promise<AnalyticsResult> {
  // Use the existing native, session-bound billing owner gate; no new delegated access.
  const gate = await billingOwnerGate();
  if (!gate.ok) return { ok: false, code: gate.code === "unavailable" ? "UNAVAILABLE" : "FORBIDDEN" };
  try {
    const client = createAdminClient();
    if (!client) throw Error("ANALYTICS_CLIENT_UNAVAILABLE");
    const db = financialDb(client);
    const readAll = async (table: string): Promise<FinancialRecord[]> => {
      // Step 1: Capture the maximum ID boundary for this snapshot
      const boundary = await db.from(table).select("id").order("id", { ascending: false }).range(0, 0);
      if (boundary.error || !Array.isArray(boundary.data)) throw Error("ANALYTICS_READ_UNAVAILABLE");
      if (boundary.data.length === 0) return [];
      const firstRow = boundary.data[0];
      if (!firstRow || typeof firstRow !== "object" || Array.isArray(firstRow)) throw Error("ANALYTICS_READ_UNAVAILABLE");
      const capturedMaxId = String((firstRow as { id?: unknown }).id ?? "");
      if (!capturedMaxId) throw Error("ANALYTICS_READ_UNAVAILABLE");

      // Step 2: Keyset pagination bounded by capturedMaxId with inter-page consistency verification
      const rows: FinancialRecord[] = [];
      const seenIds = new Set<string>();
      let cursor: string | null = null;
      let pageIndex = 0;
      while (rows.length <= 10000) {
        let query = db.from(table).select("*");
        if (cursor !== null) {
          query = query.gt("id", cursor);
        }
        query = query.lte("id", capturedMaxId).order("id", { ascending: true }).range(0, 249);
        const { data, error } = await query;
        if (error || !Array.isArray(data)) throw Error("ANALYTICS_READ_UNAVAILABLE");
        if (data.length === 0) {
          if (cursor !== capturedMaxId) throw Error("ANALYTICS_SNAPSHOT_INCOMPLETE");
          break;
        }
        for (const row of data) {
          if (!row || typeof row !== "object" || Array.isArray(row)) throw Error("ANALYTICS_READ_UNAVAILABLE");
          const id = String((row as { id?: unknown }).id ?? "");
          if (!id) throw Error("ANALYTICS_READ_UNAVAILABLE");
          if (seenIds.has(id)) throw Error("ANALYTICS_DUPLICATE_ROW_DETECTED");
          seenIds.add(id);
          if (cursor !== null && id <= cursor) throw Error("ANALYTICS_KEYSET_REGRESSION");
          if (id > capturedMaxId) throw Error("ANALYTICS_SNAPSHOT_BREACH");
          cursor = id;
          rows.push(row as FinancialRecord);
        }
        if (rows.length > 10000) throw Error("ANALYTICS_READ_LIMIT");
        pageIndex++;
        if (cursor === capturedMaxId) break;
        if (data.length < 250) {
          throw Error("ANALYTICS_SNAPSHOT_INCOMPLETE");
        }
        // Inter-page consistency check: ensure no rows with id <= cursor were inserted concurrently
        if (cursor === null) throw Error("ANALYTICS_KEYSET_REGRESSION");
        const currentCursor: string = cursor;
        const pageCheck: { data: unknown; error: unknown } = await db.from(table).select("id").lte("id", currentCursor).order("id", { ascending: true }).range(rows.length - 1, rows.length);
        if (pageCheck.error || !Array.isArray(pageCheck.data) || pageCheck.data.length !== 1 || String((pageCheck.data[0] as { id?: unknown })?.id) !== cursor) {
          throw Error("ANALYTICS_SNAPSHOT_MUTATED");
        }
      }

      // Final snapshot consistency verification if multiple pages were read
      if (pageIndex > 1) {
        const finalCheck: { data: unknown; error: unknown } = await db.from(table).select("id").lte("id", capturedMaxId).order("id", { ascending: true }).range(rows.length - 1, rows.length);
        if (finalCheck.error || !Array.isArray(finalCheck.data) || finalCheck.data.length !== 1 || String((finalCheck.data[0] as { id?: unknown })?.id) !== capturedMaxId) {
          throw Error("ANALYTICS_SNAPSHOT_MUTATED");
        }
      }
      return rows;
    };
    const [orders, subscriptions, plans, versions] = await Promise.all([
      readAll("billing_orders"), readAll("billing_subscriptions"), readAll("billing_plans"), readAll("billing_plan_versions"),
    ]);
    // Failed or incomplete evidence reads throw; never turn unread settlements into zero.
    const evidence = await readFinancialEvidence(db, orders);
    const now = Date.now();
    const qualified = orders.map(order => ({ order, truth: qualifyFinancialOrder(String(order.company_id), order, evidence, now) }));
    let liveBaisa = 0, testBaisa = 0;
    const monthly = new Map<string, MonthlyRevenuePoint>();
    const provenLive = qualified.filter(({ truth }) => truth.collectionProven && truth.environment === "live");
    for (const { order, truth } of qualified) {
      if (!truth.collectionProven) continue;
      const amount = Number(order.amount_baisa);
      if (!Number.isSafeInteger(amount) || amount < 0 || !truth.collectedAt || Date.parse(truth.collectedAt) > now) throw Error("ANALYTICS_INVALID_COLLECTION");
      if (truth.environment === "test") { testBaisa += amount; continue; }
      if (truth.environment !== "live") throw Error("ANALYTICS_UNKNOWN_ENVIRONMENT");
      liveBaisa += amount;
      const receiptDate = new Date(Date.parse(truth.collectedAt) + 4 * 3600000);
      const key = receiptDate.toISOString().slice(0, 7);
      const point = monthly.get(key) ?? { monthKey: key,
        monthLabelAr: new Intl.DateTimeFormat("ar-OM", { month: "long", year: "numeric", timeZone: "Asia/Muscat" }).format(new Date(truth.collectedAt)),
        monthLabelEn: new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "Asia/Muscat" }).format(new Date(truth.collectedAt)),
        confirmedGrossBaisa: 0, ordersCount: 0 };
      point.confirmedGrossBaisa += amount; point.ordersCount++;
      monthly.set(key, point);
    }
    if (![liveBaisa, testBaisa].every(Number.isSafeInteger)) throw Error("ANALYTICS_TOTAL_OUT_OF_RANGE");
    // Paid active tenants require a current live server receipt, not company.status.
    const active = subscriptions.filter(sub => ["active", "cancel_at_period_end"].includes(String(sub.status))
      && typeof sub.paid_through === "string" && Date.parse(sub.paid_through) > now
      && provenLive.some(({ order, truth }) => order.company_id === sub.company_id && order.plan_version_id === sub.plan_version_id
        && truth.state === "proven" && truth.paidThrough === sub.paid_through));
    const distribution = new Map<string, PlanTierMetric>();
    for (const sub of active) {
      const version = versions.find(v => v.id === sub.plan_version_id);
      const plan = plans.find(p => p.id === version?.plan_id);
      if (!version || !plan || typeof plan.name !== "string" || version.currency !== "OMR") throw Error("ANALYTICS_PLAN_UNAVAILABLE");
      const amount = Number(version.amount_baisa), count = Number(version.period_count);
      if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(count) || count < 1) throw Error("ANALYTICS_PLAN_INVALID");
      const months = version.period_unit === "year" ? count * 12 : version.period_unit === "month" ? count : null;
      const price = months ? amount / months : null; // No invented 30-day conversion.
      const id = String(version.id);
      const row = distribution.get(id) ?? { planId: id, planNameAr: plan.name, planNameEn: plan.name,
        activeTenantsCount: 0, monthlyPriceBaisa: price, monthlyRevenueBaisa: price === null ? null : 0, sharePercent: 0 };
      row.activeTenantsCount++;
      if (price !== null && row.monthlyRevenueBaisa !== null) row.monthlyRevenueBaisa += price;
      distribution.set(id, row);
    }
    for (const row of distribution.values()) row.sharePercent = active.length ? row.activeTenantsCount / active.length * 100 : 0;
    const liveOrders = qualified.filter(({ truth }) => truth.environment === "live");
    const successRate = liveOrders.length && !liveOrders.some(({ truth }) => truth.state === "unknown")
      ? Math.round(liveOrders.filter(({ truth }) => truth.collectionProven).length / liveOrders.length * 100) : null;
    const gross = (liveBaisa / 1000).toFixed(3) + " OMR";
    const recheck = await recheckBillingOwner(gate.binding); if (!recheck.ok) return { ok: false, code: recheck.code === "unavailable" ? "UNAVAILABLE" : "FORBIDDEN" };
    return { ok: true, data: {
      kpis: { grossRealizedBaisa: liveBaisa, grossRealizedOmr: gross, testCollectedBaisa: testBaisa,
        activeSubscribedTenants: active.length, arpuOmr: active.length ? (liveBaisa / active.length / 1000).toFixed(3) + " OMR" : "—",
        paymentSuccessRatePercent: successRate, gatewayMode: "TEST_MODE_GUARDED" },
      planDistribution: [...distribution.values()], monthlyHistory: [...monthly.values()].sort((a,b) => b.monthKey.localeCompare(a.monthKey)),
      // No verified, comparable all-time AI cost ledger wired here; preserve UNKNOWN.
      aiMarginAnalysis: { realizedSubscriptionOmr: gross, realizedAiConsumptionOmr: "UNKNOWN", marginRatioPercent: null, status: "UNKNOWN" },
    } };
  } catch (error) {
    logEvent("error", "admin.analytics.read_failed", { stage: "analytics_read", error_code: "ADMIN_ANALYTICS_READ_UNAVAILABLE", error_type: error instanceof Error ? error.name : "Unknown" });
    return { ok: false, code: "UNAVAILABLE", message: "ADMIN_ANALYTICS_READ_UNAVAILABLE" };
  }
}
