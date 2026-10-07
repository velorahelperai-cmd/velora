"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { AppTopBar } from "@/components/app/account-chrome";
import { Button, Notice, useAppCopy } from "@/components/app/ui";

export function AdminAccessPage() {
  const copy = useAppCopy();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    setError(null);
    setNotice(null);
    setSnapshot(null);
    try {
      const result = await adminSearchAccounts({ query, limit: 20, offset: 0 });
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
    } finally {
      setBusy(false);
    }
  }

  async function loadUser(userId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setConfirm(null);
    try {
      const result = await accessGetUserSnapshot(userId);
      if (!result.ok) {
        setError(
          result.message?.startsWith("DEPENDENCY_MISSING:")
            ? copy.admin.accessDependencyBody
            : (result.message ?? copy.admin.accessLoadFailed),
        );
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
    } finally {
      setBusy(false);
    }
  }

  function toggleCap(cap: CompanyCapability) {
    setCaps((prev) => (prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]));
    setConfirm(null);
  }

  async function saveGrants() {
    if (!snapshot || !selectedCompanyId) return;
    const grant = snapshot.grants.find((g) => g.companyId === selectedCompanyId);
    const summary = copy.admin.accessConfirmGrants
      .replace("{email}", snapshot.email)
      .replace("{n}", String(caps.length))
      .replace("{scope}", scope);
    if (confirm !== summary) {
      setConfirm(summary);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await accessSetMemberGrants({
        companyId: selectedCompanyId,
        userId: snapshot.userId,
        capabilities: caps,
        conversationScope: scope,
        expectedRevision: grant?.revision ?? 0,
        reason: "admin_access_ui",
      });
      if (!result.ok) {
        setError(result.message ?? copy.admin.accessSaveFailed);
        return;
      }
      setNotice(copy.admin.accessSaved);
      setConfirm(null);
      await loadUser(snapshot.userId);
    } finally {
      setBusy(false);
    }
  }

  async function setDelegated() {
    if (!snapshot) return;
    const summary = copy.admin.accessConfirmDelegated.replace("{email}", snapshot.email);
    if (confirm !== summary) {
      setConfirm(summary);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await accessSetPlatformRole({
        userId: snapshot.userId,
        role: "delegated",
        status: "active",
        expectedRevision: snapshot.platform?.revision ?? 0,
        reason: "admin_access_ui",
      });
      if (!result.ok) {
        setError(result.message ?? copy.admin.accessSaveFailed);
        return;
      }
      setNotice(copy.admin.accessSaved);
      setConfirm(null);
      await loadUser(snapshot.userId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-5xl">
        <AppTopBar />
        <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">{copy.admin.accessTitle}</h1>
            <p className="mt-1 text-sm text-[var(--color-muted-on-dark)]">{copy.admin.accessBody}</p>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm">
            <Link href="/admin" className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--color-border-soft)] px-3">
              {copy.admin.navAccounts}
            </Link>
            <span className="inline-flex min-h-11 items-center rounded-full bg-[#38dc89]/15 px-3 text-[var(--color-success-fg)]">
              {copy.admin.navAccess}
            </span>
          </nav>
        </div>

        <section className="app-panel mt-6 rounded-3xl p-4 sm:p-6">
          <label className="grid gap-2 text-sm">
            <span className="text-[var(--color-muted-on-dark)]">{copy.admin.accountSearch}</span>
            <div className="flex flex-wrap gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="min-h-11 min-w-[16rem] flex-1 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-3"
                dir="ltr"
              />
              <Button type="button" busy={busy} onClick={() => void search()}>
                {copy.admin.accountSearchAction}
              </Button>
            </div>
          </label>
          {error ? <Notice tone="error">{error}</Notice> : null}
          {notice ? <Notice tone="info">{notice}</Notice> : null}
          {confirm ? (
            <Notice tone="warn">
              {confirm}
              <span className="mt-2 block text-xs">{copy.admin.accessConfirmHint}</span>
            </Notice>
          ) : null}

          <ul className="mt-4 grid gap-2">
            {hits.map((hit) => (
              <li key={hit.userId}>
                <button
                  type="button"
                  className="grid w-full gap-1 rounded-xl border border-[color:var(--color-border-soft)] p-3 text-start hover:bg-[var(--color-hover-wash)]"
                  onClick={() => void loadUser(hit.userId)}
                >
                  <strong>{hit.fullName || hit.email || hit.userId}</strong>
                  <span className="text-xs text-[var(--color-muted-soft)]" dir="ltr">{hit.email} · {hit.supportCode || "—"}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {snapshot ? (
          <section className="app-panel mt-6 grid gap-4 rounded-3xl p-4 sm:p-6">
            <div>
              <h2 className="text-lg font-bold">{copy.admin.accessUserTitle}</h2>
              <p className="text-sm text-[var(--color-muted-on-dark)]" dir="ltr">{snapshot.email}</p>
              <p className="mt-1 text-xs text-[var(--color-muted-soft)]" dir="ltr">{snapshot.userId}</p>
              <p className="mt-2 text-sm">
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
              <span className="text-[var(--color-muted-on-dark)]">{copy.admin.accessStaffCompany}</span>
              <select
                value={selectedCompanyId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedCompanyId(id);
                  const grant = snapshot.grants.find((g) => g.companyId === id);
                  setCaps(grant?.capabilities ?? [...COMPANY_CAPABILITIES]);
                  setScope(grant?.conversationScope ?? "all_company");
                  setConfirm(null);
                }}
                className="min-h-11 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-3"
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
                  <span className="text-[var(--color-muted-on-dark)]">{copy.admin.accessConversationScope}</span>
                  <select
                    value={scope}
                    onChange={(e) => {
                      setScope(e.target.value === "assigned_only" ? "assigned_only" : "all_company");
                      setConfirm(null);
                    }}
                    className="min-h-11 rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] px-3"
                  >
                    <option value="all_company">{copy.admin.accessScopeAll}</option>
                    <option value="assigned_only">{copy.admin.accessScopeAssigned}</option>
                  </select>
                </label>

                <fieldset className="grid gap-2">
                  <legend className="text-sm text-[var(--color-muted-on-dark)]">{copy.admin.accessCapabilities}</legend>
                  {COMPANY_CAPABILITIES.map((cap) => (
                    <label key={cap} className="flex min-h-10 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={caps.includes(cap)}
                        disabled={busy}
                        onChange={() => toggleCap(cap)}
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
    </main>
  );
}
