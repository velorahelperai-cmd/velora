"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useDemo } from "@/lib/demo-state";
import { selectWorkspaceCompany } from "@/lib/tenancy/actions";
import { getWorkspaceView } from "@/lib/tenancy/workspace-view";
import type { CompanyRole } from "@/lib/tenancy/types";
import { AccountMenu, performLogout, useOptionalAccountSession } from "@/components/app/account-chrome";
import { ApprovedAccountLoader } from "@/components/app/approved-account-loader";
import { Button, LangSwitch, Notice, useAppCopy } from "@/components/app/ui";
import { DiagnosticHint } from "./diagnostic-hint";
import { EnterprisePresence } from "./enterprise-presence";

import styles from "./internal-ui.module.css";

type WorkspaceState = {
  needsContext: boolean;
  selectedCompanyId: string | null;
  isPlatformAdmin: boolean;
  choices: Array<{ companyId: string; displayName: string; role: CompanyRole }>;
};

type ProfileState = {
  userId: string;
  name: string;
  email: string;
  role: CompanyRole | null;
  companyName: string;
};

export function WorkspaceShell({ title, children, actions, embedded=false,immersive=false }: { title: string; children: ReactNode; actions?: ReactNode; embedded?:boolean;immersive?:boolean }) {
  if (embedded) return <div className="channel-pane">{children}</div>;
  return <WorkspaceChrome title={title} actions={actions} immersive={immersive}>{children}</WorkspaceChrome>;
}

function WorkspaceChrome({title,children,actions,immersive}:{title:string;children:ReactNode;actions?:ReactNode;immersive:boolean}) {
  const copy = useAppCopy();
  const { update, locale } = useDemo();
  const accountSession = useOptionalAccountSession();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const ar = locale === "ar";
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [workspaceDiagnostic, setWorkspaceDiagnostic] = useState<unknown>(null);
  const [knowledgeAllowed,setKnowledgeAllowed]=useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const workspaceRequest = useRef(0);

  const reloadWorkspaceState = useCallback(async () => {
    const request = ++workspaceRequest.current;
    const result = await getWorkspaceView();
    if (request !== workspaceRequest.current) return { ok: false as const, code: "UNAVAILABLE" as const };
    if (!result.ok) {
      setProfile(null);
      setKnowledgeAllowed(false);
      setWorkspaceDiagnostic(result.diagnostic);
      setProfileLoadFailed(true);
      return { ok: false as const, code: result.code };
    }

    const { workspace, identity, knowledgeAllowed } = result.data;
    setWorkspace(workspace);
    setWorkspaceDiagnostic(null);
    setProfileLoadFailed(false);
    const selected = workspace.selectedCompanyId
      ? workspace.choices.find((row) => row.companyId === workspace.selectedCompanyId)
      : null;
    const displayName = identity.fullName.trim() || identity.email || "User";
    const role = selected?.role ?? null;

    setKnowledgeAllowed(knowledgeAllowed);
    setProfile({
      userId: identity.userId,
      name: displayName,
      email: identity.email,
      role,
      companyName: selected?.displayName ?? "",
    });
    update({
      account: role ? {
        name: displayName,
        email: identity.email,
        role,
      } : null,
      signedIn: true,
      stage: "active",
      ...(role ? { viewAs: role } : {}),
    });
    return { ok: true as const, data: workspace };
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
    return () => { cancelled = true; workspaceRequest.current += 1; };
  }, [reloadWorkspaceState]);

  async function onSelectCompany(id: string) {
    if (!id || switchBusy) return;
    setSwitchBusy(true);
    setSwitchError(null);
    try {
      const preferred = workspace?.needsContext
        ? new URLSearchParams(window.location.search).get("next")
        : window.location.pathname + window.location.search;
      const result = await selectWorkspaceCompany(id, { expectedUserId: profile?.userId, next: preferred });
      if (profile && accountSession && !accountSession.isCurrentUser(profile.userId)) return;
      if (!result.ok) {
        setSwitchError(copy.app.workspaceSwitchFailed);
        // Revert select UI to last known server selection.
        setWorkspace((prev) => (prev ? { ...prev } : prev));
        return;
      }
      // Hide the old server-rendered children until AppLayout's company key
      // remounts the shell. Never combine the new sidebar with the old company.
      workspaceRequest.current += 1;
      setProfile(null);
      setKnowledgeAllowed(false);
      window.location.replace(result.data.next);
    } catch {
      setSwitchError(copy.app.workspaceSwitchFailed);
    } finally {
      setSwitchBusy(false);
    }
  }

  async function logout() {
    if (!profile || !accountSession?.isCurrentUser(profile.userId)) return;
    await performLogout(accountSession, update, copy, message => window.alert(message));
  }

  const nav = [
    { href: "/app", label: copy.app.nav.dashboard, icon: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z" },
    { href: "/app/conversations", label: copy.app.nav.conversations, icon: "M4 4h16v12H9l-5 4V4z M8 8h8 M8 12h5" },
    { href: "/app/instagram", label: ar?"ربط إنستجرام":"Instagram connection", icon: "M4 4h16v16H4z M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0" },
    { href: "/app/knowledge", label: copy.app.nav.knowledge, icon: "M4 3h12l4 4v14H4V3z M15 3v5h5 M8 12h8 M8 16h6" },
    { href: "/app/test", label: copy.app.nav.test, icon: "M9 3h6 M10 3v6L4 19q-1 2 2 2h12q3 0 2-2L14 9V3 M8 14h8" },
    { href: "/app/subscription", label: ar ? "اشتراكي" : "My subscription", icon: "M3 5h18v14H3z M3 9h18 M7 14h4" },
    { href: "/app/settings", label: copy.app.nav.settings, icon: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6" },
  ].filter(item=>profile?.role==="owner"||item.href==="/app/conversations"||item.href==="/app/settings"||item.href==="/app/knowledge"&&knowledgeAllowed);
  const role = profile?.role ?? null;
  const roleLabel = role === "owner" ? copy.app.owner : role === "staff" ? copy.app.staff : copy.app.workspacePick;

  if (!profile || (accountSession && (accountSession.status !== "ready" || !accountSession.isCurrentUser(profile.userId)))) {
    if (profileLoadFailed) {
      return (
        <main className={`app-shell ${styles.theme} p-6`} data-internal-ui="true" dir={ar ? "rtl" : "ltr"}>
          <Notice tone="error">{copy.app.workspaceSwitchFailed}</Notice>
          <DiagnosticHint diagnostic={workspaceDiagnostic} locale={locale} />
          <Button className="mt-4" onClick={() => { void reloadWorkspaceState(); }}>{copy.app.readinessRetry}</Button>
        </main>
      );
    }
    return <ApprovedAccountLoader label={copy.loading} />;
  }

  return (
    <div className={`app-shell ${styles.theme} ${styles.workspace}`} data-internal-ui="true" data-immersive={immersive} dir={ar ? "rtl" : "ltr"}>
      <a href="#workspace-content" className="service-skip-link">{ar?"انتقل للمحتوى":"Skip to content"}</a>
      <aside data-workspace-navigation="true" className={styles.sidebar}>
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
      <main id="workspace-content" className={styles.workspaceMain}>
        {profile?.role==="staff"&&workspace?.selectedCompanyId&&<EnterprisePresence key={`${profile.userId}:${workspace.selectedCompanyId}`} userId={profile.userId} companyId={workspace.selectedCompanyId}/>}
        <div data-workspace-page-header="true" className={styles.workspacePageHeader}>
          <h1 className="app-title min-w-0 break-words text-2xl lg:text-[2rem]">{title}</h1>
          <div className={styles.workspacePageActions}>{actions}</div>
        </div>
        <div className="min-w-0">{workspace?.needsContext ? <Notice tone="info">{copy.app.workspacePick}</Notice> : children}</div>
      </main>
    </div>
  );
}
