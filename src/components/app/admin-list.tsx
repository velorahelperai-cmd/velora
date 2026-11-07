"use client";

import { useDemo } from "@/lib/demo-state";
import overviewStyles from "./admin-overview.module.css";
import Link from "next/link";
import {adminCompanyHref,companyListReturnHref,type CompanyListFilters} from "./admin-company-navigation";
import { BentoCard, FiveRowGrid } from "@/components/app/magic-ui";
import { broadSectorLabel, broadSectors, preservedDetailedTypeLabel } from "@/lib/business-sectors";
import {AdminRealAISummary} from "@/components/admin/admin-real-ai-summary";
import {readAdminTruth,type AdminTruth} from "@/lib/answers/runtime/admin-truth";
import { useEffect, useRef, useState } from "react";
import { Button, Notice, useAction, useAppCopy } from "@/components/app/ui";
import { fill, type AppCopy } from "@/lib/app-copy";
import {
  adminGetOverviewStats,
  adminListCompaniesPage,
  adminListPendingReviewsPage,
} from "@/lib/tenancy/actions";
import type {
  AccessCode,
  AdminCompanyListItem,
  AdminOverviewStats,
  CompanyStatus,
} from "@/lib/tenancy/types";
import {
  IconRefresh,
  IconSearch,
} from "@/components/admin/admin-icons";

const ADMIN_SECTION_IDS = [
  "overview",
  "companies",
  "reviews",
  "future",
] as const;

type AdminTab = (typeof ADMIN_SECTION_IDS)[number];
type CompaniesLoadState = "loading" | "ready" | "error";
type OverviewState = "loading" | "ready" | "error" | "dependency";

function companyStatusLabel(status: CompanyStatus | null | undefined, copy: AppCopy): string {
  if (status === "setup") return copy.admin.statusSetup;
  if (status === "active") return copy.admin.statusActive;
  if (status === "suspended") return copy.admin.statusSuspended;
  return status ?? "—";
}

function formatCompanyBusinessType(type: string | undefined | null, isRtl: boolean): string {
  if (!type || !type.trim()) return isRtl ? "نشاط عام" : "General";
  const broad = broadSectorLabel(type, isRtl);
  if (broad) return broad;
  const detailed = preservedDetailedTypeLabel(type, isRtl);
  if (detailed) return detailed;
  const clean = type.replace(/^broad:/, "");
  const match = broadSectors.find((s) => s.id === clean);
  if (match) return isRtl ? match.ar : match.en;
  return clean;
}

function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center shrink-0">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={text}
        className="p-1 -m-1 rounded-full text-[var(--service-muted)] hover:text-[var(--service-accent)] hover:bg-[var(--service-accent-soft)] transition-colors focus:outline-none"
      >
        <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70 hover:opacity-100">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      {open ? (
        <div
          role="tooltip"
          className="absolute z-50 top-full mt-2 start-0 w-64 max-w-xs rounded-xl bg-[#0f172a] text-white p-2.5 text-xs shadow-2xl leading-relaxed text-start pointer-events-none border border-slate-700/60"
        >
          {text}
          <div className="absolute bottom-full start-2 border-4 border-transparent border-b-[#0f172a]" />
        </div>
      ) : null}
    </div>
  );
}

function RealisticCardIcon() {
  return (
    <svg width="24" height="17" viewBox="0 0 26 18" fill="none" className="shrink-0" aria-hidden="true">
      <rect width="26" height="18" rx="3" fill="url(#cardBg)" />
      <rect y="3" width="26" height="3" fill="#18181b" fillOpacity="0.85" />
      <rect x="3" y="8" width="5" height="4" rx="1" fill="url(#chipGold)" />
      <line x1="3" y1="10" x2="8" y2="10" stroke="#92400e" strokeWidth="0.5" />
      <line x1="5.5" y1="8" x2="5.5" y2="12" stroke="#92400e" strokeWidth="0.5" />
      <circle cx="21" cy="13" r="2" fill="#d97706" fillOpacity="0.85" />
      <circle cx="19" cy="13" r="2" fill="#f59e0b" fillOpacity="0.85" />
      <defs>
        <linearGradient id="cardBg" x1="0" y1="0" x2="26" y2="18" gradientUnits="userSpaceOnUse">
          <stop stopColor="#292524" />
          <stop offset="1" stopColor="#18181b" />
        </linearGradient>
        <linearGradient id="chipGold" x1="3" y1="8" x2="8" y2="12" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fef08a" />
          <stop offset="1" stopColor="#d97706" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function RealisticBuildingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="1.5" fill="url(#towerBody)" stroke="#78716c" strokeWidth="0.8" />
      <rect x="7" y="6" width="2" height="2" rx="0.4" fill="#fbbf24" />
      <rect x="11" y="6" width="2" height="2" rx="0.4" fill="#fef08a" />
      <rect x="15" y="6" width="2" height="2" rx="0.4" fill="#fbbf24" />
      <rect x="7" y="10" width="2" height="2" rx="0.4" fill="#fef08a" />
      <rect x="11" y="10" width="2" height="2" rx="0.4" fill="#fbbf24" />
      <rect x="15" y="10" width="2" height="2" rx="0.4" fill="#fef08a" />
      <rect x="7" y="14" width="2" height="2" rx="0.4" fill="#fbbf24" />
      <rect x="11" y="14" width="2" height="2" rx="0.4" fill="#fef08a" />
      <rect x="15" y="14" width="2" height="2" rx="0.4" fill="#fbbf24" />
      <rect x="10" y="18" width="4" height="3" rx="0.4" fill="#18181b" />
      <line x1="12" y1="1" x2="12" y2="3" stroke="#a8a29e" strokeWidth="1" strokeLinecap="round" />
      <defs>
        <linearGradient id="towerBody" x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#44403c" />
          <stop offset="1" stopColor="#18181b" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function RealisticUsersIcon() {
  return (
    <svg width="22" height="20" viewBox="0 0 26 22" fill="none" className="shrink-0" aria-hidden="true">
      <circle cx="17" cy="7" r="4" fill="#a8a29e" />
      <path d="M12 18 C 12 14.5, 14 13, 17 13 C 20 13, 22 14.5, 22 18" fill="#e7e5e4" />
      <circle cx="9" cy="8" r="4.5" fill="#d97706" />
      <path d="M3 20 C 3 16, 5.5 14, 9 14 C 12.5 14, 15 16, 15 20" fill="url(#primaryUserGrad)" />
      <defs>
        <linearGradient id="primaryUserGrad" x1="3" y1="14" x2="15" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d97706" />
          <stop offset="1" stopColor="#92400e" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function RealisticChipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
      <line x1="3" y1="7" x2="1" y2="7" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="3" y1="12" x2="1" y2="12" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="3" y1="17" x2="1" y2="17" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="21" y1="7" x2="23" y2="7" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="21" y1="12" x2="23" y2="12" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="21" y1="17" x2="23" y2="17" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="7" y1="3" x2="7" y2="1" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="12" y1="3" x2="12" y2="1" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="17" y1="3" x2="17" y2="1" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="7" y1="21" x2="7" y2="23" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="12" y1="21" x2="12" y2="23" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="17" y1="21" x2="17" y2="23" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#1c1917" stroke="#78716c" strokeWidth="0.8" />
      <rect x="7" y="7" width="10" height="10" rx="1" fill="url(#coreGradient)" />
      <text x="12" y="14" fill="#ffffff" fontSize="6" fontWeight="bold" textAnchor="middle" fontFamily="sans-serif">AI</text>
      <defs>
        <linearGradient id="coreGradient" x1="7" y1="7" x2="17" y2="17" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f59e0b" />
          <stop offset="1" stopColor="#b45309" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function RealisticRocketIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
      <path d="M6 18 Q 4 21, 5 23 Q 7 21, 8 19 Z" fill="url(#flameGrad)" />
      <path d="M5 14 L 2 17 L 6 17 Z" fill="#b45309" />
      <path d="M12 7 L 15 10 L 15 6 Z" fill="#b45309" />
      <path d="M19 4 C 19 4, 15 3, 11 7 C 8 10, 7 14, 7 15 L 11 19 C 12 19, 16 18, 19 15 C 23 11, 22 7, 22 7 Z" fill="url(#rocketBody)" />
      <circle cx="15.5" cy="10.5" r="2" fill="#fef08a" stroke="#ffffff" strokeWidth="0.8" />
      <defs>
        <linearGradient id="rocketBody" x1="19" y1="4" x2="7" y2="17" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d97706" />
          <stop offset="1" stopColor="#92400e" />
        </linearGradient>
        <linearGradient id="flameGrad" x1="6" y1="18" x2="5" y2="23" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fbbf24" />
          <stop offset="1" stopColor="#ef4444" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function BarVolumeChart({
  settled = 0,
  review = 0,
  pending = 0,
  failed = 0,
  reversed = 0,
  color = "#10b981",
}: {
  settled?: number;
  review?: number;
  pending?: number;
  failed?: number;
  reversed?: number;
  color?: string;
}) {
  const values = [settled, review, pending, failed, reversed];
  const max = Math.max(...values, 1);
  const total = settled + review + pending + failed + reversed;

  return (
    <div className="flex flex-col items-end gap-0.5 shrink-0" aria-hidden="true" title={`ناجحة: ${settled}، مراجعة: ${review}، معلقة: ${pending}، فاشلة: ${failed}، مستردة: ${reversed}`}>
      <div className="h-5 w-14 sm:w-16 flex items-end justify-between gap-1">
        {values.map((v, i) => {
          const heightPct = total === 0 ? 15 : Math.max(15, Math.round((v / max) * 100));
          const isHighest = v === max && total > 0;
          return (
            <span
              key={i}
              className="w-1.5 rounded-t-xs transition-all"
              style={{
                height: `${heightPct}%`,
                background: isHighest ? color : `${color}60`,
              }}
            />
          );
        })}
      </div>
      <span className="text-[8px] font-bold text-[var(--service-muted)]">
        {total} {total === 1 ? "طلب" : "طلبات"}
      </span>
    </div>
  );
}

function SegmentRatioBar({
  active = 0,
  setup = 0,
  suspended = 0,
  total = 0,
}: {
  active?: number;
  setup?: number;
  suspended?: number;
  total?: number;
}) {
  const sum = total || (active + setup + suspended) || 1;
  const activePct = Math.round((active / sum) * 100);
  const setupPct = Math.round((setup / sum) * 100);
  const suspendedPct = Math.max(0, 100 - activePct - setupPct);

  return (
    <div className="w-16 sm:w-20 shrink-0 flex flex-col gap-0.5 justify-center" aria-hidden="true">
      <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden flex">
        {activePct > 0 && (
          <div style={{ width: `${activePct}%` }} className="bg-amber-600 transition-all" />
        )}
        {setupPct > 0 && (
          <div style={{ width: `${setupPct}%` }} className="bg-slate-400 transition-all" />
        )}
        {suspendedPct > 0 && (
          <div style={{ width: `${suspendedPct}%` }} className="bg-red-500 transition-all" />
        )}
      </div>
      <div className="flex justify-between text-[8px] text-[var(--service-muted)] font-bold">
        <span>{activePct}% نشطة</span>
        <span>{setupPct}% إعداد</span>
      </div>
    </div>
  );
}

function ActivityMatrixPips({
  total = 0,
  unassigned = 0,
  withoutActive = 0,
  color = "#d97706",
}: {
  total?: number;
  unassigned?: number;
  withoutActive?: number;
  color?: string;
}) {
  const displayCount = Math.min(10, Math.max(1, total));
  const activeCount = Math.max(0, total - withoutActive);
  const activeRatio = total > 0 ? activeCount / total : 1;
  const activeDisplayPips = Math.round(displayCount * activeRatio);

  return (
    <div className="w-16 sm:w-20 shrink-0 flex flex-col gap-0.5 justify-center" aria-hidden="true">
      <div className="flex flex-wrap gap-1 justify-end max-w-full">
        {Array.from({ length: displayCount }).map((_, i) => {
          const isActive = i < activeDisplayPips;
          return (
            <span
              key={i}
              className="h-2 w-2 rounded-full transition-all"
              style={{
                backgroundColor: isActive ? color : "var(--service-line)",
                opacity: isActive ? 1 : 0.5,
              }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[8px] text-[var(--service-muted)] font-bold">
        <span>{activeCount} نشط</span>
        <span>{unassigned} متاح</span>
      </div>
    </div>
  );
}

function SteppedAreaChart({
  models = [],
  color = "#d97706",
  id = "aispend",
}: {
  models?: Array<{ model_id: string; cost_baisa: number; attempts: number }>;
  color?: string;
  id?: string;
}) {
  const costs = models.map((m) => Number(m.cost_baisa || 0));
  const totalCost = costs.reduce((a, b) => a + b, 0);

  let path = "M 0 20 L 100 20";
  if (totalCost > 0 && costs.length > 0) {
    let cum = 0;
    const points: Array<[number, number]> = [[0, 20]];
    models.forEach((m, idx) => {
      cum += Number(m.cost_baisa || 0);
      const x = Math.round(((idx + 1) / models.length) * 100);
      const y = Math.max(4, Math.round(20 - (cum / totalCost) * 16));
      points.push([x, y]);
    });
    path = `M 0 20 L ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      path += ` L ${curr[0]} ${prev[1]} L ${curr[0]} ${curr[1]}`;
    }
  }

  const totalAttempts = models.reduce((a, b) => a + Number(b.attempts || 0), 0);

  return (
    <div className="flex flex-col items-end gap-0.5 shrink-0" aria-hidden="true">
      <div className="h-5 w-14 sm:w-16 overflow-hidden">
        <svg viewBox="0 0 100 22" fill="none" className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={color} stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <path d={`${path} L 100 22 L 0 22 Z`} fill={`url(#grad-${id})`} />
          <path d={path} stroke={color} strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter" />
        </svg>
      </div>
      <span className="text-[8px] font-bold text-[var(--service-muted)]">
        {totalAttempts} {totalAttempts === 1 ? "محاولة" : "محاولات"}
      </span>
    </div>
  );
}

function RadialMeterRing({
  heldBaisa = 0,
  limitBaisa = 0,
  spentBaisa = 0,
  color = "#d97706",
}: {
  heldBaisa?: number;
  limitBaisa?: number;
  spentBaisa?: number;
  color?: string;
}) {
  const percent = limitBaisa > 0
    ? Math.min(100, Math.max(0, Math.round((heldBaisa / limitBaisa) * 100)))
    : (heldBaisa + spentBaisa) > 0
    ? Math.min(100, Math.max(0, Math.round((heldBaisa / (heldBaisa + spentBaisa)) * 100)))
    : 0;

  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
      <div className="h-6 w-6 relative flex items-center justify-center">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r={radius} stroke="#e2e8f0" strokeWidth="2.2" fill="none" />
          <circle
            cx="12"
            cy="12"
            r={radius}
            stroke={color}
            strokeWidth="2.2"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="none"
            className="transition-all duration-500"
          />
        </svg>
        <span className="absolute text-[7px] font-black text-[var(--service-ink)]">
          {percent}%
        </span>
      </div>
      <div className="text-[8px] leading-tight text-[var(--service-muted)] font-semibold">
        <span>من السقف</span>
      </div>
    </div>
  );
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
  initialCompanyFilters = {search:"",status:"all"},
}: {
  initialOverview?: AdminOverviewStats | null;
  overviewUnavailable?: { code: AccessCode | "AUTH_ERROR"; message: string | null } | null;
  initialTruth?: AdminTruth | null;
  initialCompanyFilters?: CompanyListFilters;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const { busy, run } = useAction();
  const [activeTab, setActiveTab] = useState<AdminTab>(() => {
    if (overviewUnavailable) return "companies";
    return "overview";
  });
  const [search, setSearch] = useState(initialCompanyFilters.search);
  const [appliedCompanySearch,setAppliedCompanySearch]=useState(initialCompanyFilters.search);
  const [status, setStatus] = useState<"all" | CompanyStatus>(initialCompanyFilters.status);
  const [rows, setRows] = useState<AdminCompanyListItem[]>([]);
  const [companyOffset, setCompanyOffset] = useState(0);
  const [companyTotalCount, setCompanyTotalCount] = useState<number | null>(null);
  const [companyHasMore, setCompanyHasMore] = useState(false);
  const COMPANY_PAGE_SIZE = 25;
  const [companiesState, setCompaniesState] = useState<CompaniesLoadState>("loading");
  const [error, setError] = useState<string | null>(null);

  const [trackedOverviewProps, setTrackedOverviewProps] = useState(() => ({
    overview: initialOverview,
    unavailable: overviewUnavailable,
  }));
  const [clientOverview, setClientOverview] = useState<{
    state: OverviewState;
    data: AdminOverviewStats | null;
    error: string | null;
  } | null>(null);

  const companiesGen = useRef(0);
  const overviewGen = useRef(0);
  const reviewsGen = useRef(0);
  const [pendingReviews, setPendingReviews] = useState<AdminCompanyListItem[]>([]);
  const [reviewsState, setReviewsState] = useState<"loading" | "ready" | "error">("loading");
  const [reviewsOffset, setReviewsOffset] = useState(0);
  const [reviewsTotal, setReviewsTotal] = useState<number | null>(null);
  const [reviewsHasMore, setReviewsHasMore] = useState(false);
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
  const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    }).format(value / 1000);

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

  async function load(q = search, st = status, offset = companyOffset) {
    const gen = ++companiesGen.current;
    setError(null);
    setCompaniesState("loading");
    try {
      const result = await adminListCompaniesPage({
        search: q,
        status: st,
        limit: COMPANY_PAGE_SIZE,
        offset,
      });
      if (gen !== companiesGen.current) return;
      if (!result.ok) {
        setError(result.message ?? copy.admin.companiesLoadFailed);
        setCompaniesState("error");
        return;
      }
      setRows(result.data.rows);
      setCompanyTotalCount(result.data.totalCount);
      setCompanyOffset(result.data.offset);
      setCompanyHasMore(result.data.hasMore);
      setAppliedCompanySearch(q);
      setCompaniesState("ready");
    } catch {
      if (gen !== companiesGen.current) return;
      setError(copy.admin.companiesLoadFailed);
      setCompaniesState("error");
    }
  }

  async function loadReviews(offset = 0) {
    const gen = ++reviewsGen.current;
    setReviewsState("loading");
    setReviewsTotal(null);
    try {
      const result = await adminListPendingReviewsPage({ limit: 25, offset });
      if (gen !== reviewsGen.current) return;
      if (!result.ok) {
        setReviewsState("error");
        return;
      }
      setPendingReviews(result.data.rows);
      setReviewsOffset(result.data.offset);
      setReviewsTotal(result.data.totalCount);
      setReviewsHasMore(result.data.hasMore);
      setReviewsState("ready");
    } catch {
      if (gen !== reviewsGen.current) return;
      setReviewsState("error");
    }
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      void load(initialCompanyFilters.search, initialCompanyFilters.status, 0);
      void loadReviews();
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
      const raw = (event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : window.location.hash.replace(/^#/, ""));
      if (raw === "accounts") {
        const assign = window.location?.assign?.bind(window.location);
        if (typeof assign === "function") assign("/admin/accounts");
        return;
      }
      const hash = raw === "ai" ? "overview" : (raw as AdminTab);
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
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-[var(--service-line)]/80">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[var(--service-ink)] tracking-tight">
            {copy.admin.title}
          </h1>
        </div>

        {/* Action button: Refresh Data */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            busy={truthLoading}
            onClick={() => {
              void loadOverview();
              void load(appliedCompanySearch, status, companyOffset);
              void loadTruth();
              void loadReviews();
            }}
            className="flex items-center gap-2 text-xs sm:text-sm border border-[var(--service-line)] bg-[var(--service-surface)] text-[var(--service-ink)] hover:bg-[var(--service-canvas)]"
          >
            <IconRefresh className={(truthLoading || overviewState === "loading") ? "animate-spin" : ""} />
            <span>{isRtl ? "تحديث البيانات" : "Refresh"}</span>
          </Button>
        </div>
      </div>

      {/* 📊 5 Enterprise Metric Cards in a Single Horizontal Row */}
      <FiveRowGrid className="my-1.5">
        {/* Card 1: Monthly Gross Collections */}
        <BentoCard
          interactive={true}
          className="relative flex flex-col justify-between p-3 border border-[var(--service-line)] bg-[var(--service-surface)] hover:border-[var(--service-accent)]/50 transition-colors shadow-2xs"
        >
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <RealisticCardIcon />
              <span className="text-xs font-bold text-[var(--service-ink)] tracking-tight truncate">
                {isRtl ? "إجمالي التحصيل" : "Gross Collections"}
              </span>
              <InfoTooltip
                text={
                  isRtl
                    ? "تحصيل Live قبل الاسترداد والرسوم، وليس صافي الإيراد؛ التجريبي منفصل"
                    : "Live gross before refunds and fees, not net revenue; test payments are separate"
                }
              />
            </div>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-[var(--service-subtle)] text-[var(--service-accent)] border border-[var(--service-line)] shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--service-accent)] animate-pulse" />
              Live
            </span>
          </div>

          <div className="my-1.5 flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1" dir="ltr">
              <span className="text-xl sm:text-2xl font-black tracking-tight text-[var(--service-ink)]">
                {truth ? money(Number(truth.collections.live_collected_baisa)) : "—"}
              </span>
              <span className="text-[11px] font-bold text-[var(--service-muted)] uppercase">OMR</span>
            </div>
            <BarVolumeChart
              settled={truth?.collections.settled_orders ?? 0}
              review={truth?.collections.review_orders ?? 0}
              pending={truth?.collections.pending_orders ?? 0}
              failed={truth?.collections.failed_orders ?? 0}
              reversed={truth?.collections.reversed_orders ?? 0}
              color="#d97706"
            />
          </div>

          <div className="pt-1.5 border-t border-[var(--service-line)]/50 flex items-center justify-between text-[10px]">
            <span className="text-[var(--service-muted)] truncate">
              {isRtl ? "اشتراكات موثقة" : "Verified receipts"}
            </span>
            <span className="font-semibold text-[var(--service-accent)]">
              {isRtl ? "بوابة الدفع" : "Gateway"}
            </span>
          </div>
        </BentoCard>

        {/* Card 2: Total Companies */}
        <BentoCard
          interactive={true}
          className="relative flex flex-col justify-between p-3 border border-[var(--service-line)] bg-[var(--service-surface)] hover:border-[var(--service-accent)]/50 transition-colors shadow-2xs"
        >
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <RealisticBuildingIcon />
              <span className="text-xs font-bold text-[var(--service-ink)] truncate">
                {isRtl ? "إجمالي الشركات" : "Total Companies"}
              </span>
              <InfoTooltip
                text={
                  isRtl
                    ? "إجمالي الشركات المسجلة على المنصة وحالاتها التشغيلية"
                    : "Total companies registered on platform and status"
                }
              />
            </div>
          </div>

          <div className="my-1.5 flex items-baseline justify-between gap-2">
            <p className="text-xl sm:text-2xl font-black text-[var(--service-ink)] tracking-tight">
              {overviewState === "ready" && overview ? overview.companiesTotal : "—"}
            </p>
            <SegmentRatioBar
              active={overview?.companiesActive ?? 0}
              setup={overview?.companiesSetup ?? 0}
              suspended={overview?.companiesSuspended ?? 0}
              total={overview?.companiesTotal ?? 0}
            />
          </div>

          <div className="pt-1.5 border-t border-[var(--service-line)]/50 flex flex-wrap items-center gap-1 text-[10px]">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md font-semibold bg-[var(--service-accent-soft)] text-[var(--service-accent)]">
              {overviewState === "ready" && overview ? overview.companiesActive : "—"} {isRtl ? "نشطة" : "active"}
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md font-medium bg-[var(--service-subtle)] text-[var(--service-muted)]">
              {overviewState === "ready" && overview ? overview.companiesSetup : "—"} {isRtl ? "إعداد" : "setup"}
            </span>
            {overview?.companiesSuspended ? (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-md font-semibold bg-[var(--service-subtle)] text-[var(--service-muted)]">
                {overview.companiesSuspended} {isRtl ? "معلقة" : "suspended"}
              </span>
            ) : null}
          </div>
        </BentoCard>

        {/* Card 3: Accounts & Users */}
        <BentoCard
          interactive={true}
          className="relative flex flex-col justify-between p-3 border border-[var(--service-line)] bg-[var(--service-surface)] hover:border-[var(--service-accent)]/50 transition-colors shadow-2xs"
        >
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <RealisticUsersIcon />
              <span className="text-xs font-bold text-[var(--service-ink)] truncate">
                {isRtl ? "الحسابات والمستخدمين" : "Accounts & Users"}
              </span>
              <InfoTooltip
                text={
                  isRtl
                    ? "إجمالي حسابات المستخدمين النشطين المسجلين في منصة فيلورا"
                    : "Total active registered users on Velora platform"
                }
              />
            </div>
          </div>

          <div className="my-1.5 flex items-baseline justify-between gap-2">
            <p className="text-xl sm:text-2xl font-black text-[var(--service-ink)] tracking-tight">
              {overviewState === "ready" && overview ? overview.accountsTotal : "—"}
            </p>
            <ActivityMatrixPips
              total={overview?.accountsTotal ?? 0}
              unassigned={overview?.accountsWithoutCompany ?? 0}
              withoutActive={overview?.accountsWithoutActiveCompany ?? 0}
              color="#d97706"
            />
          </div>

          <div className="pt-1.5 border-t border-[var(--service-line)]/50 flex items-center justify-between text-[10px]">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md font-medium bg-[var(--service-subtle)] text-[var(--service-muted)]">
              {isRtl ? "مستخدمين مسجلين" : "Registered users"}
            </span>
            <span className="text-[var(--service-muted)]">{isRtl ? "نشط بالنظام" : "Active"}</span>
          </div>
        </BentoCard>

        {/* Card 4: AI Operating Cost */}
        <BentoCard
          interactive={true}
          className="relative flex flex-col justify-between p-3 border border-[var(--service-line)] bg-[var(--service-surface)] hover:border-[var(--service-accent)]/50 transition-colors shadow-2xs"
        >
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <RealisticChipIcon />
              <span className="text-xs font-bold text-[var(--service-ink)] truncate">
                {isRtl ? "استهلاك الذكاء" : "AI spend"}
              </span>
              <InfoTooltip
                text={
                  isRtl
                    ? "من سجل الاستهلاك الفعلي؛ لا يشمل المبالغ المحجوزة"
                    : "From actual usage records; excludes held amounts"
                }
              />
            </div>
          </div>

          <div className="my-1.5 flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1" dir="ltr">
              <span className="text-xl sm:text-2xl font-black tracking-tight text-[var(--service-ink)]">
                {truth?.ai ? money(Number(truth.ai.budget.spent_baisa)) : "—"}
              </span>
              <span className="text-[11px] font-bold text-[var(--service-muted)] uppercase">OMR</span>
            </div>
            <SteppedAreaChart
              models={truth?.ai?.models ?? []}
              color="#d97706"
              id="aispend"
            />
          </div>

          <div className="pt-1.5 border-t border-[var(--service-line)]/50 flex items-center justify-between text-[10px]">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md font-semibold bg-[var(--service-subtle)] text-[var(--service-ink)] border border-[var(--service-line)]">
              {isRtl ? "استهلاك فعلي" : "Recorded spend"}
            </span>
            <span className="text-[var(--service-muted)] font-medium">{isRtl ? "تجارب AI" : "AI trials"}</span>
          </div>
        </BentoCard>

        {/* Card 5: AI Held Funds */}
        <BentoCard
          interactive={true}
          className="relative flex flex-col justify-between p-3 border border-[var(--service-line)] bg-[var(--service-surface)] hover:border-[var(--service-accent)]/50 transition-colors shadow-2xs"
        >
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <RealisticRocketIcon />
              <span className="text-xs font-bold text-[var(--service-ink)] truncate">
                {isRtl ? "محجوز الذكاء" : "Held trial funds"}
              </span>
              <InfoTooltip
                text={
                  isRtl
                    ? "الحجز ليس مصروفاً مؤكداً أو ربحاً"
                    : "Held funds are not confirmed spend or profit"
                }
              />
            </div>
          </div>

          <div className="my-1.5 flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-1" dir="ltr">
              <span className="text-xl sm:text-2xl font-black tracking-tight text-[var(--service-ink)]">
                {truth?.ai ? money(Number(truth.ai.budget.held_baisa)) : "—"}
              </span>
              <span className="text-[11px] font-bold text-[var(--service-muted)] uppercase">OMR</span>
            </div>
            <RadialMeterRing
              heldBaisa={Number(truth?.ai?.budget.held_baisa ?? 0)}
              limitBaisa={Number(truth?.ai?.budget.limit_baisa ?? 0)}
              spentBaisa={Number(truth?.ai?.budget.spent_baisa ?? 0)}
              color="#d97706"
            />
          </div>

          <div className="pt-1.5 border-t border-[var(--service-line)]/50 flex items-center justify-between text-[10px]">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md font-semibold bg-[var(--service-accent-soft)] text-[var(--service-accent)] border border-[var(--service-accent)]/20">
              {isRtl ? "حجز مالي" : "Temporary hold"}
            </span>
            <span className="text-[var(--service-muted)] font-medium">
              {isRtl ? "ميزانية تجارب" : "Trial budget"}
            </span>
          </div>
        </BentoCard>
      </FiveRowGrid>

      {overviewError ? <Notice tone="error">{overviewError}</Notice> : null}

      {/* 🧭 Tab Navigation Bar */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-[var(--service-line)] scrollbar-none">
        <button
          type="button"
          onClick={() => switchTab("overview")}
          aria-pressed={activeTab === "overview"}
          className={`flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold transition shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--service-accent)] ${
            activeTab === "overview"
              ? "bg-[var(--service-accent-soft)] text-[var(--service-ink)] shadow-md shadow-[var(--service-accent)]/20"
              : "text-[var(--service-ink)] hover:text-[var(--service-ink)] hover:bg-[var(--service-subtle)]"
          }`}
        >
          <span>{isRtl ? "مركز النماذج والتكاليف" : "AI Models & Costs"}</span>
        </button>

        <button
          type="button"
          onClick={() => switchTab("companies")}
          aria-pressed={activeTab === "companies"}
          className={`flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold transition shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--service-accent)] ${
            activeTab === "companies"
              ? "bg-[var(--service-accent-soft)] text-[var(--service-ink)] shadow-md shadow-[var(--service-accent)]/20"
              : "text-[var(--service-ink)] hover:text-[var(--service-ink)] hover:bg-[var(--service-subtle)]"
          }`}
        >
          <span>{isRtl ? "الشركات والعملاء" : "Companies"}</span>
          <span className="rounded-full bg-[var(--service-accent)]/10 px-1.5 py-0.2 text-[10px] font-bold">
            {companiesState === "ready" ? (companyTotalCount ?? rows.length) : "-"}
          </span>
        </button>

        <Link
          href="/admin/accounts"
          className="flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold transition shrink-0 text-[var(--service-ink)] hover:bg-[var(--service-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--service-accent)]"
        >
          <span>{isRtl ? "الحسابات والمستخدمين" : "Accounts"}</span>
        </Link>

        <button
          type="button"
          onClick={() => switchTab("reviews")}
          aria-pressed={activeTab === "reviews"}
          className={`flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold transition shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--service-accent)] ${
            activeTab === "reviews"
              ? "bg-[var(--service-accent-soft)] text-[var(--service-ink)] shadow-md shadow-[var(--service-accent)]/20"
              : "text-[var(--service-ink)] hover:text-[var(--service-ink)] hover:bg-[var(--service-subtle)]"
          }`}
        >
          <span>{isRtl ? "طلبات المراجعة" : "Reviews"}</span>
          {reviewsTotal !== null && reviewsTotal > 0 && (
            <span className="rounded-full bg-[var(--service-accent-soft)] text-[var(--service-ink)] px-1.5 py-0.2 text-[10px] font-bold">
              {reviewsTotal}
            </span>
          )}
        </button>


        <button
          type="button"
          onClick={() => switchTab("future")}
          aria-pressed={activeTab === "future"}
          className={`flex items-center gap-2 min-h-11 px-4 py-2.5 rounded-xl text-sm font-semibold transition shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--service-accent)] ${
            activeTab === "future"
              ? "bg-[var(--service-accent-soft)] text-[var(--service-ink)] shadow-md shadow-[var(--service-accent)]/20"
              : "text-[var(--service-ink)] hover:text-[var(--service-ink)] hover:bg-[var(--service-subtle)]"
          }`}
        >
          <span>{isRtl ? "الميزات المستقبلية" : "Planned Modules"}</span>
          <span className="rounded-full bg-[var(--service-canvas)] text-[var(--service-accent)] border border-[var(--service-line)] px-1.5 py-0.2 text-[10px] font-bold">
            {isRtl ? "قريباً" : "Soon"}
          </span>
        </button>
      </div>

      {/* Actual AI usage, matching the existing overview layout */}
      {activeTab === "overview" && <div id="overview"><AdminRealAISummary data={truth?.ai??null} ar={isRtl} loading={truthLoading}/></div>}

      {/* 🏢 TAB 2: COMPANIES / TENANTS */}
      {activeTab === "companies" && (
        <section
          id="companies"
          tabIndex={-1}
          className="space-y-4 rounded-3xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 sm:p-6 shadow-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--service-line)] pb-4">
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold text-[var(--service-ink)]">{copy.admin.companiesTitle}</h2>
              <span className="rounded-full bg-[var(--service-subtle)] border border-[var(--service-line)] px-2.5 py-0.5 text-xs text-[var(--service-accent)] font-bold">
                {companiesState === "ready" ? `${fill(copy.admin.companiesTitle, { n: companyTotalCount ?? rows.length })} (${companyTotalCount ?? rows.length})` : "-"}
              </span>
            </div>
          </div>

          {/* Search & Filter Form */}
          <form
            className="grid gap-3 sm:grid-cols-[1fr_auto_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => load(search, status, 0));
            }}
          >
            <div className="relative">
              <span className="absolute inset-y-0 start-0 flex items-center ps-3.5 text-[var(--service-muted)] pointer-events-none">
                <IconSearch />
              </span>
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setCompanyOffset(0);
                }}
                placeholder={copy.admin.search}
                aria-label={copy.admin.search}
                className="min-h-11 w-full rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] ps-9 pe-8 text-sm text-[var(--service-ink)] outline-none focus:border-[var(--service-accent)] focus:ring-1 focus:ring-[var(--service-accent)] transition placeholder:text-[var(--service-muted)] font-medium"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setCompanyOffset(0);
                    void run(() => load("", status, 0));
                  }}
                  aria-label={isRtl ? "مسح البحث" : "Clear search"}
                  className="absolute inset-y-0 end-0 flex items-center pe-3 text-xs text-[var(--service-muted)] hover:text-[var(--service-ink)]"
                >
                  ✕
                </button>
              )}
            </div>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as "all" | CompanyStatus);
                setCompanyOffset(0);
              }}
              aria-label={copy.admin.statusFilter}
              className="min-h-11 rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] px-3 text-sm text-[var(--service-ink)] focus:border-[var(--service-accent)] focus:ring-1 focus:ring-[var(--service-accent)] transition font-bold"
            >
              <option value="all">{copy.admin.statusAll}</option>
              <option value="setup">{copy.admin.statusSetup}</option>
              <option value="active">{copy.admin.statusActive}</option>
              <option value="suspended">{copy.admin.statusSuspended}</option>
            </select>
            <Button type="submit" busy={busy} busyLabel={copy.loading} className="rounded-xl px-5 font-bold shadow-xs !bg-[var(--service-accent)] hover:!bg-[var(--service-accent-hover)] !text-white">
              {copy.admin.searchAction}
            </Button>
          </form>

          {/* Companies Load States */}
          {companiesState === "loading" && (
            <div className="py-8 text-center text-sm text-[var(--service-muted)]">
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
                onClick={() => void run(() => load(search, status, 0))}
              >
                {copy.admin.companiesRetry}
              </Button>
            </div>
          )}

          {/* Companies Table */}
          {companiesState === "ready" && (
            <div className={`${overviewStyles.companyTable} overflow-x-auto rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] shadow-xs`} role="region" aria-label={isRtl ? "جدول الشركات" : "Companies table"} tabIndex={0}>
              <table className="w-full text-start text-sm">
                <thead className="border-b border-[var(--service-line)] bg-[var(--service-canvas)] text-[var(--service-ink)] font-bold select-none">
                  <tr>
                    <th scope="col" className="p-3.5 text-start">{isRtl ? "اسم الشركة / النشاط" : "Company"}</th>
                    <th scope="col" className="p-3.5 text-start">{isRtl ? "الموقع" : "Location"}</th>
                    <th scope="col" className="p-3.5 text-start">{isRtl ? "المالك / البريد" : "Owner"}</th>
                    <th scope="col" className="p-3.5 text-center">{isRtl ? "الحالة" : "Status"}</th>
                    <th scope="col" className="p-3.5 text-end">{isRtl ? "الإجراء" : "Action"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--service-line)]/50 text-[var(--service-ink)]">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-[var(--service-canvas)]/70 transition-colors">
                      <td className="p-3.5">
                        <div className="flex items-center gap-3">
                          <span className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--service-accent-soft)] to-[var(--service-subtle)] text-[var(--service-accent)] flex items-center justify-center text-xs font-black uppercase shrink-0 border border-[var(--service-line)] shadow-2xs">
                            {row.display_name.charAt(0)}
                          </span>
                          <div className="min-w-0">
                            <Link
                              href={adminCompanyHref(row.id,companyListReturnHref({search:appliedCompanySearch,status}))}
                              dir="auto"
                              className="font-bold text-sm text-[var(--service-ink)] hover:text-[var(--service-accent)] transition underline-offset-2 hover:underline block truncate"
                            >
                              {row.display_name}
                            </Link>
                            <span className="inline-block mt-0.5 text-[11px] font-semibold text-[var(--service-muted)]">
                              {formatCompanyBusinessType(row.business_type, isRtl)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="p-3.5 text-xs font-medium text-[var(--service-ink)]">
                        <div className="flex items-center gap-1.5">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--service-muted)] shrink-0">
                            <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
                            <circle cx="12" cy="10" r="3" />
                          </svg>
                          <span>{row.city || row.country || "—"}</span>
                        </div>
                      </td>
                      <td className="p-3.5 text-xs font-medium text-[var(--service-ink)]" dir="ltr">
                        <div className="flex items-center gap-1.5">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--service-muted)] shrink-0">
                            <rect width="20" height="16" x="2" y="4" rx="2" />
                            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                          </svg>
                          <span className="truncate max-w-[200px]">{row.owner_email || "—"}</span>
                        </div>
                      </td>
                      <td className="p-3.5 text-center">
                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-2xs ${
                            row.status === "active"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200/80"
                              : row.status === "setup"
                              ? "bg-sky-50 text-sky-700 border-sky-200/80"
                              : "bg-rose-50 text-rose-700 border-rose-200/80"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${row.status === "active" ? "bg-emerald-500" : row.status === "setup" ? "bg-sky-500" : "bg-rose-500"}`} />
                          <span>{companyStatusLabel(row.status, copy)}</span>
                        </span>
                      </td>
                      <td className="p-3.5 text-end">
                        <Link
                          href={adminCompanyHref(row.id,companyListReturnHref({search:appliedCompanySearch,status}))}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-[var(--service-line)] bg-[var(--service-surface)] px-3.5 py-1.5 text-xs font-bold text-[var(--service-ink)] transition hover:border-[var(--service-accent)] hover:bg-[var(--service-accent-soft)] hover:shadow-xs group"
                        >
                          <span>{isRtl ? "إدارة وتفاصيل" : "Manage"}</span>
                          <span className="transition-transform group-hover:-translate-x-0.5 rtl:group-hover:-translate-x-0.5 ltr:group-hover:translate-x-0.5">
                            {isRtl ? "←" : "→"}
                          </span>
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-[var(--service-muted)]">
                        {copy.admin.companiesEmpty}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--service-line)] px-4 py-3 bg-[var(--service-surface)]">
                <div className="text-xs text-[var(--service-muted)]">
                  {companiesState === "ready" && (companyTotalCount !== null || rows.length > 0)
                    ? (isRtl
                      ? `عرض ${rows.length > 0 ? companyOffset + 1 : 0}-${companyOffset + rows.length} من ${companyTotalCount ?? rows.length} شركة`
                      : `Showing ${rows.length > 0 ? companyOffset + 1 : 0}-${companyOffset + rows.length} of ${companyTotalCount ?? rows.length} companies`)
                    : "—"}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={companyOffset === 0 || busy}
                    onClick={() => {
                      const prevOffset = Math.max(0, companyOffset - COMPANY_PAGE_SIZE);
                      void load(appliedCompanySearch, status, prevOffset);
                    }}
                    className="text-xs px-3 py-1.5"
                  >
                    {isRtl ? "السابق" : "Previous"}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!companyHasMore || busy}
                    onClick={() => {
                      const nextOffset = companyOffset + COMPANY_PAGE_SIZE;
                      void load(appliedCompanySearch, status, nextOffset);
                    }}
                    className="text-xs px-3 py-1.5"
                  >
                    {isRtl ? "التالي" : "Next"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}


      {/* 📋 TAB 4: REVIEWS & APPROVALS */}
      {activeTab === "reviews" && (
        <section
          id="reviews"
          tabIndex={-1}
          className="rounded-3xl border border-[var(--service-line)] bg-[var(--service-surface)] p-5 sm:p-6 shadow-sm space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--service-line)] pb-4">
            <div>
              <h2 className="text-lg font-bold text-[var(--service-ink)]">{copy.admin.navReviews}</h2>
              <p className="mt-0.5 text-xs text-[var(--service-muted)]">
                {isRtl
                  ? "شركات تنتظر مراجعة بيانات الإعداد وتوثيق المعرفة وربط واتساب"
                  : "Tenants awaiting onboarding approval and knowledge review"}
              </p>
            </div>
            {reviewsTotal !== null && reviewsTotal > 0 && (
              <span className="rounded-full bg-[var(--service-canvas)] text-[var(--service-accent)] border border-[var(--service-line)] px-2.5 py-0.5 text-xs font-bold">
                {reviewsTotal} {isRtl ? "قيد الانتظار" : "Pending"}
              </span>
            )}
          </div>

          {reviewsState === "loading" && (
            <p className="text-sm font-medium text-[var(--service-muted)]">{copy.loading}</p>
          )}

          {reviewsState === "error" && (
            <div className="grid gap-3">
              <Notice tone="error">{copy.admin.reviewsLoadBlocked}</Notice>
              <Button
                type="button"
                variant="secondary"
                busy={busy}
                onClick={() => void run(loadReviews)}
              >
                {copy.admin.companiesRetry}
              </Button>
            </div>
          )}

          {reviewsState === "ready" && (
            <div className="grid gap-2.5">
              {pendingReviews.map((row) => (
                <div
                  key={`review-${row.id}`}
                  className="flex items-center justify-between p-4 rounded-2xl border border-[var(--service-line)] bg-[var(--service-canvas)]/60 transition hover:bg-[var(--service-canvas)] hover:shadow-xs"
                >
                  <div>
                    <Link
                      href={adminCompanyHref(row.id,companyListReturnHref({search:appliedCompanySearch,status}))}
                      className="text-base font-bold text-[var(--service-ink)] hover:text-[var(--service-accent)] transition"
                    >
                      {row.display_name}
                    </Link>
                    {row.review_revision != null && (
                      <span className="ms-2 rounded-md bg-[var(--service-canvas)] px-1.5 py-0.5 text-xs [font-family:inherit] font-medium text-[var(--service-accent)] border border-[var(--service-line)]">
                        r{row.review_revision}
                      </span>
                    )}
                    <p className="mt-1 text-xs text-[var(--service-muted)]">
                      {row.business_type} · {row.owner_email || "—"}
                    </p>
                  </div>
                  <Link
                    href={adminCompanyHref(row.id,companyListReturnHref({search:appliedCompanySearch,status}))}
                    className="rounded-xl bg-[var(--service-accent-soft)] px-3.5 py-1.5 text-xs font-bold text-[var(--service-ink)] hover:bg-[var(--service-subtle)] transition shadow-xs"
                  >
                    {isRtl ? "مراجعة واعتماد" : "Review & Approve"}
                  </Link>
                </div>
              ))}

              {!pendingReviews.length && (
                <div className="py-6 text-center text-sm font-medium text-[var(--service-muted)]">
                  {copy.admin.reviewsEmpty}
                </div>
              )}
              <nav className="flex items-center justify-between gap-3" aria-label={isRtl ? "صفحات المراجعات" : "Review pages"}>
                <Button variant="secondary" data-admin-review-page="previous" disabled={reviewsOffset === 0} onClick={() => void loadReviews(Math.max(0, reviewsOffset - 25))}>
                  {isRtl ? "السابق" : "Previous"}
                </Button>
                <span className="text-xs text-[var(--service-muted)]">{Math.floor(reviewsOffset / 25) + 1}</span>
                <Button variant="secondary" data-admin-review-page="next" disabled={!reviewsHasMore} onClick={() => void loadReviews(reviewsOffset + 25)}>
                  {isRtl ? "التالي" : "Next"}
                </Button>
              </nav>
            </div>
          )}
        </section>
      )}

      {/* 🚀 TAB 5: FUTURE ENTERPRISE ROADMAP */}
      {activeTab === "future" && (
        <section
          id="future"
          tabIndex={-1}
          className="rounded-2xl border border-[var(--service-line)] bg-[var(--service-surface)] p-4 sm:p-5 shadow-xs space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--service-line)] pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[var(--service-ink)]">
                  {isRtl ? "الميزات والوحدات المجدولة" : "Planned Modules"}
                </h2>
                <span className="rounded-full bg-[var(--service-canvas)] text-[var(--service-accent)] border border-[var(--service-line)] px-2 py-0.5 text-[10px] font-bold">
                  {isRtl ? "خارطة الطريق" : "Roadmap"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--service-muted)]">
                {isRtl
                  ? "وحدات وميزات إضافية قادمة لمنصة فيلورا"
                  : "Upcoming enterprise modules scheduled for future release"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* Module 1: AI Business Team */}
            <div className="flex flex-col justify-between p-3.5 rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] hover:bg-[var(--service-surface)] hover:border-[var(--service-accent)]/40 hover:shadow-xs transition">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--service-subtle)] border border-[var(--service-line)] text-sm shrink-0">
                    👥
                  </span>
                  <h3 className="text-xs font-bold text-[var(--service-ink)] truncate">
                    {isRtl ? "فريق العمل الذكي" : "AI Business Team"}
                  </h3>
                </div>
                <span className="rounded-full bg-[var(--service-surface)] text-[var(--service-accent)] border border-[var(--service-line)] px-1.5 py-0.2 text-[9px] font-bold shrink-0">
                  {isRtl ? "قريباً" : "Planned"}
                </span>
              </div>
              <p className="text-[11px] text-[var(--service-muted)] leading-relaxed">
                {isRtl
                  ? "توزيع مهام خدمة العملاء والتسويق والدعم الفني بين الشخصيات."
                  : "Multi-agent task distribution for sales, support, and marketing."}
              </p>
            </div>

            {/* Module 2: AI Accountant */}
            <div className="flex flex-col justify-between p-3.5 rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] hover:bg-[var(--service-surface)] hover:border-[var(--service-accent)]/40 hover:shadow-xs transition">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--service-subtle)] border border-[var(--service-line)] text-sm shrink-0">
                    📊
                  </span>
                  <h3 className="text-xs font-bold text-[var(--service-ink)] truncate">
                    {isRtl ? "المحاسب الذكي" : "AI Accountant"}
                  </h3>
                </div>
                <span className="rounded-full bg-[var(--service-surface)] text-[var(--service-accent)] border border-[var(--service-line)] px-1.5 py-0.2 text-[9px] font-bold shrink-0">
                  {isRtl ? "قريباً" : "Planned"}
                </span>
              </div>
              <p className="text-[11px] text-[var(--service-muted)] leading-relaxed">
                {isRtl
                  ? "إدارة الفواتير والقيود وحساب هوامش الأرباح والمصاريف تلقائياً."
                  : "Automated ledger balancing, invoices, and expense tracking."}
              </p>
            </div>

            {/* Module 3: Inventory Assistant */}
            <div className="flex flex-col justify-between p-3.5 rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] hover:bg-[var(--service-surface)] hover:border-[var(--service-accent)]/40 hover:shadow-xs transition">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--service-subtle)] border border-[var(--service-line)] text-sm shrink-0">
                    📦
                  </span>
                  <h3 className="text-xs font-bold text-[var(--service-ink)] truncate">
                    {isRtl ? "إدارة المخزون" : "Inventory Assistant"}
                  </h3>
                </div>
                <span className="rounded-full bg-[var(--service-surface)] text-[var(--service-accent)] border border-[var(--service-line)] px-1.5 py-0.2 text-[9px] font-bold shrink-0">
                  {isRtl ? "قريباً" : "Planned"}
                </span>
              </div>
              <p className="text-[11px] text-[var(--service-muted)] leading-relaxed">
                {isRtl
                  ? "مزامنة لحظية لكميات المنتجات وتنبيهات النواقص التلقائية."
                  : "Real-time stock level synchronization and low-stock alerts."}
              </p>
            </div>

            {/* Module 4: Sales Analytics */}
            <div className="flex flex-col justify-between p-3.5 rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] hover:bg-[var(--service-surface)] hover:border-[var(--service-accent)]/40 hover:shadow-xs transition">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--service-subtle)] border border-[var(--service-line)] text-sm shrink-0">
                    📈
                  </span>
                  <h3 className="text-xs font-bold text-[var(--service-ink)] truncate">
                    {isRtl ? "تحليلات المبيعات" : "Sales Analytics"}
                  </h3>
                </div>
                <span className="rounded-full bg-[var(--service-surface)] text-[var(--service-accent)] border border-[var(--service-line)] px-1.5 py-0.2 text-[9px] font-bold shrink-0">
                  {isRtl ? "قريباً" : "Planned"}
                </span>
              </div>
              <p className="text-[11px] text-[var(--service-muted)] leading-relaxed">
                {isRtl
                  ? "تحليل معدلات تحويل المحادثات واكتشاف المنتجات الأكثر طلباً."
                  : "Conversation conversion rates and trending product demand."}
              </p>
            </div>

            {/* Module 5: Automation Center */}
            <div className="flex flex-col justify-between p-3.5 rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] hover:bg-[var(--service-surface)] hover:border-[var(--service-accent)]/40 hover:shadow-xs transition">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--service-subtle)] border border-[var(--service-line)] text-sm shrink-0">
                    ⚙️
                  </span>
                  <h3 className="text-xs font-bold text-[var(--service-ink)] truncate">
                    {isRtl ? "مركز الأتمتة والربط" : "Automation Center"}
                  </h3>
                </div>
                <span className="rounded-full bg-[var(--service-surface)] text-[var(--service-accent)] border border-[var(--service-line)] px-1.5 py-0.2 text-[9px] font-bold shrink-0">
                  {isRtl ? "قريباً" : "Planned"}
                </span>
              </div>
              <p className="text-[11px] text-[var(--service-muted)] leading-relaxed">
                {isRtl
                  ? "مسارات أتمتة تلقائية مع Webhooks ومنصات المتاجر الخارجية."
                  : "Automated webhook workflows and third-party store integrations."}
              </p>
            </div>

            {/* Module 6: Model Evaluator */}
            <div className="flex flex-col justify-between p-3.5 rounded-xl border border-[var(--service-line)] bg-[var(--service-canvas)] hover:bg-[var(--service-surface)] hover:border-[var(--service-accent)]/40 hover:shadow-xs transition">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--service-subtle)] border border-[var(--service-line)] text-sm shrink-0">
                    🔬
                  </span>
                  <h3 className="text-xs font-bold text-[var(--service-ink)] truncate">
                    {isRtl ? "مقارنة أداء النماذج" : "Model Performance"}
                  </h3>
                </div>
                <span className="rounded-full bg-[var(--service-surface)] text-[var(--service-accent)] border border-[var(--service-line)] px-1.5 py-0.2 text-[9px] font-bold shrink-0">
                  {isRtl ? "قريباً" : "Planned"}
                </span>
              </div>
              <p className="text-[11px] text-[var(--service-muted)] leading-relaxed">
                {isRtl
                  ? "مقارنة زمن الاستجابة ودقة الإجابات والتكلفة الفعلية لكل نموذج."
                  : "Latency, response accuracy, and cost benchmarks per model."}
              </p>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
