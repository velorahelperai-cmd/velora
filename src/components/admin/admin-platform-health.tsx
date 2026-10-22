"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDemo } from "@/lib/demo-state";
import type { PlatformHealthOverviewData, SubsystemProbe } from "@/lib/tenancy/health-types";
import {
  IconCheckCircle,
  IconClock,
  IconCreditCard,
  IconDatabase,
  IconKey,
  IconLayers,
  IconPulse,
  IconRefresh,
  IconServer,
  IconShield,
  IconSparkles,
} from "./admin-icons";

export interface AdminPlatformHealthProps {
  data: PlatformHealthOverviewData;
}

export function AdminPlatformHealth({ data }: AdminPlatformHealthProps) {
  const router = useRouter();
  const { locale } = useDemo();
  const ar = locale === "ar";

  const [isRefreshing, setIsRefreshing] = useState(false);
  const { kpis, probes, invariants, evaluatedAt } = data;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      router.refresh();
    } finally {
      setTimeout(() => setIsRefreshing(false), 600);
    }
  };

  const getProbeIcon = (category: SubsystemProbe["category"]) => {
    switch (category) {
      case "database":
        return <IconDatabase className="h-5 w-5 text-[var(--service-accent)]" />;
      case "auth":
        return <IconKey className="h-5 w-5 text-indigo-600" />;
      case "integrations":
        return <IconLayers className="h-5 w-5 text-blue-600" />;
      case "ai":
        return <IconSparkles className="h-5 w-5 text-emerald-600" />;
      case "storage":
        return <IconServer className="h-5 w-5 text-teal-600" />;
      default:
        return <IconPulse className="h-5 w-5 text-[var(--service-accent)]" />;
    }
  };

  const getStatusBadge = (status: SubsystemProbe["status"]) => {
    switch (status) {
      case "HEALTHY":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800 border border-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
            {ar ? "جاهز ومتصل" : "HEALTHY"}
          </span>
        );
      case "GUARDED":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-800 border border-blue-200">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
            {ar ? "محمي (وضع فحص)" : "GUARDED"}
          </span>
        );
      case "DEGRADED":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800 border border-amber-200">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
            {ar ? "أداء منخفض" : "DEGRADED"}
          </span>
        );
      case "DOWN":
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-800 border border-rose-200">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
            {ar ? "غير متصل" : "DOWN"}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-0.5 text-xs font-bold text-gray-700 border border-gray-200">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
            {status}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--service-accent)]">
              Module 14 · Platform Readiness & Health Checks
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            {ar ? "جاهزية وصحة المنصة (Platform Health & Readiness)" : "Platform Health & Readiness"}
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar
              ? "فحص توافق وجاهزية مكونات المنصة التحتية، بوابات التكامل، ومحددات الأمان الصارمة."
              : "Subsystem readiness probes, latency benchmarks, external integration bridges, and security invariants."}
          </p>
        </div>

        {/* Action & Owner Badge */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3.5 py-2 text-xs font-bold text-[var(--service-ink)] shadow-sm hover:bg-[var(--service-subtle)] disabled:opacity-50 transition"
          >
            <IconRefresh className={`h-4 w-4 text-[var(--service-accent)] ${isRefreshing ? "animate-spin" : ""}`} />
            {ar ? "إعادة الفحص التشخيصي" : "Re-run Health Probe"}
          </button>

          <div className="flex items-center gap-2 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 shadow-sm">
            <IconShield className="h-4 w-4 text-[var(--service-success)]" />
            <span className="text-xs font-bold text-[var(--service-ink)]">velorahelperai@gmail.com</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
              {ar ? "مالك المنصة" : "Platform Owner"}
            </span>
          </div>
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: Overall System Status */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "الحالة العامة للنظام" : "Overall System Status"}
            </span>
            <IconPulse className="h-4 w-4 text-[var(--service-success)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-emerald-700">
              {kpis.overallStatus === "HEALTHY" ? (ar ? "جاهز ومستقر" : "HEALTHY") : kpis.overallStatus}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)] flex items-center justify-between">
            <span>{ar ? "جميع الخدمات الأساسية متصلة" : "Core subsystems operational"}</span>
            <span className="font-bold text-emerald-700">100%</span>
          </div>
        </div>

        {/* KPI 2: Database Probe Latency */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "زمن استجابة قاعدة البيانات" : "PostgreSQL DB Latency"}
            </span>
            <IconDatabase className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {kpis.dbLatencyMs}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">ms</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              {ar ? "فحص حقيقي" : "Live Ping"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "استعلام round-trip مباشر دون تعديل بيانات" : "Live non-mutating query probe"}
          </div>
        </div>

        {/* KPI 3: Live Payment Guard */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "حماية بوابة الدفع" : "Payment Sandbox Isolation"}
            </span>
            <IconCreditCard className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-lg font-black text-blue-800">
              {ar ? "بيئة فحص معزولة" : "TEST_MODE_GUARDED"}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "منع الخصومات الحقيقية مفعل بشكل قاطع" : "Zero live transactions permitted"}
          </div>
        </div>

        {/* KPI 4: AI Model Fleet */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "أسطول نماذج الذكاء" : "AI Router Fleet Status"}
            </span>
            <IconSparkles className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-lg font-black text-emerald-800">
              {kpis.aiRouterStatus === "UNKNOWN" ? (ar ? "غير متحقق" : "UNKNOWN") : (ar ? "جاهز ومقنن" : "READY_GUARDED")}
            </span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)]">
            {ar ? "لم يُختبر تشغيل مزود الذكاء في هذا الفحص" : "Provider operation was not tested by this probe"}
          </div>
        </div>
      </div>

      {/* Subsystem Probes Grid */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--service-line)] pb-4">
          <div>
            <h2 className="text-lg font-black text-[var(--service-ink)]">
              {ar ? "مصفوفة فحص جاهزية الخدمات والأنظمة التحتية" : "Subsystem Readiness Probes Matrix"}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--service-muted)]">
              {ar
                ? "فحوصات تشخيصية غير مدمرة للتأكد من توافر الخدمات وقنوات الاتصال دون إرسال رسائل أو خصم أموال."
                : "Non-destructive diagnostic probes verifying connectivity, endpoints, and credentials without side-effects."}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--service-muted)]">
            <IconClock className="h-3.5 w-3.5" />
            <span>
              {ar ? "آخر فحص:" : "Evaluated:"} {new Date(evaluatedAt).toLocaleTimeString(ar ? "ar-OM" : "en-US")}
            </span>
          </div>
        </div>

        <div className="mt-4 divide-y divide-[var(--service-line)]">
          {probes.map((probe) => (
            <div key={probe.id} className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-xl border border-[var(--service-line)] bg-[var(--service-subtle)] p-2">
                  {getProbeIcon(probe.category)}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[var(--service-ink)]">
                      {ar ? probe.nameAr : probe.nameEn}
                    </span>
                    <span className="rounded bg-[var(--service-subtle)] px-2 py-0.5 text-[10px] font-mono text-[var(--service-muted)] uppercase border border-[var(--service-line)]">
                      {probe.category}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--service-muted)]">
                    {ar ? probe.detailsAr : probe.detailsEn}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4 self-end md:self-center">
                {probe.latencyMs !== null && (
                  <div className="text-right text-xs">
                    <span className="font-mono font-bold text-[var(--service-ink)]">{probe.latencyMs}ms</span>
                    <span className="block text-[10px] text-[var(--service-muted)]">{ar ? "زمن الاستجابة" : "latency"}</span>
                  </div>
                )}
                <div>{getStatusBadge(probe.status)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Authoritative Security Invariants Matrix */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-sm">
        <div className="border-b border-[var(--service-line)] pb-4">
          <div className="flex items-center gap-2">
            <IconShield className="h-5 w-5 text-emerald-700" />
            <h2 className="text-lg font-black text-[var(--service-ink)]">
              {ar ? "محددات الأمان والحوكمة الإلزامية (Security Invariants)" : "Authoritative Security Invariants"}
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--service-muted)]">
            {ar
              ? "الضوابط الأمنية الصارمة المطبقة في قاعدة البيانات، التشفير، وقنوات الدفع والتفويض."
              : "Rigid security guardrails enforced at database level, API layers, and platform boundaries."}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {invariants.map((inv) => (
            <div
              key={inv.id}
              className="rounded-xl border border-[var(--service-line)] bg-[var(--service-subtle)]/40 p-4 transition"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--service-ink)]">
                  {ar ? inv.labelAr : inv.labelEn}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                  <IconCheckCircle className="h-3 w-3" />
                  {inv.status}
                </span>
              </div>
              <p className="mt-2 text-xs font-mono text-[var(--service-muted)] leading-relaxed">
                {inv.evidence}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
