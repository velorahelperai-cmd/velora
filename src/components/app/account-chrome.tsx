"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { emptyBusiness, useDemo } from "@/lib/demo-state";
import { createClient } from "@/lib/supabase/client";
import {
  getAccountProfile,
  signOut,
  type AccountProfileView,
} from "@/lib/tenancy/actions";
import { LangSwitch, useAppCopy } from "@/components/app/ui";

type SessionStatus = "loading" | "guest" | "ready" | "error" | "expired";

type AccountSessionValue = {
  status: SessionStatus;
  identity: AccountProfileView | null;
  refresh: () => Promise<void>;
  clear: () => void;
  expire: () => void;
  setIdentityName: (name: string) => void;
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
  const [status, setStatus] = useState<SessionStatus>(initial ? "ready" : "loading");
  const [identity, setIdentity] = useState<AccountProfileView | null>(initial ?? null);
  const identityRef=useRef<AccountProfileView|null>(initial??null);
  const userIdRef = useRef<string | null>(initial?.userId ?? null);
  const requestGen = useRef(0);
  /** Internal only — never rendered to visitors, never logs secrets. */
  const failureStageRef = useRef<IdentityFailureStage | null>(null);

  const clear = useCallback(() => {
    // Invalidate any in-flight refresh so a stale response cannot restore prior identity.
    requestGen.current += 1;
    userIdRef.current = null;
    identityRef.current = null;
    failureStageRef.current = null;
    setIdentity(null);
    setStatus("guest");
  }, []);

  const expire=useCallback(()=>{requestGen.current+=1;userIdRef.current=null;identityRef.current=null;setIdentity(null);setStatus("expired");},[]);

  const refresh = useCallback(async () => {
    const gen=++requestGen.current;
    try {
      const result=await getAccountProfile();
      if(gen!==requestGen.current)return;
      if(!result.ok){
        if(result.code==="UNAUTHENTICATED"){if(result.sessionExpired)expire();else clear();return;}
        failureStageRef.current=classifyProfileFailure(result.code);
        setStatus(prev=>identityRef.current&&prev==="ready"?"ready":"error");return;
      }
      if(userIdRef.current && userIdRef.current!==result.data.userId){setIdentity(null);providerRouter.refresh();}
      userIdRef.current=result.data.userId;identityRef.current=result.data;
      failureStageRef.current=null;setIdentity(result.data);setStatus("ready");
    }catch{
      if(gen!==requestGen.current)return;
      failureStageRef.current="server_auth";setStatus(prev=>identityRef.current&&prev==="ready"?"ready":"error");
    }
  },[clear,expire,providerRouter]);

  useEffect(()=>{
    const frame=window.requestAnimationFrame(()=>{void refresh();});
    return ()=>window.cancelAnimationFrame(frame);
  },[refresh]);

  useEffect(()=>{
    const supabase=createClient();let timer:ReturnType<typeof setTimeout>|undefined;
    const {data:sub}=supabase.auth.onAuthStateChange((event,session)=>{
      if(timer)clearTimeout(timer);
      if(event==="SIGNED_OUT"){clear();providerRouter.refresh();return;}
      if(session?.user && userIdRef.current && userIdRef.current!==session.user.id){
        requestGen.current+=1;userIdRef.current=null;identityRef.current=null;setIdentity(null);setStatus("loading");providerRouter.refresh();
      }
      // Server Actions update cookies without guaranteeing a browser SIGNED_IN event.
      // INITIAL_SESSION=null therefore checks the server instead of inventing a logout.
      timer=setTimeout(()=>{void refresh();},0);
    });
    return ()=>{if(timer)clearTimeout(timer);sub.subscription.unsubscribe();requestGen.current+=1;};
  },[clear,refresh,providerRouter]);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const recheck=()=>{if(document.visibilityState!=="visible")return;if(timer)clearTimeout(timer);timer=setTimeout(()=>{void refresh();},0);};
    window.addEventListener("focus",recheck);document.addEventListener("visibilitychange",recheck);
    return ()=>{if(timer)clearTimeout(timer);window.removeEventListener("focus",recheck);document.removeEventListener("visibilitychange",recheck);};
  },[refresh]);
  const setIdentityName = useCallback((name: string) => {
    setIdentity((prev) => {const updated=prev?{...prev,fullName:name}:prev;identityRef.current=updated;return updated;});
  }, []);

  const sessionValue=useMemo(()=>({status,identity,refresh,clear,expire,setIdentityName}),[status,identity,refresh,clear,expire,setIdentityName]);
  return (
    <AccountSessionContext.Provider value={sessionValue}>
      {children}
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

async function performLogout(
  clear: () => void,
  updateDemo: ReturnType<typeof useDemo>["update"],
  copy: ReturnType<typeof useAppCopy>,
  router: ReturnType<typeof useRouter>,
  onError: (message: string) => void,
) {
  let userId: string | undefined;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id;
  } catch {
    /* signOut remains authoritative */
  }
  const result = await signOut();
  if (!result.ok) {
    onError(result.message ?? copy.auth.logoutFailed);
    return;
  }
  if (userId) clearCompanyDrafts(userId);
  clear();
  updateDemo({
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

/** Shared account menu: My account, work board, settings, logout. */
export function AccountMenu({
  compact = false,
  showBrand = false,
}: {
  compact?: boolean;
  showBrand?: boolean;
}) {
  const copy = useAppCopy();
  const router = useRouter();
  const { update } = useDemo();
  const session = useOptionalAccountSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
            className="flex min-h-11 w-full items-center rounded-xl px-3 text-start text-sm hover:bg-[var(--color-hover-wash)]"
            onClick={() => {
              setOpen(false);
              void performLogout(session.clear, update, copy, router, setError);
            }}
          >
            {copy.logout}
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
