"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  accessGetUserSnapshot,
  accessSetMemberGrants,
  accessSetPlatformRole,
  type AccessUserSnapshot,
} from "@/lib/access/actions";
import {
  COMPANY_CAPABILITIES,
  type CompanyCapability,
  type ConversationScope,
} from "@/lib/access/capabilities";
import { adminSearchAccounts } from "@/lib/tenancy/actions";
import { Button, Notice, useAppCopy } from "@/components/app/ui";

type AccessRequest = { kind: "search" | "load" | "write"; userId?: string };

export function AdminAccessPage() {
  const copy = useAppCopy();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const activeRequest = useRef<AccessRequest | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; activeRequest.current = null; };
  }, []);

  function beginRequest(kind: AccessRequest["kind"], userId?: string) {
    const request = { kind, userId };
    activeRequest.current = request;
    setBusy(true);
    setWriting(kind === "write");
    return request;
  }
  function isCurrent(request: AccessRequest) {
    return mounted.current && activeRequest.current === request;
  }
  function finishRequest(request: AccessRequest) {
    if (!isCurrent(request)) return;
    activeRequest.current = null;
    setBusy(false);
    setWriting(false);
  }
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hits, setHits] = useState<Array<{ userId: string; email: string; fullName: string; supportCode: string }>>([]);
  const [snapshot, setSnapshot] = useState<AccessUserSnapshot | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [caps, setCaps] = useState<CompanyCapability[]>([]);
  const [scope, setScope] = useState<ConversationScope>("all_company");
  const [confirm, setConfirm] = useState<string | null>(null);

  const staffMemberships = useMemo(
    () => (snapshot?.memberships ?? []).filter((m) => m.role === "staff"),
    [snapshot],
  );

  async function search() {
    if (!mounted.current || activeRequest.current) return;
    const request = beginRequest("search");
    setError(null);
    setNotice(null);
    setSnapshot(null);
    setConfirm(null);
    try {
      const result = await adminSearchAccounts({ query, limit: 20, offset: 0 });
      if (!isCurrent(request)) return;
      if (!result.ok) {
        setError(result.message ?? copy.admin.accessSearchFailed);
        setHits([]);
        return;
      }
      setHits(result.data.rows.map((row) => ({
        userId: row.user_id,
        email: row.email ?? "",
        fullName: row.full_name ?? "",
        supportCode: row.support_code ?? "",
      })));
      if (result.data.rows.length === 0 && query.trim()) {
        setNotice(copy.admin.accessAskRegister);
      }
    } catch {
      if (isCurrent(request)) { setError(copy.admin.accessSearchFailed); setHits([]); }
    } finally {
      finishRequest(request);
    }
  }

  async function readSnapshot(userId: string, request: AccessRequest) {
    try {
      const result = await accessGetUserSnapshot(userId);
      if (!isCurrent(request)) return;
      if (!result.ok) {
        setError(
          result.message?.startsWith("DEPENDENCY_MISSING:")
            ? copy.admin.accessDependencyBody
            : (result.message ?? copy.admin.accessLoadFailed),
        );
        setSnapshot(null);
        return;
      }
      if (result.data.userId !== userId) {
        setError(copy.admin.accessLoadFailed);
        setSnapshot(null);
        return;
      }
      setSnapshot(result.data);
      const firstStaff = result.data.memberships.find((m) => m.role === "staff");
      const companyId = firstStaff?.companyId ?? "";
      setSelectedCompanyId(companyId);
      const grant = result.data.grants.find((g) => g.companyId === companyId);
      setCaps(grant?.capabilities ?? [...COMPANY_CAPABILITIES]);
      setScope(grant?.conversationScope ?? "all_company");
    } catch {
      if (isCurrent(request)) { setError(copy.admin.accessLoadFailed); setSnapshot(null); }
    }
  }

  async function loadUser(userId: string) {
    if (!mounted.current || activeRequest.current?.kind === "write" ||
        (activeRequest.current?.kind === "load" && activeRequest.current.userId === userId)) return;
    const request = beginRequest("load", userId);
    setError(null);
    setNotice(null);
    setConfirm(null);
    setSnapshot(null);
    try {
      await readSnapshot(userId, request);
    } finally {
      finishRequest(request);
    }
  }

  function toggleCap(cap: CompanyCapability) {
    setCaps((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]));
    setConfirm(null);
  }

  async function saveGrants() {
    if (!mounted.current || activeRequest.current || !snapshot || !selectedCompanyId) return;
    const grant = snapshot.grants.find((g) => g.companyId === selectedCompanyId);
    const summary = copy.admin.accessConfirmGrants
      .replace("{email}", snapshot.email)
      .replace("{n}", String(caps.length))
      .replace("{scope}", scope);
    if (confirm !== summary) {
      setConfirm(summary);
      return;
    }
    const request = beginRequest("write", snapshot.userId);
    setError(null);
    setNotice(null);
    try {
      const result = await accessSetMemberGrants({
        companyId: selectedCompanyId,
        userId: snapshot.userId,
        capabilities: caps,
        conversationScope: scope,
        expectedRevision: grant?.revision ?? 0,
        reason: "admin_access_ui",
      });
      if (!isCurrent(request)) return;
      if (!result.ok) {
        setError(result.message ?? copy.admin.accessSaveFailed);
        return;
      }
      setNotice(copy.admin.accessSaved);
      setConfirm(null);
      await readSnapshot(snapshot.userId, request);
    } catch {
      if (isCurrent(request)) setError(copy.admin.accessSaveFailed);
    } finally {
      finishRequest(request);
    }
  }

  async function setDelegated() {
    if (!mounted.current || activeRequest.current || !snapshot) return;
    const summary = copy.admin.accessConfirmDelegated.replace("{email}", snapshot.email);
    if (confirm !== summary) {
      setConfirm(summary);
      return;
    }
    const request = beginRequest("write", snapshot.userId);
    setError(null);
    setNotice(null);
    try {
      const result = await accessSetPlatformRole({
        userId: snapshot.userId,
        role: "delegated",
        status: "active",
        expectedRevision: snapshot.platform?.revision ?? 0,
        reason: "admin_access_ui",
      });
      if (!isCurrent(request)) return;
      if (!result.ok) {
        setError(result.message ?? copy.admin.accessSaveFailed);
        return;
      }
      setNotice(copy.admin.accessSaved);
      setConfirm(null);
      await readSnapshot(snapshot.userId, request);
    } catch {
      if (isCurrent(request)) setError(copy.admin.accessSaveFailed);
    } finally {
      finishRequest(request);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-3 border-b border-[#D7C1A5]">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-[#18130F] tracking-tight">{copy.admin.accessTitle}</h1>
          <p className="mt-1 text-xs sm:text-sm text-[#615244]">{copy.admin.accessBody}</p>
        </div>
        <nav className="flex flex-wrap gap-2 text-xs sm:text-sm">
          <Link href="/admin#accounts" className="inline-flex min-h-10 items-center rounded-xl border border-[#D7C1A5] bg-[#FFFBF5] px-3 text-xs font-semibold text-[#6B4932] hover:text-[#18130F] hover:border-[#6B4932] hover:shadow-2xs transition">
            {copy.admin.navAccounts}
          </Link>
          <span className="inline-flex min-h-10 items-center rounded-xl bg-[#EFE2CF] border border-[#D7C1A5] px-3 text-xs font-bold text-[#6B4932]">
            {copy.admin.navAccess}
          </span>
        </nav>
      </div>

      <section className="mt-6 rounded-3xl border border-[#D7C1A5] bg-[#FFFBF5] p-5 sm:p-6 shadow-sm">
        <label className="grid gap-2 text-sm">
          <span className="font-bold text-[#6B4932]">{copy.admin.accountSearch}</span>
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-h-11 min-w-[16rem] flex-1 rounded-xl border border-[#D7C1A5] bg-[#F7F0E5] px-3 text-sm font-medium text-[#18130F] outline-none focus:border-[#6B4932] focus:bg-[#FFFBF5] focus:ring-1 focus:ring-[#6B4932] transition placeholder:text-[#615244]"
              dir="ltr"
            />
            <Button type="button" busy={busy} onClick={() => void search()}>
              {copy.admin.accountSearchAction}
            </Button>
          </div>
        </label>
        {error ? <div className="mt-3"><Notice tone="error">{error}</Notice></div> : null}
        {notice ? <div className="mt-3"><Notice tone="info">{notice}</Notice></div> : null}
        {confirm ? (
          <div className="mt-3">
            <Notice tone="warn">
              {confirm}
              <span className="mt-2 block text-xs">{copy.admin.accessConfirmHint}</span>
            </Notice>
          </div>
        ) : null}

        <ul className="mt-4 grid gap-2">
          {hits.map((hit) => (
            <li key={hit.userId}>
              <button
                type="button"
                disabled={writing}
                className="grid w-full gap-1 rounded-xl border border-[#D7C1A5] bg-[#F7F0E5] p-3 text-start hover:bg-[#FFFBF5] hover:border-[#6B4932]/40 transition shadow-2xs"
                onClick={() => void loadUser(hit.userId)}
              >
                <strong className="font-bold text-[#18130F]">{hit.fullName || hit.email || hit.userId}</strong>
                <span className="text-xs [font-family:inherit] font-medium text-[#615244]" dir="ltr">{hit.email} · {hit.supportCode || "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {snapshot ? (
        <section className="mt-6 grid gap-4 rounded-3xl border border-[#D7C1A5] bg-[#FFFBF5] p-5 sm:p-6 shadow-sm">
          <div>
            <h2 className="text-lg font-bold text-[#18130F]">{copy.admin.accessUserTitle}</h2>
            <p className="text-sm font-bold text-[#18130F]" dir="ltr">{snapshot.email}</p>
            <p className="mt-1 text-xs [font-family:inherit] font-medium text-[#615244]" dir="ltr">{snapshot.userId}</p>
            <p className="mt-2 text-sm font-semibold text-[#6B4932]">
              {copy.admin.accessPlatformRole}:{" "}
              {snapshot.platform
                ? `${snapshot.platform.role} / ${snapshot.platform.status}`
                : copy.admin.accessNoPlatformRole}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" busy={busy} onClick={() => void setDelegated()}>
              {copy.admin.accessGrantDelegated}
            </Button>
          </div>

          <label className="grid gap-2 text-sm">
            <span className="font-bold text-[#6B4932]">{copy.admin.accessStaffCompany}</span>
            <select
              value={selectedCompanyId}
              disabled={busy}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedCompanyId(id);
                const grant = snapshot.grants.find((g) => g.companyId === id);
                setCaps(grant?.capabilities ?? [...COMPANY_CAPABILITIES]);
                setScope(grant?.conversationScope ?? "all_company");
                setConfirm(null);
              }}
              className="min-h-11 rounded-xl border border-[#D7C1A5] bg-[#F7F0E5] px-3 text-sm font-medium text-[#18130F] outline-none focus:border-[#6B4932] focus:bg-[#FFFBF5] focus:ring-1 focus:ring-[#6B4932] transition"
            >
              <option value="">{copy.admin.accessPickCompany}</option>
              {staffMemberships.map((m) => (
                <option key={m.companyId} value={m.companyId}>
                  {m.displayName} ({m.status})
                </option>
              ))}
            </select>
          </label>

          {selectedCompanyId ? (
            <>
              <label className="grid gap-2 text-sm">
                <span className="font-bold text-[#6B4932]">{copy.admin.accessConversationScope}</span>
                <select
                  value={scope}
                  disabled={busy}
                  onChange={(e) => {
                    setScope(e.target.value === "assigned_only" ? "assigned_only" : "all_company");
                    setConfirm(null);
                  }}
                  className="min-h-11 rounded-xl border border-[#D7C1A5] bg-[#F7F0E5] px-3 text-sm font-medium text-[#18130F] outline-none focus:border-[#6B4932] focus:bg-[#FFFBF5] focus:ring-1 focus:ring-[#6B4932] transition"
                >
                  <option value="all_company">{copy.admin.accessScopeAll}</option>
                  <option value="assigned_only">{copy.admin.accessScopeAssigned}</option>
                </select>
              </label>

              <fieldset className="grid gap-2">
                <legend className="text-sm font-bold text-[#6B4932]">{copy.admin.accessCapabilities}</legend>
                {COMPANY_CAPABILITIES.map((cap) => (
                  <label key={cap} className="flex min-h-10 items-center gap-2 text-sm font-medium text-[#18130F]">
                    <input
                      type="checkbox"
                      checked={caps.includes(cap)}
                      disabled={busy}
                      onChange={() => toggleCap(cap)}
                      className="rounded border-[#D7C1A5] text-[#6B4932] focus:ring-[#6B4932]"
                    />
                    <span dir="ltr">{cap}</span>
                  </label>
                ))}
              </fieldset>

              <Button type="button" busy={busy} disabled={!selectedCompanyId} onClick={() => void saveGrants()}>
                {confirm ? copy.admin.accessConfirmSave : copy.admin.accessSaveGrants}
              </Button>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
