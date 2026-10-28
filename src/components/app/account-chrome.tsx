"use client";

import Link from "next/link";
import {setupTiming} from "@/lib/diagnostics/setup-timing";
import {beginDiagnostic} from "@/lib/diagnostics/flow";
import {readAuthCorrelation} from "@/lib/diagnostics/correlation.mjs";
import {createSessionReadBudget} from "@/lib/auth/session-read-budget";
import { ApprovedAccountLoader, useApprovedLoaderGate } from "./approved-account-loader";
import {recordLogoutTransportFailed,recordSessionCheckUnavailable} from "@/lib/logging/browser.mjs";
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
import {
  getAccountProfile,
  signOut,
  type AccountProfileView,
} from "@/lib/tenancy/actions";
import { LangSwitch, useAppCopy } from "@/components/app/ui";
import {publishSessionContext,publishSessionLogout,publishSessionQuarantine,readLocalQuarantine,subscribeSessionContext} from "@/lib/auth/session-context";
import {SessionActivityTracker} from "@/lib/auth/session-activity-tracker";
import { OperationRecovery, type RecoveryReceipt } from "./operation-recovery";
import { createRecoveryReceipt, readRecoveryReceipt } from "@/lib/auth/operation-recovery";

type SessionStatus = "loading" | "guest" | "ready" | "error" | "expired" | "locked";

type AccountSessionValue = {
  status: SessionStatus;
  identity: AccountProfileView | null;
  boundaryFingerprint: string | null;
  refresh: (correlation?: unknown) => Promise<void>;
  clear: () => void;
  expire: () => void;
  lock: (boundaryFingerprint?: string | null) => void;
  setIdentityName: (name: string, expectedUserId: string) => void;
  isCurrentUser: (userId: string, expectedIdentity?: AccountProfileView) => boolean;
  /** True only while session is ready for use — not cleanup-retained expired/locked ids (C3-6). */
  hasCurrentUser: () => boolean;
  /** Capture retained for quarantine after expire — not a validity grant. */
  cleanupCapture: () => { userId: string | null; boundaryFingerprint: string | null };
  /** True only while the captured opaque boundary remains the locked authority. */
  isCapturedBoundary: (boundaryFingerprint: string | null | undefined) => boolean;
  /** Live ref snapshot for post-await fences — not React render values (C4-05). */
  liveSnapshot: () => {
    status: SessionStatus;
    userId: string | null;
    boundaryFingerprint: string | null;
    ready: boolean;
  };
  recoverOperation?: (receipt: RecoveryReceipt | null) => void;
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
  // Never start "ready" from SSR initial alone — mount quarantine may lock A before paint (C3).
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [recoveryReceipt, setRecoveryReceipt] = useState<RecoveryReceipt | null>(null);
  const [identity, setIdentity] = useState<AccountProfileView | null>(null);
  const [boundaryFingerprint, setBoundaryFingerprint] = useState<string | null>(null);
  const identityRef=useRef<AccountProfileView|null>(null);
  const userIdRef = useRef<string | null>(null);
  const boundaryRef = useRef<string | null>(null);
  const statusRef = useRef<SessionStatus>("loading");
  const lockedRef = useRef(false);
  const initialRef = useRef(initial ?? null);
  void initialRef;
  const requestGen = useRef(0);
  const readBudgets = useRef(new Set<ReturnType<typeof createSessionReadBudget>>());
  const softRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRef = useRef<(correlation?: unknown) => Promise<void>>(async () => {});
  const cancelReadBudgets = useCallback(() => {
    for (const budget of readBudgets.current) budget.cancel();
    readBudgets.current.clear();
  }, []);
  const clearSoftRetry = useCallback(() => {
    if (softRetryTimerRef.current) {
      clearTimeout(softRetryTimerRef.current);
      softRetryTimerRef.current = null;
    }
  }, []);
  useEffect(() => () => {requestGen.current += 1;cancelReadBudgets();clearSoftRetry();}, [cancelReadBudgets, clearSoftRetry]);
  const signalRead=useRef<{generation:number;promise:Promise<void>}|null>(null);
  const routeReloading=useRef(false);
  const publishedContext=useRef<string|null>(null);
  /** Retain an already-ready identity across transport blips; real logout/mismatch still fail closed. */
  const retainReadyOnTransient = useCallback((code: string): boolean => {
    if (code !== "UNAVAILABLE" && code !== "TRANSPORT" && code !== "AUTH_ERROR") return false;
    if (lockedRef.current || statusRef.current !== "ready") return false;
    const identity = identityRef.current;
    const userId = userIdRef.current;
    if (!identity || !userId || identity.userId !== userId) return false;
    if (!softRetryTimerRef.current) {
      softRetryTimerRef.current = setTimeout(() => {
        softRetryTimerRef.current = null;
        if (lockedRef.current || statusRef.current !== "ready") return;
        void refreshRef.current();
      }, 2500);
    }
    return true;
  }, []);
  /** One-use mount broker seed for the reserved same-operation epoch only — never persisted. */
  const bootstrapBrokerSeed = useRef<{
    epoch: number;
    budget: ReturnType<typeof createSessionReadBudget>;
    broker: {
      ok: true;
      userId: string;
      boundaryFingerprint: string;
      nativeSessionId: string;
      contextGeneration: number;
      generation: string;
    };
  } | null>(null);
  /** Internal only — never rendered to visitors, never logs secrets. */
  const failureStageRef = useRef<IdentityFailureStage | null>(null);

  const setStatusLive = useCallback((next: SessionStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const clear = useCallback(() => {
    // Invalidate any in-flight refresh so a stale response cannot restore prior identity.
    requestGen.current += 1;
    cancelReadBudgets();
    clearSoftRetry();
    bootstrapBrokerSeed.current = null;
    userIdRef.current = null;
    identityRef.current = null;
    boundaryRef.current = null;
    lockedRef.current = false;
    publishedContext.current = null;
    failureStageRef.current = null;
    setIdentity(null);
    setBoundaryFingerprint(null);
    setStatusLive("guest");
  }, [setStatusLive, cancelReadBudgets, clearSoftRetry]);

  // Retain captured boundary across expire so idle quarantine cannot retarget B (C2-R7).
  const expire=useCallback(()=>{
    requestGen.current+=1;
    cancelReadBudgets();
    clearSoftRetry();
    bootstrapBrokerSeed.current=null;
    identityRef.current=null;
    publishedContext.current=null;
    setIdentity(null);
    setStatusLive("expired");
    // Keep userIdRef + boundaryRef + boundaryFingerprint for capture-bound quarantine.
  },[setStatusLive,cancelReadBudgets,clearSoftRetry]);

  const lock=useCallback((fp?:string|null)=>{
    requestGen.current+=1;
    cancelReadBudgets();
    clearSoftRetry();
    bootstrapBrokerSeed.current=null;
    lockedRef.current=true;
    // Keep userId fence so stale results for THIS capture cannot unlock; clear identity content.
    identityRef.current=null;setIdentity(null);setStatusLive("locked");
    const next=fp??boundaryRef.current;
    if(next){
      boundaryRef.current=next;
      setBoundaryFingerprint(next);
      // Read storage once; keep same-boundary memory receipt when storage is empty/unavailable.
      const storedReceipt=readRecoveryReceipt(next);
      setRecoveryReceipt((current)=>current?.boundaryFingerprint===next?current:storedReceipt);
    }else{
      setRecoveryReceipt(null);
    }
  },[setStatusLive,cancelReadBudgets,clearSoftRetry]);

  const refresh = useCallback(async (correlation?: unknown) => {
    // Optional log metadata never changes the session attestation or generation fences.
    const parent = readAuthCorrelation(correlation);
    // Direct /setup bootstrap and manual refresh need the same fixed,
    // redacted timing envelope as verification-triggered refreshes.
    const trace = beginDiagnostic("auth_session_check", parent);
    trace?.stage("session");
    if(routeReloading.current){trace?.finish("CONFLICT");return;}
    if(lockedRef.current){trace?.finish("FORBIDDEN");return;} // captured lock never auto-restores from profile read
    // Consume one-use mount seed only while its reserved epoch is still current.
    const seed =
      bootstrapBrokerSeed.current && bootstrapBrokerSeed.current.epoch === requestGen.current
        ? bootstrapBrokerSeed.current
        : null;
    bootstrapBrokerSeed.current = null;
    const gen = seed ? seed.epoch : ++requestGen.current;
    const budget = seed?.budget ?? createSessionReadBudget();
    readBudgets.current.add(budget);
    try {
      const { readBrokerSessionStatus } = await budget.read(() => import("@/lib/auth/broker-actions"));
      const broker = seed ? seed.broker : await budget.read(() => readBrokerSessionStatus(trace.correlation));
      if(gen!==requestGen.current){trace?.finish("CONFLICT");return;}
      if(!broker.ok){
        if(broker.code==="UNAUTHENTICATED"){
          if(userIdRef.current)publishSessionLogout(userIdRef.current,boundaryRef.current);
          clear();
          trace?.finish("UNAUTHENTICATED");
          return;
        }
        failureStageRef.current="server_auth";
        // Transport/availability failure is not logout — keep capture refs.
        // If already ready, retain the page and soft-retry instead of wiping /setup.
        recordSessionCheckUnavailable(
          {userId:userIdRef.current??undefined,companyId:identityRef.current?.companyId??null},
          undefined,
          {code:broker.code,stage:"server_auth",...(trace?{correlation:trace.correlation}:{})},
        );
        if(!retainReadyOnTransient(broker.code))setStatusLive("error");
        trace?.finish("UNAVAILABLE");
        return;
      }
      // Capture broker boundary BEFORE mutating refs — compare against prior tip (C4-05).
      const priorBoundary = boundaryRef.current;
      const brokerBoundary = broker.boundaryFingerprint;
      const brokerGeneration = broker.generation;
      if (priorBoundary && identityRef.current && priorBoundary !== brokerBoundary) {
        routeReloading.current = true;
        setStatusLive("loading");
        providerRouter.refresh();
        trace?.event("handoff", "CONFLICT");
        window.location.reload();
        return;
      }
      trace?.stage("profile");
      const result = await budget.read(() => getAccountProfile(trace.correlation));
      if (gen !== requestGen.current) {trace?.finish("CONFLICT");return;}
      trace.event("profile", result.ok ? "OK" : "UNAVAILABLE");
      if (!result.ok) {
        if (result.code === "UNAUTHENTICATED") {
          if (userIdRef.current) publishSessionLogout(userIdRef.current, boundaryRef.current);
          if (result.sessionExpired) expire();
          else clear();
          trace?.finish("UNAUTHENTICATED");
          return;
        }
        failureStageRef.current = classifyProfileFailure(result.code);
        recordSessionCheckUnavailable(
          {userId:userIdRef.current??undefined,companyId:identityRef.current?.companyId??null},
          undefined,
          {code:result.code,stage:failureStageRef.current,...(trace?{correlation:trace.correlation}:{})},
        );
        if(!retainReadyOnTransient(result.code))setStatusLive("error");
        trace?.finish("UNAVAILABLE");
        return;
      }
      // Re-read live broker status after profile await — same tip/generation (C4-05).
      trace.stage("refresh");
      const broker2 = await budget.read(() => readBrokerSessionStatus(trace.correlation));
      if (gen !== requestGen.current) {trace?.finish("CONFLICT");return;}
      if (
        !broker2.ok
        || broker2.userId !== broker.userId
        || broker2.boundaryFingerprint !== brokerBoundary
        || broker2.generation !== brokerGeneration
        || result.data.userId !== broker2.userId
      ) {
        failureStageRef.current = "server_auth";
        const reattestCode=!broker2.ok?broker2.code:"BOUNDARY_MISMATCH";
        recordSessionCheckUnavailable(
          {userId:userIdRef.current??undefined,companyId:identityRef.current?.companyId??null},
          undefined,
          {code:reattestCode,stage:"server_auth",...(trace?{correlation:trace.correlation}:{})},
        );
        // Tip/generation mismatch stays fail-closed; pure transport UNAVAILABLE may retain ready.
        if(!retainReadyOnTransient(reattestCode))setStatusLive("error");
        trace?.finish("UNAVAILABLE");
        return;
      }
      if (userIdRef.current && !identityRef.current && userIdRef.current !== result.data.userId) {
        failureStageRef.current = "server_auth";
        recordSessionCheckUnavailable(
          {userId:userIdRef.current??undefined,companyId:null},
          undefined,
          {code:"USER_MISMATCH",stage:"server_auth",...(trace?{correlation:trace.correlation}:{})},
        );
        setStatusLive("error");
        trace?.finish("UNAVAILABLE");
        return;
      }
      const context = { userId: result.data.userId, companyId: result.data.companyId };
      const signature = JSON.stringify(context);
      if (publishedContext.current !== signature) {
        publishedContext.current = signature;
        publishSessionContext(context);
      }
      const switching = userIdRef.current !== null && userIdRef.current !== result.data.userId;
      const changingWorkspace =
        identityRef.current !== null && identityRef.current.companyId !== result.data.companyId;
      if (switching || changingWorkspace) {
        routeReloading.current = true;
        userIdRef.current = result.data.userId;
        identityRef.current = null;
        setIdentity(null);
        setStatusLive("loading");
        providerRouter.refresh();
        trace?.event("handoff", "CONFLICT");
        window.location.reload();
        return;
      }
      try {
        discardForeignTeamJournal(window.sessionStorage, result.data.userId);
      } catch {
        /* Storage is optional for identity. */
      }
      boundaryRef.current = brokerBoundary;
      setBoundaryFingerprint(brokerBoundary);
      userIdRef.current = result.data.userId;
      identityRef.current = result.data;
      failureStageRef.current = null;
      clearSoftRetry();
      setIdentity(result.data);
      setStatusLive("ready");
      trace?.event("completed", "OK");
    } catch {
      if (gen !== requestGen.current) {trace?.finish("CONFLICT");return;}
      failureStageRef.current = "server_auth";
      // Throw during reattest is not logout. Keep ready when identity was already admitted.
      recordSessionCheckUnavailable(
        {userId:userIdRef.current??undefined,companyId:identityRef.current?.companyId??null},
        undefined,
        {code:"TRANSPORT",stage:"server_auth",...(trace?{correlation:trace.correlation}:{})},
      );
      if(!retainReadyOnTransient("TRANSPORT"))setStatusLive("error");
      trace?.finish("OUTCOME_UNKNOWN");
    } finally {
      budget.cancel();readBudgets.current.delete(budget);
    }
  }, [clear, expire, providerRouter, setStatusLive, retainReadyOnTransient, clearSoftRetry]);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

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
    if((signal.type==="logout"||signal.type==="quarantine")&&userIdRef.current&&userIdRef.current!==signal.userId)return;
    if(signal.type==="quarantine"){
      if(boundaryRef.current&&signal.boundaryFingerprint&&boundaryRef.current!==signal.boundaryFingerprint)return;
      lock(signal.boundaryFingerprint);
      return;
    }
    if(signal.type==="logout"){
      // Same-user logout of A must not clear newer B (boundary-scoped) — C2-R7.
      if(signal.boundaryFingerprint&&boundaryRef.current&&signal.boundaryFingerprint!==boundaryRef.current)return;
      if(boundaryRef.current&&!signal.boundaryFingerprint){
        // Legacy user-only logout hint: ignore when this tab already has a boundary (may be B).
        return;
      }
      clear();
      return;
    }
    const current=identityRef.current;
    if(signal.type==="context"&&current?.userId===signal.userId&&current.companyId===signal.companyId)return;
    routeReloading.current=true;requestGen.current+=1;bootstrapBrokerSeed.current=null;userIdRef.current=null;identityRef.current=null;
    boundaryRef.current=null;failureStageRef.current=null;setIdentity(null);setBoundaryFingerprint(null);setStatusLive("loading");
    providerRouter.refresh();window.location.reload();
  }),[providerRouter,lock,clear,setStatusLive]);

  // C3: consume persisted quarantine BEFORE SSR initial / protected content.
  // Isolate by boundary fingerprint so A's lock never fences same-user B.
  // Bootstrap epoch is reserved synchronously before RAF so clear/lock/unmount before
  // the first frame invalidates scheduled work; focus/visibility joins this same operation
  // via signalRead until quarantine+seed+refresh complete (no protected profile early).
  useEffect(()=>{
    let cancelled=false;
    // Reserve BEFORE scheduling RAF / first await (PERF-ES02-ACC-BOOT-001).
    const epoch=++requestGen.current;
    let releaseFrame!:()=>void;
    const frameGate=new Promise<void>((resolve)=>{releaseFrame=resolve;});
    const bootstrap= (async()=>{
      await frameGate;
      if(cancelled||requestGen.current!==epoch)return;
      const signal=readLocalQuarantine();
      const budget=createSessionReadBudget();
      readBudgets.current.add(budget);
      const bootstrapTrace=beginDiagnostic("auth_session_check");
      bootstrapTrace.stage("session");
      try{
        const {readBrokerSessionStatus}=await budget.read(()=>import("@/lib/auth/broker-actions"));
        const broker=await budget.read(()=>readBrokerSessionStatus(bootstrapTrace.correlation));
        if(cancelled||requestGen.current!==epoch)return;
        bootstrapTrace.event("session",broker.ok?"OK":broker.code==="UNAUTHENTICATED"?"UNAUTHENTICATED":"UNAVAILABLE");
        if(signal?.type==="quarantine"){
          if(broker.ok){
            if(signal.userId===broker.userId){
              if(
                !signal.boundaryFingerprint
                || signal.boundaryFingerprint===broker.boundaryFingerprint
              ){
                userIdRef.current=signal.userId;
                boundaryRef.current=signal.boundaryFingerprint??broker.boundaryFingerprint;
                lock(signal.boundaryFingerprint??broker.boundaryFingerprint);
                return;
              }
              // Quarantine targets A; cookies already select B — ignore for this tab.
            }
          }else if(broker.code==="UNAUTHENTICATED"||broker.code==="QUARANTINED"){
            // Captured A gone from cookies — keep locked; never flash SSR initial for A.
            userIdRef.current=signal.userId;
            lock(signal.boundaryFingerprint);
            return;
          }
        }
        if(signal?.type==="logout"){
          if(broker.ok){
            if(signal.userId!==broker.userId){ /* foreign */ }
            else if(signal.boundaryFingerprint&&signal.boundaryFingerprint!==broker.boundaryFingerprint){
              // Logout of A; cookies already select B — ignore.
            }else if(!signal.boundaryFingerprint){
              // User-only hint must not clear fresher B with a known boundary.
            }else{
              userIdRef.current=signal.userId;
              clear();
              return;
            }
          }else if(broker.code==="UNAUTHENTICATED"){
            userIdRef.current=signal.userId;
            clear();
            return;
          }
        }
        if(!broker.ok){
          // Failed reattest: never seed SSR initial as ready (C2-R7).
          if(signal?.type==="quarantine"){
            userIdRef.current=signal.userId;
            lock(signal.boundaryFingerprint);
            return;
          }
          if(broker.code==="UNAUTHENTICATED"){
            clear();
            return;
          }
          // Availability failure ≠ logout; retain ready if already admitted, else error chrome.
          recordSessionCheckUnavailable(
            {userId:userIdRef.current??undefined,companyId:null},
            undefined,
            {code:broker.code,stage:"server_auth"},
          );
          if(!retainReadyOnTransient(broker.code))setStatusLive("error");
          return;
        }
        if(cancelled||lockedRef.current||requestGen.current!==epoch)return;
        // One-use seed for this epoch; call refresh directly (signalRead already owns bootstrap).
        bootstrapBrokerSeed.current={epoch,broker,budget};
        bootstrapTrace.stage("refresh");
        await refresh(bootstrapTrace.correlation);
        bootstrapTrace.event("completed",cancelled||requestGen.current!==epoch?"CONFLICT":statusRef.current==="ready"?"OK":"UNAVAILABLE");
      }catch{
        if(cancelled||requestGen.current!==epoch)return;
        bootstrapTrace.finish("OUTCOME_UNKNOWN");
        if(signal?.type==="quarantine"){
          userIdRef.current=signal.userId;
          lock(signal.boundaryFingerprint);
          return;
        }
        recordSessionCheckUnavailable(
          {userId:userIdRef.current??undefined,companyId:null},
          undefined,
          {code:"TRANSPORT",stage:"browser_auth"},
        );
        if(!retainReadyOnTransient("TRANSPORT"))setStatusLive("error");
      }finally{
        budget.cancel();readBudgets.current.delete(budget);
      }
    })();
    const pending={generation:epoch,promise:bootstrap};
    signalRead.current=pending;
    void bootstrap.finally(()=>{if(signalRead.current===pending)signalRead.current=null;});
    const frame=window.requestAnimationFrame(()=>{releaseFrame();});
    return ()=>{
      cancelled=true;
      // Invalidate the entire bootstrap/refresh operation (seed, profile, final broker, publish).
      requestGen.current+=1;
      cancelReadBudgets();
      clearSoftRetry();
      bootstrapBrokerSeed.current=null;
      if(signalRead.current===pending)signalRead.current=null;
      window.cancelAnimationFrame(frame);
      releaseFrame();
    };
  },[clear,lock,refresh,setStatusLive,cancelReadBudgets,clearSoftRetry,retainReadyOnTransient]);

  useEffect(()=>{
    // WP01A: broker status replaces browser Auth observers. Focus/visibility recheck only.
    let timer:ReturnType<typeof setTimeout>|undefined;
    const recheck=()=>{
      if(document.visibilityState!=="visible")return;
      if(lockedRef.current)return; // locked capture never auto-unlocks from focus
      if(timer)clearTimeout(timer);
      timer=setTimeout(()=>{void refreshFromSignal();},0);
    };
    window.addEventListener("focus",recheck);document.addEventListener("visibilitychange",recheck);
    return ()=>{if(timer)clearTimeout(timer);window.removeEventListener("focus",recheck);document.removeEventListener("visibilitychange",recheck);};
  },[refreshFromSignal]);
  // Live refs — never close over render status for post-await fences (C4-05).
  const isCurrentUser = useCallback(
    (userId: string, expectedIdentity?: AccountProfileView) =>
      statusRef.current === "ready"
      && userIdRef.current === userId
      && identityRef.current?.userId === userId
      && (!expectedIdentity || identityRef.current === expectedIdentity),
    [],
  );
  const hasCurrentUser = useCallback(
    () => statusRef.current === "ready" && userIdRef.current !== null && identityRef.current !== null,
    [],
  );
  const cleanupCapture = useCallback(
    () => ({ userId: userIdRef.current, boundaryFingerprint: boundaryRef.current }),
    [],
  );
  const isCapturedBoundary = useCallback(
    (fp: string | null | undefined) => Boolean(fp) && lockedRef.current && boundaryRef.current === fp,
    [],
  );
  const liveSnapshot = useCallback(
    () => ({
      status: statusRef.current,
      userId: userIdRef.current,
      boundaryFingerprint: boundaryRef.current,
      ready: statusRef.current === "ready" && userIdRef.current !== null && identityRef.current !== null,
    }),
    [],
  );
  const setIdentityName = useCallback((name: string, expectedUserId: string) => {
    if(!isCurrentUser(expectedUserId))return;
    setIdentity((prev) => {const updated=prev?.userId===expectedUserId?{...prev,fullName:name}:prev;identityRef.current=updated;return updated;});
  }, [isCurrentUser]);

  const recoverOperation = useCallback((receipt: RecoveryReceipt | null) => {
    if (receipt && boundaryRef.current !== receipt.boundaryFingerprint) return;
    // Lock first (may hydrate storage); then retain the explicit memory receipt.
    lock(receipt?.boundaryFingerprint ?? boundaryRef.current);
    setRecoveryReceipt(receipt);
  }, [lock]);
  const sessionValue=useMemo(()=>({status,identity,boundaryFingerprint,refresh,clear,expire,lock,setIdentityName,isCurrentUser,hasCurrentUser,cleanupCapture,isCapturedBoundary,liveSnapshot,recoverOperation}),[status,identity,boundaryFingerprint,refresh,clear,expire,lock,setIdentityName,isCurrentUser,hasCurrentUser,cleanupCapture,isCapturedBoundary,liveSnapshot,recoverOperation]);
  const protectedRoute=/^\/(app|admin|account|setup|complete-profile|reset-password)(\/|$)/.test(pathname);
  const setupRoute=/^\/setup(\/|$)/.test(pathname);
  const copy=useAppCopy();
  const loaderGate=useApprovedLoaderGate(protectedRoute&&status==="loading",protectedRoute&&status==="ready",pathname);
  const admitted=status==='ready'&&!!identity&&!!boundaryFingerprint;
  useEffect(()=>{if(protectedRoute&&status==='ready'&&identity&&boundaryFingerprint)setupTiming('session_ready')();},[protectedRoute,status,identity,boundaryFingerprint]);
  useEffect(()=>{if(protectedRoute&&status==='ready'&&!loaderGate.holding)setupTiming('content_visible')();},[protectedRoute,status,loaderGate.holding]);
  const content=protectedRoute&&(status!=="ready"||loaderGate.holding||(setupRoute&&!admitted))
    ? status==="expired" ? <SessionActivityTracker />
    : status === "locked" ? <main className="grid min-h-svh place-content-center gap-3 bg-[#f6fafb] px-6 text-[#102a33]"><LangSwitch /><OperationRecovery receipt={recoveryReceipt} isCaptured={() => isCapturedBoundary(recoveryReceipt?.boundaryFingerprint ?? boundaryRef.current)} /></main>
    : status === "loading" || (status === "ready"&&loaderGate.holding) ? <ApprovedAccountLoader key={pathname} label={copy.loading} ready={status==="ready"} onComplete={loaderGate.finish} />
    : <main className="grid min-h-svh place-content-center gap-4 bg-[#f6fafb] px-6 text-center text-[#102a33]">
        <p className="text-base font-medium">{status==="error"?copy.account.identityError:copy.auth.login}</p>
        {status==="error"?<button type="button" className="mx-auto rounded-xl bg-[#006c81] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#00586a]" onClick={()=>void refresh()}>{copy.errors.accessRetry}</button>:null}
        {status==="guest"?<Link href="/login" className="mx-auto rounded-xl bg-[#006c81] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#00586a]">{copy.auth.login}</Link>:null}
      </main>
    : children;
  return (
    <AccountSessionContext.Provider value={sessionValue}>
      {setupRoute ? <>
        {admitted&&<div key={JSON.stringify([identity.userId,identity.companyId,boundaryFingerprint])} hidden={loaderGate.holding} inert={loaderGate.holding} aria-hidden={loaderGate.holding||undefined}>
          {children}
        </div>}
        {(!admitted||loaderGate.holding)&&content}
      </> : content}
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
  const companyId = session.identity?.companyId ?? null;
  const boundaryFp = session.boundaryFingerprint;
  if (!boundaryFp) return;
  const receipt = createRecoveryReceipt(userId, boundaryFp, "logout");
  // Immediate local quarantine BEFORE awaiting server — even on failure/UNKNOWN.
  session.lock(boundaryFp);
  publishSessionQuarantine(userId, boundaryFp);
  clearCompanyDrafts(userId);
  updateDemo({
    account: null,
    signedIn: false,
    stage: "guest",
    business: emptyBusiness,
    businessSaved: false,
    setupStep: 0,
    setupDone: [false, false, false, false],
  });
  let result: Awaited<ReturnType<typeof signOut>>;
  try {
    result = await signOut(userId, boundaryFp, receipt.operationKey);
  } catch (error) {
    if (!session.isCapturedBoundary(boundaryFp)) return;
    session.recoverOperation?.(receipt);
    recordLogoutTransportFailed({userId,companyId},error);
    onError(copy.auth.logoutFailed);
    return;
  }
  // Stale A result must never clear/navigate a newer committed boundary (incl. same user).
  if (!session.isCapturedBoundary(boundaryFp)) return;
  if (!result.ok) {
    session.recoverOperation?.(receipt);
    onError(result.message ?? copy.auth.logoutFailed);
    return;
  }
  publishSessionLogout(userId, boundaryFp);
  session.clear();
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

  // Navbar chrome is decoupled from network: only a confirmed ready identity
  // may replace public Sign-in / Create-account. Loading, transport error,
  // guest, expired, and locked keep the same public CTAs (no empty slot, no
  // technical identity-error copy). Session verification continues in the provider.
  if (!session || session.status !== "ready" || !session.identity) {
    return (
      <div className="flex min-h-11 min-w-[12.5rem] items-center gap-2" data-account-chrome="public">
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
