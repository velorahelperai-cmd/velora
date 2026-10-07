"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  classifyGetUserFailure,
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

type SessionStatus = "loading" | "guest" | "ready" | "error";

type AccountSessionValue = {
  status: SessionStatus;
  identity: AccountProfileView | null;
  refresh: () => Promise<void>;
  clear: () => void;
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
  const [status, setStatus] = useState<SessionStatus>(initial ? "ready" : "loading");
  const [identity, setIdentity] = useState<AccountProfileView | null>(initial ?? null);
  const userIdRef = useRef<string | null>(initial?.userId ?? null);
  const requestGen = useRef(0);
  /** Internal only — never rendered to visitors, never logs secrets. */
  const failureStageRef = useRef<IdentityFailureStage | null>(null);

  const clear = useCallback(() => {
    // Invalidate any in-flight refresh so a stale response cannot restore prior identity.
    requestGen.current += 1;
    userIdRef.current = null;
    failureStageRef.current = null;
    setIdentity(null);
    setStatus("guest");
  }, []);

  const refresh = useCallback(async () => {
    const gen = ++requestGen.current;
    try {
      const supabase = createClient();
      const { data, error: userError } = await supabase.auth.getUser();
      if (gen !== requestGen.current) return;

      if (userError) {
        const classified = classifyGetUserFailure(userError);
        failureStageRef.current = classified.stage;
        if (classified.kind === "guest") {
          // Confirmed AuthSessionMissingError — normal visitor, not an outage.
          clear();
          return;
        }
        // Network/server/unknown auth errors stay as error — never guest.
        setStatus("error");
        return;
      }

      if (!data.user) {
        failureStageRef.current = null;
        clear();
        return;
      }

      // Account switch: drop prior identity before applying the next profile.
      if (userIdRef.current && userIdRef.current !== data.user.id) {
        setIdentity(null);
        if (gen !== requestGen.current) return;
      }

      const result = await getAccountProfile();
      if (gen !== requestGen.current) return;
      if (!result.ok) {
        if (result.code === "UNAUTHENTICATED") {
          failureStageRef.current = "server_auth";
          clear();
          return;
        }
        failureStageRef.current = classifyProfileFailure(result.code);
        // Real outage/forbidden — not logout. Keep prior identity if same user.
        setStatus((prev) => (
          userIdRef.current === data.user.id && prev === "ready" ? "ready" : "error"
        ));
        return;
      }

      // Reject a successful profile that does not match this request's getUser subject.
      if (result.data.userId !== data.user.id) {
        failureStageRef.current = "profile";
        userIdRef.current = null;
        setIdentity(null);
        setStatus("error");
        return;
      }

      failureStageRef.current = null;
      userIdRef.current = result.data.userId;
      setIdentity(result.data);
      setStatus("ready");
    } catch {
      if (gen !== requestGen.current) return;
      failureStageRef.current = "browser_auth";
      setStatus("error");
    }
  }, [clear]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (initial) {
        userIdRef.current = initial.userId;
        setIdentity(initial);
        setStatus("ready");
        return;
      }
      void refresh();
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once / when initial identity prop changes
  }, [initial?.userId]);

  useEffect(() => {
    const supabase = createClient();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session?.user) {
        clear();
        return;
      }
      if (
        event === "SIGNED_IN"
        || event === "TOKEN_REFRESHED"
        || event === "USER_UPDATED"
        || event === "INITIAL_SESSION"
      ) {
        if (userIdRef.current && userIdRef.current !== session.user.id) {
          setIdentity(null);
        }
        setStatus((prev) => (prev === "ready" && userIdRef.current === session.user.id ? prev : "loading"));
        void refresh();
      }
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, [clear, refresh]);

  const setIdentityName = useCallback((name: string) => {
    setIdentity((prev) => (prev ? { ...prev, fullName: name } : prev));
  }, []);

  return (
    <AccountSessionContext.Provider value={{ status, identity, refresh, clear, setIdentityName }}>
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
