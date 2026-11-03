"use client";

import { useState, useMemo } from "react";
import type { AdminAIState } from "@/lib/answers/runtime/admin-types";

const models = ["gpt-6-luna", "gemini-3.8-flash", "gpt-6.1-sol"] as const;

const modelMeta: Record<string, { label: string; shortLabel: string; badge: string; color: string; dotBg: string; borderHover: string }> = {
  "gemini-3.8-flash": {
    label: "Gemini 3.8 Flash",
    shortLabel: "Gemini",
    badge: "Google AI",
    color: "#0284c7",
    dotBg: "bg-sky-500",
    borderHover: "hover:border-sky-500/40",
  },
  "gpt-6-luna": {
    label: "GPT-6 Luna",
    shortLabel: "Luna",
    badge: "Standard",
    color: "#059669",
    dotBg: "bg-emerald-500",
    borderHover: "hover:border-emerald-500/40",
  },
  "gpt-6.1-sol": {
    label: "GPT-6.1 Sol",
    shortLabel: "Sol",
    badge: "Advanced",
    color: "#d97706",
    dotBg: "bg-amber-500",
    borderHover: "hover:border-amber-500/40",
  },
};

type SortField = "name" | "attempts" | "cost";
type SortDirection = "asc" | "desc";

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-30 shrink-0">
        <path d="m7 15 5 5 5-5" />
        <path d="m7 9 5-5 5 5" />
      </svg>
    );
  }
  return direction === "desc" ? (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--service-accent)] shrink-0">
      <path d="m19 12-7 7-7-7" />
      <path d="M12 5v14" />
    </svg>
  ) : (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--service-accent)] shrink-0">
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  );
}

export function AdminRealAISummary({
  data,
  ar,
  loading = false,
}: {
  data: AdminAIState | null;
  ar: boolean;
  loading?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selectedModelFilter, setSelectedModelFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("cost");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const total = data ? data.models.reduce((n, m) => n + Number(m.attempts), 0) : 0;
  const format = (v: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 6,
    }).format(v / 1000);

  // Process rows per company with precise breakdown of all 3 models
  const companyRows = useMemo(() => {
    if (!data) return [];
    return data.companies.map((c) => {
      const attempts = data.recent.filter((v) => v.company_id === c.id);
      const costKnown = attempts.every(
        (v) => typeof v.cost_baisa === "number" && Number.isFinite(v.cost_baisa) && v.cost_baisa >= 0
      );
      const costBaisa = costKnown
        ? attempts.reduce((n, v) => n + (v.cost_baisa as number), 0)
        : 0;

      // Breakdown of the 3 models for THIS specific company
      const modelBreakdown = models.map((mId) => {
        const mAttempts = attempts.filter((v) => v.model_id === mId);
        const mCostKnown = mAttempts.every(
          (v) => typeof v.cost_baisa === "number" && Number.isFinite(v.cost_baisa) && v.cost_baisa >= 0
        );
        const mCostBaisa = mCostKnown
          ? mAttempts.reduce((n, v) => n + (v.cost_baisa as number), 0)
          : 0;
        const succeeded = mAttempts.filter((v) => v.status === "success").length;

        return {
          modelId: mId,
          meta: modelMeta[mId],
          attemptsCount: mAttempts.length,
          succeeded,
          costBaisa: mCostBaisa,
          costKnown: mCostKnown,
        };
      });

      // Find which model consumed the most in this company
      const maxCost = Math.max(...modelBreakdown.map((m) => m.costBaisa));
      const maxAttempts = Math.max(...modelBreakdown.map((m) => m.attemptsCount));
      const hasUsage = maxCost > 0 || maxAttempts > 0;

      const topModel = hasUsage
        ? maxCost > 0
          ? modelBreakdown.find((m) => m.costBaisa === maxCost) || null
          : modelBreakdown.find((m) => m.attemptsCount === maxAttempts) || null
        : null;

      return {
        id: c.id,
        name: c.name,
        status: c.status,
        attemptsCount: attempts.length,
        costBaisa,
        costKnown,
        modelBreakdown,
        topModel,
        hasUsage,
      };
    });
  }, [data]);

  // Real-time filter and sort
  const filteredRows = useMemo(() => {
    let list = companyRows;

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => r.name.toLowerCase().includes(q));
    }

    if (selectedModelFilter !== "all") {
      list = list.filter((r) =>
        r.modelBreakdown.some(
          (m) => m.modelId === selectedModelFilter && (m.attemptsCount > 0 || m.costBaisa > 0)
        )
      );
    }

    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortField === "cost") {
        cmp = a.costBaisa - b.costBaisa;
      } else if (sortField === "attempts") {
        cmp = a.attemptsCount - b.attemptsCount;
      } else if (sortField === "name") {
        cmp = a.name.localeCompare(b.name, ar ? "ar" : "en");
      }

      return sortDirection === "desc" ? -cmp : cmp;
    });

    return list;
  }, [companyRows, search, selectedModelFilter, sortField, sortDirection, ar]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDirection(field === "cost" || field === "attempts" ? "desc" : "asc");
    }
  }

  if (!data) {
    return (
      <div className="rounded-3xl border border-[var(--service-line)] bg-[var(--service-surface)] p-6 shadow-xs">
        <p className="text-sm text-[var(--service-muted)]" role="status">
          {loading
            ? (ar ? "جارٍ تحديث بيانات الذكاء…" : "Refreshing AI usage…")
            : (ar ? "تعذّر قراءة سجل الذكاء. استخدم تحديث البيانات لإعادة المحاولة." : "Could not read AI usage. Refresh to retry.")}
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-3xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 sm:p-6 shadow-xs">
      <header className="border-b border-[var(--service-line)] pb-4">
        <h2 className="text-lg font-bold text-[var(--service-ink)]">
          {ar ? "استهلاك الذكاء المسجّل" : "Recorded AI usage"}
        </h2>
      </header>

      {/* 3 AI Model Overview Cards */}
      <div className="mt-5 grid gap-3.5 md:grid-cols-3">
        {models.map((model) => {
          const m = data.models.find((v) => v.model_id === model);
          const meta = modelMeta[model] || {
            label: model,
            shortLabel: model,
            badge: "Model",
            color: "#d97706",
            dotBg: "bg-amber-500",
            borderHover: "hover:border-amber-500/40",
          };
          const attempts = Number(m?.attempts ?? 0);
          const succeeded = Number(m?.succeeded ?? 0);
          const costBaisa = Number(m?.cost_baisa ?? 0);
          const sharePct = total ? Math.round((attempts / total) * 100) : 0;
          const successRate = attempts > 0 ? Math.min(100, Math.round((succeeded / attempts) * 100)) : 0;

          return (
            <div
              key={model}
              className={`relative flex flex-col justify-between p-4 rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${meta.borderHover}`}
            >
              {/* Header */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2.5 w-2.5 rounded-full ${meta.dotBg} shrink-0`} />
                  <span className="text-sm font-extrabold text-[var(--service-ink)] tracking-tight truncate">
                    {meta.label}
                  </span>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--service-subtle)] text-[var(--service-muted)]">
                    {meta.badge}
                  </span>
                </div>
                <span className="text-xs font-black text-[var(--service-ink)] px-2 py-0.5 rounded-lg bg-[var(--service-canvas)] border border-[var(--service-line)]/60">
                  {sharePct}%
                </span>
              </div>

              {/* Middle: Big Metric */}
              <div className="my-3 flex items-baseline justify-between gap-2">
                <div>
                  <span className="text-2xl sm:text-3xl font-black tracking-tight text-[var(--service-ink)]">
                    {succeeded}
                  </span>
                  <span className="ms-1.5 text-xs font-semibold text-[var(--service-muted)]">
                    {ar ? "طلب ناجح" : "successful"}
                  </span>
                </div>
                <div className="text-end">
                  <span className="text-[11px] font-medium text-[var(--service-muted)] block">
                    {ar ? "من أصل" : "out of"} {attempts} {ar ? "محاولة" : "attempts"}
                  </span>
                </div>
              </div>

              {/* Success rate progress bar */}
              <div className="w-full bg-[var(--service-line)]/50 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${successRate}%`,
                    backgroundColor: meta.color,
                  }}
                />
              </div>

              {/* Footer: Finalized Cost */}
              <div className="mt-3 pt-2.5 border-t border-[var(--service-line)]/60 flex items-center justify-between text-xs">
                <span className="text-[var(--service-muted)] font-medium">
                  {ar ? "التكلفة المسجّلة" : "Recorded cost"}
                </span>
                <div className="flex items-baseline gap-1" dir="ltr">
                  <span className="font-extrabold text-[var(--service-ink)] text-sm">
                    {format(costBaisa)}
                  </span>
                  <span className="text-[10px] font-bold text-[var(--service-muted)] uppercase">OMR</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Companies Usage Table: Per-Company Breakdown for all 3 models */}
      <div className="mt-6 pt-5 border-t border-[var(--service-line)]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-[var(--service-ink)]">
              {ar ? "استهلاك الشركات المسجلة لكل نموذج" : "Companies AI Usage Breakdown"}
            </h3>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--service-subtle)] text-[var(--service-muted)]">
              {filteredRows.length} {ar ? "شركة" : "companies"}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Model Filter Pills */}
            <div className="flex items-center gap-1 p-0.5 rounded-xl bg-[var(--service-canvas)] border border-[var(--service-line)] text-xs">
              <button
                type="button"
                onClick={() => setSelectedModelFilter("all")}
                className={`px-2.5 py-1 rounded-lg font-bold transition-colors ${
                  selectedModelFilter === "all"
                    ? "bg-[var(--service-accent)] text-white shadow-xs"
                    : "text-[var(--service-muted)] hover:text-[var(--service-ink)]"
                }`}
              >
                {ar ? "كل النماذج" : "All Models"}
              </button>
              {models.map((mId) => (
                <button
                  key={mId}
                  type="button"
                  onClick={() => setSelectedModelFilter(mId)}
                  className={`px-2 py-1 rounded-lg font-bold transition-colors flex items-center gap-1.5 ${
                    selectedModelFilter === mId
                      ? "bg-[var(--service-surface)] text-[var(--service-ink)] shadow-xs border border-[var(--service-line)]"
                      : "text-[var(--service-muted)] hover:text-[var(--service-ink)]"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${modelMeta[mId].dotBg}`} />
                  <span>{modelMeta[mId].shortLabel}</span>
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative min-w-[180px] sm:min-w-[220px]">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={ar ? "بحث باسم الشركة..." : "Search company..."}
                className="w-full h-8.5 ps-8 pe-6 text-xs rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] text-[var(--service-ink)] placeholder-[var(--service-muted)] focus:outline-none focus:border-[var(--service-accent)] focus:ring-1 focus:ring-[var(--service-accent)] transition-all"
              />
              <div className="absolute top-1/2 -translate-y-1/2 start-2.5 pointer-events-none">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--service-muted)]">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
              </div>
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label={ar ? "مسح البحث" : "Clear search"}
                  className="absolute top-1/2 -translate-y-1/2 end-2 text-xs text-[var(--service-muted)] hover:text-[var(--service-ink)] p-1"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Table Container */}
        <div className="rounded-2xl border border-[var(--service-line)] overflow-hidden bg-[var(--service-surface)] shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs min-w-[700px]">
              <thead className="border-b border-[var(--service-line)] bg-[var(--service-canvas)] text-[var(--service-ink)] select-none">
                <tr>
                  {/* Company Column */}
                  <th
                    onClick={() => handleSort("name")}
                    className="p-3 text-start cursor-pointer hover:bg-[var(--service-line)]/40 transition-colors font-bold w-[22%]"
                    title={ar ? "اضغط للترتيب حسب الاسم" : "Click to sort by name"}
                  >
                    <div className="flex items-center gap-1.5">
                      <span>{ar ? "الشركة" : "Company"}</span>
                      <SortIcon active={sortField === "name"} direction={sortDirection} />
                    </div>
                  </th>

                  {/* Top Consumed Model Column */}
                  <th className="p-3 text-start font-bold w-[18%]">
                    <span>{ar ? "النموذج الأكثر استهلاكاً" : "Top Consumed Model"}</span>
                  </th>

                  {/* 3 Models Detailed Consumption */}
                  <th className="p-3 text-start font-bold w-[36%]">
                    <span>{ar ? "استهلاك الـ 3 نماذج (بالريال والطلبات)" : "3 Models Consumption (OMR & requests)"}</span>
                  </th>

                  {/* Total Attempts */}
                  <th
                    onClick={() => handleSort("attempts")}
                    className="p-3 text-center cursor-pointer hover:bg-[var(--service-line)]/40 transition-colors font-bold w-[10%]"
                    title={ar ? "اضغط للترتيب حسب عدد المحاولات" : "Click to sort by attempts"}
                  >
                    <div className="flex items-center justify-center gap-1.5">
                      <span>{ar ? "المحاولات" : "Attempts"}</span>
                      <SortIcon active={sortField === "attempts"} direction={sortDirection} />
                    </div>
                  </th>

                  {/* Total Cost Column */}
                  <th
                    onClick={() => handleSort("cost")}
                    className="p-3 text-end cursor-pointer hover:bg-[var(--service-line)]/40 transition-colors font-bold w-[14%]"
                    title={ar ? "اضغط للترتيب حسب أعلى/أقل تكلفة" : "Click to sort by cost"}
                  >
                    <div className="flex items-center justify-end gap-1.5">
                      <SortIcon active={sortField === "cost"} direction={sortDirection} />
                      <span>{ar ? "إجمالي التكلفة" : "Total Cost"}</span>
                      {sortField === "cost" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold bg-[var(--service-accent-soft)] text-[var(--service-accent)]">
                          {sortDirection === "desc" ? (ar ? "الأعلى أولاً" : "Highest") : (ar ? "الأقل أولاً" : "Lowest")}
                        </span>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-xs text-[var(--service-muted)]">
                      {search
                        ? (ar ? `لا توجد شركات مطابقة لـ "${search}"` : `No companies matching "${search}"`)
                        : (ar ? "لا توجد شركات مسجلة في النظام" : "No companies registered")}
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-[var(--service-line)]/50 text-[var(--service-ink)] hover:bg-[var(--service-canvas)]/70 transition-colors"
                    >
                      {/* Company Name */}
                      <td className="p-3 font-bold">
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-lg bg-[var(--service-subtle)] text-[var(--service-accent)] flex items-center justify-center text-[11px] font-black uppercase shrink-0">
                            {row.name.charAt(0)}
                          </span>
                          <span className="truncate max-w-[140px] sm:max-w-[180px]">{row.name}</span>
                        </div>
                      </td>

                      {/* Top Consumed Model */}
                      <td className="p-3">
                        {row.hasUsage && row.topModel ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--service-accent-soft)] text-[var(--service-accent)] border border-[var(--service-accent)]/20 shadow-2xs">
                            <span className={`w-2 h-2 rounded-full ${row.topModel.meta.dotBg}`} />
                            <span className="truncate max-w-[120px]">{row.topModel.meta.label}</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[var(--service-muted)] font-medium">
                            {ar ? "لا يوجد استهلاك بعد" : "No usage yet"}
                          </span>
                        )}
                      </td>

                      {/* 3 Models Consumption: Exact cost & attempts per model for this company */}
                      <td className="p-3">
                        <div className="flex flex-wrap items-center gap-1.5" dir="ltr">
                          {row.modelBreakdown.map((m) => {
                            const isModelTop = row.hasUsage && row.topModel?.modelId === m.modelId;
                            return (
                              <div
                                key={m.modelId}
                                title={`${m.meta.label}: ${format(m.costBaisa)} OMR (${m.attemptsCount} attempts, ${m.succeeded} successful)`}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] transition-all ${
                                  isModelTop
                                    ? "bg-[var(--service-accent-soft)]/60 text-[var(--service-ink)] border border-[var(--service-accent)]/40 font-bold shadow-2xs"
                                    : "bg-[var(--service-canvas)] text-[var(--service-ink)] border border-[var(--service-line)] font-medium"
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${m.meta.dotBg} shrink-0`} />
                                <span className="text-[10px] text-[var(--service-muted)] font-semibold">
                                  {m.meta.shortLabel}:
                                </span>
                                <span className="font-bold text-[11px]">
                                  {m.costKnown ? format(m.costBaisa) : "—"}
                                </span>
                                <span className="text-[9px] text-[var(--service-muted)]">
                                  ({m.attemptsCount})
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </td>

                      {/* Attempts Count */}
                      <td className="p-3 text-center">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-[var(--service-subtle)] text-[var(--service-ink)]">
                          {row.attemptsCount}
                        </span>
                      </td>

                      {/* Total Cost */}
                      <td className="p-3 text-end">
                        <div className="inline-flex items-baseline gap-1" dir="ltr">
                          <span className={`font-black text-xs ${row.costBaisa > 0 ? "text-[var(--service-accent)]" : "text-[var(--service-ink)]"}`}>
                            {row.costKnown ? format(row.costBaisa) : (ar ? "غير متوفر" : "Unavailable")}
                          </span>
                          <span className="text-[10px] font-bold text-[var(--service-muted)] uppercase">OMR</span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
