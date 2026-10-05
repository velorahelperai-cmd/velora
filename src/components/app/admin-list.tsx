"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppTopBar } from "@/components/app/account-chrome";
import { Button, Notice, useAction, useAppCopy } from "@/components/app/ui";
import { fill, type AppCopy } from "@/lib/app-copy";
import { adminGetOverviewStats, adminListCompanies, adminSearchAccounts } from "@/lib/tenancy/actions";
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

const ACCOUNT_PAGE_SIZE = 20;
const ADMIN_SECTION_IDS = ["accounts", "companies", "reviews"] as const;

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
}: {
  initialOverview?: AdminOverviewStats | null;
  overviewUnavailable?: { code: AccessCode | "AUTH_ERROR"; message: string | null } | null;
}) {
  const copy = useAppCopy();
  const { busy, run } = useAction();
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
  const rootRef = useRef<HTMLElement | null>(null);
  const applyingHash = useRef(false);

  // Adopt newer SSR props on router.refresh (React “adjust state when props change”).
  if (
    trackedOverviewProps.overview !== initialOverview
    || trackedOverviewProps.unavailable !== overviewUnavailable
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
  const overview = clientOverview?.state === "ready"
    ? clientOverview.data
    : (initialOverview ?? null);
  const overviewError = clientOverview?.state === "error"
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial companies load
  }, []);

  // Sync overview fetches with SSR props: invalidate in-flight, fetch only if SSR empty.
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

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href^='#']");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const root = rootRef.current;
      if (!root || !root.contains(anchor)) return;
      const href = anchor.getAttribute("href");
      if (!href || href === "#") return;
      const id = href.slice(1);
      if (!ADMIN_SECTION_IDS.includes(id as (typeof ADMIN_SECTION_IDS)[number])) return;
      event.preventDefault();
      applyingHash.current = true;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          scrollAdminSection(id, "push");
          applyingHash.current = false;
        });
      });
    }

    function onHashNav() {
      if (applyingHash.current) return;
      const hash = window.location.hash.replace(/^#/, "");
      if (!ADMIN_SECTION_IDS.includes(hash as (typeof ADMIN_SECTION_IDS)[number])) return;
      scrollAdminSection(hash, "none");
    }

    document.addEventListener("click", onClick, true);
    window.addEventListener("hashchange", onHashNav);
    window.addEventListener("popstate", onHashNav);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("hashchange", onHashNav);
      window.removeEventListener("popstate", onHashNav);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace(/^#/, "");
    if (!ADMIN_SECTION_IDS.includes(hash as (typeof ADMIN_SECTION_IDS)[number])) return;
    const frame = window.requestAnimationFrame(() => {
      scrollAdminSection(hash, "none");
    });
    const timer = window.setTimeout(() => scrollAdminSection(hash, "none"), 280);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
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
      // Bind page to the normalized query that produced it.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounced account browse/search
  }, [accountQuery]);

  function onAccountQueryChange(value: string) {
    // Invalidate in-flight work immediately (before debounce ends).
    accountsGen.current += 1;
    // Same max length as server normalize (trim applied at request time).
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
    // Never page with a stale query while the input has diverged.
    if (q !== inputQ) return;
    if (nextOffset > ADMIN_ACCOUNT_SEARCH_MAX_OFFSET) return;
    const gen = ++accountsGen.current;
    void loadAccounts(q, nextOffset, gen);
  }

  const inputAccountQuery = normalizeAdminAccountQuery(accountQuery);
  const requestMatchesInput =
    (accountsState === "ready" || accountsState === "error")
    && activeAccountQuery === inputAccountQuery;
  const resultsMatchInput =
    accountsState === "ready"
    && activeAccountQuery === inputAccountQuery;

  const legacyBrowseLikely =
    !inputAccountQuery
    && resultsMatchInput
    && !accountRows.length
    && overviewState === "ready"
    && overview
    && overview.accountsTotal > 0;

  const filtered = useMemo(
    () => (status === "all" ? rows : rows.filter((r) => r.status === status)),
    [rows, status],
  );

  const reviewPending = useMemo(
    () => rows.filter((r) => r.review_status === "pending_review"),
    [rows],
  );

  const pageNumber = Math.floor(accountOffset / ACCOUNT_PAGE_SIZE) + 1;

  return (
    <main ref={rootRef} className="app-shell px-4 py-6">
      <div className="mx-auto max-w-[1100px]">
        <AppTopBar />
        <div className="mt-6">
          <p className="text-sm text-[#38dc89]">{copy.brand}</p>
          <h1 className="text-3xl font-bold">{copy.admin.title}</h1>
          <p className="mt-1 text-sm text-[#adbeaf]">{copy.admin.body}</p>
        </div>

        <nav className="mt-4 flex flex-wrap gap-2 text-sm" aria-label={copy.admin.title}>
          <a href="#accounts" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-3 hover:bg-white/5">{copy.admin.navAccounts}</a>
          <a href="#companies" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-3 hover:bg-white/5">{copy.admin.navCompanies}</a>
          <a href="#reviews" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-3 hover:bg-white/5">{copy.admin.navReviews}</a>
        </nav>

        <section className="app-panel mt-6 rounded-3xl p-4 sm:p-6" aria-label={copy.admin.statsTitle}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">{copy.admin.statsTitle}</h2>
            {overviewState === "ready" || overviewState === "error" ? (
              <Button type="button" variant="secondary" onClick={() => void loadOverview()}>
                {copy.admin.statsRetry}
              </Button>
            ) : null}
          </div>
          {overviewState === "dependency" ? (
            <div className="mt-3">
              <Notice tone="error">
                <strong>{copy.admin.accountJourneyDependencyTitle}</strong>
                <br />
                {copy.admin.accountJourneyDependencyBody}
              </Notice>
            </div>
          ) : null}
          {overviewState === "loading" ? (
            <p className="mt-3 text-sm text-[#8da195]">{copy.loading}</p>
          ) : null}
          {overviewState === "error" ? (
            <div className="mt-3">
              <Notice tone="error">{overviewError ?? copy.admin.statsLoadFailed}</Notice>
            </div>
          ) : null}
          {overviewState === "ready" && overview ? (
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3"><dt className="text-[#adbeaf]">{copy.admin.statsAccountsTotal}</dt><dd>{overview.accountsTotal}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#adbeaf]">{copy.admin.statsAccountsNoCompany}</dt><dd>{overview.accountsWithoutCompany}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#adbeaf]">{copy.admin.statsAccountsNoActiveCompany}</dt><dd>{overview.accountsWithoutActiveCompany}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#adbeaf]">{copy.admin.statsCompaniesTotal}</dt><dd>{overview.companiesTotal}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#adbeaf]">{copy.admin.statsCompaniesSetup}</dt><dd>{overview.companiesSetup}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#adbeaf]">{copy.admin.statsCompaniesActive}</dt><dd>{overview.companiesActive}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-[#adbeaf]">{copy.admin.statsCompaniesSuspended}</dt><dd>{overview.companiesSuspended}</dd></div>
              <div className="flex justify-between gap-3 sm:col-span-2"><dt className="text-[#adbeaf]">{copy.admin.statsSubscriptions}</dt><dd className="text-[#8da195]">{copy.admin.statsNotConfigured}</dd></div>
            </dl>
          ) : null}
        </section>

        <section
          id="accounts"
          tabIndex={-1}
          className="app-panel mt-6 scroll-mt-28 rounded-3xl p-4 outline-none transition-[box-shadow,border-color] duration-300 sm:p-6"
        >
          <h2 className="text-lg font-bold">{copy.admin.accountsTitle}</h2>
          <p className="mt-1 text-sm text-[#adbeaf]">{copy.admin.accountsBody}</p>
          <input
            value={accountQuery}
            onChange={(e) => onAccountQueryChange(e.target.value)}
            placeholder={copy.admin.accountSearch}
            className="mt-4 min-h-11 w-full rounded-xl border border-white/15 bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]"
          />
          {accountsState === "loading" || accountBusy ? (
            <p className="mt-3 text-xs text-[#8da195]">{copy.loading}</p>
          ) : null}
          {accountError && requestMatchesInput ? (
            <div className="mt-3 grid gap-2">
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
          ) : null}
          {legacyBrowseLikely ? (
            <p className="mt-3 text-xs text-[#8da195]">{copy.admin.accountsBrowseHint}</p>
          ) : null}
          {resultsMatchInput && accountOffsetCapped ? (
            <p className="mt-3 text-xs text-[#8da195]">
              {fill(copy.admin.accountsOffsetCap, { n: ADMIN_ACCOUNT_SEARCH_MAX_OFFSET })}
            </p>
          ) : null}
          <ul className="mt-4 grid gap-2">
            {resultsMatchInput ? accountRows.map((row) => (
              <li key={row.user_id} className="rounded-2xl border border-white/10 px-4 py-3">
                <strong className="block break-words">
                  {row.full_name || copy.admin.accountFieldUnavailable}
                </strong>
                <p className="mt-1 font-mono text-xs text-[#9af0c3]" dir="ltr">
                  {row.support_code || copy.admin.accountFieldUnavailable}
                </p>
                <p className="mt-1 text-xs text-[#adbeaf]" dir="ltr">{row.email || "—"}</p>
                <p className="mt-1 text-xs text-[#8da195]">{emailConfirmLabel(row.email_confirmed, copy)}</p>
                <p className="mt-1 text-xs text-[#8da195]" dir="ltr">
                  {copy.admin.accountPhone}: {row.account_phone || "—"}
                </p>
                <ul className="mt-2 grid gap-1 text-xs text-[#adbeaf]">
                  {row.companies.length ? row.companies.map((c) => (
                    <li key={`${row.user_id}-${c.company_id}`}>
                      <Link href={`/admin/companies/${c.company_id}`} className="text-[#38dc89] underline">{c.display_name}</Link>
                      {" · "}{c.role}
                      {" · "}{companyStatusLabel(c.company_status ?? null, copy)}
                      {" · "}{copy.admin.accountMemberStatus}: {c.status}
                      {c.business_phone ? <span dir="ltr"> · {copy.admin.businessPhone}: {c.business_phone}</span> : null}
                    </li>
                  )) : <li>{copy.admin.noCompaniesYet}</li>}
                </ul>
              </li>
            )) : null}
            {resultsMatchInput && !accountBusy && !accountRows.length && !accountError && !legacyBrowseLikely ? (
              <li className="text-sm text-[#8da195]">{copy.admin.accountSearchEmpty}</li>
            ) : null}
          </ul>
          {resultsMatchInput && (accountOffset > 0 || accountHasMore) ? (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={accountBusy || accountOffset <= 0}
                onClick={() => loadAccountPage(Math.max(0, accountOffset - ACCOUNT_PAGE_SIZE))}
              >
                {copy.admin.accountPrev}
              </Button>
              <span className="text-xs text-[#8da195]">{fill(copy.admin.accountPage, { n: pageNumber })}</span>
              <Button
                variant="secondary"
                disabled={accountBusy || !accountHasMore}
                onClick={() => loadAccountPage(accountOffset + ACCOUNT_PAGE_SIZE)}
              >
                {copy.admin.accountNext}
              </Button>
            </div>
          ) : null}
        </section>

        <section
          id="companies"
          tabIndex={-1}
          className="app-panel mt-6 scroll-mt-28 rounded-3xl p-4 outline-none transition-[box-shadow,border-color] duration-300 sm:p-6"
        >
          <h2 className="text-lg font-bold">{copy.admin.companiesTitle}</h2>
          <p className="mt-1 text-sm text-[#adbeaf]">{copy.admin.companiesBody}</p>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => load(search));
            }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={copy.admin.search}
              className="min-h-11 w-full rounded-xl border border-white/15 bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#38dc89]"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "all" | CompanyStatus)}
              aria-label={copy.admin.statusFilter}
              className="min-h-11 rounded-xl border border-white/15 bg-[#0d1a14] px-3 text-sm"
            >
              <option value="all">{copy.admin.statusAll}</option>
              <option value="setup">{copy.admin.statusSetup}</option>
              <option value="active">{copy.admin.statusActive}</option>
              <option value="suspended">{copy.admin.statusSuspended}</option>
            </select>
            <Button type="submit" busy={busy} busyLabel={copy.loading}>{copy.admin.searchAction}</Button>
          </form>

          {companiesState === "loading" ? (
            <p className="mt-4 text-sm text-[#8da195]">{copy.loading}</p>
          ) : null}

          {companiesState === "error" ? (
            <div className="mt-4 grid gap-3">
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
          ) : null}

          {companiesState === "ready" ? (
            <ul className="mt-5 grid gap-2">
              {filtered.map((row) => (
                <li key={row.id}>
                  <Link href={`/admin/companies/${row.id}`} className="block rounded-2xl border border-white/10 px-4 py-3 transition hover:border-[#38dc89]/50 hover:bg-white/5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <strong className="block break-words text-base">{row.display_name}</strong>
                        <p className="mt-1 text-xs text-[#8da195]">{row.business_type} · {row.city || row.country}</p>
                        <p className="mt-1 text-xs text-[#adbeaf]" dir="ltr">{row.owner_email || "—"}</p>
                      </div>
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px]">
                        {row.status === "setup" ? copy.admin.statusSetup
                          : row.status === "active" ? copy.admin.statusActive
                            : row.status === "suspended" ? copy.admin.statusSuspended
                              : row.status}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
              {!filtered.length ? (
                <li className="text-sm text-[#8da195]">{copy.admin.companiesEmpty}</li>
              ) : null}
            </ul>
          ) : null}
        </section>

        <section
          id="reviews"
          tabIndex={-1}
          className="app-panel mt-6 scroll-mt-28 rounded-3xl p-4 outline-none transition-[box-shadow,border-color] duration-300 sm:p-6"
        >
          <h2 className="text-lg font-bold">{copy.admin.navReviews}</h2>
          {companiesState === "loading" ? (
            <p className="mt-4 text-sm text-[#8da195]">{copy.loading}</p>
          ) : null}
          {companiesState === "error" ? (
            <div className="mt-4 grid gap-3">
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
          ) : null}
          {companiesState === "ready" ? (
            <ul className="mt-4 grid gap-2">
              {reviewPending.map((row) => (
                <li key={`review-${row.id}`}>
                  <Link href={`/admin/companies/${row.id}`} className="text-sm text-[#38dc89] underline">{row.display_name}</Link>
                  {row.review_revision != null ? (
                    <span className="ms-2 text-xs text-[#8da195]">r{row.review_revision}</span>
                  ) : null}
                </li>
              ))}
              {!reviewPending.length ? (
                <li className="text-sm text-[#8da195]">{copy.admin.reviewsEmpty}</li>
              ) : null}
            </ul>
          ) : null}
        </section>
      </div>
    </main>
  );
}
