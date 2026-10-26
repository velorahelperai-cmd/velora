"use client";
import { AccessibleDialog } from "@/components/app/accessible-dialog";

import { useState } from "react";
import Link from "next/link";
import { useDemo } from "@/lib/demo-state";
import type {
  AdminAuditLogEntry,
  AdminAuditOverviewData,
  AuditCategory,
} from "@/lib/tenancy/audit-types";
import {
  IconAlert,
  IconCheckCircle,
  IconClock,
  IconFileText,
  IconSearch,
  IconShield,
  IconX,
} from "./admin-icons";

export interface AdminAuditComplianceProps {
  data: AdminAuditOverviewData;
  initialFilter?: { action?: string; category?: string; search?: string; companyId?: string };
}

const CATEGORY_STYLES: Record<AuditCategory, { ar: string; en: string; style: string }> = {
  security: { ar: "أمان وصلاحيات", en: "Security", style: "bg-red-100 text-red-800 border-red-200" },
  support: { ar: "دعم وتذاكر", en: "Support", style: "bg-blue-100 text-blue-800 border-blue-200" },
  billing: { ar: "مالية واشتراكات", en: "Billing", style: "bg-emerald-100 text-emerald-800 border-emerald-200" },
  company: { ar: "منشآت وتهيئة", en: "Company", style: "bg-teal-100 text-teal-800 border-teal-200" },
  channel: { ar: "قنوات ورسائل", en: "Channel", style: "bg-amber-100 text-amber-800 border-amber-200" },
  system: { ar: "نظام وتشغيل", en: "System", style: "bg-stone-100 text-stone-700 border-stone-200" },
};

export function AdminAuditCompliance({ data, initialFilter = {} }: AdminAuditComplianceProps) {
  const { locale } = useDemo();
  const ar = locale === "ar";

  const [categoryFilter, setCategoryFilter] = useState<string>(initialFilter.category || "");
  const [actionFilter, setActionFilter] = useState<string>(initialFilter.action || "");
  const [searchQuery, setSearchQuery] = useState<string>(initialFilter.search || "");

  // Inspect detail modal state
  const [inspectedEntry, setInspectedEntry] = useState<AdminAuditLogEntry | null>(null);

  const filteredLogs = data.logs;
  function pageHref(offset: number) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(initialFilter)) if (value) query.set(key, value);
    query.set("limit", String(data.pagination.limit));
    query.set("offset", String(offset));
    return `/admin/audit?${query}`;
  }

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--service-accent)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--service-accent)]">
              Module 11 · Governance & Immutable Audit Logs
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            {ar ? "سجل التدقيق والحوكمة الإدارية (Audit & Compliance)" : "Audit & Compliance Center"}
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar
              ? "السجل الإداري غير القابل للتعديل (Append-Only) لتوثيق العمليات الحساسة، الصلاحيات، وحركات المنشآت."
              : "Append-only immutable administrative audit trail recording sensitive tenant operations, role grants, and security events."}
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
        {/* KPI 1: Total Audit Records */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "إجمالي السجلات المسجلة" : "Total Audit Logs"}
            </span>
            <IconFileText className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {data.kpis.totalLogsCount}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {ar ? "عملية موثقة" : "records"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "سجل تراكمي موثق بقاعدة البيانات" : "Cumulative immutable database log"}
          </div>
        </div>

        {/* KPI 2: Operations in Last 24 Hours */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "العمليات خلال 24 ساعة" : "Operations (Last 24h)"}
            </span>
            <IconClock className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {data.kpis.recent24hCount}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {ar ? "عملية حديثة" : "recent events"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "مراقبة حية للنشاط الإداري" : "Active administrative velocity"}
          </div>
        </div>

        {/* KPI 3: Immutability Security Gate */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "بوابة ثبات السجل (Immutability)" : "Immutability Gate"}
            </span>
            <IconCheckCircle className="h-4 w-4 text-[var(--service-success)]" />
          </div>
          <div className="mt-3">
            <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
              {data.kpis.immutabilityGate === "APPEND_ONLY" ? (ar ? "إضافة فقط (APPEND-ONLY LOCKED)" : "APPEND-ONLY (LOCKED)") : (ar ? "غير متحقق" : "UNVERIFIED")}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "حالة حارس قاعدة البيانات تحتاج تحققًا مستقلًا" : "Database immutability requires independent verification"}
          </div>
        </div>

        {/* KPI 4: Governance Retention Policy */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "فترة الاحتفاظ بالحوكمة" : "Retention Policy"}
            </span>
            <IconAlert className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-xl font-black text-[var(--service-ink)]">
              {data.kpis.retentionPolicy === "UNCONFIGURED" ? "UNCONFIGURED" : data.kpis.retentionPolicy}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {ar ? "(غير معتمد)" : "(Unconfigured)"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "سياسة فترة الاحتفاظ قيد الاعتماد الرسمي" : "Data retention policy pending formal approval"}
          </div>
        </div>
      </div>

      {/* Audit Log Table & Filters */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--service-ink)]">
              {ar ? "سجل العمليات الإدارية الموثق (Audit Trail)" : "Administrative Audit Trail"}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--service-muted)]">
              {ar
                ? "تتبع كافة القرارات والتعديلات وتغييرات الحالات مع الفاعل والبيانات قبل وبعد الإجراء."
                : "Complete trace of administrative decisions, state transitions, actor attribution, and before/after payloads."}
            </p>
          </div>

          {/* Quick Filters */}
          <form action="/admin/audit" className="flex flex-wrap items-center gap-2 text-xs">
            {initialFilter.companyId && <input type="hidden" name="companyId" value={initialFilter.companyId} />}
            <div className="relative">
              <IconSearch className="pointer-events-none absolute start-2.5 top-2 h-3.5 w-3.5 text-[var(--service-muted)]" />
              <input
                type="search" name="search" maxLength={120} aria-label={ar ? "البحث في سجل التدقيق" : "Search audit logs"}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={ar ? "البحث بالعملية أو المنشأة..." : "Filter by action or company..."}
                className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] py-1.5 ps-8 pe-3 text-xs outline-none focus:border-[var(--service-accent)]"
              />
            </div>
            <select
              name="category" aria-label={ar ? "التصنيف" : "Category"} value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-1.5 text-xs outline-none focus:border-[var(--service-accent)]"
            >
              <option value="">{ar ? "كل التصنيفات" : "All Categories"}</option>
              <option value="security">{ar ? "أمان وصلاحيات" : "Security"}</option>
              <option value="support">{ar ? "دعم وتذاكر" : "Support"}</option>
              <option value="company">{ar ? "منشآت وتهيئة" : "Company"}</option>
              <option value="billing">{ar ? "مالية واشتراكات" : "Billing"}</option>
              <option value="channel">{ar ? "قنوات ورسائل" : "Channel"}</option>
              <option value="system">{ar ? "نظام وتشغيل" : "System"}</option>
            </select>
            {(data.availableActions.length > 0 || actionFilter) && (
              <select
                name="action" aria-label={ar ? "العملية" : "Action"} value={actionFilter}
                onChange={(e) => setActionFilter(e.target.value)}
                className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-1.5 text-xs outline-none focus:border-[var(--service-accent)] max-w-[180px]"
              >
                <option value="">{ar ? "كل العمليات" : "All Actions"}</option>
                {actionFilter && !data.availableActions.includes(actionFilter) && <option value={actionFilter}>{actionFilter}</option>}
                {data.availableActions.map((act) => (
                  <option key={act} value={act}>
                    {act}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="min-h-11 rounded-xl border px-4">{ar ? "بحث" : "Search"}</button>
            <Link href="/admin/audit" className="underline">{ar ? "مسح المرشحات" : "Clear filters"}</Link>
          </form>
        </div>
        <nav aria-label={ar ? "صفحات السجل" : "Audit pages"} className="mb-4 flex flex-wrap items-center gap-4 text-sm">
          <span>{ar ? "عدد النتائج:" : "Results:"} {data.pagination.totalCount}</span>
          {data.pagination.offset > 0 && <Link className="underline" href={pageHref(Math.max(0, data.pagination.offset - data.pagination.limit))}>{ar ? "السابق" : "Previous"}</Link>}
          {data.pagination.hasMore && <Link className="underline" href={pageHref(data.pagination.offset + data.pagination.limit)}>{ar ? "التالي" : "Next"}</Link>}
        </nav>

        {/* Audit Table */}
        <div className="overflow-x-auto rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)]">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-[var(--service-line)] text-[11px] font-bold text-[var(--service-muted)]">
              <tr>
                <th className="p-3.5">{ar ? "نوع العملية" : "Action"}</th>
                <th className="p-3.5">{ar ? "التصنيف" : "Category"}</th>
                <th className="p-3.5">{ar ? "الفاعل (Actor)" : "Actor"}</th>
                <th className="p-3.5">{ar ? "المنشأة المتأثرة" : "Target Company"}</th>
                <th className="p-3.5">{ar ? "الوقت (UTC+4)" : "Timestamp"}</th>
                <th className="p-3.5">{ar ? "التفاصيل" : "Details"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--service-line)] text-[var(--service-ink)]">
              {filteredLogs.map((log) => {
                const catMeta = CATEGORY_STYLES[log.category] ?? CATEGORY_STYLES.system;

                return (
                  <tr key={log.id} className="hover:bg-[var(--service-subtle)] transition">
                    <td className="p-3.5 font-mono font-bold text-[var(--service-ink)]">
                      {log.action}
                    </td>
                    <td className="p-3.5">
                      <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold border ${catMeta.style}`}>
                        {ar ? catMeta.ar : catMeta.en}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-[11px] text-[var(--service-muted)]">
                      {log.actorEmail ? (
                        <span className="font-bold text-[var(--service-accent)]">{log.actorEmail}</span>
                      ) : (
                        <span>{log.actorUserId.slice(0, 12)}...</span>
                      )}
                    </td>
                    <td className="p-3.5">
                      {log.companyId ? (
                        <Link
                          href={`/admin/companies/${encodeURIComponent(log.companyId)}?returnTo=/admin/audit`}
                          className="font-medium hover:underline text-[var(--service-ink)] hover:text-[var(--service-accent)]"
                        >
                          {log.companyName ?? log.companyId.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="text-[11px] text-[var(--service-muted)]">
                          {ar ? "عام / المنصة" : "Platform-wide"}
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 font-mono text-[11px] text-[var(--service-muted)]">
                      <time dateTime={log.createdAt}>
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "short",
                          timeStyle: "medium",
                          timeZone: "Asia/Muscat",
                        }).format(new Date(log.createdAt))}
                      </time>
                    </td>
                    <td className="p-3.5">
                      <button
                        type="button"
                        onClick={() => setInspectedEntry(log)}
                        className="rounded-lg bg-[var(--service-surface)] px-2.5 py-1 text-[11px] font-bold text-[var(--service-ink)] border border-[var(--service-line)] hover:bg-[var(--service-subtle)] transition shadow-2xs"
                      >
                        {ar ? "فحص التغييرات" : "Inspect Diff"}
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-xs text-[var(--service-muted)] font-sans">
                    {ar
                      ? "لا توجد سجلات تدقيق مسجلة تطابق شروط الفرز الحالية."
                      : "No audit logs match the specified filter criteria."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspect Detail Modal */}
      {inspectedEntry && (
        <AccessibleDialog label={ar ? "تفاصيل سجل التدقيق" : "Audit log details"} onClose={() => setInspectedEntry(null)} busy={false}>
          <div className="w-full max-w-2xl rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-xl space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[var(--service-line)] pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs font-mono font-bold text-stone-700">
                    {inspectedEntry.action}
                  </span>
                  <span className="text-xs text-[var(--service-muted)] font-mono">
                    {inspectedEntry.id}
                  </span>
                </div>
                <div className="mt-1 text-xs text-[var(--service-muted)]">
                  {ar ? "الفاعل:" : "Actor:"} <span className="font-mono">{inspectedEntry.actorUserId}</span>
                  {inspectedEntry.companyId && (
                    <span className="ms-2">| {ar ? "المنشأة:" : "Company:"} {inspectedEntry.companyName ?? inspectedEntry.companyId}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                aria-label={ar ? "إغلاق" : "Close"}
                onClick={() => setInspectedEntry(null)}
                className="rounded-lg p-1 text-[var(--service-muted)] hover:bg-[var(--service-subtle)]"
              >
                <IconX className="h-4 w-4" />
              </button>
            </div>

            {/* Diff View Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
              <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-3">
                <div className="font-bold text-[var(--service-ink)] mb-2 flex items-center gap-1.5 font-sans">
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span>{ar ? "الحالة السابقة (Before Data)" : "Before Data"}</span>
                </div>
                <pre className="text-[11px] overflow-x-auto whitespace-pre-wrap text-[var(--service-muted)] max-h-60">
                  {inspectedEntry.beforeData
                    ? JSON.stringify(inspectedEntry.beforeData, null, 2)
                    : ar ? "لا توجد بيانات سابقة (إنشاء جديد)" : "null (New entity creation)"}
                </pre>
              </div>

              <div className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-3">
                <div className="font-bold text-[var(--service-ink)] mb-2 flex items-center gap-1.5 font-sans">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  <span>{ar ? "الحالة اللاحقة (After Data)" : "After Data"}</span>
                </div>
                <pre className="text-[11px] overflow-x-auto whitespace-pre-wrap text-emerald-800 max-h-60">
                  {inspectedEntry.afterData
                    ? JSON.stringify(inspectedEntry.afterData, null, 2)
                    : ar ? "لا توجد بيانات لاحقة (حذف / تعليق)" : "null (Deletion / Suspension)"}
                </pre>
              </div>
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-[var(--service-line)]">
              <button
                type="button"
                onClick={() => setInspectedEntry(null)}
                className="rounded-xl bg-[var(--service-accent)] px-4 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90 transition"
              >
                {ar ? "إغلاق النافذة" : "Close"}
              </button>
            </div>
          </div>
        </AccessibleDialog>
      )}
    </div>
  );
}
