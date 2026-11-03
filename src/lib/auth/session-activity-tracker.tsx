"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOptionalAccountSession } from "@/components/app/account-chrome";
import { checkSessionActivity } from "./session-actions";
import { emptyBusiness, useDemo } from "@/lib/demo-state";
import { clearPendingSignup } from "./auth-journey";
import { recordSessionCheckUnavailable } from "@/lib/logging/browser.mjs";
import { quarantineCurrentBrokerSession } from "@/lib/auth/broker-actions";
import { publishSessionQuarantine } from "@/lib/auth/session-context";

function isTransientAuthError(err: unknown): boolean {
  if (!err) return false;
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const msg = String((err as { message?: string })?.message ?? err).toLowerCase();
  const name = String((err as { name?: string })?.name ?? "").toLowerCase();
  return (
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("offline") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("unavailable") ||
    msg.includes("failed to fetch") ||
    name.includes("network") ||
    name.includes("aborterror") ||
    name.includes("timeouterror")
  );
}

/** Server timestamps enforce the policy. This timer provides UI updates only. */
export function SessionActivityTracker() {
  const { update, locale } = useDemo();
  const session = useOptionalAccountSession(),
    router = useRouter(),
    pathname = usePathname(),
    pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  const lastTouch = useRef({ userId: "", at: 0 }),
    expiryHandled = useRef(false);
  const [unverifiedHolding, setUnverifiedHolding] = useState(false);
  const manualRecheck = useRef<() => void>(() => {});

  useEffect(() => {
    if (session?.status === "expired") {
      // hasCurrentUser is false while expired — cleanup-retained userId must not skip close (C3-6).
      if (expiryHandled.current) return;
      expiryHandled.current = true;
      let cancelled = false;
      const capture =
        session.cleanupCapture?.() ?? {
          userId: session.identity?.userId ?? null,
          boundaryFingerprint: session.boundaryFingerprint,
        };
      const userId = capture.userId;
      const boundaryFp = capture.boundaryFingerprint;
      session.lock(boundaryFp);
      if (userId) publishSessionQuarantine(userId, boundaryFp);
      clearPendingSignup();
      update({
        account: null,
        signedIn: false,
        stage: "guest",
        business: emptyBusiness,
        businessSaved: false,
        setupStep: 0,
        setupDone: [false, false, false, false],
      });
      const path = pathRef.current;
      void quarantineCurrentBrokerSession(boundaryFp)
        .catch(() => {})
        .finally(() => {
          if (cancelled) return;
          // Live refs after await — never trust captured session.status from expiry effect (C4-05).
          const live = session.liveSnapshot?.() ?? {
            status: session.status,
            userId: session.identity?.userId ?? null,
            boundaryFingerprint: session.boundaryFingerprint,
            ready: session.status === "ready" && session.hasCurrentUser(),
          };
          if (live.ready) return;
          if (live.boundaryFingerprint !== boundaryFp) return;
          session.clear();
          if (/^\/(app|admin|account|setup|complete-profile)(\/|$)/.test(path))
            router.replace(
              `/login?reason=session_expired&next=${encodeURIComponent(path + window.location.search)}`,
            );
          router.refresh();
        });
      return () => {
        cancelled = true;
      };
    }
    if (session?.status !== "ready" || !session.identity) return;
    expiryHandled.current = false;
    const identity = session.identity,
      userId = identity.userId;
    let stopped = false,
      busy = false,
      pendingTouch = false,
      outageLogged = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    let unavailableAttempts = 0;
    const current = () => !stopped && session.isCurrentUser(userId, identity);
    let expiry = Date.parse(session.identity.sessionExpiresAt ?? "");
    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (Number.isFinite(expiry))
        timer = setTimeout(() => {
          void check(false);
        }, Math.min(Math.max(expiry - Date.now() + 100, 1000), 3600000));
    };
    const retry = () => {
      if (!outageLogged) {
        recordSessionCheckUnavailable(identity);
        outageLogged = true;
      }
      unavailableAttempts += 1;
      if (unavailableAttempts >= 3) {
        // Exhaustion of 3 retries alone does not prove session termination.
        // Retain session, prevent sensitive operations with a re-verification option, without quarantining automatically.
        setUnverifiedHolding(true);
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void check(false);
      }, 30000);
    };
    async function check(touch: boolean) {
      if (!current()) return;
      if (busy) {
        if (touch) pendingTouch = true;
        return;
      }
      busy = true;
      const capturedBoundary = session?.boundaryFingerprint;
      const capturedUserId = userId;
      try {
        const result = await checkSessionActivity(touch);
        const live = session?.liveSnapshot?.() ?? {
          status: session?.status,
          userId: session?.identity?.userId ?? null,
          boundaryFingerprint: session?.boundaryFingerprint,
          ready: session?.status === "ready" && session?.hasCurrentUser(),
        };
        // Stale check fencing: prevent an old check from affecting a new session or boundary
        if (!current() || live.boundaryFingerprint !== capturedBoundary || live.userId !== capturedUserId) return;
        if (result.ok) {
          outageLogged = false;
          unavailableAttempts = 0;
          setUnverifiedHolding(false);
          expiry = Date.parse(result.expiresAt);
          schedule();
          return;
        }
        // Confirmed rejection, including cancellation, revocation, or expired:
        // انتهاء JWT مش بالضرورة انتهاء الجلسة؛ لو التجديد مسموح ونجح، ما نطردش المستخدم.
        if (result.code === "UNAUTHENTICATED" && result.confirmed === true) {
          if (typeof session?.refresh === "function") {
            let refreshErr: unknown = null;
            try {
              await session.refresh();
            } catch (err) {
              refreshErr = err;
            }
            const refreshedLive = session?.liveSnapshot?.() ?? {
              status: session?.status,
              userId: session?.identity?.userId ?? null,
              boundaryFingerprint: session?.boundaryFingerprint,
              ready: session?.status === "ready" && session?.hasCurrentUser(),
            };
            // Refresh replaces the identity object even for the same session.
            // Fence by live account/boundary, not the pre-refresh object reference.
            if (stopped) return;
            if (refreshedLive.status === "guest" || refreshedLive.status === "expired" || refreshedLive.status === "locked") return;
            if (refreshedLive.boundaryFingerprint !== capturedBoundary || refreshedLive.userId !== capturedUserId) return;
            if (refreshedLive.ready && !refreshErr) {
              // Renewal succeeded! Do not kick out the user.
              outageLogged = false;
              unavailableAttempts = 0;
              setUnverifiedHolding(false);
              schedule();
              return;
            }
            // Distinguish transient failure (network/offline/temporary blip) from confirmed rejection:
            if (isTransientAuthError(refreshErr) || refreshedLive.status === "error") {
              // فشل تجديد الجلسة بسبب الشبكة أو تعذر مؤقت لا يطرد المستخدم.
              // حافظ على المسودة والجلسة، وادخل في إعادة المحاولة والتعليق المؤقت.
              retry();
              return;
            }
            // An unresolved refresh is not fresh rejection evidence. The
            // session provider owns confirmed guest/expired transitions.
            retry();
            return;
          }
          stopped = true;
          session?.expire();
          return;
        }
        retry();
      } catch {
        // A failed Server Action transport is not proof of expiry. Retry only a
        // read; reconnecting cannot invent human activity or revive a session.
        if (current()) retry();
      } finally {
        busy = false;
        if (pendingTouch && current()) {
          pendingTouch = false;
          void check(true);
        }
      }
    }
    manualRecheck.current = () => {
      if (!current()) return;
      unavailableAttempts = 0;
      setUnverifiedHolding(false);
      void check(false);
    };
    function activity(event: Event) {
      if (!event.isTrusted || document.visibilityState !== "visible" || !current()) return;
      if (lastTouch.current.userId === userId && Date.now() - lastTouch.current.at < 30000) return;
      lastTouch.current = { userId, at: Date.now() };
      void check(true);
    }
    const recheck = () => {
      if (document.visibilityState === "visible") {
        unavailableAttempts = 0;
        setUnverifiedHolding(false);
        void check(false);
      }
    };
    window.addEventListener("focus", recheck);
    window.addEventListener("visibilitychange", recheck);
    const events = ["pointerdown", "keydown", "wheel", "touchmove"] as const;
    events.forEach((event) => window.addEventListener(event, activity, { passive: true }));
    schedule();
    if (!Number.isFinite(expiry)) void check(false);
    return () => {
      stopped = true;
      manualRecheck.current = () => {};
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("visibilitychange", recheck);
      events.forEach((event) => window.removeEventListener(event, activity));
    };
  }, [session, router, update]);

  if (session?.status === "expired") {
    return (
      <div role="alert" className="fixed inset-0 z-[1000] grid place-items-center bg-[#07110d] px-6 text-center text-white">
        <p>
          {locale === "ar"
            ? "انتهت الجلسة. جارٍ تأمين الحساب والعودة لتسجيل الدخول…"
            : "Your session expired. Securing your account and returning to sign in…"}
        </p>
      </div>
    );
  }
  if (unverifiedHolding) {
    return (
      <aside
        role="status"
        aria-live="polite"
        className="fixed top-0 inset-x-0 z-[999] flex flex-wrap items-center justify-between gap-3 bg-amber-950/95 border-b border-amber-600/40 px-4 py-2.5 text-sm text-amber-200"
      >
        <p>
          {locale === "ar"
            ? "تعذر التحقق من حالة الجلسة مؤقتًا. العمليات الحساسة معلقة لحماية الحساب."
            : "Session verification is temporarily unavailable. Sensitive operations are held for security."}
        </p>
        <button
          type="button"
          onClick={() => manualRecheck.current()}
          className="rounded bg-amber-700/80 hover:bg-amber-600 px-3 py-1 font-medium text-white transition-colors"
        >
          {locale === "ar" ? "إعادة التحقق الآن" : "Re-verify now"}
        </button>
      </aside>
    );
  }
  return null;
}
