"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOptionalAccountSession } from "./account-chrome";
import { safeInternalPath } from "@/lib/auth/safe-next";
import { Button, Notice, useAppCopy } from "@/components/app/ui";
import { quarantineCurrentBrokerSession } from "@/lib/auth/broker-actions";
import { publishSessionQuarantine } from "@/lib/auth/session-context";

/** Only confirmed expiry auto-redirects; service outages remain retryable. */
export function AccessGate({
  code,
  reason,
}: {
  code: "FORBIDDEN" | "UNAVAILABLE" | "SESSION_EXPIRED";
  /** Optional machine reason (e.g. DEPENDENCY_MISSING:…) — never secrets. */
  reason?: string | null;
}) {
  const copy = useAppCopy();
  const router = useRouter();
  const pathname = usePathname();
  const session = useOptionalAccountSession();
  const clearSession = session?.clear;
  const lockSession = session?.lock;
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState(false);
  const signInPending = useRef(false);
  const expired = code === "SESSION_EXPIRED" || reason === "SESSION_EXPIRED" || reason === "APP_SESSION_EXPIRED";
  const signInAgain = useCallback(async () => {
    if (signInPending.current) return;
    signInPending.current = true;
    setSigningIn(true);
    setSignInError(false);
    try {
      // Cleanup-retained ids vs live validity (C3-6).
      const capture = session?.cleanupCapture?.() ?? {
        userId: session?.identity?.userId ?? null,
        boundaryFingerprint: session?.boundaryFingerprint ?? null,
      };
      const userId = capture.userId;
      const captureFp = capture.boundaryFingerprint;
      // Immediate local quarantine; broker expires only this handle (no SDK global/others).
      lockSession?.(captureFp);
      if (userId) publishSessionQuarantine(userId, captureFp);
      await quarantineCurrentBrokerSession(captureFp);
      // Live snapshot after await — not captured React ready/status (C4-05).
      const live = session?.liveSnapshot?.();
      if (live && live.boundaryFingerprint !== captureFp) return;
      if (live?.ready) {
        if (!captureFp || live.boundaryFingerprint !== captureFp) return;
      }
      clearSession?.();
      const next = safeInternalPath(pathname + window.location.search, "/");
      const reason = expired ? "session_expired" : "reauthenticate";
      router.replace(`/login?reason=${reason}&next=${encodeURIComponent(next)}`);
      router.refresh();
    } catch {
      setSignInError(true);
    } finally {
      signInPending.current = false;
      setSigningIn(false);
    }
  }, [clearSession, expired, lockSession, pathname, router, session]);
  useEffect(() => {
    if (!expired) return;
    const frame = requestAnimationFrame(() => { void signInAgain(); });
    return () => cancelAnimationFrame(frame);
  }, [expired, signInAgain]);
  const dependencyMissing = Boolean(reason?.startsWith("DEPENDENCY_MISSING:"));
  const title = expired ? copy.errors.sessionExpiredTitle : code === "FORBIDDEN"
    ? copy.errors.forbiddenTitle
    : dependencyMissing
      ? copy.admin.conversationsDependencyTitle
      : copy.errors.unavailableTitle;
  const body = expired ? copy.errors.sessionExpiredBody : code === "FORBIDDEN"
    ? copy.errors.forbiddenBody
    : dependencyMissing
      ? copy.admin.conversationsDependencyBody
      : copy.errors.unavailableBody;

  return (
    <main className="app-shell px-4 py-10">
      <div className="mx-auto grid max-w-lg gap-4">
        <Notice tone={code === "FORBIDDEN" ? "warn" : "error"}>
          <strong>{title}</strong>
          <br />
          {body}
          {dependencyMissing && reason ? (
            <>
              <br />
              <span className="mt-2 block font-mono text-xs text-[var(--color-muted-soft)]" dir="ltr">{reason}</span>
            </>
          ) : null}
        </Notice>
        {signInError ? <Notice tone="error">{copy.errors.authFailed}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => router.refresh()}>
            {copy.errors.accessRetry}
          </Button>
          <Button type="button" variant="secondary" busy={signingIn} busyLabel={copy.loading} onClick={() => void signInAgain()}>
            {copy.errors.accessSignIn}
          </Button>
          <Link href="/admin" className="inline-flex min-h-11 items-center rounded-xl border border-[color:var(--color-border-soft)] px-4 text-sm text-[#38dc89]">
            {copy.admin.title}
          </Link>
          <Link href="/" className="inline-flex min-h-11 items-center rounded-xl border border-[color:var(--color-border-soft)] px-4 text-sm text-[#38dc89]">
            {copy.home}
          </Link>
        </div>
      </div>
    </main>
  );
}
