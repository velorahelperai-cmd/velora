"use client";
import {sessionHasCompanyCapability} from "@/lib/access/actions";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { emptyBusiness, useDemo } from "@/lib/demo-state";
import { getWorkspaceSwitcher, getAccountProfile, selectWorkspaceCompany, signOut } from "@/lib/tenancy/actions";
import type { CompanyRole } from "@/lib/tenancy/types";
import { AccountMenu, useOptionalAccountSession } from "@/components/app/account-chrome";
import { Button, LangSwitch, Notice, useAppCopy } from "@/components/app/ui";

type WorkspaceState = {
  needsContext: boolean;
  selectedCompanyId: string | null;
  isPlatformAdmin: boolean;
  choices: Array<{ companyId: string; displayName: string; role: CompanyRole }>;
};

type ProfileState = {
  name: string;
  email: string;
  role: CompanyRole | null;
  companyName: string;
};

export function WorkspaceShell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const copy = useAppCopy();
  const { update } = useDemo();
  const accountSession = useOptionalAccountSession();
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [knowledgeAllowed,setKnowledgeAllowed]=useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const reloadWorkspaceState = useCallback(async () => {
    const switcher = await getWorkspaceSwitcher();
    if (!switcher.ok) {
      setProfile(null);
      setKnowledgeAllowed(false);
      setProfileLoadFailed(true);
      return { ok: false as const, code: switcher.code };
    }

    const identity=await getAccountProfile();
    if(!identity.ok){
      setProfile(null);
      setKnowledgeAllowed(false);
      setProfileLoadFailed(true);
      return {ok:false as const,code:identity.code};
    }
    setWorkspace(switcher.data);
    setProfileLoadFailed(false);
    const user={id:identity.data.userId,email:identity.data.email,user_metadata:{full_name:identity.data.fullName}};
    const profileRow={full_name:identity.data.fullName};
    const selected = switcher.data.selectedCompanyId
      ? switcher.data.choices.find((row) => row.companyId === switcher.data.selectedCompanyId)
      : null;
    const displayName =
      profileRow?.full_name?.trim()
      || (user.user_metadata?.full_name as string)
      || user.email
      || "User";
    const role = selected?.role ?? null;

    setKnowledgeAllowed(role==="owner"||!!selected&&await sessionHasCompanyCapability(selected.companyId,"knowledge.read")===true);
    setProfile({
      name: displayName,
      email: user.email ?? "",
      role,
      companyName: selected?.displayName ?? "",
    });
    update({
      account: role ? {
        name: displayName,
        email: user.email ?? "",
        role,
      } : null,
      signedIn: true,
      stage: "active",
      ...(role ? { viewAs: role } : {}),
    });
    return { ok: true as const, data: switcher.data };
  }, [update]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await reloadWorkspaceState();
        if (cancelled || !result.ok) return;
      } catch {
        if (!cancelled) setProfileLoadFailed(true);
      }
    })();
    return () => { cancelled = true; };
  }, [reloadWorkspaceState]);

  async function onSelectCompany(id: string) {
    if (!id || switchBusy) return;
    setSwitchBusy(true);
    setSwitchError(null);
    try {
      const result = await selectWorkspaceCompany(id);
      if (!result.ok) {
        setSwitchError(copy.app.workspaceSwitchFailed);
        // Revert select UI to last known server selection.
        setWorkspace((prev) => (prev ? { ...prev } : prev));
        return;
      }
      const reloaded = await reloadWorkspaceState();
      if (!reloaded.ok) {
        setSwitchError(copy.app.workspaceSwitchFailed);
      }
      await accountSession?.refresh();
      router.refresh();
    } catch {
      setSwitchError(copy.app.workspaceSwitchFailed);
    } finally {
      setSwitchBusy(false);
    }
  }

  async function logout() {
    const result = await signOut();
    if (!result.ok) {
      window.alert(result.message ?? copy.auth.logoutFailed);
      return;
    }
    accountSession?.clear();
    update({
      account: null,
      signedIn: false,
      stage: "guest",
      business: emptyBusiness,
      businessSaved: false,
      setupStep: 0,
      setupDone: [false, false, false, false],
    });
    router.replace("/login");
    router.refresh();
  }

  const nav = [
    { href: "/app", label: copy.app.nav.dashboard, icon: "📊" },
    { href: "/app/conversations", label: copy.app.nav.conversations, icon: "💬" },
    { href: "/app/knowledge", label: copy.app.nav.knowledge, icon: "🧠" },
    { href: "/app/test", label: copy.app.nav.test, icon: "⚡" },
    { href: "/app/settings", label: copy.app.nav.settings, icon: "⚙️" },
  ].filter(item=>profile?.role==="owner"||item.href==="/app/conversations"||item.href==="/app/settings"||item.href==="/app/knowledge"&&knowledgeAllowed);
  const role = profile?.role ?? null;
  const roleLabel = role === "owner" ? copy.app.owner : role === "staff" ? copy.app.staff : copy.app.workspacePick;

  if (!profile) {
    return <main className="app-shell p-6" aria-busy={!profileLoadFailed}>{profileLoadFailed ? <><Notice tone="error">{copy.app.workspaceSwitchFailed}</Notice><Button className="mt-4" onClick={() => { void reloadWorkspaceState(); }}>{copy.app.readinessRetry}</Button></> : <p>{copy.loading}</p>}</main>;
  }

  return (
    <div className="app-shell overflow-x-hidden lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="app-shell-aside sticky top-0 z-20 border-b backdrop-blur lg:h-svh lg:border-b-0 lg:border-e lg:backdrop-blur-none bg-[#07110d]/90">
        <div className="flex items-center justify-between gap-2 px-4 py-3 lg:flex-col lg:items-stretch lg:gap-4 lg:py-5">
          <div className="flex items-center justify-between">
            <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-xl font-bold tracking-tight">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#38dc89] to-[#1d7d4c] text-sm font-bold text-[#072317] shadow-sm">V</span>
              {copy.brand}
            </Link>
            <span className="hidden lg:inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] text-[#c5d4cc]">
              {roleLabel}
            </span>
          </div>
          <div className="flex items-center gap-2 lg:justify-between">
            <LangSwitch />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 pb-2 lg:hidden">
          <p className="app-muted truncate text-xs">{profile.name} · {roleLabel}</p>
          <AccountMenu compact />
        </div>
        <nav aria-label={copy.app.nav.dashboard} className="flex gap-1 overflow-x-auto px-3 pb-3 [scrollbar-width:none] lg:flex-col lg:overflow-visible lg:px-3 [&::-webkit-scrollbar]:hidden">
          {nav.map((item) => {
            const active = item.href === "/app" ? pathname === "/app" : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl px-3.5 text-sm font-medium transition duration-200 ${active ? "bg-[#38dc89]/15 text-[var(--color-success-fg)] border border-[#38dc89]/30 shadow-[0_2px_12px_rgba(56,220,137,0.1)]" : "text-[var(--color-on-dark)] hover:bg-[var(--color-hover-wash)] border border-transparent"}`}
              >
                <span className="text-base opacity-80">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="hidden border-t border-[color:var(--color-line)] px-4 py-4 text-sm lg:block">
          <div className="mb-3"><AccountMenu /></div>
          <p className="app-muted mt-1 text-xs">{profile.companyName}</p>
          {workspace && (
            workspace.needsContext
            || workspace.choices.length > 1
            || (workspace.isPlatformAdmin && workspace.choices.length >= 1)
          ) ? (
            <label className="app-muted-soft mt-3 grid gap-1 text-xs">
              {copy.app.workspacePick}
              <select
                value={workspace.selectedCompanyId ?? ""}
                disabled={switchBusy}
                onChange={(e) => {
                  void onSelectCompany(e.target.value);
                }}
                className="min-h-10 rounded-lg border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] px-2 text-sm text-[var(--color-on-dark)] disabled:opacity-60"
              >
                {workspace.needsContext || !workspace.selectedCompanyId ? (
                  <option value="">{copy.app.workspacePick}</option>
                ) : null}
                {workspace.choices.map((row) => (
                  <option key={row.companyId} value={row.companyId}>{row.displayName}</option>
                ))}
              </select>
              {switchError ? (
                <p className="text-xs text-[#f0a0a0]" role="alert">{switchError}</p>
              ) : null}
            </label>
          ) : null}
          {workspace?.isPlatformAdmin ? (
            <Link href="/admin" className="mt-2 inline-flex min-h-10 items-center text-xs underline">
              {copy.account.menuPlatformAdmin}
            </Link>
          ) : null}
          <p className="app-muted mt-1 text-xs">{copy.app.roleLabel}: {roleLabel}</p>
          <div className="mt-4 grid gap-1">
            <Button variant="ghost" className="justify-start px-2" onClick={() => void logout()}>{copy.logout}</Button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 overflow-x-hidden px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] lg:px-8">
        <div className="mb-6 flex min-w-0 flex-wrap items-end justify-between gap-3 border-b border-[color:var(--color-line)] pb-4">
          <h1 className="app-title min-w-0 break-words text-2xl lg:text-[2rem]">{title}</h1>
          <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
        </div>
        <div className="min-w-0">{children}</div>
      </main>
    </div>
  );
}
