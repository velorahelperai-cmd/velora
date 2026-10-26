"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDemo } from "@/lib/demo-state";
import type { AdminOperationsData, EventSeverity } from "@/lib/tenancy/operations-types";
import {
  IconAlert,
  IconLayers,
  IconPulse,
  IconShield,
  IconSparkles,
} from "./admin-icons";

const SEVERITY_BADGES: Record<EventSeverity, { ar: string; en: string; tone: "info" | "warn" | "error" | "critical" }> = {
  info: { ar: "معلومات", en: "Info", tone: "info" },
  warning: { ar: "تحذير", en: "Warning", tone: "warn" },
  error: { ar: "خطأ", en: "Error", tone: "error" },
  critical: { ar: "حرج", en: "Critical", tone: "critical" },
};

export interface AdminOperationsCenterProps {
  data: AdminOperationsData;
}

export function AdminOperationsCenter({ data }: AdminOperationsCenterProps) {
  const { locale } = useDemo();
  const ar = locale === "ar";
  const router = useRouter();

  const [serviceFilter, setServiceFilter] = useState<string>(data.queryFilter?.service ?? "all");
  const [severityFilter, setSeverityFilter] = useState<string>(data.queryFilter?.severity ?? "all");
  const [searchQuery, setSearchQuery] = useState<string>(data.queryFilter?.correlationId ?? "");

  const handleServerSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set("correlationId", searchQuery.trim());
    if (serviceFilter !== "all") params.set("service", serviceFilter);
    if (severityFilter !== "all") params.set("severity", severityFilter);
    const qs = params.toString();
    router.push(`/admin/operations${qs ? `?${qs}` : ""}`);
  };

  const filteredEvents = data.recentEvents.filter((evt) => {
    if (serviceFilter !== "all" && evt.service.toLowerCase() !== serviceFilter.toLowerCase()) return false;
    if (severityFilter !== "all" && evt.severity.toLowerCase() !== severityFilter.toLowerCase()) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTrace = evt.traceId.toLowerCase().includes(q);
      const matchReq = evt.requestId.toLowerCase().includes(q);
      const matchErr = evt.errorCode.toLowerCase().includes(q);
      const matchMsg = evt.message.toLowerCase().includes(q);
      const matchComp = evt.companyId?.toLowerCase().includes(q);
      if (!matchTrace && !matchReq && !matchErr && !matchMsg && !matchComp) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--service-accent)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--service-accent)]">
              Module 08 · System Observability & Incident Center
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            {ar ? "مركز العمليات والأعطال (Operations Center)" : "Operations & Incident Center"}
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar
              ? "مراقبة حية لصحة المنصة، وسجل الأحداث التشغيلية، ومسار Webhooks، وتتبع مسار الطلبات (Correlation Tracing)."
              : "Live platform observability, operational logs, webhook ingestion pipes, and end-to-end correlation tracing."}
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
        {/* KPI 1: Active Incidents */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "الحوادث التشغيلية النشطة" : "Active Incidents"}
            </span>
            <IconAlert className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span
              className={`text-2xl font-black ${
                data.kpis.activeIncidents > 0 ? "text-amber-700" : "text-[var(--service-success)]"
              }`}
            >
              {data.kpis.activeIncidents}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {ar ? "حادثة مفتوحة" : "active"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {data.kpis.activeIncidents === 0
              ? ar
                ? "كافة الأنظمة تعمل بكفاءة"
                : "All systems operational"
              : ar
              ? "تتطلب فحص المسار والتشخيص"
              : "Requires diagnostic inspection"}
          </div>
        </div>

        {/* KPI 2: Webhook Ingestion Health */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "معدل نجاح الـ Webhooks" : "Webhook Success Rate"}
            </span>
            <IconPulse className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            {data.kpis.webhookSuccessRate === "UNKNOWN" ? (
              <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-600 border border-stone-200">
                {ar ? "غير متوفر / —" : "UNKNOWN / —"}
              </span>
            ) : (
              <>
                <span className="text-2xl font-black text-[var(--service-success)]">
                  {data.kpis.webhookSuccessRate}
                </span>
                <span className="text-xs font-bold text-[var(--service-muted)]">
                  {ar ? "تسليم مؤكد" : "delivered"}
                </span>
              </>
            )}
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "WhatsApp وInstagram والمدفوعات" : "WhatsApp, Instagram & payments"}
          </div>
        </div>

        {/* KPI 3: Server Response Latency */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "متوسط سرعة استجابة الخادم" : "Avg Server Latency"}
            </span>
            <IconSparkles className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {data.kpis.avgServerLatency}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {ar ? "خادم وقاعدة بيانات" : "server & DB"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "قياس زمن السيرفر (بدون شبكة العميل)" : "Measured server processing time"}
          </div>
        </div>

        {/* KPI 4: Core Services Status */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "جاهزية الخدمات الأساسية" : "Services Health"}
            </span>
            <IconLayers className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                data.kpis.servicesHealth === "healthy"
                  ? "bg-emerald-100 text-emerald-800"
                  : data.kpis.servicesHealth === "degraded"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-stone-100 text-stone-800"
              }`}
            >
              {data.kpis.servicesHealth === "healthy"
                ? ar
                  ? "جاهزة ومستقرة (OPERATIONAL)"
                  : "OPERATIONAL"
                : data.kpis.servicesHealth === "degraded"
                ? ar
                  ? "متأثرة / قيد الفحص (DEGRADED)"
                  : "DEGRADED"
                : ar
                ? "غير معروف (UNKNOWN)"
                : "UNKNOWN"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "5 خدمات تحت المراقبة اللحظية" : "5 core platform dependencies monitored"}
          </div>
        </div>
      </div>

      {/* Core Platform Services Health Grid */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-[var(--service-ink)]">
          {ar ? "جاهزية وصحة المكونات الأساسية (Platform Dependencies Health)" : "Core Platform Services Health"}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
          {data.services.map((svc) => (
            <div
              key={svc.id}
              className="flex flex-col justify-between rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-sm"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      svc.status === "OPERATIONAL"
                        ? "bg-emerald-100 text-emerald-800"
                        : svc.status === "DEGRADED"
                        ? "bg-amber-100 text-amber-800"
                        : "bg-stone-100 text-stone-700"
                    }`}
                  >
                    {svc.status}
                  </span>
                  {svc.latencyMs !== undefined && (
                    <span className="text-[10px] font-mono text-[var(--service-muted)]">{svc.latencyMs}ms</span>
                  )}
                </div>
                <h3 className="mt-2 text-xs font-bold text-[var(--service-ink)]">{svc.name}</h3>
                <p className="mt-1 text-[11px] text-[var(--service-muted)] leading-relaxed">{svc.details}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Webhook Pipes Ingestion Status */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-[var(--service-ink)]">
          {ar ? "قنوات استقبال الـ Webhooks (Event Ingestion Pipes)" : "Webhook Ingestion Pipes"}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {data.webhookPipes.map((pipe) => (
            <div
              key={pipe.channel}
              className="flex items-center justify-between rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-sm"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      pipe.status === "active" ? "bg-emerald-500" : "bg-stone-400"
                    }`}
                  />
                  <span className="text-xs font-bold text-[var(--service-ink)]">{pipe.channel}</span>
                </div>
                <div className="mt-1 text-[11px] text-[var(--service-muted)]">
                  {ar ? "إجمالي الأحداث المعالجة:" : "Processed:"}{" "}
                  <span className="font-mono font-bold text-[var(--service-ink)]">{pipe.eventsCount}</span>
                </div>
              </div>
              <div className="text-left font-mono">
                {pipe.successRate === "UNKNOWN" ? (
                  <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-500 border border-stone-200">
                    {ar ? "غير متوفر" : "UNKNOWN"}
                  </span>
                ) : (
                  <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                    {pipe.successRate}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Correlation & Diagnostics Log Table */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-[var(--service-ink)]">
              {ar ? "سجل التشخيص وتتبع مسار الطلبات (Correlation & Diagnostic Logs)" : "Correlation & Diagnostic Logs"}
            </h2>
            <p className="text-xs text-[var(--service-muted)] mt-0.5">
              {ar
                ? "تتبع مسار الطلبات برقم المعاملة (Correlation ID) أو معرف التتبع (Trace ID) عبر الخادم وقاعدة البيانات."
                : "Trace end-to-end requests by Correlation ID or Trace ID across server runtime and database."}
            </p>
          </div>

          {/* Quick Filters & Correlation Search Form */}
          <form onSubmit={handleServerSearch} className="flex flex-wrap items-center gap-2 text-xs">
            <input
              type="text"
              aria-label={ar ? "معرّف التتبع أو الطلب" : "Trace or request ID"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={ar ? "البحث بـ trace_id أو request_id..." : "Filter by trace_id or request_id..."}
              className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-1.5 text-xs outline-none focus:border-[var(--service-accent)]"
            />
            <button
              type="submit"
              className="rounded-xl bg-[var(--service-accent)] px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition"
            >
              {ar ? "تتبع وبحث" : "Search Trace"}
            </button>
            <select
              aria-label={ar ? "الخدمة" : "Service"}
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
              className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-1.5 text-xs outline-none focus:border-[var(--service-accent)]"
            >
              <option value="all">{ar ? "كل الخدمات" : "All Services"}</option>
              <option value="webhook_meta">Meta Webhooks</option>
              <option value="ai_engine">AI Engine</option>
              <option value="billing_paymob">Historical billing</option>
            </select>
            <select
              aria-label={ar ? "مستوى الحدث" : "Severity"}
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-1.5 text-xs outline-none focus:border-[var(--service-accent)]"
            >
              <option value="all">{ar ? "كل المستويات" : "All Severities"}</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="error">Error</option>
              <option value="critical">Critical</option>
            </select>
          </form>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] shadow-sm">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-[var(--service-line)] bg-[var(--service-canvas)] text-[11px] font-bold text-[var(--service-muted)]">
              <tr>
                <th className="p-3.5">{ar ? "مسار التتبع (Trace / Req ID)" : "Trace / Req ID"}</th>
                <th className="p-3.5">{ar ? "الخدمة" : "Service"}</th>
                <th className="p-3.5">{ar ? "مستوى الحدث" : "Severity"}</th>
                <th className="p-3.5">{ar ? "كود الخطأ الثابت" : "Stable Error Code"}</th>
                <th className="p-3.5">{ar ? "تفاصيل التشخيص" : "Diagnostic Detail"}</th>
                <th className="p-3.5">{ar ? "وقت الحدوث" : "Timestamp"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--service-line)] text-[var(--service-ink)]">
              {filteredEvents.map((evt) => {
                const sevMeta = SEVERITY_BADGES[evt.severity] ?? { ar: evt.severity, en: evt.severity, tone: "info" };

                return (
                  <tr key={evt.id} className="hover:bg-[var(--service-subtle)] transition">
                    <td className="p-3.5 font-mono">
                      <div className="font-bold text-[var(--service-accent)]">{evt.traceId}</div>
                      <div className="text-[10px] text-[var(--service-muted)]">{evt.requestId}</div>
                    </td>
                    <td className="p-3.5 font-medium">{evt.service}</td>
                    <td className="p-3.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          sevMeta.tone === "info"
                            ? "bg-blue-100 text-blue-800"
                            : sevMeta.tone === "warn"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {ar ? sevMeta.ar : sevMeta.en}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <span className="font-mono text-[11px] font-bold text-red-700 bg-red-50 rounded px-1.5 py-0.5 border border-red-200">
                        {evt.errorCode}
                      </span>
                    </td>
                    <td className="p-3.5 text-xs text-[var(--service-ink)] max-w-xs">{evt.message}</td>
                    <td className="p-3.5 font-mono text-[11px] text-[var(--service-muted)]">
                      <time dateTime={evt.createdAt}>
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "short",
                          timeStyle: "medium",
                          timeZone: "Asia/Muscat",
                        }).format(new Date(evt.createdAt))}
                      </time>
                    </td>
                  </tr>
                );
              })}

              {filteredEvents.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-xs text-[var(--service-muted)] font-sans">
                    {searchQuery
                      ? ar
                        ? "لا توجد أحداث مطابقة لمسار التتبع المحدد."
                        : "No events match the specified correlation trace."
                      : ar
                      ? "لا توجد أحداث تشغيلية مسجلة حاليًا في بيئة التشغيل."
                      : "No operational events recorded in this environment yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
