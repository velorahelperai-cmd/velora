"use client";

import { useDemo } from "@/lib/demo-state";
import Link from "next/link";
import {AdminRealAISummary} from "@/components/admin/admin-real-ai-summary";
import {readAdminTruth,type AdminTruth} from "@/lib/answers/runtime/admin-truth";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Notice, useAction, useAppCopy } from "@/components/app/ui";
import { fill, type AppCopy } from "@/lib/app-copy";
import {
  adminGetOverviewStats,
  adminListCompanies,
  adminSearchAccounts,
} from "@/lib/tenancy/actions";
import type {
  AccessCode,
  AdminAccountSearchItem,
  AdminCompanyListItem,
  AdminOverviewStats,
  CompanyStatus,
} from "@/lib/tenancy/types";
import {
  ADMIN_ACCOUNT_QUERY_MAX_LEN,
  ADMIN_ACCOUNT_SEARCH_MAX_OFFSET,
  normalizeAdminAccountQuery,
} from "@/lib/tenancy/types";
import {
  IconBuilding,
  IconCheckCircle,
  IconCreditCard,
  IconDashboard,
  IconRefresh,
  IconRocket,
  IconSearch,
  IconSparkles,
  IconUsers,
} from "@/components/admin/admin-icons";

const ACCOUNT_PAGE_SIZE = 20;
const ADMIN_SECTION_IDS = [
  "overview",
  "companies",
  "accounts",
  "reviews",
  "ai",
  "future",
] as const;

type AdminTab = (typeof ADMIN_SECTION_IDS)[number];
type CompaniesLoadState = "loading" | "ready" | "error";
type AccountsLoadState = "loading" | "ready" | "error";
type OverviewState = "loading" | "ready" | "error" | "dependency";

function companyStatusLabel(status: CompanyStatus | null | undefined, copy: AppCopy): string {
  if (status === "setup") return copy.admin.statusSetup;
  if (status === "active") return copy.admin.statusActive;
  if (status === "suspended") return copy.admin.statusSuspended;
  return status ?? "—";
}

function emailConfirmLabel(value: boolean | null, copy: AppCopy): string {
  if (value === true) return copy.admin.accountEmailConfirmed;
  if (value === false) return copy.admin.accountEmailUnconfirmed;
  return copy.admin.accountEmailUnknown;
}

const ADMIN_FLASH_CLASS = "admin-section-target";
let adminFlashTimer = 0;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function scrollAdminSection(id: string, historyMode: "push" | "replace" | "none" = "push") {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({
    behavior: prefersReducedMotion() ? "instant" : "smooth",
    block: "start",
  });
  if (historyMode !== "none") {
    const next = `#${id}`;
    if (window.location.hash !== next) {
      try {
        if (historyMode === "push") history.pushState(null, "", next);
        else history.replaceState(null, "", next);
      } catch {
        /* ignore */
      }
    }
  }
  document.querySelectorAll(`.${ADMIN_FLASH_CLASS}`).forEach((node) => {
    node.classList.remove(ADMIN_FLASH_CLASS);
  });
  el.classList.add(ADMIN_FLASH_CLASS);
  window.clearTimeout(adminFlashTimer);
  adminFlashTimer = window.setTimeout(() => {
    el.classList.remove(ADMIN_FLASH_CLASS);
  }, 1400);
  if (typeof el.focus === "function") {
    try {
      el.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }
  return true;
}

export function AdminList({
  initialOverview = null,
  overviewUnavailable = null,
  initialTruth = null,
}: {
  initialOverview?: AdminOverviewStats | null;
  overviewUnavailable?: { code: AccessCode | "AUTH_ERROR"; message: string | null } | null;
  initialTruth?: AdminTruth | null;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const { busy, run } = useAction();
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | CompanyStatus>("all");
  const [rows, setRows] = useState<AdminCompanyListItem[]>([]);
  const [companiesState, setCompaniesState] = useState<CompaniesLoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const [accountQuery, setAccountQuery] = useState("");
  const [accountRows, setAccountRows] = useState<AdminAccountSearchItem[]>([]);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountOffset, setAccountOffset] = useState(0);
  const [accountHasMore, setAccountHasMore] = useState(false);
  const [accountOffsetCapped, setAccountOffsetCapped] = useState(false);
  const [accountsState, setAccountsState] = useState<AccountsLoadState>("loading");
  const [activeAccountQuery, setActiveAccountQuery] = useState("");
  const [trackedOverviewProps, setTrackedOverviewProps] = useState(() => ({
    overview: initialOverview,
    unavailable: overviewUnavailable,
  }));
  const [clientOverview, setClientOverview] = useState<{
    state: OverviewState;
    data: AdminOverviewStats | null;
    error: string | null;
  } | null>(null);

  const accountsGen = useRef(0);
  const companiesGen = useRef(0);
  const overviewGen = useRef(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [truthState,setTruthState]=useState<{
    source:AdminTruth|null;
    data:AdminTruth|null;
    pending:object|null;
  }>(()=>({source:initialTruth,data:initialTruth,pending:null}));
  if(truthState.source!==initialTruth){
    setTruthState({source:initialTruth,data:initialTruth,pending:null});
  }
  const truth=truthState.source===initialTruth?truthState.data:initialTruth;
  const truthLoading=truthState.source===initialTruth&&truthState.pending!==null;
  async function loadTruth(){
    const token={};
    setTruthState(current=>current.source===initialTruth
      ? {...current,data:null,pending:token}:current);
    try{
      const result=await readAdminTruth();
      setTruthState(current=>current.source===initialTruth&&current.pending===token
        ? {...current,data:result.ok?result.data:null,pending:null}:current);
    }catch{
      setTruthState(current=>current.source===initialTruth&&current.pending===token
        ? {...current,data:null,pending:null}:current);
    }
  }
  const money=(value:number)=>new Intl.NumberFormat(locale==="ar"?"ar-OM":"en-OM",{maximumFractionDigits:6,minimumFractionDigits:3}).format(value/1000);

  // Adopt newer SSR props on router.refresh
  if (
    trackedOverviewProps.overview !== initialOverview ||
    trackedOverviewProps.unavailable !== overviewUnavailable
  ) {
    setTrackedOverviewProps({ overview: initialOverview, unavailable: overviewUnavailable });
    setClientOverview(null);
  }

  const overviewState: OverviewState = clientOverview
    ? clientOverview.state
    : overviewUnavailable?.message?.startsWith("DEPENDENCY_MISSING:")
    ? "dependency"
    : initialOverview
    ? "ready"
    : overviewUnavailable
    ? "error"
    : "loading";

  const overview =
    clientOverview?.state === "ready"
      ? clientOverview.data
      : (initialOverview ?? null);

  const overviewError =
    clientOverview?.state === "error"
      ? clientOverview.error
      : overviewUnavailable && !overviewUnavailable.message?.startsWith("DEPENDENCY_MISSING:")
      ? (overviewUnavailable.message ?? copy.admin.statsLoadFailed)
      : null;

  async function loadOverview() {
    const gen = ++overviewGen.current;
    setClientOverview({ state: "loading", data: null, error: null });
    try {
      const result = await adminGetOverviewStats();
      if (gen !== overviewGen.current) return;
      if (!result.ok) {
        if (result.message?.startsWith("DEPENDENCY_MISSING:")) {
          setClientOverview({ state: "dependency", data: null, error: null });
          return;
        }
        setClientOverview({
          state: "error",
          data: null,
          error: result.message ?? copy.admin.statsLoadFailed,
        });
        return;
      }
      setClientOverview({ state: "ready", data: result.data, error: null });
    } catch {
      if (gen !== overviewGen.current) return;
      setClientOverview({
        state: "error",
        data: null,
        error: copy.admin.statsLoadFailed,
      });
    }
  }

  async function load(q = search) {
    const gen = ++companiesGen.current;
    setError(null);
    setCompaniesState("loading");
    try {
      const result = await adminListCompanies(q);
      if (gen !== companiesGen.current) return;
      if (!result.ok) {
        setError(result.message ?? copy.admin.companiesLoadFailed);
        setCompaniesState("error");
        return;
      }
      setRows(result.data);
      setCompaniesState("ready");
    } catch {
      if (gen !== companiesGen.current) return;
      setError(copy.admin.companiesLoadFailed);
      setCompaniesState("error");
    }
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load("");
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const gen = ++overviewGen.current;
    if (initialOverview || overviewUnavailable) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await adminGetOverviewStats();
        if (cancelled || gen !== overviewGen.current) return;
        if (!result.ok) {
          if (result.message?.startsWith("DEPENDENCY_MISSING:")) {
            setClientOverview({ state: "dependency", data: null, error: null });
            return;
          }
          setClientOverview({
            state: "error",
            data: null,
            error: result.message ?? copy.admin.statsLoadFailed,
          });
          return;
        }
        setClientOverview({ state: "ready", data: result.data, error: null });
      } catch {
        if (cancelled || gen !== overviewGen.current) return;
        setClientOverview({
          state: "error",
          data: null,
          error: copy.admin.statsLoadFailed,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialOverview, overviewUnavailable, copy.admin.statsLoadFailed]);

  // Synchronize hash with activeTab
  useEffect(() => {
    function handleHash(event?: Event) {
      if (typeof window === "undefined") return;
      const hash = (event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : window.location.hash.replace(/^#/, "")) as AdminTab;
      if (ADMIN_SECTION_IDS.includes(hash)) {
        setActiveTab(hash);
        requestAnimationFrame(() => scrollAdminSection(hash, "none"));
      }
    }

    handleHash();
    window.addEventListener("hashchange", handleHash);
    window.addEventListener("popstate", handleHash);
    window.addEventListener("velora-admin-tab", handleHash);
    return () => {
      window.removeEventListener("hashchange", handleHash);
      window.removeEventListener("popstate", handleHash);
      window.removeEventListener("velora-admin-tab", handleHash);
    };
  }, []);

  async function loadAccounts(q: string, offset: number, gen: number) {
    const normalized = normalizeAdminAccountQuery(q);
    setAccountBusy(true);
    if (offset === 0) setAccountsState("loading");
    try {
      const result = await adminSearchAccounts({
        query: normalized,
        limit: ACCOUNT_PAGE_SIZE,
        offset,
      });
      if (gen !== accountsGen.current) return;
      if (!result.ok) {
        setAccountError(
          result.message === "rate_limited"
            ? copy.admin.accountSearchRateLimited
            : result.message?.startsWith("DEPENDENCY_MISSING:")
            ? copy.admin.accountJourneyDependencyBody
            : (result.message ?? copy.errors.authFailed),
        );
        setAccountRows([]);
        setAccountHasMore(false);
        setAccountOffsetCapped(false);
        setActiveAccountQuery(normalized);
        setAccountsState("error");
        return;
      }
      if (result.data.query !== normalized) return;
      setAccountError(null);
      setAccountRows(result.data.rows);
      setAccountOffset(result.data.offset);
      setActiveAccountQuery(result.data.query);
      setAccountHasMore(result.data.hasMore);
      setAccountOffsetCapped(result.data.atBrowseWindowEnd);
      setAccountsState("ready");
    } catch {
      if (gen !== accountsGen.current) return;
      setAccountError(copy.errors.authFailed);
      setActiveAccountQuery(normalized);
      setAccountsState("error");
    } finally {
      if (gen === accountsGen.current) setAccountBusy(false);
    }
  }

  useEffect(() => {
    const gen = ++accountsGen.current;
    const q = normalizeAdminAccountQuery(accountQuery);
    const delay = q ? 350 : 0;
    const timer = window.setTimeout(() => {
      void loadAccounts(q, 0, gen);
    }, delay);
    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountQuery]);

  function onAccountQueryChange(value: string) {
    accountsGen.current += 1;
    setAccountQuery(value.slice(0, ADMIN_ACCOUNT_QUERY_MAX_LEN));
    setAccountError(null);
    setAccountOffset(0);
    setAccountHasMore(false);
    setAccountOffsetCapped(false);
    setAccountRows([]);
    setActiveAccountQuery("");
    setAccountsState("loading");
  }

  function loadAccountPage(nextOffset: number) {
    const q = activeAccountQuery;
    const inputQ = normalizeAdminAccountQuery(accountQuery);
    if (q !== inputQ) return;
    if (nextOffset > ADMIN_ACCOUNT_SEARCH_MAX_OFFSET) return;
    const gen = ++accountsGen.current;
    void loadAccounts(q, nextOffset, gen);
  }

  const inputAccountQuery = normalizeAdminAccountQuery(accountQuery);
  const requestMatchesInput =
    (accountsState === "ready" || accountsState === "error") &&
    activeAccountQuery === inputAccountQuery;
  const resultsMatchInput =
    accountsState === "ready" && activeAccountQuery === inputAccountQuery;

  const legacyBrowseLikely =
    !inputAccountQuery &&
    resultsMatchInput &&
    !accountRows.length &&
    overviewState === "ready" &&
    overview &&
    overview.accountsTotal > 0;

  const filtered = useMemo(
    () => (status === "all" ? rows : rows.filter((r) => r.status === status)),
    [rows, status],
  );

  const reviewPending = useMemo(
    () => rows.filter((r) => r.review_status === "pending_review"),
    [rows],
  );

  const pageNumber = Math.floor(accountOffset / ACCOUNT_PAGE_SIZE) + 1;
  const isRtl = locale === "ar";

  function switchTab(tab: AdminTab) {
    setActiveTab(tab);
    try {
      if (tab === "overview") history.replaceState(null, "", "/admin");
      else history.replaceState(null, "", `#${tab}`);
    } catch {
      /* ignore */
    }
  }

  return (
    <div ref={rootRef} className="space-y-6">
      {/* 📌 Header Title & Top Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-[#D7C1A5]/80">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 rounded-full bg-[#D1AE7C]" />
            <span className="text-xs font-semibold text-[#6B4932] tracking-wider uppercase">
              {copy.brand} Enterprise Platform
            </span>
          </div>
          <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold text-[#18130F] tracking-tight">
            {copy.admin.title}
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[#18130F] max-w-2xl">
            {copy.admin.body}
          </p>
        </div>

        {/* Action button: Refresh Data */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            busy={truthLoading}
            onClick={() => {
              void loadOverview();
              void load(search);
              void loadTruth();
            }}
            className="flex items-center gap-2 text-xs sm:text-sm border border-[#D7C1A5] bg-[#FFFBF5] text-[#18130F] hover:bg-[#F7F0E5]"
          >
            <IconRefresh className={(truthLoading || overviewState === "loading") ? "animate-spin" : ""} />
            <span>{isRtl ? "تحديث البيانات" : "Refresh"}</span>
          </Button>
        </div>
      </div>

      {/* 📊 5 Enterprise KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Card 1: Total Companies */}
        <div className="relative rounded-2xl border border-[#D7C1A5] bg-[#FFFBF5] p-4 transition-all hover:border-[#6B4932] hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#18130F]">
              {isRtl ? "إجمالي الشركات" : "Total Companies"}
            </span>
            <span className="p-1.5 rounded-lg bg-[#EFE2CF] text-[#6B4932]">
              <IconBuilding />
            </span>
          </div>
          <p className="mt-3 text-2xl font-black text-[#18130F] [font-family:inherit]">
            {overviewState === "ready" && overview ? overview.companiesTotal : "—"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[#615244]">
            <span className="text-[#6B4932] font-bold">
              {overviewState === "ready" && overview ? overview.companiesActive : "—"} {isRtl ? "نشطة" : "active"}
            </span>
            <span>·</span>
            <span className="text-[#6B4932] font-bold">
              {overviewState === "ready" && overview ? overview.companiesSetup : "—"} {isRtl ? "إعداد" : "setup"}
            </span>
            {overview?.companiesSuspended ? (
              <>
                <span>·</span>
                <span className="text-[#8B3D29] font-bold">
                  {overview.companiesSuspended} {isRtl ? "معلقة" : "suspended"}
                </span>
              </>
            ) : null}
          </div>
        </div>

        {/* Card 2: Accounts & Admins */}
        <div className="relative rounded-2xl border border-[#D7C1A5] bg-[#FFFBF5] p-4 transition-all hover:border-[#6B4932] hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#18130F]">
              {isRtl ? "الحسابات والمستخدمين" : "Accounts & Users"}
            </span>
            <span className="p-1.5 rounded-lg bg-[#F7F0E5] text-[#6B4932]">
              <IconUsers />
            </span>
          </div>
          <p className="mt-3 text-2xl font-black text-[#18130F] [font-family:inherit]">
            {overviewState === "ready" && overview ? overview.accountsTotal : "—"}
          </p>
          <p className="mt-2 text-[11px] text-[#615244]">
            {isRtl ? "مستخدمين مسجلين في النظام" : "Registered user accounts"}
          </p>
        </div>

        {/* Card 3: Monthly Subscription Revenue */}
        <div className="relative rounded-2xl border border-[#D7C1A5] bg-[#FFFBF5] p-4 transition-all hover:border-[#6B4932] hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#18130F]">
              {isRtl ? "إجمالي التحصيل الموثق هذا الشهر" : "Proven gross collections this month"}
            </span>
            <span className="p-1.5 rounded-lg bg-[#EFE2CF] text-[#6B4932]">
              <IconCreditCard />
            </span>
          </div>
          <p className="mt-3 text-2xl font-black text-[#18130F] [font-family:inherit]" dir="ltr">
            <bdi>{truth?money(Number(truth.collections.live_collected_baisa)):"—"} OMR</bdi>
          </p>
          <p className="mt-2 text-[11px] text-[#6B4932] font-semibold">
            {isRtl ? "تحصيل Live قبل الاسترداد والرسوم، وليس صافي الإيراد؛ التجريبي منفصل" : "Live gross before refunds and fees, not net revenue; test payments are separate"}
          </p>
          <p className="mt-2 text-[11px] text-[#615244]">
            {truth ? (isRtl
              ? `طلبات النشاط المالي هذا الشهر: مستردة/معكوسة ${truth.collections.reversed_orders}، للمراجعة ${truth.collections.review_orders}، معلقة ${truth.collections.pending_orders}، فاشلة ${truth.collections.failed_orders}، غير محسومة ${truth.collections.unknown_orders}. قيمة الاسترداد وصافي الإيراد غير متاحين دون دليل تفصيلي.`
              : `Orders with financial activity this month: reversed ${truth.collections.reversed_orders}, review ${truth.collections.review_orders}, pending ${truth.collections.pending_orders}, failed ${truth.collections.failed_orders}, unknown ${truth.collections.unknown_orders}. Refund amount and net revenue are unavailable without detailed evidence.`)
              : truthLoading ? (isRtl ? "جارٍ تحديث الأدلة المالية…" : "Refreshing financial evidence…") : (isRtl ? "تعذّر التحقق من الأدلة المالية؛ لا يُعرض مبلغ تقديري." : "Financial evidence could not be verified; no estimated amount is displayed.")}
          </p>
        </div>

        {/* Card 4: AI Operating Cost */}
        <div className="relative rounded-2xl border border-[#D7C1A5] bg-[#FFFBF5] p-4 transition-all hover:border-[#8B3D29]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8B3D29]">
              {isRtl ? "استهلاك تجارب الذكاء المسجّل" : "Recorded administrative AI spend"}
            </span>
            <span className="p-1.5 rounded-lg bg-[#FFFBF5] text-[#8B3D29]">
              <IconSparkles />
            </span>
          </div>
          <p className="mt-3 text-2xl font-black text-[#8B3D29] [font-family:inherit]" dir="ltr">
            <bdi>{truth?.ai?money(Number(truth.ai.budget.spent_baisa)):"—"} OMR</bdi>
          </p>
          <p className="mt-2 text-[11px] text-[#8B3D29]">
            {isRtl ? "من سجل الاستهلاك الفعلي؛ لا يشمل المبالغ المحجوزة" : "From actual usage records; excludes held amounts"}
          </p>
        </div>

        {/* Card 5: Net Operating Margin */}
        <div className="relative rounded-2xl border border-[#D7C1A5] bg-[#EFE2CF] p-4 transition-all hover:border-[#6B4932] shadow-[0_4px_16px_rgba(107,73,50,0.06)]">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#6B4932]">
              {isRtl ? "مبلغ محجوز لتجارب الذكاء" : "Held trial funds"}
            </span>
            <span className="p-1.5 rounded-lg bg-[#EFE2CF] text-[#6B4932]">
              <IconRocket />
            </span>
          </div>
          <p className="mt-3 text-2xl font-black text-[#6B4932] [font-family:inherit]" dir="ltr">
            <bdi>{truth?.ai?money(Number(truth.ai.budget.held_baisa)):"—"} OMR</bdi>
          </p>
          <p className="mt-2 text-[11px] text-[#6B4932] font-bold">
            {isRtl ? "الحجز ليس مصروفًا مؤكدًا أو ربحًا" : "Held funds are not confirmed spend or profit"}
          </p>
        </div>
      </div>

      {overviewError?<Notice tone="error">{overviewError}</Notice>:null}

      {/* 🧭 Tab Navigation Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-[#D7C1A5] scrollbar-none">
        <button
          type="button"
          onClick={() => switchTab("overview")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition shrink-0 ${
            activeTab === "overview"
              ? "bg-[#D1AE7C] text-[#18130F] shadow-md shadow-[#6B4932]/20"
              : "text-[#18130F] hover:text-[#18130F] hover:bg-[#EFE2CF]"
          }`}
        >
          <IconDashboard />
          <span>{isRtl ? "الرئيسية والذكاء" : "Overview & AI"}</span>
        </button>

        <button
          type="button"
          onClick={() => switchTab("companies")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition shrink-0 ${
            activeTab === "companies"
              ? "bg-[#D1AE7C] text-[#18130F] shadow-md shadow-[#6B4932]/20"
              : "text-[#18130F] hover:text-[#18130F] hover:bg-[#EFE2CF]"
          }`}
        >
          <IconBuilding />
          <span>{isRtl ? "الشركات والعملاء" : "Companies"}</span>
          <span className="rounded-full bg-[#6B4932]/10 px-1.5 py-0.2 text-[10px] font-bold">
            {companiesState === "ready" ? filtered.length : "-"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => switchTab("accounts")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition shrink-0 ${
            activeTab === "accounts"
              ? "bg-[#D1AE7C] text-[#18130F] shadow-md shadow-[#6B4932]/20"
              : "text-[#18130F] hover:text-[#18130F] hover:bg-[#EFE2CF]"
          }`}
        >
          <IconUsers />
          <span>{isRtl ? "الحسابات والمستخدمين" : "Accounts"}</span>
        </button>

        <button
          type="button"
          onClick={() => switchTab("reviews")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition shrink-0 ${
            activeTab === "reviews"
              ? "bg-[#D1AE7C] text-[#18130F] shadow-md shadow-[#6B4932]/20"
              : "text-[#18130F] hover:text-[#18130F] hover:bg-[#EFE2CF]"
          }`}
        >
          <IconCheckCircle />
          <span>{isRtl ? "طلبات المراجعة" : "Reviews"}</span>
          {reviewPending.length > 0 && (
            <span className="rounded-full bg-[#D1AE7C] text-[#18130F] px-1.5 py-0.2 text-[10px] font-bold">
              {reviewPending.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => switchTab("ai")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition shrink-0 ${
            activeTab === "ai"
              ? "bg-[#D1AE7C] text-[#18130F] shadow-md shadow-[#6B4932]/20"
              : "text-[#18130F] hover:text-[#18130F] hover:bg-[#EFE2CF]"
          }`}
        >
          <IconSparkles />
          <span>{isRtl ? "مركز النماذج والتكاليف" : "AI Routing & Ledger"}</span>
        </button>

        <button
          type="button"
          onClick={() => switchTab("future")}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition shrink-0 ${
            activeTab === "future"
              ? "bg-[#D1AE7C] text-[#18130F] shadow-md shadow-[#6B4932]/20"
              : "text-[#18130F] hover:text-[#18130F] hover:bg-[#EFE2CF]"
          }`}
        >
          <IconRocket />
          <span>{isRtl ? "الميزات المستقبلية" : "Planned Modules"}</span>
          <span className="rounded-full bg-[#F7F0E5] text-[#6B4932] border border-[#D7C1A5] px-1.5 py-0.2 text-[10px] font-bold">
            {isRtl ? "قريباً" : "Soon"}
          </span>
        </button>
      </div>

      {/* Actual AI usage, matching the existing overview layout */}
      {activeTab === "overview" && <div id="overview"><AdminRealAISummary data={truth?.ai??null} ar={isRtl} loading={truthLoading}/></div>}

      {/* 🏢 TAB 2: COMPANIES / TENANTS */}
      {(activeTab === "companies" || activeTab === "overview") && (
        <section
          id="companies"
          tabIndex={-1}
          className="rounded-3xl border border-[#D7C1A5] bg-[#FFFBF5] p-5 sm:p-6 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D7C1A5] pb-4">
            <div>
              <h2 className="text-lg font-bold text-[#18130F]">{copy.admin.companiesTitle}</h2>
              <p className="mt-0.5 text-xs text-[#615244]">{copy.admin.companiesBody}</p>
            </div>
            <span className="rounded-full bg-[#F7F0E5] border border-[#D7C1A5] px-3 py-1 text-xs text-[#6B4932] font-semibold">
              {companiesState === "ready" ? `${fill(copy.admin.companiesTitle, { n: filtered.length })} (${filtered.length})` : "-"}
            </span>
          </div>

          {/* Search & Filter Form */}
          <form
            className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => load(search));
            }}
          >
            <div className="relative">
              <span className="absolute inset-y-0 start-0 flex items-center ps-3 text-[#615244] pointer-events-none">
                <IconSearch />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={copy.admin.search}
                className="min-h-11 w-full rounded-xl border border-[#D7C1A5] bg-[#F7F0E5] ps-9 pe-3 text-sm text-[#18130F] outline-none focus:border-[#6B4932] focus:ring-1 focus:ring-[#6B4932] transition placeholder:text-[#615244] font-medium"
              />
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "all" | CompanyStatus)}
              aria-label={copy.admin.statusFilter}
              className="min-h-11 rounded-xl border border-[#D7C1A5] bg-[#F7F0E5] px-3 text-sm text-[#18130F] outline-none focus:border-[#6B4932] font-medium"
            >
              <option value="all">{copy.admin.statusAll}</option>
              <option value="setup">{copy.admin.statusSetup}</option>
              <option value="active">{copy.admin.statusActive}</option>
              <option value="suspended">{copy.admin.statusSuspended}</option>
            </select>
            <Button type="submit" busy={busy} busyLabel={copy.loading}>
              {copy.admin.searchAction}
            </Button>
          </form>

          {/* Companies Load States */}
          {companiesState === "loading" && (
            <div className="py-8 text-center text-sm text-[#615244]">
              <span className="inline-block animate-spin me-2">⏳</span>
              {copy.loading}
            </div>
          )}

          {companiesState === "error" && (
            <div className="grid gap-3 py-4">
              <Notice tone="error">{error ?? copy.admin.companiesLoadFailed}</Notice>
              <Button
                type="button"
                variant="secondary"
                busy={busy}
                onClick={() => void run(() => load(search))}
              >
                {copy.admin.companiesRetry}
              </Button>
            </div>
          )}

          {/* Companies Table */}
          {companiesState === "ready" && (
            <div className="overflow-x-auto rounded-2xl border border-[#D7C1A5] bg-[#FFFBF5]">
              <table className="w-full text-start text-xs sm:text-sm">
                <thead className="border-b border-[#D7C1A5] bg-[#F7F0E5] text-[#18130F] font-bold">
                  <tr>
                    <th className="p-3.5 text-start">{isRtl ? "اسم الشركة / النشاط" : "Company"}</th>
                    <th className="p-3.5 text-start">{isRtl ? "الموقع" : "Location"}</th>
                    <th className="p-3.5 text-start">{isRtl ? "المالك / البريد" : "Owner"}</th>
                    <th className="p-3.5 text-center">{isRtl ? "الحالة" : "Status"}</th>
                    <th className="p-3.5 text-end">{isRtl ? "الإجراء" : "Action"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#D7C1A5]/60 text-[#18130F]">
                  {filtered.map((row) => (
                    <tr key={row.id} className="hover:bg-[#F7F0E5] transition">
                      <td className="p-3.5">
                        <Link
                          href={`/admin/companies/${row.id}`}
                          className="font-bold text-[#18130F] hover:text-[#6B4932] transition underline-offset-2 hover:underline block"
                        >
                          {row.display_name}
                        </Link>
                        <span className="text-xs text-[#615244]">{row.business_type}</span>
                      </td>
                      <td className="p-3.5 text-xs text-[#18130F]">
                        {row.city || row.country || "—"}
                      </td>
                      <td className="p-3.5 text-xs text-[#18130F]" dir="ltr">
                        {row.owner_email || "—"}
                      </td>
                      <td className="p-3.5 text-center">
                        <span
                          className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                            row.status === "active"
                              ? "bg-[#EFE2CF] text-[#6B4932] border-[#D7C1A5]"
                              : row.status === "setup"
                              ? "bg-[#F7F0E5] text-[#6B4932] border-[#D7C1A5]"
                              : "bg-[#FFFBF5] text-[#8B3D29] border-[#D7C1A5]"
                          }`}
                        >
                          {companyStatusLabel(row.status, copy)}
                        </span>
                      </td>
                      <td className="p-3.5 text-end">
                        <Link
                          href={`/admin/companies/${row.id}`}
                          className="inline-flex items-center gap-1 rounded-xl border border-[#D7C1A5] bg-[#F7F0E5] px-3 py-1 text-xs font-semibold text-[#18130F] hover:bg-[#D1AE7C] hover:text-[#18130F] hover:border-[#6B4932] transition"
                        >
                          <span>{isRtl ? "إدارة وتفاصيل" : "Manage"}</span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {!filtered.length && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-[#615244]">
                        {copy.admin.companiesEmpty}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* 👥 TAB 3: ACCOUNTS & USERS */}
      {(activeTab === "accounts" || activeTab === "overview") && (
        <section
          id="accounts"
          tabIndex={-1}
          className="rounded-3xl border border-[#D7C1A5] bg-[#FFFBF5] p-5 sm:p-6 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D7C1A5] pb-4">
            <div>
              <h2 className="text-lg font-bold text-[#18130F]">{copy.admin.accountsTitle}</h2>
              <p className="mt-0.5 text-xs text-[#615244]">{copy.admin.accountsBody}</p>
            </div>
            <span className="text-xs font-semibold text-[#6B4932]">
              {resultsMatchInput && accountRows.length > 0
                ? `${accountRows.length} ${isRtl ? "حسابات محملة" : "loaded"}`
                : ""}
            </span>
          </div>

          {/* Search Account input */}
          <div className="relative">
            <span className="absolute inset-y-0 start-0 flex items-center ps-3 text-[#6B4932] pointer-events-none">
              <IconSearch />
            </span>
            <input
              value={accountQuery}
              onChange={(e) => onAccountQueryChange(e.target.value)}
              placeholder={copy.admin.accountSearch}
              className="min-h-11 w-full rounded-xl border border-[#D7C1A5] bg-[#F7F0E5] ps-9 pe-3 text-sm font-medium text-[#18130F] outline-none focus:border-[#6B4932] focus:bg-[#FFFBF5] focus:ring-1 focus:ring-[#6B4932] transition placeholder:text-[#615244]"
            />
          </div>

          {/* Account Load / Search states */}
          {(accountsState === "loading" || accountBusy) && (
            <p className="text-xs font-medium text-[#615244] flex items-center gap-2">
              <span className="animate-spin">⏳</span> {copy.loading}
            </p>
          )}

          {accountError && requestMatchesInput && (
            <div className="grid gap-2">
              <Notice tone="error">{accountError}</Notice>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const gen = ++accountsGen.current;
                  void loadAccounts(inputAccountQuery, 0, gen);
                }}
              >
                {copy.admin.companiesRetry}
              </Button>
            </div>
          )}

          {legacyBrowseLikely && (
            <p className="text-xs text-[#615244]">{copy.admin.accountsBrowseHint}</p>
          )}

          {resultsMatchInput && accountOffsetCapped && (
            <p className="text-xs text-[#615244]">
              {fill(copy.admin.accountsOffsetCap, { n: ADMIN_ACCOUNT_SEARCH_MAX_OFFSET })}
            </p>
          )}

          {/* Accounts List / Cards */}
          <div className="grid gap-2.5">
            {resultsMatchInput &&
              accountRows.map((row) => (
                <div
                  key={row.user_id}
                  className="rounded-2xl border border-[#D7C1A5] bg-[#F7F0E5] p-4 transition hover:border-[#6B4932]/40 hover:bg-[#FFFBF5] hover:shadow-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <strong className="block text-sm font-bold text-[#18130F] break-words">
                        {row.full_name || copy.admin.accountFieldUnavailable}
                      </strong>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        <span className="[font-family:inherit] font-semibold text-[#6B4932] bg-[#EFE2CF] px-2 py-0.5 rounded-md border border-[#D7C1A5]">
                          {row.support_code || copy.admin.accountFieldUnavailable}
                        </span>
                        <span className="text-[#18130F] font-medium" dir="ltr">
                          {row.email || "—"}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            row.email_confirmed
                              ? "bg-[#EFE2CF] text-[#6B4932] border border-[#D7C1A5]"
                              : "bg-[#F7F0E5] text-[#6B4932] border border-[#D7C1A5]"
                          }`}
                        >
                          {emailConfirmLabel(row.email_confirmed, copy)}
                        </span>
                      </div>
                      {row.account_phone && (
                        <p className="mt-1 text-xs text-[#615244]" dir="ltr">
                          {copy.admin.accountPhone}: {row.account_phone}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Associated Companies List */}
                  <div className="mt-3 pt-3 border-t border-[#D7C1A5]">
                    <p className="text-[11px] font-bold text-[#6B4932] mb-1.5">
                      {isRtl ? "الشركات التابعة:" : "Memberships:"}
                    </p>
                    {row.companies.length ? (
                      <div className="flex flex-wrap gap-2">
                        {row.companies.map((c) => (
                          <div
                            key={`${row.user_id}-${c.company_id}`}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-[#D7C1A5] bg-[#FFFBF5] px-2.5 py-1 text-xs shadow-2xs"
                          >
                            <Link
                              href={`/admin/companies/${c.company_id}`}
                              className="font-bold text-[#6B4932] hover:underline"
                            >
                              {c.display_name}
                            </Link>
                            <span className="text-[#615244]">·</span>
                            <span className="text-[#18130F] font-medium">{c.role}</span>
                            <span className="text-[#615244]">·</span>
                            <span className="text-[#615244]">
                              {companyStatusLabel(c.company_status ?? null, copy)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-[#615244]">{copy.admin.noCompaniesYet}</p>
                    )}
                  </div>
                </div>
              ))}

            {resultsMatchInput &&
              !accountBusy &&
              !accountRows.length &&
              !accountError &&
              !legacyBrowseLikely && (
                <div className="py-8 text-center text-sm font-medium text-[#615244]">
                  {copy.admin.accountSearchEmpty}
                </div>
              )}
          </div>

          {/* Pagination Controls */}
          {resultsMatchInput && (accountOffset > 0 || accountHasMore) && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#D7C1A5]">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={accountBusy || accountOffset <= 0}
                  onClick={() =>
                    loadAccountPage(Math.max(0, accountOffset - ACCOUNT_PAGE_SIZE))
                  }
                >
                  {copy.admin.accountPrev}
                </Button>
                <Button
                  variant="secondary"
                  disabled={accountBusy || !accountHasMore}
                  onClick={() => loadAccountPage(accountOffset + ACCOUNT_PAGE_SIZE)}
                >
                  {copy.admin.accountNext}
                </Button>
              </div>
              <span className="text-xs font-semibold text-[#615244]">
                {fill(copy.admin.accountPage, { n: pageNumber })}
              </span>
            </div>
          )}
        </section>
      )}

      {/* 📋 TAB 4: REVIEWS & APPROVALS */}
      {(activeTab === "reviews" || activeTab === "overview") && (
        <section
          id="reviews"
          tabIndex={-1}
          className="rounded-3xl border border-[#D7C1A5] bg-[#FFFBF5] p-5 sm:p-6 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D7C1A5] pb-4">
            <div>
              <h2 className="text-lg font-bold text-[#18130F]">{copy.admin.navReviews}</h2>
              <p className="mt-0.5 text-xs text-[#615244]">
                {isRtl
                  ? "شركات تنتظر مراجعة بيانات الإعداد وتوثيق المعرفة وربط واتساب"
                  : "Tenants awaiting onboarding approval and knowledge review"}
              </p>
            </div>
            {reviewPending.length > 0 && (
              <span className="rounded-full bg-[#F7F0E5] text-[#6B4932] border border-[#D7C1A5] px-2.5 py-0.5 text-xs font-bold">
                {reviewPending.length} {isRtl ? "قيد الانتظار" : "Pending"}
              </span>
            )}
          </div>

          {companiesState === "loading" && (
            <p className="text-sm font-medium text-[#615244]">{copy.loading}</p>
          )}

          {companiesState === "error" && (
            <div className="grid gap-3">
              <Notice tone="error">{copy.admin.reviewsLoadBlocked}</Notice>
              <Button
                type="button"
                variant="secondary"
                busy={busy}
                onClick={() => void run(() => load(search))}
              >
                {copy.admin.companiesRetry}
              </Button>
            </div>
          )}

          {companiesState === "ready" && (
            <div className="grid gap-2.5">
              {reviewPending.map((row) => (
                <div
                  key={`review-${row.id}`}
                  className="flex items-center justify-between p-4 rounded-2xl border border-[#D7C1A5] bg-[#F7F0E5]/60 transition hover:bg-[#F7F0E5] hover:shadow-xs"
                >
                  <div>
                    <Link
                      href={`/admin/companies/${row.id}`}
                      className="text-base font-bold text-[#18130F] hover:text-[#6B4932] transition"
                    >
                      {row.display_name}
                    </Link>
                    {row.review_revision != null && (
                      <span className="ms-2 rounded-md bg-[#F7F0E5] px-1.5 py-0.5 text-xs [font-family:inherit] font-medium text-[#6B4932] border border-[#D7C1A5]">
                        r{row.review_revision}
                      </span>
                    )}
                    <p className="mt-1 text-xs text-[#615244]">
                      {row.business_type} · {row.owner_email || "—"}
                    </p>
                  </div>
                  <Link
                    href={`/admin/companies/${row.id}`}
                    className="rounded-xl bg-[#D1AE7C] px-3.5 py-1.5 text-xs font-bold text-[#18130F] hover:bg-[#EFE2CF] transition shadow-xs"
                  >
                    {isRtl ? "مراجعة واعتماد" : "Review & Approve"}
                  </Link>
                </div>
              ))}

              {!reviewPending.length && (
                <div className="py-6 text-center text-sm font-medium text-[#615244]">
                  {copy.admin.reviewsEmpty}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {activeTab === "ai" && <section id="ai"><AdminRealAISummary data={truth?.ai??null} ar={isRtl} loading={truthLoading}/></section>}

      {/* 🚀 TAB 6: FUTURE ENTERPRISE ROADMAP */}
      {(activeTab === "future" || activeTab === "overview") && (
        <section
          id="future"
          tabIndex={-1}
          className="rounded-3xl border border-[#D7C1A5] bg-[#FFFBF5] p-5 sm:p-6 shadow-sm space-y-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D7C1A5] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[#F7F0E5] text-[#6B4932] border border-[#D7C1A5] px-2.5 py-0.5 text-xs font-bold">
                  {isRtl ? "خارطة الطريق المؤسسية" : "Enterprise Roadmap"}
                </span>
                <span className="text-xs font-medium text-[#615244]">Planned / UI-Ready</span>
              </div>
              <h2 className="mt-1 text-lg font-bold text-[#18130F]">
                {isRtl ? "الميزات والوحدات المستقبلية لمنصة فيلورا" : "Planned SaaS Modules"}
              </h2>
              <p className="mt-0.5 text-xs text-[#615244]">
                {isRtl
                  ? "واجهات مجهزة ومجدولة للتطوير المستقبلي — لا تؤثر على النظام الحالي أو قاعدة البيانات"
                  : "Pre-designed architecture for upcoming phases without impacting live databases"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Module 1: AI Business Team */}
            <div className="rounded-2xl border border-[#D7C1A5] bg-[#F7F0E5] p-5 space-y-3 relative overflow-hidden group hover:bg-[#FFFBF5] hover:border-[#6B4932]/40 hover:shadow-xs transition">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EFE2CF] border border-[#D7C1A5] text-lg">
                  👥
                </span>
                <span className="rounded-full bg-[#F7F0E5] text-[#6B4932] border border-[#D7C1A5] px-2 py-0.5 text-[10px] font-bold">
                  {isRtl ? "قريباً" : "Planned"}
                </span>
              </div>
              <h3 className="text-base font-bold text-[#18130F]">
                {isRtl ? "فريق العمل الذكي (AI Business Team)" : "AI Business Team"}
              </h3>
              <p className="text-xs text-[#615244] leading-relaxed">
                {isRtl
                  ? "تمكين الشخصيات الثلاث (دانة، لينا، نورا) لتوزيع مهام خدمة العملاء والتسويق والدعم الفني بشكل متكامل."
                  : "Collaborative multi-agent workflows featuring Dana, Lina, and Noura for business operations."}
              </p>
              <div className="pt-2 text-[11px] font-medium text-[#615244]">
                {isRtl ? "الواجهة جاهزة · التكامل البرمجي في المرحلة 2" : "UI Ready · Phase 2 Integration"}
              </div>
            </div>

            {/* Module 2: AI Accountant for SMEs */}
            <div className="rounded-2xl border border-[#D7C1A5] bg-[#F7F0E5] p-5 space-y-3 relative overflow-hidden group hover:bg-[#FFFBF5] hover:border-[#6B4932]/40 hover:shadow-xs transition">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EFE2CF] border border-[#D7C1A5] text-lg">
                  📊
                </span>
                <span className="rounded-full bg-[#F7F0E5] text-[#6B4932] border border-[#D7C1A5] px-2 py-0.5 text-[10px] font-bold">
                  {isRtl ? "قريباً" : "Planned"}
                </span>
              </div>
              <h3 className="text-base font-bold text-[#18130F]">
                {isRtl ? "المحاسب الذكي للمؤسسات (AI Accountant)" : "AI Accountant for SMEs"}
              </h3>
              <p className="text-xs text-[#615244] leading-relaxed">
                {isRtl
                  ? "إدارة الفواتير والقيود المحاسبية، حساب هوامش الأرباح التلقائية، وربط المصاريف التشغيلية للمتاجر."
                  : "Automated ledger balancing, invoice parsing, and tax summaries for small enterprises."}
              </p>
              <div className="pt-2 text-[11px] font-medium text-[#615244]">
                {isRtl ? "الواجهة جاهزة · التكامل البرمجي في المرحلة 2" : "UI Ready · Phase 2 Integration"}
              </div>
            </div>

            {/* Module 3: Inventory Assistant */}
            <div className="rounded-2xl border border-[#D7C1A5] bg-[#F7F0E5] p-5 space-y-3 relative overflow-hidden group hover:bg-[#FFFBF5] hover:border-[#6B4932]/40 hover:shadow-xs transition">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EFE2CF] border border-[#D7C1A5] text-lg">
                  📦
                </span>
                <span className="rounded-full bg-[#F7F0E5] text-[#6B4932] border border-[#D7C1A5] px-2 py-0.5 text-[10px] font-bold">
                  {isRtl ? "قريباً" : "Planned"}
                </span>
              </div>
              <h3 className="text-base font-bold text-[#18130F]">
                {isRtl ? "مساعد إدارة المخزون (Inventory Assistant)" : "Inventory Assistant"}
              </h3>
              <p className="text-xs text-[#615244] leading-relaxed">
                {isRtl
                  ? "مزامنة لحظية لكميات المنتجات، تنبيهات النواقص التلقائية، وربط كتالوج المبيعات مع ردود المساعد."
                  : "Real-time stock level synchronization, low-stock alerts, and auto-catalog answers."}
              </p>
              <div className="pt-2 text-[11px] font-medium text-[#615244]">
                {isRtl ? "الواجهة جاهزة · التكامل البرمجي في المرحلة 2" : "UI Ready · Phase 2 Integration"}
              </div>
            </div>

            {/* Module 4: AI Sales Analytics */}
            <div className="rounded-2xl border border-[#D7C1A5] bg-[#F7F0E5] p-5 space-y-3 relative overflow-hidden group hover:bg-[#FFFBF5] hover:border-[#6B4932]/40 hover:shadow-xs transition">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F7F0E5] border border-[#D7C1A5] text-lg">
                  📈
                </span>
                <span className="rounded-full bg-[#F7F0E5] text-[#6B4932] border border-[#D7C1A5] px-2 py-0.5 text-[10px] font-bold">
                  {isRtl ? "قريباً" : "Planned"}
                </span>
              </div>
              <h3 className="text-base font-bold text-[#18130F]">
                {isRtl ? "تحليلات المبيعات ونسب التحويل (Sales Analytics)" : "AI Sales Analytics"}
              </h3>
              <p className="text-xs text-[#615244] leading-relaxed">
                {isRtl
                  ? "تحليل معدل تحويل المحادثات إلى طلبات شراء ناجحة، واكتشاف المنتجات الأكثر طلباً في كل شركة."
                  : "Conversation-to-conversion analytics and customer sentiment heatmaps."}
              </p>
              <div className="pt-2 text-[11px] font-medium text-[#615244]">
                {isRtl ? "الواجهة جاهزة · التكامل البرمجي في المرحلة 2" : "UI Ready · Phase 2 Integration"}
              </div>
            </div>

            {/* Module 5: Automation Center */}
            <div className="rounded-2xl border border-[#D7C1A5] bg-[#F7F0E5] p-5 space-y-3 relative overflow-hidden group hover:bg-[#FFFBF5] hover:border-[#6B4932]/40 hover:shadow-xs transition">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EFE2CF] border border-[#D7C1A5] text-lg">
                  ⚙️
                </span>
                <span className="rounded-full bg-[#F7F0E5] text-[#6B4932] border border-[#D7C1A5] px-2 py-0.5 text-[10px] font-bold">
                  {isRtl ? "قريباً" : "Planned"}
                </span>
              </div>
              <h3 className="text-base font-bold text-[#18130F]">
                {isRtl ? "مركز الأتمتة والربط السحابي (Automation Center)" : "Automation Center"}
              </h3>
              <p className="text-xs text-[#615244] leading-relaxed">
                {isRtl
                  ? "بناء مسارات أتمتة تلقائية مع Webhooks ومنصات التجارة مثل سلة وزد وShopify."
                  : "Webhook triggers, Zapier-like connectors, and automated multichannel dispatch."}
              </p>
              <div className="pt-2 text-[11px] font-medium text-[#615244]">
                {isRtl ? "الواجهة جاهزة · التكامل البرمجي في المرحلة 2" : "UI Ready · Phase 2 Integration"}
              </div>
            </div>

            {/* Module 6: Model Evaluator */}
            <div className="rounded-2xl border border-[#D7C1A5] bg-[#F7F0E5] p-5 space-y-3 relative overflow-hidden group hover:bg-[#FFFBF5] hover:border-[#6B4932]/40 hover:shadow-xs transition">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EFE2CF] border border-[#D7C1A5] text-lg">
                  🔬
                </span>
                <span className="rounded-full bg-[#F7F0E5] text-[#6B4932] border border-[#D7C1A5] px-2 py-0.5 text-[10px] font-bold">
                  {isRtl ? "قريباً" : "Planned"}
                </span>
              </div>
              <h3 className="text-base font-bold text-[#18130F]">
                {isRtl ? "مقارنة أداء النماذج (Model Performance)" : "Model Benchmark Evaluator"}
              </h3>
              <p className="text-xs text-[#615244] leading-relaxed">
                {isRtl
                  ? "لوحة مقارنة تفصيلية لزمن استجابة النماذج، ودقة الفهم، والتكلفة الفعلية لكل مليون توكن."
                  : "Real-time latency, hallucination rate, and cost efficiency across Luna, Sol, and Gemini."}
              </p>
              <div className="pt-2 text-[11px] font-medium text-[#615244]">
                {isRtl ? "الواجهة جاهزة · التكامل البرمجي في المرحلة 2" : "UI Ready · Phase 2 Integration"}
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
