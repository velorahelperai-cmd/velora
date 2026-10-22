"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDemo } from "@/lib/demo-state";
import { readAdminAIState, runAdminAITrial } from "@/lib/answers/runtime/admin-actions";
import type { AdminAIActionInput, AdminAIState } from "@/lib/answers/runtime/admin-types";
import type { SyntheticGeminiFreeState } from "@/lib/answers/runtime/synthetic-gemini-types";
import { SyntheticGeminiConsole } from "@/components/app/synthetic-gemini-console";
import {
  IconLayers,
  IconPulse,
  IconShield,
  IconSparkles,
} from "./admin-icons";

const MODEL_DEFINITIONS = [
  {
    id: "gemini-3.8-flash",
    name: "Gemini 3.8 Flash",
    taglineAr: "المحرك الافتراضي للردود السريعة وكفاءة التكلفة العالية",
    taglineEn: "Default primary engine for fast responses and high cost efficiency",
    pricing: "0.0003 ر.ع / 1k توكن",
    badgeAr: "الافتراضي · فائق السرعة",
    badgeEn: "Default · Ultra Fast",
  },
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    taglineAr: "استدلال متوازن للمحادثات المعقدة ومتعددة المراحل",
    taglineEn: "Balanced reasoning for complex multi-turn conversations",
    pricing: "0.0012 ر.ع / 1k توكن",
    badgeAr: "استدلال متوازن",
    badgeEn: "Balanced Reasoning",
  },
  {
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    taglineAr: "محرك المهام التحليلية المتقدمة والاستخراج الدقيق",
    taglineEn: "Advanced analytical engine for deep reasoning and precision",
    pricing: "0.0025 ر.ع / 1k توكن",
    badgeAr: "استدلال متقدم",
    badgeEn: "Advanced Reasoning",
  },
] as const;

const STATUS_LABELS: Record<string, { ar: string; en: string; tone: "success" | "warn" | "error" | "neutral" }> = {
  success: { ar: "نجاح مكتمل", en: "Success", tone: "success" },
  incomplete: { ar: "رد غير مكتمل", en: "Incomplete", tone: "warn" },
  rejected: { ar: "مرفوض من المزود", en: "Rejected by Provider", tone: "error" },
  uncertain: { ar: "مراجعة مطلوبة", en: "Pending Review", tone: "warn" },
  running: { ar: "قيد التنفيذ", en: "Running", tone: "neutral" },
  reserved: { ar: "محجوز", en: "Funds Held", tone: "neutral" },
};

const ERROR_MESSAGES: Record<string, string> = {
  BUDGET_EXCEEDED: "المتبقي لا يغطي الحد الأقصى للطلب. لم يتم الاتصال بالنموذج.",
  BUDGET_DISABLED: "ميزانية التجارب متوقفة في إعدادات المنصة.",
  NO_KNOWLEDGE: "لا توجد معرفة معتمدة لهذه الشركة. جرّب فحص الاتصال أو اعتمد مصادر المعرفة أولًا.",
  APPROVAL_FOUNDATION_UNAVAILABLE: "تجهيز اعتماد المعرفة غير مكتمل في قاعدة البيانات. فحص الاتصال متاح.",
  KEY_MISSING: "مفتاح المزود غير موجود في إعدادات السيرفر.",
  PROVIDER_HTTP_401: "المزود رفض المفتاح. راجع صلاحية المفتاح وحسابه.",
  PROVIDER_HTTP_403: "الحساب لا يملك صلاحية تنفيذ هذا الطلب لدى المزود.",
  PROVIDER_HTTP_404: "النموذج غير متاح على نقطة الاتصال لهذا الحساب.",
  PROVIDER_HTTP_429: "المزود رفض الطلب بسبب الحصة أو الرصيد أو معدل الطلبات (HTTP 429).",
  PROVIDER_NETWORK_ERROR: "الاتصال غير مؤكد؛ الميزانية المحجوزة محفوظة لحين مراجعة الاستهلاك.",
  SETTLEMENT_PENDING_RECONCILIATION: "وصل الطلب للمزود لكن تأكيد حفظ الاستهلاك تعذّر. الحجز محفوظ لتجنب تجاوز الميزانية.",
  DUPLICATE_REQUEST: "تم استخدام رقم الطلب بالفعل؛ لن نرسل طلبًا مكررًا.",
};

function validRefreshSnapshot(value: AdminAIState) {
  const budget = value?.budget;
  return (
    !!budget &&
    typeof budget.enabled === "boolean" &&
    [budget.limit_baisa, budget.spent_baisa, budget.held_baisa].every(
      (v) => typeof v === "number" && Number.isFinite(v) && v >= 0
    ) &&
    Array.isArray(value.companies) &&
    Array.isArray(value.models) &&
    Array.isArray(value.recent) &&
    value.models.every((row) =>
      [row.attempts, row.succeeded, row.cost_baisa].every(
        (v) => typeof v === "number" && Number.isFinite(v) && v >= 0
      )
    )
  );
}

function formatOMR(baisa: number): string {
  return (baisa / 1000).toFixed(3);
}

export interface AdminAIOperationsProps {
  initial: AdminAIState;
  freeState?: SyntheticGeminiFreeState;
}

export function AdminAIOperations({ initial, freeState }: AdminAIOperationsProps) {
  const { locale } = useDemo();
  const ar = locale === "ar";

  const [snapshot, setSnapshot] = useState<{ source: AdminAIState; data: AdminAIState | null }>({
    source: initial,
    data: initial,
  });

  const state = snapshot.source === initial && snapshot.data ? snapshot.data : initial;
  const activeCompanies = useMemo(
    () => state.companies.filter((c) => c.status !== "suspended"),
    [state.companies]
  );

  const [companyId, setCompanyId] = useState(activeCompanies[0]?.id ?? "");
  const [model, setModel] = useState<AdminAIActionInput["model"]>("gemini-3.8-flash");
  const [contextMode, setContextMode] = useState<AdminAIActionInput["contextMode"]>("connection");
  const [question, setQuestion] = useState("هذا فحص اتصال. أكّدي وصول الرسالة باختصار.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runAdminAITrial>> | null>(null);
  const [freeAttempted, setFreeAttempted] = useState(false);

  const refreshScope = useMemo(() => ({ initial, locale }), [initial, locale]);
  const refreshRequest = useRef<{ scope: typeof refreshScope; active: boolean; pending: boolean; failed: boolean } | null>(null);
  const [refreshState, setRefreshState] = useState<{ scope: typeof refreshScope; pending: boolean; failed: boolean } | null>(null);
  const refreshing = refreshState?.scope === refreshScope && refreshState.pending;
  const [refreshFailure, setRefreshFailure] = useState<{ initial: typeof initial; failed: boolean } | null>(null);
  const refreshFailed = refreshFailure?.initial === initial && refreshFailure.failed;

  useEffect(() => {
    const previous = refreshRequest.current;
    const request = {
      scope: refreshScope,
      active: true,
      pending: false,
      failed: previous?.scope.initial === refreshScope.initial && previous.failed,
    };
    refreshRequest.current = request;
    return () => {
      request.active = false;
    };
  }, [refreshScope]);

  async function refresh() {
    const request = refreshRequest.current;
    if (!request || request.scope !== refreshScope || !request.active || request.pending) return;
    request.pending = true;
    setRefreshState({ scope: refreshScope, pending: true, failed: request.failed });
    try {
      const value = await readAdminAIState();
      if (!request.active) return;
      if (value.ok && validRefreshSnapshot(value.data)) {
        request.failed = false;
        setSnapshot({ source: initial, data: value.data });
        setCompanyId((curr) =>
          value.data.companies.some((c) => c.id === curr && c.status !== "suspended")
            ? curr
            : value.data.companies.find((c) => c.status !== "suspended")?.id ?? ""
        );
      } else {
        request.failed = true;
        if (
          !value.ok &&
          ["OWNER_REQUIRED", "FORBIDDEN", "UNAUTHENTICATED", "UNVERIFIED", "SESSION_UNAVAILABLE"].includes(
            value.error
          )
        ) {
          setSnapshot({ source: initial, data: null });
        }
      }
    } catch {
      if (request.active) request.failed = true;
    } finally {
      if (request.active) {
        request.pending = false;
        setRefreshState({ scope: refreshScope, pending: false, failed: request.failed });
        setRefreshFailure({ initial, failed: request.failed });
      }
    }
  }

  async function handleSubmitTrial(e: React.FormEvent) {
    e.preventDefault();
    const request = refreshRequest.current;
    if (busy || !request || request.scope !== refreshScope || !request.active || request.pending || request.failed) {
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const val = await runAdminAITrial({
        companyId,
        model,
        contextMode,
        question,
        executionId: crypto.randomUUID(),
        locale,
      });
      setResult(val);
      if (!val.ok) {
        setError(ar ? ERROR_MESSAGES[val.error] ?? `تعذّر تنفيذ التجربة (${val.error}).` : val.error);
      }
      await refresh();
    } catch {
      setError(
        ar
          ? "تعذّر تأكيد نتيجة الطلب. راجع سجل الاستهلاك قبل إعادة التجربة."
          : "Could not confirm the result. Check usage before retrying."
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  // Budget calculations directly from real DB state (Never hardcoded to 100 OMR!)
  const budget = state.budget;
  const limitBaisa = Number(budget.limit_baisa || 0);
  const spentBaisa = Number(budget.spent_baisa || 0);
  const heldBaisa = Number(budget.held_baisa || 0);
  const remainingBaisa = Math.max(0, limitBaisa - spentBaisa - heldBaisa);

  const trialResponseText = result && "text" in result && typeof result.text === "string" ? result.text : null;
  const trialModel = result && "model" in result && typeof result.model === "string" ? result.model : null;
  const trialIsComplete = result && "complete" in result ? result.complete === true : true;
  const trialAttempts = result && "attempts" in result && Array.isArray(result.attempts) ? result.attempts : [];
  const trialLatency = trialAttempts.length > 0 && typeof trialAttempts[0]?.latencyMs === "number" ? trialAttempts[0].latencyMs : null;
  const totalAttempts = state.models.reduce((acc, m) => acc + (m.attempts || 0), 0);
  const totalSucceeded = state.models.reduce((acc, m) => acc + (m.succeeded || 0), 0);
  const successRate = totalAttempts > 0 ? ((totalSucceeded / totalAttempts) * 100).toFixed(1) : "0.0";

  // Real measured server latency from recent logs
  const validLatencies = state.recent
    .map((r) => r.latency_ms)
    .filter((l): l is number => typeof l === "number" && l > 0);
  const avgLatency =
    validLatencies.length > 0
      ? Math.round(validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length)
      : null;

  return (
    <div className="space-y-6" dir={ar ? "rtl" : "ltr"}>
      {/* Header with Title and Platform Owner Guard */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--service-line)] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-[var(--service-accent)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--service-accent)]">
              Module 05 · AI Operations & Assistant Studio
            </span>
          </div>
          <h1 className="mt-1 text-2xl font-black text-[var(--service-ink)] tracking-tight">
            {ar ? "عمليات الذكاء الاصطناعي واستوديو المساعدين" : "AI Operations & Assistant Studio"}
          </h1>
          <p className="mt-1 text-sm text-[var(--service-muted)]">
            {ar
              ? "إدارة نماذج الذكاء، ومراقبة الاستهلاك التراكمي، وتنفيذ الفحوصات التشغيلية المعزولة لمالك المنصة."
              : "Manage AI models, monitor cumulative consumption, and run isolated operational trials for the platform owner."}
          </p>
        </div>

        {/* Action Controls & Owner Verification Badge */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 shadow-sm">
            <IconShield className="h-4 w-4 text-[var(--service-success)]" />
            <span className="text-xs font-bold text-[var(--service-ink)]">velorahelperai@gmail.com</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
              {ar ? "مالك المنصة" : "Platform Owner"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy || refreshing}
            className="flex items-center gap-2 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--service-ink)] shadow-sm hover:bg-[var(--service-subtle)] transition disabled:opacity-50"
          >
            <IconPulse className={`h-3.5 w-3.5 text-[var(--service-accent)] ${refreshing ? "animate-spin" : ""}`} />
            <span>{refreshing ? (ar ? "جارٍ التحديث…" : "Refreshing…") : ar ? "تحديث الاستهلاك" : "Refresh Usage"}</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {refreshFailed && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-800 shadow-sm"
        >
          {ar
            ? "تعذّر تحديث الاستهلاك من الخادم. تُعرض آخر بيانات مؤكدة مسجلة في قاعدة البيانات."
            : "Could not refresh usage. Showing last confirmed records from the database."}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-800 shadow-sm"
        >
          {error}
        </div>
      )}

      {/* Top 4 KPI Metrics Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: AI Operations Budget */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "ميزانية تجارب الذكاء (سقف حقيقي)" : "AI Trial Budget (DB Cap)"}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                budget.enabled ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
              }`}
            >
              {budget.enabled ? (ar ? "نشطة" : "Active") : ar ? "متوقفة" : "Disabled"}
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">{formatOMR(limitBaisa)}</span>
            <span className="text-xs font-bold text-[var(--service-muted)]">{ar ? "ر.ع سقف" : "OMR Limit"}</span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)] space-y-1">
            <div className="flex justify-between">
              <span>{ar ? "المصروف الفعلي:" : "Spent:"}</span>
              <span className="font-bold text-[var(--service-ink)]">{formatOMR(spentBaisa)} ر.ع</span>
            </div>
            <div className="flex justify-between">
              <span>{ar ? "المتبقي للتجارب:" : "Remaining:"}</span>
              <span className="font-bold text-[var(--service-success)]">{formatOMR(remainingBaisa)} ر.ع</span>
            </div>
          </div>
        </div>

        {/* KPI 2: Total Attempted Responses & Success Rate */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "إجمالي الردود المنفذة" : "Total Executed Trials"}
            </span>
            <IconSparkles className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">{totalAttempts}</span>
            <span className="text-xs font-bold text-[var(--service-muted)]">{ar ? "محاولة" : "trials"}</span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)] flex justify-between items-center">
            <span>{ar ? "نسبة النجاح المؤكدة:" : "Success Rate:"}</span>
            <span className="font-bold text-[var(--service-success)]">{`${successRate}%`}</span>
          </div>
        </div>

        {/* KPI 3: Real Measured Latency */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "متوسط سرعة المعالجة" : "Average Latency"}
            </span>
            <IconPulse className="h-4 w-4 text-[var(--service-accent)]" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-[var(--service-ink)]">
              {avgLatency !== null ? `${avgLatency}ms` : "—"}
            </span>
            <span className="text-xs font-bold text-[var(--service-muted)]">{ar ? "زمن خادم" : "server ms"}</span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)] flex justify-between items-center">
            <span>{ar ? "بيئة القياس:" : "Measurement:"}</span>
            <span className="font-medium text-[var(--service-ink)]">
              {ar ? "خادم Node.js + DB" : "Node.js Server + DB"}
            </span>
          </div>
        </div>

        {/* KPI 4: Default Primary Engine */}
        <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--service-muted)]">
              {ar ? "المحرك الأساسي" : "Primary Engine"}
            </span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              {ar ? "جاهز ومتصل" : "Ready"}
            </span>
          </div>
          <div className="mt-3">
            <span className="text-xl font-black text-[var(--service-accent)]">Gemini 3.8 Flash</span>
          </div>
          <div className="mt-3 border-t border-[var(--service-line)] pt-3 text-xs text-[var(--service-muted)] flex justify-between items-center">
            <span>{ar ? "التكلفة الافتراضية:" : "Baseline Cost:"}</span>
            <span className="font-medium text-[var(--service-ink)]">0.0003 ر.ع / 1k</span>
          </div>
        </div>
      </div>

      {/* AI Models Registry Cards */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-[var(--service-ink)]">
          {ar ? "سجل نماذج الذكاء الاصطناعي المعتمدة (Model Registry)" : "Authorized AI Model Registry"}
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {MODEL_DEFINITIONS.map((def) => {
            const usage = state.models.find((m) => m.model_id === def.id);
            const attemptsCount = usage?.attempts ?? 0;
            const successCount = usage?.succeeded ?? 0;
            const costBaisa = usage?.cost_baisa ?? 0;

            return (
              <div
                key={def.id}
                className="flex flex-col justify-between rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 shadow-sm transition hover:border-[var(--service-accent)]"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-[var(--service-accent-soft)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--service-accent)]">
                      {ar ? def.badgeAr : def.badgeEn}
                    </span>
                    <span className="text-[11px] font-mono text-[var(--service-muted)]">{def.pricing}</span>
                  </div>
                  <h3 className="mt-3 text-lg font-black text-[var(--service-ink)]">{def.name}</h3>
                  <p className="mt-1 text-xs text-[var(--service-muted)]">{ar ? def.taglineAr : def.taglineEn}</p>
                </div>

                <div className="mt-4 border-t border-[var(--service-line)] pt-3 grid grid-cols-3 gap-2 text-center text-xs">
                  <div>
                    <div className="text-[10px] text-[var(--service-muted)]">{ar ? "المحاولات" : "Attempts"}</div>
                    <div className="mt-1 font-bold text-[var(--service-ink)]">{attemptsCount}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--service-muted)]">{ar ? "الناجحة" : "Succeeded"}</div>
                    <div className="mt-1 font-bold text-[var(--service-success)]">{successCount}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-[var(--service-muted)]">{ar ? "التكلفة (ر.ع)" : "Cost (OMR)"}</div>
                    <div className="mt-1 font-bold text-[var(--service-ink)]">{formatOMR(costBaisa)}</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Synthetic Gemini Console for Free Trials if available */}
      {freeState && (
        <SyntheticGeminiConsole
          initial={freeState}
          ar={ar}
          attemptedBefore={freeAttempted}
          onAttempt={() => setFreeAttempted(true)}
        />
      )}

      {/* Diagnostic Test Console & Live Assistant Studio (Module 05 Diagnostic) */}
      <div className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-sm">
        <div className="border-b border-[var(--service-line)] pb-4">
          <h2 className="text-lg font-black text-[var(--service-ink)]">
            {ar ? "منصة الفحص التجريبي الإداري (Diagnostic Test & Assistant Studio)" : "Diagnostic Test & Studio Console"}
          </h2>
          <p className="mt-1 text-xs text-[var(--service-muted)]">
            {ar
              ? "فحص مباشر للردود واسترجاع المعرفة لمالك المنصة فقط، دون أي تأثير على بيانات العملاء أو استهلاك اشتراكاتهم."
              : "Direct live prompt test and knowledge retrieval for the platform owner only, without affecting customer channels or subscriptions."}
          </p>

          {/* Active Assistant & Routing Pipeline Status */}
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-[var(--service-canvas)] p-3 border border-[var(--service-line)] text-xs">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="font-bold text-[var(--service-ink)]">
                {ar ? "المساعد الافتراضي: نورا (Noura)" : "Default Assistant: Noura"}
              </span>
            </div>
            <span className="text-[var(--service-muted)]">•</span>
            <div className="text-[var(--service-muted)]">
              {ar ? "سلسلة التوجيه والبدائل: Gemini 3.8 Flash → GPT-6 Luna → GPT-6.1 Sol" : "Routing Fallback: Gemini Flash → Luna → Sol"}
            </div>
            <span className="text-[var(--service-muted)]">•</span>
            <div className="font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              {ar ? "عزل مالي وتشغيلي 100% عن قنوات العملاء" : "100% Isolated from customer channels"}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Trial Configuration Form (7 cols) */}
          <form onSubmit={handleSubmitTrial} className="space-y-4 lg:col-span-7">
            <div>
              <label className="block text-xs font-bold text-[var(--service-ink)]">
                {ar ? "الشركة المرتبطة بالسجل التشغيلي" : "Target Company for Ledger"}
              </label>
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                disabled={busy}
                className="mt-1.5 w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 text-xs font-medium text-[var(--service-ink)] outline-none focus:border-[var(--service-accent)]"
              >
                {activeCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-bold text-[var(--service-ink)]">
                  {ar ? "النموذج المختار" : "Selected Model"}
                </label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value as AdminAIActionInput["model"])}
                  disabled={busy}
                  className="mt-1.5 w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 text-xs font-medium text-[var(--service-ink)] outline-none focus:border-[var(--service-accent)]"
                >
                  <option value="gemini-3.8-flash">Gemini 3.8 Flash</option>
                  <option value="gpt-6-luna">GPT-6 Luna</option>
                  <option value="gpt-6.1-sol">GPT-6.1 Sol</option>
                  <option value="auto">{ar ? "توجيه تلقائي (Auto-Routing)" : "Auto Routing"}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-[var(--service-ink)]">
                  {ar ? "مصدر المعرفة والسياق" : "Context & Knowledge Mode"}
                </label>
                <select
                  value={contextMode}
                  onChange={(e) => setContextMode(e.target.value as AdminAIActionInput["contextMode"])}
                  disabled={busy}
                  className="mt-1.5 w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 py-2 text-xs font-medium text-[var(--service-ink)] outline-none focus:border-[var(--service-accent)]"
                >
                  <option value="connection">{ar ? "فحص اتصال فقط" : "Connection check"}</option>
                  <option value="company">{ar ? "معرفة الشركة المعتمدة" : "Approved company knowledge"}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[var(--service-ink)]">
                {ar ? "السؤال أو الرسالة التجريبية" : "Test Prompt / Question"}
              </label>
              <textarea
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={1000}
                rows={4}
                disabled={busy}
                required
                className="mt-1.5 w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-3 text-xs text-[var(--service-ink)] outline-none focus:border-[var(--service-accent)]"
              />
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
              {ar
                ? "تنبيه: هذا الفحص يرسل طلبًا فعليًا مشفرًا ومحميًا إلى مزود النموذج، ويتم حجز تكلفة الطلب من ميزانية تجارب مالك المنصة فقط دون المساس باشتراك الشركة."
                : "Notice: This trial dispatches a real encrypted request to the provider. Funds are reserved solely from the platform owner trial budget."}
            </div>

            <button
              type="submit"
              disabled={busy || refreshing || refreshFailed || !companyId || !budget.enabled || remainingBaisa <= 0 || !question.trim()}
              className="flex items-center justify-center gap-2 rounded-xl bg-[var(--service-accent)] px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:opacity-95 transition disabled:opacity-50"
            >
              <IconSparkles className="h-4 w-4" />
              <span>{busy ? (ar ? "جارٍ الاتصال بالنموذج…" : "Calling Model…") : ar ? "تشغيل تجربة فعلية (Run Trial)" : "Run Real Trial"}</span>
            </button>
          </form>

          {/* Trial Response Panel (5 cols) */}
          <div className="flex flex-col justify-between rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] p-4 lg:col-span-5">
            <div>
              <div className="flex items-center justify-between border-b border-[var(--service-line)] pb-2">
                <span className="text-xs font-bold text-[var(--service-ink)]">
                  {ar ? "نتيجة التجربة واستجابة النموذج" : "Trial Response Output"}
                </span>
                {trialLatency !== null && (
                  <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                    {trialLatency}ms
                  </span>
                )}
              </div>

              <div className="mt-4 text-xs leading-relaxed text-[var(--service-ink)]">
                {trialResponseText !== null ? (
                  <div className="space-y-3">
                    <div className="rounded-lg bg-[var(--service-surface)] p-3 border border-[var(--service-line)]">
                      <div className="text-[10px] font-bold text-[var(--service-muted)] uppercase">
                        {trialModel ?? "AI Model"}
                      </div>
                      <div className="mt-1.5 whitespace-pre-wrap">
                        {trialResponseText || (ar ? "المزود لم يُرجع نصًا، ولكن استهلاكه سُجّل في قاعدة البيانات." : "Provider returned empty text; usage was recorded.")}
                      </div>
                    </div>

                    {!trialIsComplete && (
                      <div className="rounded-md bg-amber-50 p-2 text-[11px] text-amber-800 border border-amber-200">
                        {ar
                          ? "الرد غير مكتمل عند حد الإخراج (Incomplete). تم حفظ الاستهلاك ولن يتم التكرار تلقائيًا."
                          : "Incomplete at output limit. Usage recorded; no automatic retry."}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-12 text-center text-[var(--service-muted)]">
                    <IconLayers className="mx-auto h-8 w-8 opacity-40" />
                    <p className="mt-2 text-xs">
                      {ar
                        ? "اختر الشركة والنموذج المطلوب ثم اضغط تشغيل الفحص لعرض الرد الحقيقي هنا."
                        : "Select company & model, then click Run Trial to inspect live responses."}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {trialAttempts.length > 0 && (
              <div className="mt-4 border-t border-[var(--service-line)] pt-3 space-y-2">
                <div className="text-[10px] font-bold text-[var(--service-muted)]">
                  {ar ? "تفاصيل المحاولات والتكلفة:" : "Attempt Breakdown:"}
                </div>
                {trialAttempts.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center justify-between rounded-lg bg-[var(--service-surface)] px-2.5 py-1.5 text-[11px] border border-[var(--service-line)]"
                  >
                    <span className="font-mono text-[var(--service-ink)]">{att.model}</span>
                    <span className="font-semibold text-[var(--service-success)]">
                      {att.costBaisa === null ? (ar ? "الحجز محفوظ" : "Funds held") : `${formatOMR(att.costBaisa)} ر.ع`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent AI Usage Ledger Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-[var(--service-ink)]">
            {ar ? "سجل الاستهلاك التشغيلي والمالي الأخير (Usage Ledger)" : "Recent Operational & Usage Ledger"}
          </h2>
          <span className="text-xs text-[var(--service-muted)]">
            {ar ? `عرض آخر ${state.recent.length} محاولات مسجلة` : `Showing last ${state.recent.length} recorded trials`}
          </span>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] shadow-sm">
          <table className="w-full text-right text-xs">
            <thead className="border-b border-[var(--service-line)] bg-[var(--service-canvas)] text-[11px] font-bold text-[var(--service-muted)]">
              <tr>
                <th className="p-3.5">{ar ? "معرف الطلب" : "Request ID"}</th>
                <th className="p-3.5">{ar ? "النموذج" : "Model"}</th>
                <th className="p-3.5">{ar ? "الحالة" : "Status"}</th>
                <th className="p-3.5">{ar ? "زمن الاستجابة" : "Latency"}</th>
                <th className="p-3.5">{ar ? "التوكنز (إدخال / إخراج)" : "Tokens (Prompt / Comp)"}</th>
                <th className="p-3.5">{ar ? "التكلفة (ر.ع)" : "Cost (OMR)"}</th>
                <th className="p-3.5">{ar ? "تاريخ ووقت التنفيذ" : "Execution Timestamp"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--service-line)] text-[var(--service-ink)] font-mono">
              {state.recent.map((row) => {
                const statusMeta = STATUS_LABELS[row.status] ?? {
                  ar: row.status,
                  en: row.status,
                  tone: "neutral" as const,
                };
                const costDisplay = row.cost_baisa !== null ? `${formatOMR(Number(row.cost_baisa))} ر.ع` : (ar ? "محجوز" : "Held");

                return (
                  <tr key={row.id} className="hover:bg-[var(--service-subtle)] transition">
                    <td className="p-3.5 font-bold text-[var(--service-accent)]">{row.request_id}</td>
                    <td className="p-3.5 font-medium">{row.model_id}</td>
                    <td className="p-3.5">
                      <div className="flex flex-col gap-1 items-start">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            statusMeta.tone === "success"
                              ? "bg-emerald-100 text-emerald-800"
                              : statusMeta.tone === "warn"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {ar ? statusMeta.ar : statusMeta.en}
                        </span>
                        {row.error_code && (
                          <span className="text-[10px] font-mono text-red-700 bg-red-50 rounded px-1.5 py-0.5 border border-red-200">
                            {row.error_code}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3.5">{row.latency_ms !== null ? `${row.latency_ms}ms` : "—"}</td>
                    <td className="p-3.5 text-center">
                      {row.prompt_tokens ?? "—"} / {row.completion_tokens ?? "—"}
                    </td>
                    <td className="p-3.5 font-bold">{costDisplay}</td>
                    <td className="p-3.5 text-[11px] font-sans text-[var(--service-muted)]">
                      {new Date(row.created_at).toLocaleString(ar ? "ar-OM" : "en-OM", {
                        timeZone: "Asia/Muscat",
                      })}
                    </td>
                  </tr>
                );
              })}

              {state.recent.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-xs text-[var(--service-muted)] font-sans">
                    {ar ? "لا يوجد استهلاك مسجّل بعد في قاعدة البيانات." : "No usage recorded yet in database."}
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
