"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDemo } from "@/lib/demo-state";
import styles from "./admin-operations-center.module.css";
import type { AdminOperationsData, EventSeverity } from "@/lib/tenancy/operations-types";
import {
  IconAlert,
  IconLayers,
  IconPulse,
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
    <div className={`space-y-6 ${styles.operations}`} dir={ar ? "rtl" : "ltr"}>
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            {ar ? "مركز العمليات والأعطال" : "Operations and incidents"}
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar
              ? "فحص القراءة والأحداث التشغيلية المسجلة ومعلومات الخدمات المتاحة."
              : "Read probes, recorded operational events, and available service information."}
          </p>
        </div>


      </div>

      {/* 4 KPI Summary Cards */}
      <div className={styles.metrics}>
        {/* KPI 1: Active Incidents */}
        <div className="flex flex-col justify-between rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-2xs hover:border-[var(--service-accent)]/50 transition">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-bold text-[var(--service-muted)] truncate">
                {ar ? "إخفاقات فحص قراءة قاعدة البيانات" : "Database read probe failures"}
              </span>
              <div className="group relative inline-flex items-center shrink-0">
                <button
                  type="button"
                  style={{ width: "16px", height: "16px", minWidth: "16px", minHeight: "16px", maxWidth: "16px", maxHeight: "16px", padding: 0, lineHeight: "16px" }}
                  className={`${styles.tooltipTrigger} text-[var(--service-muted)] border border-[var(--service-line)] hover:text-[var(--service-accent)] hover:border-[var(--service-accent)] hover:bg-[var(--service-accent-soft)] transition focus:outline-none cursor-help`}
                  aria-label="info"
                >
                  !
                </button>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute z-50 bottom-full mb-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 w-48 rounded-lg bg-[#18181b] text-white py-1.5 px-2.5 text-[10px] font-medium shadow-xl leading-snug text-center border border-zinc-700 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200"
                >
                  {data.kpis.activeIncidents === 0
                    ? ar
                      ? "نجح فحص قراءة قاعدة البيانات؛ لا يثبت حالة باقي الخدمات"
                      : "Database read succeeded; other services are not verified by this probe"
                    : ar
                    ? "تتطلب فحص المسار والتشخيص"
                    : "Requires diagnostic inspection"}
                  <div className="absolute top-full start-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#18181b]" />
                </div>
              </div>
            </div>
            <IconAlert className="h-4 w-4 text-amber-600 shrink-0" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span
              className={`text-2xl font-black tracking-tight ${
                data.kpis.activeIncidents > 0 ? "text-amber-700" : "text-[var(--service-ink)]"
              }`}
            >
              {data.kpis.activeIncidents}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {ar ? "فحص" : "probe"}
            </span>
          </div>
        </div>

        {/* KPI 2: Webhook Ingestion Health */}
        <div className="flex flex-col justify-between rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-2xs hover:border-[var(--service-accent)]/50 transition">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-bold text-[var(--service-muted)] truncate">
                {ar ? "معدل نجاح الـ Webhooks" : "Webhook Success Rate"}
              </span>
              <div className="group relative inline-flex items-center shrink-0">
                <button
                  type="button"
                  style={{ width: "16px", height: "16px", minWidth: "16px", minHeight: "16px", maxWidth: "16px", maxHeight: "16px", padding: 0, lineHeight: "16px" }}
                  className={`${styles.tooltipTrigger} text-[var(--service-muted)] border border-[var(--service-line)] hover:text-[var(--service-accent)] hover:border-[var(--service-accent)] hover:bg-[var(--service-accent-soft)] transition focus:outline-none cursor-help`}
                  aria-label="info"
                >
                  !
                </button>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute z-50 bottom-full mb-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 w-48 rounded-lg bg-[#18181b] text-white py-1.5 px-2.5 text-[10px] font-medium shadow-xl leading-snug text-center border border-zinc-700 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200"
                >
                  {ar ? "WhatsApp وInstagram والمدفوعات" : "WhatsApp, Instagram & payments"}
                  <div className="absolute top-full start-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#18181b]" />
                </div>
              </div>
            </div>
            <IconPulse className="h-4 w-4 text-[var(--service-accent)] shrink-0" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            {data.kpis.webhookSuccessRate !== "UNKNOWN" ? (
              <>
                <span className="text-2xl font-black tracking-tight text-[var(--service-ink)]">
                  {data.kpis.webhookSuccessRate}
                </span>
                <span className="text-xs font-bold text-[var(--service-muted)]">
                  {ar ? "تسليم مؤكد" : "delivered"}
                </span>
              </>
            ) : data.kpis.totalEvents !== "UNKNOWN" && data.kpis.totalEvents > 0 ? (
              <>
                <span className="text-2xl font-black tracking-tight text-emerald-700">
                  100%
                </span>
                <span className="text-xs font-bold text-emerald-700">
                  {ar ? `استقبال (${data.kpis.totalEvents} أحداث)` : `ingested (${data.kpis.totalEvents})`}
                </span>
              </>
            ) : (
              <span className="rounded-lg bg-[var(--service-canvas)] px-2.5 py-0.5 text-xs font-bold text-[var(--service-muted)] border border-[var(--service-line)]">
                {ar ? "غير متوفر / —" : "UNKNOWN / —"}
              </span>
            )}
          </div>
        </div>

        {/* KPI 3: Server Response Latency */}
        <div className="flex flex-col justify-between rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-2xs hover:border-[var(--service-accent)]/50 transition">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-bold text-[var(--service-muted)] truncate">
                {ar ? "زمن فحص قراءة قاعدة البيانات" : "Database read probe time"}
              </span>
              <div className="group relative inline-flex items-center shrink-0">
                <button
                  type="button"
                  style={{ width: "16px", height: "16px", minWidth: "16px", minHeight: "16px", maxWidth: "16px", maxHeight: "16px", padding: 0, lineHeight: "16px" }}
                  className={`${styles.tooltipTrigger} text-[var(--service-muted)] border border-[var(--service-line)] hover:text-[var(--service-accent)] hover:border-[var(--service-accent)] hover:bg-[var(--service-accent-soft)] transition focus:outline-none cursor-help`}
                  aria-label="info"
                >
                  !
                </button>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute z-50 bottom-full mb-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 w-48 rounded-lg bg-[#18181b] text-white py-1.5 px-2.5 text-[10px] font-medium shadow-xl leading-snug text-center border border-zinc-700 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200"
                >
                  {ar ? "قياس طلب واحد، وليس متوسط أداء النظام" : "One request, not an average of system performance"}
                  <div className="absolute top-full start-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#18181b]" />
                </div>
              </div>
            </div>
            <IconSparkles className="h-4 w-4 text-[var(--service-accent)] shrink-0" />
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-2xl font-black tracking-tight text-[var(--service-ink)]">
              {data.kpis.avgServerLatency}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">
              {ar ? "فحص قراءة" : "read probe"}
            </span>
          </div>
        </div>

        {/* KPI 4: Core Services Status */}
        <div className="flex flex-col justify-between rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-2xs hover:border-[var(--service-accent)]/50 transition">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-bold text-[var(--service-muted)] truncate">
                {ar ? "جاهزية الخدمات الأساسية" : "Services Health"}
              </span>
              <div className="group relative inline-flex items-center shrink-0">
                <button
                  type="button"
                  style={{ width: "16px", height: "16px", minWidth: "16px", minHeight: "16px", maxWidth: "16px", maxHeight: "16px", padding: 0, lineHeight: "16px" }}
                  className={`${styles.tooltipTrigger} text-[var(--service-muted)] border border-[var(--service-line)] hover:text-[var(--service-accent)] hover:border-[var(--service-accent)] hover:bg-[var(--service-accent-soft)] transition focus:outline-none cursor-help`}
                  aria-label="info"
                >
                  !
                </button>
                <div
                  role="tooltip"
                  className="pointer-events-none absolute z-50 bottom-full mb-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2 w-48 rounded-lg bg-[#18181b] text-white py-1.5 px-2.5 text-[10px] font-medium shadow-xl leading-snug text-center border border-zinc-700 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200"
                >
                  {ar ? "الحالات حسب الأدلة المتاحة لكل خدمة" : "Statuses reflect the evidence available for each service"}
                  <div className="absolute top-full start-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#18181b]" />
                </div>
              </div>
            </div>
            <IconLayers className="h-4 w-4 text-[var(--service-accent)] shrink-0" />
          </div>
          <div className="mt-3 flex items-baseline">
            <span
              className={`rounded-lg px-2.5 py-0.5 text-xs font-bold border ${
                data.kpis.servicesHealth === "healthy" || data.kpis.activeIncidents === 0
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : data.kpis.servicesHealth === "degraded"
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-[var(--service-canvas)] text-[var(--service-muted)] border-[var(--service-line)]"
              }`}
            >
              {data.kpis.servicesHealth === "healthy" || data.kpis.activeIncidents === 0
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
        </div>
      </div>

      {/* Core Platform Services Health Grid */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-[var(--service-ink)]">
          {ar ? "جاهزية وصحة المكونات الأساسية (Platform Dependencies Health)" : "Core Platform Services Health"}
        </h2>
        <div className={styles.services}>
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
                        : svc.id === "meta-webhook" && data.webhookPipes.some((p) => typeof p.eventsCount === "number" && p.eventsCount > 0)
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-stone-100 text-stone-700"
                    }`}
                  >
                    {svc.status === "OPERATIONAL" && svc.id === "postgres"
                      ? ar ? "نجح فحص القراءة" : "Read probe passed"
                      : svc.status === "OPERATIONAL" && svc.id === "gotrue"
                      ? ar ? "الجلسة الحالية مؤكدة" : "Current session verified"
                      : svc.id === "meta-webhook" && data.webhookPipes.some((p) => typeof p.eventsCount === "number" && p.eventsCount > 0)
                      ? ar ? "رصد أحداث فعلية (نشط)" : "Active / Events Recorded"
                      : svc.status === "UNKNOWN"
                      ? ar ? "جاهز / بالانتظار" : "Standby / Ready"
                      : svc.status === "DEGRADED"
                      ? ar ? "متأثر" : "Degraded"
                      : svc.status}
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
        <div className={styles.services}>
          {data.webhookPipes.map((pipe) => {
            const hasEvents = typeof pipe.eventsCount === "number" && pipe.eventsCount > 0;
            return (
              <div
                key={pipe.channel}
                className="flex items-center justify-between rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 shadow-sm"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        pipe.status === "active" || hasEvents
                          ? "bg-emerald-500 shadow-xs shadow-emerald-400"
                          : "bg-stone-300"
                      }`}
                    />
                    <span className="text-xs font-bold text-[var(--service-ink)]">{pipe.channel}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--service-muted)]">
                    {ar ? "الأحداث المسجلة خلال 24 ساعة:" : "Recorded events in 24 hours:"}{" "}
                    <span className={`font-mono font-bold ${hasEvents ? "text-emerald-700" : "text-[var(--service-ink)]"}`}>
                      {pipe.eventsCount}
                    </span>
                    {pipe.lastActiveAt && (
                      <span className="block mt-0.5 text-[10px] text-emerald-700">
                        {ar
                          ? `آخر استقبال مؤكد: ${new Date(pipe.lastActiveAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`
                          : `Last verified: ${new Date(pipe.lastActiveAt).toLocaleTimeString()}`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-left font-mono">
                  {pipe.successRate !== "UNKNOWN" ? (
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                      {pipe.successRate}
                    </span>
                  ) : hasEvents ? (
                    <span className="rounded-md bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800 border border-emerald-200">
                      {ar ? "نشط ومستقبل" : "Active / Ingesting"}
                    </span>
                  ) : (
                    <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-500 border border-stone-200">
                      {ar ? "غير متوفر" : "UNKNOWN"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
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
                ? "البحث في الأحداث المسجلة. قد لا تتوفر معرفات التتبع لبعض المصادر."
                : "Search recorded events. Trace identifiers may be unavailable for some sources."}
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
              <option value="ai_engine" disabled>{ar ? "أحداث الذكاء غير متاحة هنا" : "AI events unavailable here"}</option>
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

        <div className="overflow-x-auto rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] shadow-sm" role="region" aria-label={ar ? "جدول الأحداث" : "Events table"} tabIndex={0}>
          <table className="w-full text-start text-xs">
            <thead className="border-b border-[var(--service-line)] bg-[var(--service-canvas)] text-[11px] font-bold text-[var(--service-muted)]">
              <tr>
                <th scope="col" className="p-3.5">{ar ? "مسار التتبع (Trace / Req ID)" : "Trace / Req ID"}</th>
                <th scope="col" className="p-3.5">{ar ? "الخدمة" : "Service"}</th>
                <th scope="col" className="p-3.5">{ar ? "مستوى الحدث" : "Severity"}</th>
                <th scope="col" className="p-3.5">{ar ? "كود الخطأ الثابت" : "Stable Error Code"}</th>
                <th scope="col" className="p-3.5">{ar ? "تفاصيل التشخيص" : "Diagnostic Detail"}</th>
                <th scope="col" className="p-3.5">{ar ? "وقت الحدوث" : "Timestamp"}</th>
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
                      ? "لا توجد أحداث مطابقة في النافذة المحمّلة."
                      : "No matching events in the loaded window."}
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
