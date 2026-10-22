"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useDemo } from "@/lib/demo-state";
import type { AdminSupportOverviewData, AdminAccountSearchItem } from "@/lib/tenancy/support-types";
import { adminLookupCustomerByCodeOrEmail } from "@/lib/tenancy/support-actions";
import {
  IconAlert,
  IconBuilding,
  IconCheckCircle,
  IconClock,
  IconSearch,
  IconShield,
  IconSparkles,
} from "./admin-icons";

export interface AdminSupportReviewsProps {
  data: AdminSupportOverviewData;
}

export function AdminSupportReviews({ data }: AdminSupportReviewsProps) {
  const { locale } = useDemo();
  const ar = locale === "ar";

  // Account search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AdminAccountSearchItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleAccountSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults(null);
      setSearchError(null);
      return;
    }
    setSearchError(null);
    startTransition(async () => {
      const res = await adminLookupCustomerByCodeOrEmail(q);
      if (res.ok) {
        setSearchResults(res.rows);
      } else {
        setSearchError(res.message ?? "Search failed");
      }
    });
  };

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--service-accent)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--service-accent)]">
              Module 09 · Customer Support & Reviews Center
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            {ar ? "تذاكر الدعم ومراجعات المنشآت (Support & Reviews)" : "Customer Support & Reviews"}
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar
              ? "متابعة طلبات المراجعة للشركات الجديدة، فحص كود الدعم (Support Code)، وتنسيق قنوات الخدمة المعتمدة."
              : "Review onboarding setup requests, look up customer accounts by Support Code, and coordinate official SLA channels."}
          </p>
        </div>

        {/* Owner Verification Badge */}
        <div className="flex items-center gap-2 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 shadow-sm">
          <IconShield className="h-4 w-4 text-[var(--service-success)]" />
          <span className="text-xs font-bold text-[var(--service-ink)]">velorahelperai@gmail.com</span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
            {ar ? "مالك المنصة" : "Platform Owner"}
          </span>
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Pending Reviews */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "طلبات المراجعة المعلقة" : "Pending Reviews"}
            </span>
            <IconAlert
              className={`h-4 w-4 ${
                data.kpis.pendingReviewsCount > 0 ? "text-amber-600" : "text-[var(--service-success)]"
              }`}
            />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className={`text-2xl font-black ${
                data.kpis.pendingReviewsCount > 0 ? "text-amber-700" : "text-[var(--service-success)]"
              }`}
            >
              {data.kpis.pendingReviewsCount}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {ar ? "طلب بانتظار الاعتماد" : "awaiting approval"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {data.kpis.pendingReviewsCount === 0
              ? ar
                ? "كافة طلبات التهيئة تمت مراجعتها"
                : "All onboarding requests reviewed"
              : ar
              ? "تتطلب فحص رقم واتساب وإعدادات المساعد"
              : "Requires WhatsApp & Assistant audit"}
          </div>
        </div>

        {/* KPI 2: Review SLA Target */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "اتفاقية مستوى الخدمة المستهدفة" : "Target Review SLA"}
            </span>
            <IconClock className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {`< ${data.kpis.supportSlaHours}h`}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {ar ? "ساعات كحد أقصى" : "hours max"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "اعتماد التهيئة للشركات المؤهلة" : "Qualified setup approval turnaround"}
          </div>
        </div>

        {/* KPI 3: Security & Review Gate */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "بوابة مراجعة الهوية والتهيئة" : "Review Security Gate"}
            </span>
            <IconCheckCircle className="h-4 w-4 text-[var(--service-success)]" />
          </div>
          <div className="mt-3">
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
              {ar ? "نشطة وآمنة (FAIL-CLOSED)" : "FAIL-CLOSED (ACTIVE)"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "حماية صارمة لعزل البيانات والفروع" : "Strict tenant & branch isolation active"}
          </div>
        </div>

        {/* KPI 4: Official Support Channels */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "قنوات التواصل المعتمدة" : "Official Support"}
            </span>
            <IconSparkles className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3">
            <span className="text-sm font-bold text-[var(--service-ink)]">
              {data.kpis.officialSupportChannel}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "دعم مباشر للمشتركين بـ كود الدعم" : "Direct escalation via customer support code"}
          </div>
        </div>
      </div>

      {/* Customer Account & Support Code Quick Lookup */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--service-ink)]">
              {ar ? "البحث السريع عن حسابات العملاء بكود الدعم (Support Code Lookup)" : "Customer Support Code Lookup"}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--service-muted)]">
              {ar
                ? "ابحث بكود الدعم الفريد (مثل VEL-XXXX-XXXX-XXXX) أو البريد الإلكتروني أو الهاتف لمطابقة الحساب وتأكيد هوية العميل."
                : "Search by unique Support Code (e.g. VEL-XXXX-XXXX-XXXX), email, or phone to authenticate customer identity."}
            </p>
          </div>
        </div>

        <form onSubmit={handleAccountSearch} className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[240px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={ar ? "أدخل كود الدعم (VEL-...) أو البريد أو الهاتف..." : "Enter Support Code (VEL-...), email, or phone..."}
              className="w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3.5 py-2 text-xs outline-none focus:border-[var(--service-accent)]"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-xl bg-[var(--service-accent)] px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50 transition flex items-center gap-1.5"
          >
            <IconSearch className="h-3.5 w-3.5" />
            <span>{isPending ? (ar ? "جاري البحث..." : "Searching...") : ar ? "بحث عن الحساب" : "Lookup Account"}</span>
          </button>
        </form>

        {searchError && (
          <div className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700 border border-red-200">
            {searchError}
          </div>
        )}

        {/* Search Results Table */}
        {searchResults !== null && (
          <div className="overflow-x-auto rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] mt-3">
            <table className="w-full text-right text-xs">
              <thead className="border-b border-[var(--service-line)] text-[11px] font-bold text-[var(--service-muted)]">
                <tr>
                  <th className="p-3">{ar ? "كود الدعم (Support Code)" : "Support Code"}</th>
                  <th className="p-3">{ar ? "اسم العميل" : "Customer Name"}</th>
                  <th className="p-3">{ar ? "البريد الإلكتروني" : "Email"}</th>
                  <th className="p-3">{ar ? "رقم الهاتف" : "Phone"}</th>
                  <th className="p-3">{ar ? "المنشآت المرتبطة" : "Companies"}</th>
                  <th className="p-3">{ar ? "الإجراء" : "Action"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--service-line)] text-[var(--service-ink)]">
                {searchResults.map((acc) => {
                  const primaryCompany = acc.companies[0];

                  return (
                    <tr key={acc.user_id} className="hover:bg-[var(--service-subtle)] transition">
                      <td className="p-3 font-mono font-bold text-[var(--service-accent)]">
                        {acc.support_code || "—"}
                      </td>
                      <td className="p-3 font-medium">{acc.full_name || "—"}</td>
                      <td className="p-3 font-mono text-[11px]">{acc.email || "—"}</td>
                      <td className="p-3 font-mono text-[11px]" dir="ltr">
                        {acc.account_phone || "—"}
                      </td>
                      <td className="p-3">
                        <span className="rounded-md bg-stone-100 px-2 py-0.5 text-[11px] font-bold text-stone-700">
                          {acc.companies.length} {ar ? "منشأة" : "companies"}
                        </span>
                      </td>
                      <td className="p-3">
                        {primaryCompany ? (
                          <Link
                            href={`/admin/companies/${encodeURIComponent(primaryCompany.company_id)}?returnTo=/admin/support`}
                            className="rounded-lg bg-[var(--service-accent-soft)] px-2.5 py-1 text-[11px] font-bold text-[var(--service-accent)] hover:bg-[var(--service-line)] transition inline-flex items-center gap-1"
                          >
                            <span>{ar ? "عرض المنشأة" : "Manage"}</span>
                            <span>←</span>
                          </Link>
                        ) : (
                          <span className="text-[11px] text-[var(--service-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {searchResults.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-xs text-[var(--service-muted)]">
                      {ar ? "لم يتم العثور على أي حساب يطابق بيانات البحث." : "No accounts match the lookup query."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pending Onboarding Reviews Queue */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--service-ink)]">
              {ar ? "طابور مراجعات تهيئة المنشآت الجديدة (Pending Onboarding Reviews)" : "Pending Onboarding Reviews"}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--service-muted)]">
              {ar
                ? "المنشآت التي أكملت بيانات الربط وقدمت طلب اعتماد المساعد وتنتظر موافقة الإدارة."
                : "Businesses that submitted onboarding details and are awaiting administrative verification."}
            </p>
          </div>

          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800 border border-amber-200">
            {data.pendingReviews.length} {ar ? "طلبات قيد الانتظار" : "in queue"}
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)]">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-[var(--service-line)] text-[11px] font-bold text-[var(--service-muted)]">
              <tr>
                <th className="p-3.5">{ar ? "المنشأة" : "Company"}</th>
                <th className="p-3.5">{ar ? "نوع النشاط" : "Business Type"}</th>
                <th className="p-3.5">{ar ? "بريد المالك" : "Owner Email"}</th>
                <th className="p-3.5">{ar ? "رقم الهاتف المعتمد" : "Contact Phone"}</th>
                <th className="p-3.5">{ar ? "المدينة / الدولة" : "Location"}</th>
                <th className="p-3.5">{ar ? "تاريخ التقديم" : "Submitted At"}</th>
                <th className="p-3.5">{ar ? "الإجراء" : "Action"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--service-line)] text-[var(--service-ink)]">
              {data.pendingReviews.map((row) => (
                <tr key={row.id} className="hover:bg-[var(--service-subtle)] transition">
                  <td className="p-3.5 font-bold text-[var(--service-ink)]">
                    <div className="flex items-center gap-2">
                      <IconBuilding className="h-3.5 w-3.5 text-[var(--service-accent)]" />
                      <span>{row.display_name}</span>
                    </div>
                  </td>
                  <td className="p-3.5 text-[var(--service-muted)]">{row.business_type || "—"}</td>
                  <td className="p-3.5 font-mono text-[11px]">{row.owner_email || "—"}</td>
                  <td className="p-3.5 font-mono text-[11px]" dir="ltr">
                    {row.contact_phone || "—"}
                  </td>
                  <td className="p-3.5 text-[var(--service-muted)]">
                    {row.city ? `${row.city}, ` : ""}{row.country}
                  </td>
                  <td className="p-3.5 font-mono text-[11px] text-[var(--service-muted)]">
                    {row.review_requested_at || row.updated_at ? (
                      <time dateTime={row.review_requested_at ?? row.updated_at}>
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "short",
                          timeStyle: "short",
                          timeZone: "Asia/Muscat",
                        }).format(new Date(row.review_requested_at ?? row.updated_at))}
                      </time>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3.5">
                    <Link
                      href={`/admin/companies/${encodeURIComponent(row.id)}?returnTo=/admin/support`}
                      className="rounded-xl bg-[var(--service-accent)] px-3 py-1.5 text-xs font-bold text-white hover:opacity-90 transition inline-flex items-center gap-1 shadow-xs"
                    >
                      <span>{ar ? "مراجعة واعتماد" : "Review & Decide"}</span>
                      <span>←</span>
                    </Link>
                  </td>
                </tr>
              ))}

              {data.pendingReviews.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-xs text-[var(--service-muted)]">
                    {ar
                      ? "لا توجد طلبات مراجعة معلقة حاليًا. كافة المنشآت تمت مراجعتها وجاهزة للعمل."
                      : "No pending company onboarding reviews at this time. All businesses verified."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Official Support Channels & Escalation Matrix */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-[var(--service-ink)]">
          {ar ? "قنوات الدعم الفني المعتمدة (Official Support Channels & Escalation)" : "Official Support Channels"}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {data.supportChannels.map((ch) => (
            <div
              key={ch.id}
              className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-sm flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--service-ink)]">{ch.channel}</span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    {ch.status}
                  </span>
                </div>
                <div className="mt-2 font-mono text-xs font-bold text-[var(--service-accent)]">
                  {ch.target}
                </div>
                <p className="mt-1 text-[11px] text-[var(--service-muted)] leading-relaxed">
                  {ch.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
