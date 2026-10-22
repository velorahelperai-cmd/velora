"use client";

import { useDemo } from "@/lib/demo-state";
import type { FinancialAnalyticsData } from "@/lib/tenancy/analytics-types";
import {
  IconBuilding,
  IconCheckCircle,
  IconCreditCard,
  IconPulse,
  IconShield,
  IconSparkles,
  IconTrending,
} from "./admin-icons";

export interface AdminFinancialAnalyticsProps {
  data: FinancialAnalyticsData;
}

export function AdminFinancialAnalytics({ data }: AdminFinancialAnalyticsProps) {
  const { locale } = useDemo();
  const ar = locale === "ar";

  const { kpis, planDistribution, monthlyHistory, aiMarginAnalysis } = data;

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--service-accent)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--service-accent)]">
              Module 12 · Advanced Analytics & Reporting
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            {ar ? "التحليلات المتقدمة والتقارير المالية (Financial Analytics)" : "Financial Analytics & Platform Metrics"}
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar
              ? "مؤشرات الإيرادات المحققة، متوسط الإيراد لكل مشترك (ARPU)، كفاءة استهلاك الذكاء الاصطناعي، وسجل التحصيل الشهري."
              : "Realized subscription revenue, ARPU, AI operating margins, plan distribution, and monthly collection cadence."}
          </p>
        </div>

        {/* Finance Access Badge */}
        <div className="flex items-center gap-2 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 shadow-sm">
          <IconShield className="h-4 w-4 text-[var(--service-success)]" />
          <span className="text-xs font-bold text-[var(--service-ink)]">Finance & Owner Only</span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
            {ar ? "وصول مالي محمي" : "Secured"}
          </span>
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Gross Realized Revenue */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "التحصيلات الحقيقية المؤكدة (Live)" : "Confirmed Live Collections"}
            </span>
            <IconCreditCard className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {kpis.grossRealizedOmr}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? `تحصيل إجمالي قبل الرسوم؛ Test منفصل: ${((kpis.testCollectedBaisa ?? 0) / 1000).toFixed(3)} OMR` : `Gross before fees; separate Test collections: ${((kpis.testCollectedBaisa ?? 0) / 1000).toFixed(3)} OMR`}
          </div>
        </div>

        {/* KPI 2: Active Subscribed Tenants */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "الشركات المشتركة النشطة" : "Active Paid Tenants"}
            </span>
            <IconBuilding className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {kpis.activeSubscribedTenants}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {ar ? "منشأة نشطة" : "companies"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "اشتراكات سارية ومؤهلة تشغيلياً" : "Actively subscribed workspaces"}
          </div>
        </div>

        {/* KPI 3: ARPU */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "متوسط الإيراد لكل مشترك (ARPU)" : "Average Revenue (ARPU)"}
            </span>
            <IconTrending className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {kpis.arpuOmr}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "معدل القيمة المحققة لكل منشأة" : "Average gross per account"}
          </div>
        </div>

        {/* KPI 4: Payment Success Rate */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "معدل نجاح عمليات الدفع" : "Payment Success Rate"}
            </span>
            <IconPulse className="h-4 w-4 text-[var(--service-success)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {kpis.paymentSuccessRatePercent === null ? "—" : `${kpis.paymentSuccessRatePercent}%`}
            </span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              {kpis.paymentSuccessRatePercent === null ? (ar ? "غير متحقق" : "Unverified") : "Live"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "بوابة Paymob (وضع الاختبار التجريبي معزول)" : "Paymob Test Isolation Active"}
          </div>
        </div>
      </div>

      {/* Direct AI Token Cost Coverage Ratio Section */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconSparkles className="h-5 w-5 text-[var(--service-accent)]" />
            <div>
              <h2 className="text-sm font-bold text-[var(--service-ink)]">
                {ar ? "مؤشر تغطية تكلفة الذكاء الاصطناعي المباشرة (Direct AI Token Coverage)" : "Direct AI Token Cost Coverage Ratio"}
              </h2>
              <p className="text-[11px] text-[var(--service-muted)]">
                {ar
                  ? "يقيس نسبة تكلفة التوكنات المباشرة لنماذج الذكاء مقابل الإيرادات المحققة (لا يمثل هامش ربح تشغيلي صافي للمنصة)."
                  : "Direct token costs relative to collections. Excludes gateway processing fees, cloud hosting, and operational overhead."}
              </p>
            </div>
          </div>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-bold border ${
              aiMarginAnalysis.status === "HEALTHY"
                ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                : "bg-amber-100 text-amber-800 border-amber-200"
            }`}
          >
            {aiMarginAnalysis.status === "HEALTHY"
              ? ar ? "تغطية ممتازة (Healthy Coverage)" : "Healthy Coverage"
              : aiMarginAnalysis.status === "UNKNOWN" ? (ar ? "غير متحقق (Unverified)" : "Unverified") : ar ? "يحتاج متابعة (Attention)" : "Attention"}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pt-2">
          <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-3">
            <div className="text-[var(--service-muted)] mb-1 font-semibold">{ar ? "إيراد الاشتراكات المحقق:" : "Subscription Collections:"}</div>
            <div className="text-lg font-black text-[var(--service-ink)]">{aiMarginAnalysis.realizedSubscriptionOmr}</div>
          </div>
          <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-3">
            <div className="text-[var(--service-muted)] mb-1 font-semibold">{ar ? "تكلفة استهلاك التوكنات الفعلية:" : "Direct AI Tokens Cost:"}</div>
            <div className="text-lg font-black text-[var(--service-accent)]">{aiMarginAnalysis.realizedAiConsumptionOmr}</div>
          </div>
          <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-3">
            <div className="text-[var(--service-muted)] mb-1 font-semibold">{ar ? "نسبة التغطية المباشرة:" : "Direct Coverage Ratio:"}</div>
            <div className="text-lg font-black text-emerald-700">{aiMarginAnalysis.marginRatioPercent === null ? "—" : `${aiMarginAnalysis.marginRatioPercent}%`}</div>
          </div>
        </div>
      </div>

      {/* Grid: Plan Distribution + Monthly History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plan Distribution */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-[var(--service-ink)]">
            {ar ? "توزيع المشتركين حسب الباقات (Plan Distribution)" : "Plan Subscription Breakdown"}
          </h2>
          <div className="divide-y divide-[var(--service-line)] text-xs">
            {planDistribution.map((plan) => (
              <div key={plan.planId} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="font-bold text-[var(--service-ink)]">
                    {ar ? plan.planNameAr : plan.planNameEn}
                  </div>
                  <div className="text-[11px] text-[var(--service-muted)]">
                    {plan.monthlyPriceBaisa === null ? "—" : (plan.monthlyPriceBaisa / 1000).toFixed(3)} OMR / {ar ? "شهر" : "mo"}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-[var(--service-ink)]">
                    {plan.activeTenantsCount} {ar ? "مشترك" : "subscribers"}
                  </div>
                  <div className="text-[11px] font-mono text-[var(--service-muted)]">
                    {plan.monthlyRevenueBaisa === null ? "—" : (plan.monthlyRevenueBaisa / 1000).toFixed(3)} OMR
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly History */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-4">
          <h2 className="text-base font-bold text-[var(--service-ink)]">
            {ar ? "سجل التحصيل الشهري (Monthly Collections)" : "Monthly Collection Trend"}
          </h2>

          <div className="divide-y divide-[var(--service-line)] text-xs">
            {monthlyHistory.map((item) => (
              <div key={item.monthKey} className="py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <IconCheckCircle className="h-4 w-4 text-emerald-600" />
                  <span className="font-bold text-[var(--service-ink)]">
                    {ar ? item.monthLabelAr : item.monthLabelEn}
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-[var(--service-ink)]">
                    {(item.confirmedGrossBaisa / 1000).toFixed(3)} OMR
                  </div>
                  <div className="text-[11px] text-[var(--service-muted)]">
                    {item.ordersCount} {ar ? "عمليات دفع" : "transactions"}
                  </div>
                </div>
              </div>
            ))}

            {monthlyHistory.length === 0 && (
              <div className="py-6 text-center text-xs text-[var(--service-muted)]">
                {ar ? "لا توجد حركات تحصيل شهرية مسجلة بعد." : "No monthly collections recorded yet."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
