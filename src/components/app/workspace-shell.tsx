"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { clearCompanyDrafts } from "@/lib/company-draft";
import { emptyBusiness, useDemo } from "@/lib/demo-state";
import { createClient } from "@/lib/supabase/client";
import { getWorkspaceSwitcher, selectWorkspaceCompany, signOut } from "@/lib/tenancy/actions";
import type { CompanyRole } from "@/lib/tenancy/types";
import { AccountMenu, useOptionalAccountSession } from "@/components/app/account-chrome";
import { Button, LangSwitch, PreviewBadge, useAppCopy } from "@/components/app/ui";

type WorkspaceState = {
  needsContext: boolean;
  selectedCompanyId: string | null;
  isPlatformAdmin: boolean;
  choices: Array<{ companyId: string; displayName: string; role: CompanyRole }>;
};

type ProfileState = {
  name: string;
  email: string;
  role: CompanyRole;
  companyName: string;
};

export function WorkspaceShell({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  const copy = useAppCopy();
  const { state, update, reset } = useDemo();
  const accountSession = useOptionalAccountSession();
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const reloadWorkspaceState = useCallback(async () => {
    const switcher = await getWorkspaceSwitcher();
    if (!switcher.ok) {
      return { ok: false as const, code: switcher.code };
    }
    setWorkspace(switcher.data);

    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) {
      return { ok: false as const, code: "UNAUTHENTICATED" as const };
    }

    const { data: profileRow } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("user_id", user.id)
      .maybeSingle();

    const selected = switcher.data.selectedCompanyId
      ? switcher.data.choices.find((row) => row.companyId === switcher.data.selectedCompanyId)
      : null;
    const displayName =
      profileRow?.full_name?.trim()
      || (user.user_metadata?.full_name as string)
      || user.email
      || "User";
    const role = selected?.role ?? (switcher.data.needsContext ? "staff" : "owner");

    setProfile({
      name: displayName,
      email: user.email ?? "",
      role,
      companyName: selected?.displayName ?? "",
    });
    update({
      account: {
        name: displayName,
        email: user.email ?? "",
        role,
      },
      signedIn: true,
      stage: "active",
      viewAs: role,
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
        /* layout already enforces auth */
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
    let userId: string | undefined;
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      userId = data.user?.id;
    } catch {
      /* continue — signOut still authoritative */
    }
    const result = await signOut();
    if (!result.ok) {
      window.alert(result.message ?? copy.auth.logoutFailed);
      return;
    }
    if (userId) clearCompanyDrafts(userId);
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
    { href: "/app", label: copy.app.nav.dashboard },
    { href: "/app/conversations", label: copy.app.nav.conversations },
    { href: "/app/knowledge", label: copy.app.nav.knowledge },
    { href: "/app/test", label: copy.app.nav.test },
    { href: "/app/settings", label: copy.app.nav.settings },
  ];
  const role = profile?.role ?? "owner";
  const effectiveRole = role === "owner" ? state.viewAs : role;

  if (!profile) {
    return <main className="app-shell" aria-busy="true" />;
  }

  return (
    <div className="app-shell overflow-x-hidden lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="app-shell-aside sticky top-0 z-20 border-b backdrop-blur lg:h-svh lg:border-b-0 lg:border-e lg:backdrop-blur-none">
        <div className="flex items-center justify-between gap-2 px-4 py-3 lg:flex-col lg:items-stretch lg:gap-4 lg:py-5">
          <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-xl font-bold tracking-tight">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#38dc89] text-sm text-[#072317]">V</span>
            {copy.brand}
          </Link>
          <div className="flex items-center gap-2 lg:justify-between">
            <PreviewBadge note />
            <LangSwitch />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 px-3 pb-2 lg:hidden">
          <p className="app-muted truncate text-xs">{profile.name} · {effectiveRole === "owner" ? copy.app.owner : copy.app.staff}</p>
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
                className={`inline-flex min-h-11 shrink-0 items-center rounded-xl px-3 text-sm font-medium transition ${active ? "bg-[#38dc89]/15 text-[var(--color-success-fg)]" : "text-[var(--color-on-dark)] hover:bg-[var(--color-hover-wash)]"}`}
              >
                {item.label}
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
          <p className="app-muted mt-1 text-xs">{copy.app.roleLabel}: {role === "owner" ? copy.app.owner : copy.app.staff}</p>
          {role === "owner" ? (
            <label className="app-muted-soft mt-3 grid gap-1 text-xs">
              {copy.app.viewAs}
              <select
                value={state.viewAs}
                onChange={(e) => update({ viewAs: e.target.value as "owner" | "staff" })}
                className="min-h-10 rounded-lg border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] px-2 text-sm text-[var(--color-on-dark)]"
              >
                <option value="owner">{copy.app.owner}</option>
                <option value="staff">{copy.app.staff}</option>
              </select>
            </label>
          ) : null}
          <div className="mt-4 grid gap-1">
            <Button variant="ghost" className="justify-start px-2" onClick={() => void logout()}>{copy.logout}</Button>
            <Button variant="ghost" className="app-muted justify-start px-2" onClick={() => { reset(); }}>{copy.resetPreview}</Button>
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
