"use client";
import {sessionHasCompanyCapability} from "@/lib/access/actions";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { emptyBusiness, useDemo } from "@/lib/demo-state";
import { getWorkspaceSwitcher, getAccountProfile, selectWorkspaceCompany, signOut } from "@/lib/tenancy/actions";
import type { CompanyRole } from "@/lib/tenancy/types";
import { AccountMenu, useOptionalAccountSession } from "@/components/app/account-chrome";
import { Button, LangSwitch, Notice, useAppCopy } from "@/components/app/ui";

import styles from "./internal-ui.module.css";

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
  const { update, locale } = useDemo();
  const accountSession = useOptionalAccountSession();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const ar = locale === "ar";
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
    { href: "/app", label: copy.app.nav.dashboard, icon: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" },
    { href: "/app/conversations", label: copy.app.nav.conversations, icon: "M4 4h16v12H9l-5 4V4z M8 8h8 M8 12h5" },
    { href: "/app/knowledge", label: copy.app.nav.knowledge, icon: "M4 3h12l4 4v14H4V3z M15 3v5h5 M8 12h8 M8 16h6" },
    { href: "/app/test", label: copy.app.nav.test, icon: "M9 3h6 M10 3v6L4 19q-1 2 2 2h12q3 0 2-2L14 9V3 M8 14h8" },
    { href: "/app/settings", label: copy.app.nav.settings, icon: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6" },
  ].filter(item=>profile?.role==="owner"||item.href==="/app/conversations"||item.href==="/app/settings"||item.href==="/app/knowledge"&&knowledgeAllowed);
  const role = profile?.role ?? null;
  const roleLabel = role === "owner" ? copy.app.owner : role === "staff" ? copy.app.staff : copy.app.workspacePick;

  if (!profile) {
    return <main className={`app-shell ${styles.theme} p-6`} data-internal-ui="true" dir={ar ? "rtl" : "ltr"} aria-busy={!profileLoadFailed}>{profileLoadFailed ? <><Notice tone="error">{copy.app.workspaceSwitchFailed}</Notice><Button className="mt-4" onClick={() => { void reloadWorkspaceState(); }}>{copy.app.readinessRetry}</Button></> : <p>{copy.loading}</p>}</main>;
  }

  return (
    <div className={`app-shell ${styles.theme} ${styles.workspace}`} data-internal-ui="true" dir={ar ? "rtl" : "ltr"}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <div className={styles.sidebarBrand}>
            <Link href="/" className={styles.brand}><span className={styles.brandMark}>V</span>{copy.brand}</Link>
          </div>
          <div className={styles.sidebarUtilities}>
            <LangSwitch />
            <button ref={menuButtonRef} type="button" className={styles.menuButton}
              aria-label={ar ? "قائمة مساحة العمل" : "Workspace menu"} aria-expanded={menuOpen}
              aria-controls="workspace-navigation" onClick={() => setMenuOpen(v => !v)}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={menuOpen ? "m6 6 12 12 M6 18 18 6" : "M4 6h16 M4 12h16 M4 18h16"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
        <div id="workspace-navigation" className={styles.workspaceMenu} data-open={menuOpen}
          onKeyDown={e => { if (e.key === "Escape" && menuOpen && window.matchMedia("(max-width: 1023px)").matches) { setMenuOpen(false); menuButtonRef.current?.focus(); } }}>
          <nav aria-label={copy.app.nav.dashboard} className={styles.workspaceNav}>
            {nav.map(item => {
              const active = item.href === "/app" ? pathname === "/app" : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
                className={styles.navLink} onClick={() => setMenuOpen(false)}>
                <svg className={styles.navIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={item.icon} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>{item.label}</span>
              </Link>;
            })}
          </nav>
          <div className={styles.workspaceAccount}>
            <div className="mb-3"><AccountMenu /></div>
            <p className="app-muted text-xs">{profile.companyName}</p>
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
        </div>
      </aside>
      <main className={styles.workspaceMain}>
        <div className={styles.workspacePageHeader}>
          <h1 className="app-title min-w-0 break-words text-2xl lg:text-[2rem]">{title}</h1>
          <div className={styles.workspacePageActions}>{actions}</div>
        </div>
        <div className="min-w-0">{children}</div>
      </main>
    </div>
  );
}
