"use client";

import Link from "next/link";
import {recordLogoutTransportFailed} from "@/lib/logging/browser.mjs";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  classifyProfileFailure,
  type IdentityFailureStage,
} from "@/lib/auth/session-presence";
import { clearCompanyDrafts } from "@/lib/company-draft";
import { discardForeignTeamJournal } from "@/lib/platform-teams/ui-state";
import { emptyBusiness, useDemo } from "@/lib/demo-state";
import { tryCreateClient } from "@/lib/supabase/client";
import {
  getAccountProfile,
  signOut,
  type AccountProfileView,
} from "@/lib/tenancy/actions";
import { LangSwitch, useAppCopy } from "@/components/app/ui";
import {publishSessionContext,publishSessionLogout,subscribeSessionContext} from "@/lib/auth/session-context";
import {SessionActivityTracker} from "@/lib/auth/session-activity-tracker";

type SessionStatus = "loading" | "guest" | "ready" | "error" | "expired";

type AccountSessionValue = {
  status: SessionStatus;
  identity: AccountProfileView | null;
  refresh: () => Promise<void>;
  clear: () => void;
  expire: () => void;
  setIdentityName: (name: string, expectedUserId: string) => void;
  isCurrentUser: (userId: string, expectedIdentity?: AccountProfileView) => boolean;
  hasCurrentUser: () => boolean;
};

const AccountSessionContext = createContext<AccountSessionValue | null>(null);

function initialsOf(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]!}${parts[1]![0]!}`.toUpperCase();
  if (parts[0]?.length) return parts[0].slice(0, 2).toUpperCase();
  return (email.slice(0, 2) || "V").toUpperCase();
}

export function AccountSessionProvider({
  children,
  initial,
}: {
  children: ReactNode;
  initial?: AccountProfileView | null;
}) {
  const providerRouter=useRouter();
  const pathname=usePathname();
  const [status, setStatus] = useState<SessionStatus>(initial ? "ready" : "loading");
  const [identity, setIdentity] = useState<AccountProfileView | null>(initial ?? null);
  const identityRef=useRef<AccountProfileView|null>(initial??null);
  const userIdRef = useRef<string | null>(initial?.userId ?? null);
  const requestGen = useRef(0);
  const signalRead=useRef<{generation:number;promise:Promise<void>}|null>(null);
  const routeReloading=useRef(false);
  const publishedContext=useRef<string|null>(null);
  /** Internal only — never rendered to visitors, never logs secrets. */
  const failureStageRef = useRef<IdentityFailureStage | null>(null);

  const clear = useCallback(() => {
    // Invalidate any in-flight refresh so a stale response cannot restore prior identity.
    requestGen.current += 1;
    userIdRef.current = null;
    identityRef.current = null;
    publishedContext.current = null;
    failureStageRef.current = null;
    setIdentity(null);
    setStatus("guest");
  }, []);

  const expire=useCallback(()=>{requestGen.current+=1;userIdRef.current=null;identityRef.current=null;publishedContext.current=null;setIdentity(null);setStatus("expired");},[]);

  const refresh = useCallback(async () => {
    if(routeReloading.current)return;
    const gen=++requestGen.current;
    try {
      const result=await getAccountProfile();
      if(gen!==requestGen.current)return;
      if(!result.ok){
        if(result.code==="UNAUTHENTICATED"){if(userIdRef.current)publishSessionLogout(userIdRef.current);if(result.sessionExpired)expire();else clear();return;}
        failureStageRef.current=classifyProfileFailure(result.code);
        setStatus(prev=>identityRef.current&&prev==="ready"?"ready":"error");return;
      }
      // An auth event already observed a new account; an older cookie response
      // must not revive the prior account while that switch is still loading.
      if(userIdRef.current && !identityRef.current && userIdRef.current!==result.data.userId){
        failureStageRef.current="server_auth";setStatus("error");return;
      }
      const context={userId:result.data.userId,companyId:result.data.companyId};
      const signature=JSON.stringify(context);
      if(publishedContext.current!==signature){publishedContext.current=signature;publishSessionContext(context);}
      const switching=userIdRef.current!==null&&userIdRef.current!==result.data.userId;
      const changingWorkspace=identityRef.current!==null&&identityRef.current.companyId!==result.data.companyId;
      if(switching||changingWorkspace){
        routeReloading.current=true;
        userIdRef.current=result.data.userId;identityRef.current=null;setIdentity(null);setStatus("loading");
        providerRouter.refresh();window.location.reload();return;
      }
      try{discardForeignTeamJournal(window.sessionStorage,result.data.userId);}catch{/* Storage is optional for identity. */}
      userIdRef.current=result.data.userId;identityRef.current=result.data;
      failureStageRef.current=null;setIdentity(result.data);setStatus("ready");
    }catch{
      if(gen!==requestGen.current)return;
      failureStageRef.current="server_auth";setStatus(prev=>identityRef.current&&prev==="ready"?"ready":"error");
    }
  },[clear,expire,providerRouter]);

  // Mount/Auth/focus notifications often arrive together. Share only reads
  // within the same authority generation; logout/account changes invalidate it.
  const refreshFromSignal=useCallback(()=>{
    if(signalRead.current?.generation===requestGen.current)return signalRead.current.promise;
    const promise=refresh();
    const pending={generation:requestGen.current,promise};
    signalRead.current=pending;
    void promise.finally(()=>{if(signalRead.current===pending)signalRead.current=null;});
    return promise;
  },[refresh]);

  useEffect(()=>subscribeSessionContext(signal=>{
    if(signal.type==="logout"&&userIdRef.current&&userIdRef.current!==signal.userId)return;
    const current=identityRef.current;
    if(signal.type==="context"&&current?.userId===signal.userId&&current.companyId===signal.companyId)return;
    // Hints never establish a user or workspace. Discard every old request,
    // then let the refreshed server route and shared cookies establish context.
    routeReloading.current=true;requestGen.current+=1;userIdRef.current=null;identityRef.current=null;
    failureStageRef.current=null;setIdentity(null);setStatus("loading");
    providerRouter.refresh();window.location.reload();
  }),[providerRouter]);

  useEffect(()=>{
    const frame=window.requestAnimationFrame(()=>{void refreshFromSignal();});
    return ()=>window.cancelAnimationFrame(frame);
  },[refreshFromSignal]);

  useEffect(()=>{
    const supabase=tryCreateClient();if(!supabase)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const {data:sub}=supabase.auth.onAuthStateChange((event,session)=>{
      if(timer)clearTimeout(timer);
      if(event==="SIGNED_OUT"){clear();providerRouter.refresh();return;}
      if(session?.user && userIdRef.current!==session.user.id){
        const switching=userIdRef.current!==null;
        requestGen.current+=1;userIdRef.current=session.user.id;identityRef.current=null;setIdentity(null);setStatus("loading");providerRouter.refresh();
        if(switching){routeReloading.current=true;window.location.reload();return;}
      }
      // Server Actions update cookies without guaranteeing a browser SIGNED_IN event.
      // INITIAL_SESSION=null therefore checks the server instead of inventing a logout.
      timer=setTimeout(()=>{void refreshFromSignal();},0);
    });
    return ()=>{if(timer)clearTimeout(timer);sub.subscription.unsubscribe();requestGen.current+=1;};
  },[clear,refreshFromSignal,providerRouter]);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const recheck=()=>{if(document.visibilityState!=="visible")return;if(timer)clearTimeout(timer);timer=setTimeout(()=>{void refreshFromSignal();},0);};
    window.addEventListener("focus",recheck);document.addEventListener("visibilitychange",recheck);
    return ()=>{if(timer)clearTimeout(timer);window.removeEventListener("focus",recheck);document.removeEventListener("visibilitychange",recheck);};
  },[refreshFromSignal]);
  const isCurrentUser = useCallback((userId:string,expectedIdentity?:AccountProfileView)=>userIdRef.current===userId&&identityRef.current?.userId===userId&&(!expectedIdentity||identityRef.current===expectedIdentity),[]);
  const hasCurrentUser = useCallback(()=>userIdRef.current!==null,[]);
  const setIdentityName = useCallback((name: string, expectedUserId: string) => {
    if(!isCurrentUser(expectedUserId))return;
    setIdentity((prev) => {const updated=prev?.userId===expectedUserId?{...prev,fullName:name}:prev;identityRef.current=updated;return updated;});
  }, [isCurrentUser]);

  const sessionValue=useMemo(()=>({status,identity,refresh,clear,expire,setIdentityName,isCurrentUser,hasCurrentUser}),[status,identity,refresh,clear,expire,setIdentityName,isCurrentUser,hasCurrentUser]);
  const protectedRoute=/^\/(app|admin|account|setup|complete-profile|reset-password)(\/|$)/.test(pathname);
  const copy=useAppCopy();
  const content=protectedRoute&&status!=="ready"
    ? status==="expired" ? <SessionActivityTracker />
    : <main className="grid min-h-screen place-content-center gap-3 px-6 text-center" aria-busy={status==="loading"}>
        <p>{status==="loading"?copy.loading:status==="error"?copy.account.identityError:copy.auth.login}</p>
        {status==="error"?<button type="button" onClick={()=>void refresh()}>{copy.errors.accessRetry}</button>:null}
        {status==="guest"?<Link href="/login">{copy.auth.login}</Link>:null}
      </main>
    : children;
  return (
    <AccountSessionContext.Provider value={sessionValue}>
      {content}
    </AccountSessionContext.Provider>
  );
}

export function useAccountSession() {
  const ctx = useContext(AccountSessionContext);
  if (!ctx) throw new Error("useAccountSession requires AccountSessionProvider");
  return ctx;
}

export function useOptionalAccountSession() {
  return useContext(AccountSessionContext);
}

export async function performLogout(
  session: AccountSessionValue,
  updateDemo: ReturnType<typeof useDemo>["update"],
  copy: ReturnType<typeof useAppCopy>,
  onError: (message: string) => void,
) {
  const userId = session.identity?.userId;
  if (!userId || !session.isCurrentUser(userId)) return;
  let result: Awaited<ReturnType<typeof signOut>>;
  try {
    result = await signOut(userId);
  } catch (error) {
    recordLogoutTransportFailed({userId,companyId:session.identity?.companyId},error);
    if (session.isCurrentUser(userId)) onError(copy.auth.logoutFailed);
    return;
  }
  if (!session.isCurrentUser(userId)) return;
  if (!result.ok) {
    onError(result.message ?? copy.auth.logoutFailed);
    return;
  }
  clearCompanyDrafts(userId);
  publishSessionLogout(userId);
  session.clear();
  updateDemo({
    account: null,
    signedIn: false,
    stage: "guest",
    business: emptyBusiness,
    businessSaved: false,
    setupStep: 0,
    setupDone: [false, false, false, false],
  });
  // Discard the prior account's client router cache after confirmed logout.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/login");
}

/** Shared account menu: My account, work board, settings, logout. */
export function AccountMenu({
  compact = false,
  showBrand = false,
}: {
  compact?: boolean;
  showBrand?: boolean;
}) {
  const copy = useAppCopy();
  const { update } = useDemo();
  const session = useOptionalAccountSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutPending = useRef(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!session || session.status === "loading") {
    return (
      <div className="inline-flex min-h-11 min-w-[7rem] items-center justify-center rounded-full border border-[color:var(--color-border-soft)] px-3 text-xs text-[var(--color-muted-soft)]" aria-busy="true">
        {copy.loading}
      </div>
    );
  }

  if (session.status === "error") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-[#f0a0a0]">{copy.account.identityError}</span>
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--color-border-soft)] px-3 text-sm"
          onClick={() => void session.refresh()}
        >
          {copy.errors.accessRetry}
        </button>
      </div>
    );
  }

  if (session.status === "guest" || !session.identity) {
    return (
      <div className="flex items-center gap-2">
        {showBrand ? null : null}
        <Link href="/login" className="inline-flex min-h-11 items-center px-2 text-sm">
          {copy.auth.login}
        </Link>
        <Link
          href="/signup"
          className="inline-flex min-h-11 items-center rounded-full bg-[#38dc89] px-3 text-sm font-medium text-[#072317]"
        >
          {copy.auth.signup}
        </Link>
      </div>
    );
  }

  const identity = session.identity;
  const displayName = identity.fullName.trim() || identity.email || copy.brand;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`inline-flex min-h-11 max-w-[14rem] items-center gap-2 rounded-full border border-[color:var(--color-border-soft)] px-2 text-sm transition hover:bg-[var(--color-hover-wash)] ${compact ? "px-2" : "sm:px-3"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#38dc89]/20 text-xs font-bold text-[var(--color-success-fg)]"
          aria-hidden
        >
          {initialsOf(identity.fullName, identity.email)}
        </span>
        <span className="min-w-0 truncate font-medium">{displayName}</span>
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute end-0 z-50 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel)] p-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]"
        >
          <p className="truncate px-3 py-2 text-xs text-[var(--color-muted-soft)]" dir="ltr">{identity.email}</p>
          {identity.companyName ? (
            <p className="truncate px-3 pb-2 text-xs text-[var(--color-muted-on-dark)]" key={identity.companyId ?? identity.companyName}>
              {identity.companyName}
            </p>
          ) : null}
          <Link
            role="menuitem"
            href="/account"
            className="flex min-h-11 items-center rounded-xl px-3 text-sm hover:bg-[var(--color-hover-wash)]"
            onClick={() => setOpen(false)}
          >
            {copy.account.menuAccount}
          </Link>
          {identity.adminHref ? (
            <Link
              role="menuitem"
              href={identity.adminHref}
              className="flex min-h-11 items-center rounded-xl px-3 text-sm hover:bg-[var(--color-hover-wash)]"
              onClick={() => setOpen(false)}
            >
              {copy.account.menuPlatformAdmin}
            </Link>
          ) : null}
          {identity.workspaceHref ? (
            <Link
              role="menuitem"
              href={identity.workspaceHref}
              className="flex min-h-11 items-center rounded-xl px-3 text-sm hover:bg-[var(--color-hover-wash)]"
              onClick={() => setOpen(false)}
            >
              {identity.workspaceHref.startsWith("/setup")
                ? copy.account.menuSetup
                : copy.account.menuMyWorkspace}
            </Link>
          ) : null}
          {identity.companyId && identity.role ? (
            <Link
              role="menuitem"
              href="/app/settings"
              className="flex min-h-11 items-center rounded-xl px-3 text-sm hover:bg-[var(--color-hover-wash)]"
              onClick={() => setOpen(false)}
            >
              {copy.account.menuSettings}
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={loggingOut}
            aria-busy={loggingOut}
            className="flex min-h-11 w-full items-center rounded-xl px-3 text-start text-sm hover:bg-[var(--color-hover-wash)]"
            onClick={() => {
              if (logoutPending.current) return;
              logoutPending.current = true;
              setLoggingOut(true);
              setError(null);
              void performLogout(session, update, copy, setError).finally(() => {
                logoutPending.current = false;
                setLoggingOut(false);
              });
            }}
          >
            {loggingOut ? copy.loading : copy.logout}
          </button>
          {error ? <p className="px-3 py-2 text-xs text-[#f0a0a0]">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Top bar used on home, setup, admin, and shared account surfaces. */
export function AppTopBar({
  trailing,
}: {
  trailing?: ReactNode;
}) {
  const copy = useAppCopy();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Link href="/" className="inline-flex min-h-11 min-w-0 items-center gap-2 text-xl font-bold tracking-tight">
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#38dc89] text-sm text-[#072317]">V</span>
        <span className="truncate">{copy.brand}</span>
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <LangSwitch />
        {trailing}
        <AccountMenu />
      </div>
    </div>
  );
}

export function accountInitials(name: string, email: string) {
  return initialsOf(name, email);
}
