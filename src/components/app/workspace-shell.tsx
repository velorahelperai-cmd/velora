"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useDemo } from "@/lib/demo-state";
import { selectWorkspaceCompany } from "@/lib/tenancy/actions";
import { getWorkspaceView } from "@/lib/tenancy/workspace-view";
import type { CompanyRole } from "@/lib/tenancy/types";
import { AccountMenu, performLogout, useOptionalAccountSession } from "@/components/app/account-chrome";
import { ApprovedAccountLoader } from "@/components/app/approved-account-loader";
import { Button, Notice, useAppCopy } from "@/components/app/ui";
import { DiagnosticHint } from "./diagnostic-hint";
import { EnterprisePresence } from "./enterprise-presence";
import {useWorkspaceBootstrap,type WorkspaceBootstrap} from './workspace-bootstrap';

import styles from "./internal-ui.module.css";
import {WorkspaceFrame,workspaceNavigation} from "./workspace-frame";

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

function profileFromWorkspace(data:WorkspaceBootstrap):ProfileState{
  const selected=data.workspace.choices.find(row=>row.companyId===data.workspace.selectedCompanyId);
  return {userId:data.identity.userId,name:data.identity.fullName.trim()||data.identity.email||'User',email:data.identity.email,role:selected?.role??null,companyName:selected?.displayName??''};
}

export function WorkspaceShell({ title, children, actions, embedded=false,immersive=false }: { title: string; children: ReactNode; actions?: ReactNode; embedded?:boolean;immersive?:boolean }) {
  if (embedded) return <div className="channel-pane">{children}</div>;
  return <WorkspaceChrome title={title} actions={actions} immersive={immersive}>{children}</WorkspaceChrome>;
}

function WorkspaceChrome({title,children,actions,immersive}:{title:string;children:ReactNode;actions?:ReactNode;immersive:boolean}) {
  const copy = useAppCopy();
  const { update, locale } = useDemo();
  const accountSession = useOptionalAccountSession();
  const bootstrap=useWorkspaceBootstrap();
  const ar = locale === "ar";
  const [profile, setProfile] = useState<ProfileState | null>(()=>bootstrap?profileFromWorkspace(bootstrap):null);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [workspaceDiagnostic, setWorkspaceDiagnostic] = useState<unknown>(null);
  const [knowledgeAllowed,setKnowledgeAllowed]=useState(bootstrap?.knowledgeAllowed??false);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(bootstrap?.workspace??null);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const workspaceRequest = useRef(0);

  const reloadWorkspaceState = useCallback(async () => {
    const request = ++workspaceRequest.current;
    // AppLayout already loaded this identity and workspace under native access.
    // Reuse its display snapshot instead of hiding every page for another action.
    const result = bootstrap?{ok:true as const,data:bootstrap}:await getWorkspaceView();
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
  }, [update,bootstrap]);

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

  const nav = workspaceNavigation(copy,ar).filter(item=>profile?.role==="owner"||item.href==="/app/conversations"||item.href==="/app/settings"||item.href==="/app/knowledge"&&knowledgeAllowed);
  const role = profile?.role ?? null;
  const roleLabel = role === "owner" ? copy.app.owner : role === "staff" ? copy.app.staff : copy.app.workspacePick;

  if (!profile || (accountSession && (accountSession.status !== "ready" || !accountSession.isCurrentUser(profile.userId)
    || (accountSession.identity && (accountSession.identity.companyId !== workspace?.selectedCompanyId || accountSession.identity.role !== profile.role))))) {
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

  return <WorkspaceFrame title={title} actions={actions} immersive={immersive} nav={nav}
    account={<>
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
          </div></>}
    presence={profile.role==='staff'&&workspace?.selectedCompanyId?<EnterprisePresence key={profile.userId+':'+workspace.selectedCompanyId} userId={profile.userId} companyId={workspace.selectedCompanyId}/>:null}>
    {workspace?.needsContext?<Notice tone="info">{copy.app.workspacePick}</Notice>:children}
  </WorkspaceFrame>;
}
