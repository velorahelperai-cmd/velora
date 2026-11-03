"use client";

import Link from "next/link";
import { useDemo } from "@/lib/demo-state";
import { adminCompanyHref } from "@/components/app/admin-company-navigation";
import type { AdminBillingPage } from "@/lib/billing/admin/model";
import { formatOmrBaisa } from "@/components/app/subscription-offers-view";
import {
  IconAlert,
  IconCreditCard,
  IconFileText,
  IconLayers,
  IconPulse,
} from "./admin-icons";

const LABELS = {
  en: {
    badge: "Module 06 · Billing & Financial Operations",
    title: "Billing & Financial Ledger",
    subtitle:
      "Platform subscription orders and qualified payment records.",
    ownerBadge: "Platform Owner",
    kpiTotalOrders: "Total Stored Orders",
    kpiRevenue: "Confirmed Collections (Gross)",
    kpiAttention: "Pending / Attention",
    kpiGateway: "Payment Gateway",
    kpiGatewayStatus: "Thawani UAT",
    kpiGatewayNote: "Live payments strictly guarded",
    filterCompany: "Company ID",
    filterEnvironment: "Environment",
    filterFrom: "From Date",
    filterUntil: "Through Date",
    btnFilter: "Apply Filters",
    btnRefresh: "Refresh Snapshot",
    btnReset: "Reset Filters",
    all: "All Environments",
    test: "Test Environment",
    live: "Live Environment",
    unknown: "Unknown Environment",
    colCompany: "Company & Account",
    colOrderId: "Order ID",
    colAmount: "Locked Amount",
    colEnvironment: "Environment",
    colPayment: "Payment Status",
    colDate: "Created Date",
    colActions: "Action",
    open: "Open Order",
    next: "Next Page",
    empty: "No orders match these filters.",
    unavailable: "Billing records could not be loaded. Refresh to retry.",
    forbidden: "Billing records are restricted to the platform owner.",
    invalid: "The filter or page link is invalid. Start a new search.",
    basisNote: "Dates filter order creation in UTC. Refreshing begins a fresh transactional snapshot.",
  },
  ar: {
    badge: "Module 06 · Billing & Financial Operations",
    title: "سجل الفواتير والاشتراكات المالية",
    subtitle:
      "متابعة طلبات اشتراكات المنصة وسجل المدفوعات المؤهلة.",
    ownerBadge: "مالك المنصة",
    kpiTotalOrders: "إجمالي الطلبات المسجلة",
    kpiRevenue: "إجمالي التحصيل المؤكد (OMR)",
    kpiAttention: "طلبات معلقة / للمراجعة",
    kpiGateway: "بوابة الدفع الإلكتروني",
    kpiGatewayStatus: "ثواني UAT",
    kpiGatewayNote: "المدفوعات الحية مغلقة احترازيًا",
    filterCompany: "معرّف الشركة (UUID)",
    filterEnvironment: "بيئة التنفيذ",
    filterFrom: "من تاريخ",
    filterUntil: "حتى تاريخ",
    btnFilter: "تطبيق التصفية",
    btnRefresh: "تحديث",
    btnReset: "بحث جديد",
    all: "كل البيئات",
    test: "بيئة الاختبار",
    live: "بيئة الإنتاج الفعلي",
    unknown: "غير معروف",
    colCompany: "الشركة والمنشأة",
    colOrderId: "معرف الطلب",
    colAmount: "المبلغ المحفوظ",
    colEnvironment: "البيئة",
    colPayment: "حالة الدفع",
    colDate: "تاريخ الطلب",
    colActions: "الإجراء",
    open: "فتح الطلب",
    next: "الصفحة التالية",
    empty: "لا توجد طلبات مطابقة.",
    unavailable: "تعذر تحميل السجلات. حدّث للمحاولة.",
    forbidden: "سجلات الدفع متاحة لمالك المنصة فقط.",
    invalid: "رابط الصفحة أو التصفية غير صالح.",
    basisNote: "التواريخ حسب إنشاء الطلب UTC. التحديث يبدأ تصفحًا جديدًا في قاعدة البيانات.",
  },
} as const;

export const financialLabels: Record<
  "en" | "ar",
  Record<string, { label: string; tone: "success" | "warn" | "error" | "neutral" | "purple" }>
> = {
  en: {
    proven: { label: "Confirmed", tone: "success" },
    pending: { label: "Pending", tone: "warn" },
    failed: { label: "Failed", tone: "error" },
    reversed: { label: "Reversed", tone: "neutral" },
    requires_review: { label: "Requires Review", tone: "purple" },
    unknown: { label: "Unknown", tone: "neutral" },
  },
  ar: {
    proven: { label: "مؤكد", tone: "success" },
    pending: { label: "معلق", tone: "warn" },
    failed: { label: "فشل", tone: "error" },
    reversed: { label: "معكوس", tone: "neutral" },
    requires_review: { label: "يحتاج مراجعة", tone: "purple" },
    unknown: { label: "غير معروف", tone: "neutral" },
  },
};

export interface AdminBillingLedgerProps {
  result: AdminBillingPage;
  query: Record<string, string>;
}

export function AdminBillingLedger({ result, query }: AdminBillingLedgerProps) {
  const { locale } = useDemo();
  const ar = locale === "ar";
  const c = LABELS[ar ? "ar" : "en"];

  const params = new URLSearchParams(query);
  params.delete("cursor");
  const refreshHref = "/admin/billing?" + params.toString();
  const currentHref = "/admin/billing?" + new URLSearchParams(query).toString();
  const isReady = result.status === "ready" || result.status === "empty";

  // Totals are scoped to the loaded page and separated by recorded environment.
  const pageAmount = (environment: "live" | "test" | null) => {
    if (!isReady) return null;
    const rows = result.rows.filter(row => row.financial.state === "proven" && row.environment === environment);
    if (rows.some(row => row.amountBaisa === null || row.currency !== "OMR")) return null;
    const total = rows.reduce((sum, row) => sum + (row.amountBaisa ?? 0), 0);
    return Number.isSafeInteger(total) ? (total / 1000).toFixed(3) : null;
  };
  const attentionCount = isReady ? result.rows.filter(row => row.financial.state !== "proven").length : null;

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* Module Header with Owner Shield */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            {c.title}
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">{c.subtitle}</p>
        </div>

        {/* Platform Owner Verification Badge & Quick Refresh */}
        <div className="flex flex-wrap items-center gap-3">

          <Link
            href={refreshHref}
            className="flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 text-sm font-semibold text-[var(--service-ink)] shadow-sm hover:bg-[var(--service-subtle)] transition"
          >
            <IconPulse className="h-3.5 w-3.5 text-[var(--service-accent)]" />
            <span>{c.btnRefresh}</span>
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <section className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(15,23,42,0.09)] hover:border-[var(--service-accent)]/30">
          <div className="flex items-start justify-between gap-3"><h2 className="text-sm font-semibold leading-[22px] text-[var(--service-muted)]">{ar ? "الطلبات المطابقة" : "Matching orders"}</h2><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#f1faf7] text-[#11665f]"><IconFileText aria-hidden="true" className="h-[19px] w-[19px]" /></span></div>
          <p className="mt-3 text-[28px] leading-9 font-bold text-[var(--service-ink)]">{isReady ? result.total : "—"}</p>
          <p className="mt-2 text-sm text-[var(--service-muted)]">{ar ? "عدد الطلبات المطابقة للتصفية" : "Orders matching the filters"}</p>
        </section>
        <section className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(15,23,42,0.09)] hover:border-[var(--service-accent)]/30">
          <div className="flex items-start justify-between gap-3"><h2 className="text-sm font-semibold leading-[22px] text-[var(--service-muted)]">{ar ? "المبالغ المؤكدة في الصفحة الحالية" : "Confirmed amounts on this page"}</h2><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#f1faf7] text-[#11665f]"><IconCreditCard aria-hidden="true" className="h-[19px] w-[19px]" /></span></div>
          <dl className="mt-2 grid gap-1 text-sm text-[var(--service-ink)]">
            {(["live", "test", null] as const).map(environment => {
              const value = pageAmount(environment);
              const name = environment === "live" ? (ar ? "الإنتاج" : "Live") : environment === "test" ? (ar ? "الاختبار" : "Test") : (ar ? "بيئة غير معروفة" : "Unknown environment");
              return <div key={environment ?? "unknown"} className="flex flex-wrap justify-between gap-2"><dt>{name}</dt><dd dir="ltr">{value === null ? (ar ? "غير متاح" : "Unavailable") : `${value} OMR`}</dd></div>;
            })}
          </dl>
          <p className="mt-2 text-sm text-[var(--service-muted)]">{ar ? "قبل الرسوم والاستردادات؛ لا يشمل الصفحات الأخرى." : "Before fees and refunds; excludes other pages."}</p>
        </section>
        <section className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(15,23,42,0.09)] hover:border-[var(--service-accent)]/30">
          <div className="flex items-start justify-between gap-3"><h2 className="text-sm font-semibold leading-[22px] text-[var(--service-muted)]">{ar ? "حالات غير مؤكدة في الصفحة" : "Non-confirmed records on this page"}</h2><span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#f1faf7] text-[#11665f]"><IconAlert aria-hidden="true" className="h-[19px] w-[19px]" /></span></div>
          <p className="mt-3 text-[28px] leading-9 font-bold text-[var(--service-ink)]">{attentionCount ?? "—"}</p>
          <p className="mt-2 text-sm text-[var(--service-muted)]">{ar ? "تشمل المعلقة والفاشلة والمعكوسة وغير المعروفة والمراجعة." : "Includes pending, failed, reversed, unknown and review states."}</p>
        </section>
      </div>

      {/* Filter and Search Bar */}
      <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
        <form key={currentHref} method="get" action="/admin/billing" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="billing-filter-1" className="block text-sm font-bold text-[var(--service-ink)]">
                {c.filterCompany}
              </label>
              <input id="billing-filter-1"
                type="text"
                name="companyId"
                defaultValue={query.companyId ?? ""}
                dir="ltr"
                placeholder="UUID..."
                className="mt-1.5 min-h-11 w-full rounded-lg border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 text-sm text-[var(--service-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--service-accent)]"
              />
            </div>

            <div>
              <label htmlFor="billing-filter-2" className="block text-sm font-bold text-[var(--service-ink)]">
                {c.filterEnvironment}
              </label>
              <select id="billing-filter-2"
                name="environment"
                defaultValue={query.environment ?? "all"}
                className="mt-1.5 min-h-11 w-full rounded-lg border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 text-sm text-[var(--service-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--service-accent)]"
              >
                {(["all", "live", "test", "unknown"] as const).map((env) => (
                  <option key={env} value={env}>
                    {c[env]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="billing-filter-3" className="block text-sm font-bold text-[var(--service-ink)]">{c.filterFrom}</label>
              <input id="billing-filter-3"
                type="date"
                name="from"
                defaultValue={query.from ?? ""}
                className="mt-1.5 min-h-11 w-full rounded-lg border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 text-sm text-[var(--service-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--service-accent)]"
              />
            </div>

            <div>
              <label htmlFor="billing-filter-4" className="block text-sm font-bold text-[var(--service-ink)]">
                {c.filterUntil}
              </label>
              <input id="billing-filter-4"
                type="date"
                name="until"
                defaultValue={query.until ?? ""}
                className="mt-1.5 min-h-11 w-full rounded-lg border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 text-sm text-[var(--service-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--service-accent)]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--service-line)] pt-3">
            <span className="text-[13px] text-[var(--service-muted)]">{c.basisNote}</span>
            <div className="flex items-center gap-2">
              <Link
                href="/admin/billing"
                className="inline-flex min-h-11 items-center rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-4 py-2 text-sm font-bold text-[var(--service-ink)] hover:bg-[var(--service-subtle)] transition"
              >
                {c.btnReset}
              </Link>
              <button
                type="submit"
                className="min-h-11 rounded-xl bg-[var(--service-accent)] px-5 py-2 text-sm font-bold text-white shadow-sm hover:opacity-95 transition"
              >
                {c.btnFilter}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Access Denied or Error Notice */}
      {!isReady && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm font-bold text-red-800 shadow-sm"
        >
          {result.status === "forbidden"
            ? c.forbidden
            : result.status === "invalid_input"
            ? c.invalid
            : c.unavailable}
        </div>
      )}

      {/* Orders Ledger Table */}
      {isReady && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[var(--service-ink)]">
              {ar ? "سجل طلبات الاشتراك (Transactions Ledger)" : "Subscription Transactions Ledger"}
            </h2>
            <span className="text-sm text-[var(--service-muted)]">
              {ar
                ? `إجمالي الطلبات المطابقة: ${result.total}`
                : `Total Matching Orders: ${result.total}`}
            </span>
          </div>

          {result.status === "empty" ? (
            <div
              role="status"
              className="rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] p-12 text-center text-sm text-[var(--service-muted)] shadow-sm"
            >
              <IconLayers className="mx-auto h-8 w-8 opacity-40" />
              <p className="mt-3 font-semibold">{c.empty}</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] shadow-sm" role="region" aria-label={ar ? "جدول الطلبات" : "Orders table"} tabIndex={0}>
              <table className="w-full min-w-[60rem] text-start text-sm">
                <thead className="border-b border-[var(--service-line)] bg-[var(--service-canvas)] text-[13px] font-bold text-[var(--service-muted)]">
                  <tr>
                    <th scope="col" className="p-3.5">{c.colCompany}</th>
                    <th scope="col" className="p-3.5">{c.colOrderId}</th>
                    <th scope="col" className="p-3.5">{c.colAmount}</th>
                    <th scope="col" className="p-3.5">{c.colEnvironment}</th>
                    <th scope="col" className="p-3.5">{c.colPayment}</th>
                    <th scope="col" className="p-3.5">{c.colDate}</th>
                    <th scope="col" className="p-3.5 text-center">{c.colActions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--service-line)] text-[var(--service-ink)]">
                  {result.rows.map((row) => {
                    const statusMeta =
                      financialLabels[ar ? "ar" : "en"][row.financial.state] ?? {
                        label: row.financial.state,
                        tone: "neutral" as const,
                      };

                    return (
                      <tr key={row.id} className="hover:bg-[var(--service-subtle)] transition">
                        <td className="p-3.5">
                          <Link
                            href={adminCompanyHref(row.companyId, currentHref)}
                            className="font-bold text-[var(--service-accent)] hover:underline"
                          >
                            <bdi>{row.companyName || row.companyId}</bdi>
                          </Link>
                          <div className="mt-0.5 font-mono text-[13px] text-[var(--service-muted)]">
                            {row.companyId}
                          </div>
                        </td>

                        <td dir="ltr" className="p-3.5 font-mono font-bold text-[var(--service-ink)]">
                          {row.id}
                        </td>

                        <td className="p-3.5 font-bold font-mono">
                          {row.amountBaisa !== null && row.currency === "OMR"
                            ? formatOmrBaisa(row.amountBaisa, locale)
                            : "—"}
                        </td>

                        <td className="p-3.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[13px] font-bold ${
                              row.environment === "live"
                                ? "bg-emerald-100 text-emerald-800"
                                : row.environment === "test"
                                ? "bg-blue-100 text-blue-800"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {row.environment ? c[row.environment] : c.unknown}
                          </span>
                        </td>

                        <td className="p-3.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[13px] font-bold ${
                              statusMeta.tone === "success"
                                ? "bg-emerald-100 text-emerald-800"
                                : statusMeta.tone === "warn"
                                ? "bg-amber-100 text-amber-800"
                                : statusMeta.tone === "error"
                                ? "bg-red-100 text-red-800"
                                : statusMeta.tone === "purple"
                                ? "bg-purple-100 text-purple-800"
                                : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {statusMeta.label}
                          </span>
                        </td>

                        <td className="p-3.5 font-mono text-[13px] text-[var(--service-muted)]">
                          <time dateTime={row.createdAt}>
                            {new Intl.DateTimeFormat(locale, {
                              dateStyle: "medium",
                              timeZone: "UTC",
                            }).format(new Date(row.createdAt))}
                          </time>
                        </td>

                        <td className="p-3.5 text-center">
                          <Link
                            href={`/admin/billing/orders/${row.id}?companyId=${row.companyId}&returnTo=${encodeURIComponent(
                              currentHref
                            )}`}
                            className="inline-flex min-h-11 items-center rounded-lg border border-[var(--service-line)] bg-[var(--service-surface)] px-2.5 py-1 text-sm font-semibold text-[var(--service-accent)] shadow-sm hover:bg-[var(--service-accent-soft)] transition"
                          >
                            {c.open}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Next Link */}
          {result.hasMore && result.nextCursor && (
            <div className="flex justify-center pt-2">
              <Link
                href={
                  "/admin/billing?" +
                  new URLSearchParams({ ...query, cursor: result.nextCursor }).toString()
                }
                className="flex min-h-11 items-center gap-2 rounded-xl bg-[var(--service-accent)] px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-95 transition"
              >
                <span>{c.next}</span>
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
