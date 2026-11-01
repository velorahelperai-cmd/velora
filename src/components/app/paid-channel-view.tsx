"use client";

import {awaitSetupRequest} from "./paid-setup-request";
import {useEffect, useLayoutEffect, useId, useRef, useState} from "react";
import type {PaidBranchSetupRead, PaidSetupChannel} from "@/lib/tenancy/paid-setup-contracts";
import {checklistSteps, paidChecklistFromRead, type PaidSetupFlowProps} from "./paid-assistant-checklist";
import {WhatsappConnectionGuide, GuideStatusBadge} from "./whatsapp-connection-guide";
import styles from "./paid-channel-view.module.css";
import { CoexistenceImportPanel } from "./coexistence-import-panel";
import type {WhatsappReviewRequestInput,WhatsappReviewRequestResult,WhatsappReviewReceipt} from '@/lib/tenancy/whatsapp-review-request-actions';
import {useSetupUnsavedChanges} from './paid-setup-unsaved';
import {
  type CancelOwnedPaidBranchConnectionInput,
  type CompleteOwnedPaidBranchConnectionInput,
  type PaidBranchConnectionFlow,
  type PaidBranchConnectionLaunch,
  type PaidBranchConnectionMutation,
  type PaidBranchConnectionRead,
  type PaidBranchConnectionScope,
  type PaidBranchConnectionDenial,
  type PaidBranchConnectionStartResult,
  type RecoverOwnedPaidBranchConnectionInput,
  type StartOwnedPaidBranchConnectionInput,
} from "@/lib/tenancy/paid-branch-connection-contracts";
import {
  channelConnectionLabel,
  derivePaidChannelConnectionViewModel,
  scopedChannelConnection,
} from "./paid-channel-connection-model";
import {createSignupPopupSession,type PopupObservation} from "@/lib/whatsapp/signup-popup-session";
import type {SignupErrorReason} from "@/lib/whatsapp/signup-popup-session";
import {parseSignupMessage, signupLoginOptions} from "@/lib/whatsapp/embedded-signup-browser";
import {
  coexistenceLoginOptions,
  createSignupAttempt,
  joinSignupSignal,
  parseEmbeddedSignupMessage,
} from "@/lib/whatsapp/coexistence/browser";
import type {WhatsappMetaTestReceiveProof} from "@/lib/tenancy/whatsapp-meta-test-receive-proof";
import type {NumberConfirmationRead,NumberConfirmationDecision} from "@/lib/whatsapp/number-confirmation-store";

export type WhatsappSdkPopupResult =
  | { kind: "completed"; code: string; wabaId?: string; phoneNumberId?: string }
  | { kind: "cancelled" }
  | { kind: "error"; reason?: SignupErrorReason };

export type WhatsappPopupConfig = Pick<Extract<PaidBranchConnectionLaunch,{flow:"wa_new_number"|"wa_coexistence"}>,"flow"|"appId"|"configId"|"graphVersion"> & {attemptId?:string;captureId?:string};
type WhatsappBootstrap = {ok:true;read:PaidBranchConnectionRead;config:WhatsappPopupConfig|null}|{ok:false};
export type PaidChannelViewActions = {
  readWhatsappBootstrap?:(input:PaidBranchConnectionScope&{flow:"wa_new_number"|"wa_coexistence"})=>Promise<WhatsappBootstrap>;
  launchUnboundWhatsappSdk?:(config:WhatsappPopupConfig,lifecycle:PopupLifecycle)=>Promise<WhatsappSdkPopupResult>;
  reviewRequest?:(input:WhatsappReviewRequestInput)=>Promise<WhatsappReviewRequestResult>;
  captureAuthorization?:(input:PaidBranchConnectionScope&{attemptId:string;generation:number;nonce:string;code:string;correlationId?:string})=>Promise<{ok:boolean}>;
  prepareRegistration?:(input:CompleteOwnedPaidBranchConnectionInput)=>Promise<{ok:true;registrationRequired:boolean;autoPinEligible?:boolean;authorizationTicket:string}|{ok:false}>;
  startConnection?: (input: StartOwnedPaidBranchConnectionInput) => Promise<PaidBranchConnectionStartResult | PaidBranchConnectionDenial>;
  completeConnection?: (input: CompleteOwnedPaidBranchConnectionInput) => Promise<PaidBranchConnectionMutation>;
  recoverConnection?: (input: RecoverOwnedPaidBranchConnectionInput) => Promise<PaidBranchConnectionMutation>;
  cancelConnection?: (input: CancelOwnedPaidBranchConnectionInput) => Promise<PaidBranchConnectionMutation>;
  readConnection?: (input: PaidBranchConnectionScope) => Promise<PaidBranchConnectionRead>;
  readMetaTestReceiveProof?: (input: {expectedAccountId:string;companyId:string;branchId:string}) => Promise<{ok:boolean;proof?:WhatsappMetaTestReceiveProof|null}>;
  launchWhatsappSdk?: (launch: Extract<PaidBranchConnectionLaunch, { flow: "wa_new_number" | "wa_coexistence" }>) => Promise<WhatsappSdkPopupResult>;
  navigateToUrl?: (url: string) => void;
  /** F5: read-only re-issue of an existing same-session pending attempt's launch. Never creates an attempt. */
  resumeLaunch?: (input: PaidBranchConnectionScope & { attemptId: string }) => Promise<{ok:true;read:PaidBranchConnectionRead;launch:Extract<PaidBranchConnectionLaunch,{flow:"wa_new_number"|"wa_coexistence"}>}|{ok:false;code:string}>;
  readNumberConfirmation?: (companyId: string) => Promise<NumberConfirmationRead>;
  decideNumberConfirmation?: (input:{companyId:string;linkId:string;linkGeneration:number;answer:"confirmed"|"rejected"}) => Promise<NumberConfirmationDecision>;
};

export type PaidChannelViewProps = {
  hideStatusBadge?:boolean;
  locale: "ar" | "en";
  scope: PaidSetupFlowProps["scope"] & {branchId: string};
  read: PaidBranchSetupRead | null;
  channel: PaidSetupChannel;
  /** Optional released B3 read; flat scope fields, never a start receipt. */
  connectionRead?: PaidBranchConnectionRead | null;
  /** Live session check before and after async work. */
  isCurrent?: () => boolean;
  /** Trigger authoritative B1 + B3 reread in parent workspace. */
  onRefresh?: () => void;
  /** Optional dependency injection for tests. */
  actions?: PaidChannelViewActions;
};

type FbSdk = {
  init: (options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
  login: (callback: (response: { authResponse?: { code?: unknown } }) => void, options: Record<string, unknown>) => void;
};

async function resolveDefaultActions(): Promise<Required<Pick<PaidChannelViewActions, "startConnection" | "completeConnection" | "recoverConnection" | "cancelConnection" | "prepareRegistration" | "readConnection" | "captureAuthorization">>> {
  const mod = await import("@/lib/tenancy/paid-branch-connection-actions");
  return {
    captureAuthorization:input => awaitSetupRequest(mod.captureOwnedWhatsappAuthorizationAction(input),60_000),
    prepareRegistration:input => awaitSetupRequest(mod.prepareOwnedWhatsappRegistrationAction(input),60_000),
    startConnection: input => awaitSetupRequest(mod.startOwnedPaidBranchConnectionAction(input),60_000),
    completeConnection: input => awaitSetupRequest(mod.completeOwnedPaidBranchConnectionAction(input),60_000),
    recoverConnection: input => awaitSetupRequest(mod.recoverOwnedPaidBranchConnectionAction(input),60_000),
    cancelConnection: input => awaitSetupRequest(mod.cancelOwnedPaidBranchConnectionAction(input),60_000),
    readConnection: input => awaitSetupRequest(mod.readOwnedPaidBranchConnectionAction(input),60_000),
  };
}

const META_SDK_SRC = "https://connect.facebook.net/en_US/sdk.js";
// Script preload only: no FB.init, no server call, no attempt. loadMetaFacebookSdk reuses it.
export function preloadMetaFacebookSdkScript(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if ((window as unknown as { FB?: unknown }).FB || document.querySelector(`script[src="${META_SDK_SRC}"]`)) return;
  const script = document.createElement("script");
  script.src = META_SDK_SRC; script.async = true; script.defer = true; script.crossOrigin = "anonymous";
  document.head.appendChild(script);
}

function loadMetaFacebookSdk(appId: string, graphVersion: string, trace: (stage: string) => void): Promise<FbSdk | null> {
  trace("sdk_load_started");
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve(null);
  const win = window as unknown as { FB?: FbSdk; fbAsyncInit?: () => void };
  if (win.FB) {
    try { win.FB.init({ appId, autoLogAppEvents: true, xfbml: true, version: graphVersion }); trace("sdk_init_ready"); return Promise.resolve(win.FB); }
    catch { trace("sdk_init_failed"); return Promise.resolve(null); }
  }
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => { trace("sdk_load_timeout"); resolve(null); }, 15_000);
    win.fbAsyncInit = () => {
      window.clearTimeout(timeout);
      if (win.FB) {
        try { win.FB.init({ appId, autoLogAppEvents: true, xfbml: true, version: graphVersion }); trace("sdk_init_ready"); resolve(win.FB); }
        catch { trace("sdk_init_failed"); resolve(null); }
      } else {
        resolve(null);
      }
    };
    const existing = document.querySelector('script[src="https://connect.facebook.net/en_US/sdk.js"]');
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.onerror = () => {
        window.clearTimeout(timeout);
        trace("sdk_load_failed");
        resolve(null);
      };
      document.head.appendChild(script);
    }
  });
}

export async function runBrowserWhatsappSdkPopup(
  launch: Extract<PaidBranchConnectionLaunch, { flow: "wa_new_number" | "wa_coexistence" }>,
  lifecycle?:PopupLifecycle,
): Promise<WhatsappSdkPopupResult> {
  // A fresh, non-identifying correlation value; never log attempt IDs or provider payloads.
  const correlationId = crypto.randomUUID();
  const trace = (stage: string, facts: Record<string, boolean> = {}) => console.info("whatsapp_signup_stage", { correlation_id: correlationId, timestamp: new Date().toISOString(), stage, ...facts });
  const fb = await loadMetaFacebookSdk(launch.appId, launch.graphVersion, trace);
  if (!fb) return { kind: "error" };
  return launchPreparedWhatsappSdkPopup(launch, fb, trace, lifecycle);
}

function launchCoexistenceSdkPopup(launch:WhatsappPopupConfig,fb:FbSdk,trace:(stage:string,facts?:Record<string,boolean>)=>void,lifecycle?:PopupLifecycle):Promise<WhatsappSdkPopupResult>{
  return new Promise(resolve=>{
    let settled=false;let onMessage:(event:MessageEvent)=>void=()=>{};
    const expiresAt=lifecycle?.expiresAt??Date.now()+5*60_000;
    let attempt = createSignupAttempt(launch.captureId ?? launch.attemptId!);
    let callbackWithoutCode=false;
    const observe=(stage:PopupObservation)=>{trace(stage);lifecycle?.onObservation?.(stage);};
    const finishOnce=(result:WhatsappSdkPopupResult)=>{
      if(settled)return;settled=true;
      window.clearTimeout(timeout);window.clearTimeout(expiry);window.clearInterval(authority);
      window.removeEventListener('message',onMessage);lifecycle?.signal?.removeEventListener('abort',abort);
      attempt=createSignupAttempt(launch.captureId ?? launch.attemptId!);resolve(result);
    };
    const valid=()=>{
      if(settled)return false;
      if(lifecycle?.signal?.aborted||!(lifecycle?.isCurrent()??true)){observe('authority_lost');finishOnce({kind:'error'});return false;}
      if(!Number.isFinite(expiresAt)||Date.now()>=expiresAt){observe('attempt_expired');finishOnce({kind:'error'});return false;}
      return true;
    };
    const abort=()=>{if(!settled){observe('authority_lost');finishOnce({kind:'error'});}};
    // A UI wait deadline is not proof of cancellation or provider failure.
    const timeout=window.setTimeout(()=>{if(valid())observe('waiting_timeout');},5*60_000);
    const expiry=window.setTimeout(()=>{valid();},Math.max(0,Math.min(expiresAt-Date.now(),2_147_483_647)));
    const authority=window.setInterval(()=>{valid();},500);
    lifecycle?.signal?.addEventListener('abort',abort,{once:true});
    if(!valid())return;
    const checkCoexistence = () => {
      // v5 sends phone_number_id. Without it and without a server-held confirmed number there is nothing exact to match, so stop (no auto-choice).
      if (attempt.status === "ready-for-server-validation" && attempt.code && attempt.session && !attempt.session.data.phone_number_id && !(launch as { confirmedPhoneNumber?: string }).confirmedPhoneNumber) { finishOnce({ kind: "error", reason: "missing_number" }); return; }
      if (attempt.status === "ready-for-server-validation" && attempt.code && attempt.session) {
        finishOnce({
          kind: "completed",
          code: attempt.code,
          wabaId: attempt.session.data.waba_id,
          phoneNumberId: attempt.session.data.phone_number_id,
        });
      } else if (attempt.status === "cancelled") {
        finishOnce({ kind: "cancelled" });
      } else if (attempt.status === "error" || attempt.status === "conflict") {
        finishOnce({ kind: "error" });
      }
    };
    onMessage = (event: MessageEvent) => {
      if (!valid()) return;
      const obs = parseEmbeddedSignupMessage({ origin: event.origin, data: event.data }, "coexistence");
      if (obs.kind === "ignored") return;
      trace("signup_signal", { finish: obs.kind === "finish", cancel: obs.kind === "cancel", error: obs.kind === "error" || obs.kind === "invalid" || obs.kind === "unknown", assets_received: obs.kind === "finish" });
      // Partial authorization must be reconciled, never automatically cancelled.
      if(obs.kind==='cancel'&&(attempt.code||attempt.session)){finishOnce({kind:'error'});return;}
      if(obs.kind==='rejected'){finishOnce({kind:'error',reason:obs.reason});return;}
      if(obs.kind==='error'&&obs.event==='ERROR'){finishOnce({kind:'error',reason:'meta_error'});return;}
      attempt = joinSignupSignal(attempt, launch.captureId ?? launch.attemptId!, obs);
      checkCoexistence();
      if(!settled&&callbackWithoutCode&&attempt.session&&!attempt.code)observe('finish_without_code');
    };
    window.addEventListener("message", onMessage);
    trace("fb_login_invoked");
    try { fb.login((response) => {
      if (!valid()) return;
      const code = response?.authResponse?.code;
      if(typeof code==='string'&&code.trim())lifecycle?.onCodeReceived?.();
      trace("oauth_callback_received", { code_received: typeof code === "string" && code.trim().length > 0 });
      if (typeof code === "string" && code.trim().length > 0) {
        attempt = joinSignupSignal(attempt, launch.captureId ?? launch.attemptId!, { kind: "code", code });
        checkCoexistence();
      } else if (!settled) {
        callbackWithoutCode=true;
        observe(attempt.session?'finish_without_code':'callback_without_code');
      }
    }, coexistenceLoginOptions(launch.configId));
    } catch { trace('fb_login_failed');finishOnce({kind:'error'}); }
  });
}

type PopupLifecycle={expiresAt:number;isCurrent:()=>boolean;signal?:AbortSignal;onCodeReceived?:()=>void;onCode?:(code:string)=>Promise<boolean>;onObservation?:(stage:PopupObservation)=>void};
export function launchPreparedWhatsappSdkPopup(
 launch:WhatsappPopupConfig,fb:FbSdk,
 trace:(stage:string,facts?:Record<string,boolean>)=>void,lifecycle?:PopupLifecycle,
):Promise<WhatsappSdkPopupResult>{
 if(launch.flow==='wa_coexistence')return launchCoexistenceSdkPopup(launch,fb,trace,lifecycle);
 if(lifecycle&&(!lifecycle.isCurrent()||lifecycle.signal?.aborted||!Number.isFinite(lifecycle.expiresAt)||lifecycle.expiresAt<=Date.now())){trace('attempt_not_launchable');return Promise.resolve({kind:'error'});}
 const session=createSignupPopupSession({expiresAt:lifecycle?.expiresAt??Date.now()+5*60_000,isCurrent:lifecycle?.isCurrent??(()=>true),signal:lifecycle?.signal,onCode:lifecycle?.onCode,onObservation:lifecycle?.onObservation,trace});
 const onMessage=(event:MessageEvent)=>{
  const parsed=parseSignupMessage(event.origin,event.data);if(!parsed)return;
  if(parsed.event==='FINISH')session.assets(parsed);else if(parsed.event==='CANCEL')session.cancelled();else if(parsed.event==='FINISH_ONLY_WABA')session.error('only_waba');else if(parsed.event==='BUSINESS_APP_ONBOARDING')session.error('wrong_route');else if(parsed.event==='GRANT_ONLY')session.error('grant_only');else if(parsed.event==='MULTIPLE_ACCOUNTS')session.error('multiple_accounts');else if(parsed.event==='MISSING_PHONE_NUMBER')session.error('missing_number');else if(parsed.event==='ERROR')session.error('meta_error');else session.error();
 };
 window.addEventListener('message',onMessage);
 // Capture only the synchronously opened SDK popup, as in Meta's official sample.
 const originalOpen=window.open;let popup:Window|null=null,closed=false;
 const capture:typeof window.open=function(...args){const opened=originalOpen.apply(window,args);if(opened)popup=opened;return opened;};
 window.open=capture;
 try{trace('fb_login_invoked');fb.login(response=>{if(typeof response?.authResponse?.code==='string'&&response.authResponse.code.trim())lifecycle?.onCodeReceived?.();session.code(response?.authResponse?.code);},signupLoginOptions(launch.configId));}
 catch{trace('fb_login_failed');session.error();}finally{if(window.open===capture)window.open=originalOpen;}
 const poll=setInterval(()=>{try{if(popup?.closed&&!closed){closed=true;session.closed();}}catch{/* COOP is unknown, never cancellation. */}},500);
 return session.promise.finally(()=>{clearInterval(poll);window.removeEventListener('message',onMessage);popup=null;});
}

function currentTime(): number { return Date.now(); }

function makeClientOpId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "10000000-1000-4000-8000-" + String(Date.now()).padStart(12, "0").slice(-12);
}

export function PaidChannelView(props: PaidChannelViewProps) {
  // A different actor, capture, company, branch, channel or entitlement starts
  // with no route selected. Locale changes preserve the owner's choice.
  const identity = JSON.stringify([props.scope, props.channel, props.read?.sourceStatus,
    props.read?.selectedChannels, props.read?.entitlement]);
  return <ChannelView key={identity} {...props}/>;
}

function ChannelView({locale, scope, read, channel, connectionRead, isCurrent, onRefresh, actions,hideStatusBadge}: PaidChannelViewProps) {
  const [route, setRoute] = useState<"new-number" | "coexistence" | null>(null);
  const [screen, setScreen] = useState<"choice" | "guide" | "requirements">("choice");
  const [pin, setPin] = useState("");
  const [awaitingPin,setAwaitingPin]=useState(false);
  const pinAnswer=useRef<((value:string|null)=>void)|null>(null);
  const connectReserved=useRef(false);
  const [clickMaterial,setClickReady]=useState<{config:WhatsappPopupConfig;fb:FbSdk|null;resolved:PaidChannelViewActions;revision:string}|null>(null);
  const preparedPopup = useRef<{ attemptId: string; generation: number; expiresAt: number; launch: () => void; abandon: () => void } | null>(null);
  const [popupReady, setPopupReady] = useState(false);
  // F4 item 1: owner confirmation of the server-verified linked number, bound to the link generation.
  // F5: the number answer is server-persisted; outbound replies are blocked in Postgres until confirmed.
  const [numberCheck, setNumberCheck] = useState<{key:string;status:'loading'|'not_required'|'pending'|'confirmed'|'rejected'|'unavailable';linkId?:string;linkGeneration?:number;busy?:boolean;error?:boolean}|null>(null);
  const resumeTried = useRef<string|null>(null);
  const unsavedConnection=!!(awaitingPin||pin)&&!(connectionRead?.connection.state==='connected'&&connectionRead.connection.verified);
  useSetupUnsavedChanges(unsavedConnection,isCurrent??(()=>false),locale);
  const [localOverride, setLocalOverride] = useState<{ base: PaidBranchConnectionRead | null | undefined; read: PaidBranchConnectionRead } | null>(null);
  const [inFlight, setInFlight] = useState<"starting" | "completing" | "recovering" | "cancelling" | null>(null);
  const [feedbackMessage, setFeedback] = useState<{ar:string;en:string} | null>(null);
  const feedback = feedbackMessage?.[locale] ?? null;
  const [cancelUncertain, setCancelUncertain] = useState(false);
  const [reviewResult,setReviewReceipt]=useState<{key:string;receipt:WhatsappReviewReceipt|null}|null>(null);
  const reviewBinding=useRef('');
  const popupCapture=useRef<AbortController|null>(null);
  const mounted = useRef(true);
  const currentAuthority=useRef(isCurrent);
  useLayoutEffect(()=>{currentAuthority.current=isCurrent;},[isCurrent]);
  const titleId = useId();
  const setLocalConnection = (next: PaidBranchConnectionRead) => setLocalOverride({ base: connectionRead, read: next });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      popupCapture.current?.abort();popupCapture.current=null;
      preparedPopup.current?.abandon(); preparedPopup.current = null;
      pinAnswer.current?.(null);pinAnswer.current=null;
    };
  }, []);

  const checkCurrent = () => (isCurrent ? isCurrent() : true);

  const ar = locale === "ar";
  const t = (arabic: string, english: string) => ar ? arabic : english;
  const tf = (arabic: string, english: string) => ({ar:arabic,en:english});
  const model = read ? paidChecklistFromRead(read, scope) : null;
  const steps = model ? checklistSteps(model) : [];
  const channelStep = steps.find(step => step.id === channel);
  const branch = model?.branches.find(item => item.id === scope.branchId);
  const effectiveRead = localOverride && localOverride.base === connectionRead ? localOverride.read : connectionRead;
  const connection = scopedChannelConnection(effectiveRead, {...scope, channel});
  const latestConnection=useRef(connection);
  useLayoutEffect(()=>{latestConnection.current=connection;},[connection]);
  const viewModel = derivePaidChannelConnectionViewModel(connection, locale, {inFlight});
  const reviewAttempt=connection?.connection.attempt;
  const canRequestReview=channel==='whatsapp'&&connection?.sourceStatus==='ready'&&connection.connection.flow==='wa_new_number'&&!!reviewAttempt&&['pending','claimed','unknown'].includes(reviewAttempt.status)&&Date.parse(reviewAttempt.expiresAt)<=Date.parse(connection.asOf);
  const reviewKey=JSON.stringify([scope.expectedAccountId,scope.companyId,scope.branchId,scope.boundaryFingerprint,reviewAttempt?.id,reviewAttempt?.generation,reviewAttempt?.status,connection?.connection.verified]);
  const reviewReceipt=reviewResult?.key===reviewKey?reviewResult.receipt:null;
  useLayoutEffect(()=>{reviewBinding.current=reviewKey;},[reviewKey]);
  const handleReviewRequest=async(request:boolean)=>{
    if(!canRequestReview||!reviewAttempt||connectReserved.current||!checkCurrent())return;
    const captured=reviewKey;connectReserved.current=true;setInFlight('recovering');
    try{
      const action=actions?.reviewRequest??(await import('@/lib/tenancy/whatsapp-review-request-actions')).ownedWhatsappReviewRequestAction;
      const result=await awaitSetupRequest(action({...scope,channel:'whatsapp',attemptId:reviewAttempt.id,generation:reviewAttempt.generation,request}),60_000);
      if(!mounted.current||!checkCurrent()||reviewBinding.current!==captured)return;
      if(result.ok){setReviewReceipt({key:captured,receipt:result.receipt});setFeedback(result.receipt?tf('تم حفظ طلب المراجعة وهو قيد الانتظار. المحاولة والأصول محفوظة؛ الربط لم يكتمل.','Review request is saved and pending. The attempt and assets are preserved; connection is not complete.'):tf('لا يوجد طلب مراجعة محفوظ لهذه المحاولة.','No review request is saved for this attempt.'));}
      else setFeedback(tf('تعذر تأكيد طلب المراجعة لهذه المحاولة. تحقق من الحالة؛ لم تتغير الأصول.','The review request could not be confirmed for this attempt. Check its status; assets were not changed.'));
    }catch{if(mounted.current&&checkCurrent()&&reviewBinding.current===captured)setFeedback(tf('تعذر التحقق من طلب المراجعة الآن.','Review request status is unavailable.'));}
    finally{connectReserved.current=false;if(mounted.current)setInFlight(null);}
  };
  const available = checkCurrent() && !!scope.expectedAccountId && !!scope.boundaryFingerprint && !!branch &&
    !!channelStep && (channelStep.status === "pending" || channelStep.status === "verified") &&
    channelStep.dependencyIds.every(id => steps.some(step => step.id === id && step.status === "verified"));

  const selectedWhatsappFlow: PaidBranchConnectionFlow | null =
    route === "new-number" ? "wa_new_number" : route === "coexistence" ? "wa_coexistence" : null;
  const clickReady=clickMaterial && clickMaterial.revision===connection?.revision && clickMaterial.config.flow===selectedWhatsappFlow && screen==='requirements'?clickMaterial:null;
  const whatsappInputsValid =
    route === "new-number"
      ? true
      : route === "coexistence"
        ? true
        : false;
  const canStartSelectedWhatsapp =
    !!selectedWhatsappFlow && viewModel.canStartFlow(selectedWhatsappFlow) && whatsappInputsValid;
  const canStartInstagram = viewModel.canStartFlow("instagram_direct");

  const handleWhatsappConnect = async (requestedFlow?: "wa_new_number" | "wa_coexistence", resume?: { attemptId: string }, eager?: {popup:Promise<WhatsappSdkPopupResult>;config:WhatsappPopupConfig;resolved:PaidChannelViewActions;bind:(start:PaidBranchConnectionStartResult|null)=>void;abort:()=>void;codeValid:()=>boolean}) => {
    const selectedWhatsappFlow = requestedFlow ?? (route === "new-number" ? "wa_new_number" : route === "coexistence" ? "wa_coexistence" : null);
    // F5: a resume re-issues an existing attempt's launch, so start capability is not required.
    const canStartSelectedWhatsapp = !!selectedWhatsappFlow && (!!resume || viewModel.canStartFlow(selectedWhatsappFlow));
    // Both connection routes must use the live session boundary after every await.
    const checkCurrent = () => currentAuthority.current?.() ?? true;
    if (connectReserved.current || inFlight) return;
    if (!checkCurrent()) {
      setFeedback(tf('انتهت صلاحية الجلسة أو تغير سياق الحساب. حدّث الصفحة قبل المتابعة.', 'Session expired or account context changed. Refresh the page before continuing.'));
      return;
    }
    if (!connection || !connection.revision) {
      setFeedback(tf('بيانات القناة غير مكتملة أو لم تُحمّل بعد. انتظر لحظة أو حدّث الصفحة.', 'Channel data is incomplete or still loading. Wait a moment or refresh the page.'));
      return;
    }
    if (!selectedWhatsappFlow) {
      setFeedback(tf('يرجى اختيار طريقة الربط أولاً: رقم جديد أو تطبيق WhatsApp Business الحالي.', 'Please choose a connection method first: a new number or your current WhatsApp Business App.'));
      return;
    }
    if (!canStartSelectedWhatsapp) {
      if (selectedWhatsappFlow === "wa_coexistence") {
        setFeedback(tf('لا يمكن بدء ربط تطبيق WhatsApp Business الحالي الآن. تحقق من متطلبات القناة.', 'Cannot connect your current WhatsApp Business App right now. Check channel requirements.'));
      } else {
        setFeedback(tf('لا يمكن بدء ربط هذا الرقم حاليًا. راجع متطلبات الربط أو حالة الفرع.', 'Cannot start connecting this number right now. Review connection requirements or branch status.'));
      }
      return;
    }
    // Meta's JavaScript SDK refuses FB.login on HTTP and may never call back.
    // Check before creating a server attempt; injected launchers are test doubles.
    if (!actions?.launchWhatsappSdk && !actions?.launchUnboundWhatsappSdk && window.location.protocol !== 'https:') {
      setFeedback(tf('يلزم اتصال آمن (HTTPS) لفتح Facebook','A secure (HTTPS) connection is required to open Facebook'));
      return;
    }
    connectReserved.current=true;
    let ownsReservation = true;
    let startedOverride: PaidBranchConnectionStartResult | null = null;
    setFeedback(null);
    setInFlight("starting");
    try {
      const resolved = eager?.resolved ?? (actions?.startConnection && actions?.completeConnection && actions?.cancelConnection
        ? actions
        : { ...(await resolveDefaultActions()), ...actions });
      if (resume) {
        const resumeFn = actions?.resumeLaunch ?? (async (input: PaidBranchConnectionScope & { attemptId: string }) => { try { return await awaitSetupRequest((await import("@/lib/tenancy/paid-branch-connection-actions")).resumeOwnedPaidBranchLaunchAction(input), 30_000); } catch { return null; } });
        const resumed = await resumeFn({ expectedAccountId: scope.expectedAccountId, companyId: scope.companyId, branchId: scope.branchId, channel: "whatsapp", attemptId: resume.attemptId }).catch(() => null);
        if (!mounted.current || !checkCurrent()) return;
        // Not resumable: stay silent; the existing recover/cancel controls remain the path forward.
        if (!resumed || !resumed.ok || resumed.launch.flow !== selectedWhatsappFlow) { setInFlight(null); return; }
        startedOverride = { ok: true as const, read: resumed.read, launch: resumed.launch };
      }
      const started = startedOverride ?? await resolved.startConnection!({
        expectedAccountId: scope.expectedAccountId,
        companyId: scope.companyId,
        branchId: scope.branchId,
        channel: "whatsapp",
        flow: selectedWhatsappFlow,
        clientOpId: makeClientOpId(),
        expectedRevision: connection.revision,
      });
      if (!mounted.current || !checkCurrent()) return;
      setLocalConnection(started.read);
      if (!started.ok || started.launch.flow === "instagram_direct") {
        if (!started.ok) {
          setFeedback(started.code === 'setup_required'
            ? tf('ربط واتساب غير متاح حاليًا. حاول لاحقًا أو تواصل مع الدعم. لم تبدأ محاولة ربط.', 'WhatsApp connection is currently unavailable. Try later or contact support. No connection attempt was started.')
            : started.code === 'conflict'
              ? tf('توجد محاولة ربط نشطة أو قيد المراجعة لهذا الفرع، أو يتعارض نوع الربط مع إعدادات الفرع المحفوظة (مثل تقييد المراجعة برقم Coexistence محدد). راجع الحالة أو استخدم الاسترداد.', 'An active or review-restricted connection exists for this branch, or the route conflicts with saved branch settings (e.g. review restriction to a specific Coexistence number). Review status or use recovery.')
              : tf('تعذّر بدء محاولة الربط حاليًا. راجع الحالة المحفوظة ثم أعد المحاولة.', 'Could not start the connection attempt right now. Review the saved state and try again.'));
        }
        setInFlight(null);
        return;
      }
      const attempt = started.read.connection.attempt;
      const expiresAt = Date.parse(attempt?.expiresAt ?? "");
      if (!attempt || attempt.id !== started.launch.attemptId || attempt.status !== "pending" || !Number.isFinite(expiresAt) || expiresAt <= currentTime()) {
        setInFlight(null); setFeedback(started.launch.flow==='wa_new_number'?tf('انتهت المحاولة أو تعذّر التحقق منها. راجع المحاولة والأصول المحفوظة قبل المتابعة.','The attempt expired or could not be verified. Review the attempt and saved assets before proceeding.'):tf("انتهت المحاولة أو تعذّر التحقق منها. استخدم الاسترداد أو الإلغاء.", "The attempt expired or could not be verified. Use recovery or cancellation.")); return;
      }
      const generation = attempt.generation;
      if(eager && (started.launch.flow!==eager.config.flow || started.launch.appId!==eager.config.appId || started.launch.configId!==eager.config.configId || started.launch.graphVersion!==eager.config.graphVersion)) {
        setInFlight(null);setFeedback(tf('إعدادات الربط اتغيرت. راجع المحاولة المحفوظة قبل المتابعة.','Connection settings changed. Review the saved attempt before continuing.'));return;
      }
      eager?.bind(started);
      const correlationId = makeClientOpId();
      const trace = (stage: string, facts: Record<string, boolean> = {}) => console.info("whatsapp_signup_stage", { correlation_id: correlationId, timestamp: new Date().toISOString(), stage, ...facts });
      const fb = eager || actions?.launchWhatsappSdk ? null : await loadMetaFacebookSdk(started.launch.appId, started.launch.graphVersion, trace);
      if (!mounted.current || !checkCurrent()) return;
      if (!eager && !actions?.launchWhatsappSdk && !fb) { setInFlight(null); setFeedback(tf("تعذر تجهيز Facebook. راجع حالة المحاولة قبل المتابعة.", "Facebook could not be prepared. Review the attempt before continuing.")); return; }
      if (expiresAt <= currentTime()) { setInFlight(null); setFeedback(started.launch.flow==='wa_new_number'?tf('انتهت المحاولة. راجع المحاولة والأصول المحفوظة قبل المتابعة.','The attempt expired. Review the attempt and saved assets before proceeding.'):tf("انتهت المحاولة. استخدم الاسترداد أو الإلغاء.", "The attempt expired. Use recovery or cancellation.")); return; }
      let abandoned = false;
      const popupResult = await (eager?.popup ?? new Promise<WhatsappSdkPopupResult>((resolve) => {
        const timer = window.setTimeout(() => { abandoned = true; preparedPopup.current = null; setPopupReady(false); setFeedback(started.launch.flow==='wa_new_number'?tf('انتهت المحاولة. راجع المحاولة والأصول المحفوظة قبل المتابعة.','The attempt expired. Review the attempt and saved assets before proceeding.'):tf("انتهت المحاولة. استخدم الاسترداد أو الإلغاء.", "The attempt expired. Use recovery or cancellation.")); resolve({kind:"error"}); }, Math.min(expiresAt - Date.now(), 2_147_483_647));
        const abandon = () => { abandoned = true; ownsReservation = false; window.clearTimeout(timer); resolve({kind:"error"}); };
        preparedPopup.current = { attemptId: attempt.id, generation, expiresAt, abandon, launch: () => {
          window.clearTimeout(timer); preparedPopup.current = null; setPopupReady(false); connectReserved.current = true; setInFlight("starting");
          try {
            const controller=new AbortController();popupCapture.current=controller;
            const preparedLaunch=started.launch;
            const lifecycle:PopupLifecycle={expiresAt,onCode:preparedLaunch.flow==='wa_new_number'&&resolved.captureAuthorization?async code=>{if(!mounted.current||!checkCurrent())return false;const result=await resolved.captureAuthorization!({...scope,channel:'whatsapp',attemptId:attempt.id,generation,nonce:preparedLaunch.nonce,code,correlationId});return mounted.current&&checkCurrent()&&result.ok;}:undefined,isCurrent:()=>mounted.current&&(currentAuthority.current?.()??true),signal:controller.signal,onObservation:stage=>{
              if(!mounted.current||!checkCurrent())return;
              if(stage==='finish_without_code'){setInFlight(null);setFeedback(tf('ننتظر تأكيد Meta لهذه المحاولة؛ إغلاق النافذة في الشاشة الأخيرة لا يلغيها. لا تبدأ محاولة أخرى، وإن طال الانتظار استخدم الاسترداد.','Waiting for Meta to confirm this attempt; closing the window on the final screen does not cancel it. Do not start another attempt; if this takes long, use recovery.'));return;}
              if(stage==='waiting_timeout'||stage==='popup_closed'||stage==='callback_without_code'){setInFlight(null);setFeedback(tf('نتيجة Meta غير محسومة. ننتظر التفويض ضمن صلاحية المحاولة؛ لا تبدأ محاولة أخرى.','Meta outcome is unconfirmed. Waiting within this attempt’s validity; do not start another attempt.'));}
            }};
            const popup = actions?.launchWhatsappSdk ? actions.launchWhatsappSdk(started.launch as Extract<PaidBranchConnectionLaunch, {flow:"wa_new_number"|"wa_coexistence"}>) : launchPreparedWhatsappSdkPopup(started.launch as Extract<PaidBranchConnectionLaunch, {flow:"wa_new_number"|"wa_coexistence"}>, fb!, trace, lifecycle);
            void popup.then(resolve, () => resolve({kind:"error"}));
          } catch { trace("fb_login_failed"); resolve({kind:"error"}); }
        } };
        connectReserved.current = false; setInFlight(null); setPopupReady(true);
      }));
      if (abandoned || !mounted.current || !checkCurrent()) return;
      if(eager && selectedWhatsappFlow==='wa_coexistence' && popupResult.kind==='completed' && !eager.codeValid()){setInFlight(null);setFeedback(tf('انتهت صلاحية كود التفويض. راجع المحاولة المحفوظة قبل المتابعة.','The authorization code expired. Review the saved attempt before continuing.'));return;}
      if (popupResult.kind === "cancelled") {
        setInFlight("cancelling");
        const cancelled = await resolved.cancelConnection!({
          expectedAccountId: scope.expectedAccountId,
          companyId: scope.companyId,
          branchId: scope.branchId,
          channel: "whatsapp",
          flow: selectedWhatsappFlow,
          attemptId: started.launch.attemptId,
          generation,
        });
        if (!mounted.current || !checkCurrent()) return;
        setLocalConnection(cancelled.read);
        setInFlight(null);
        onRefresh?.();
        return;
      }
      if (popupResult.kind === "error" && popupResult.reason) {
        const reasonText: Record<SignupErrorReason, [string, string]> = {
          only_waba: ['أنهيت Meta دون إضافة رقم هاتف. ألغِ المحاولة ثم ابدأ من جديد وأضف الرقم داخل نافذة Meta.', 'Meta finished without adding a phone number. Cancel this attempt, then start again and add the number in the Meta window.'],
          wrong_route: selectedWhatsappFlow === 'wa_coexistence'
            ? ['اخترت في Meta رقمًا جديدًا بدل رقم تطبيق WhatsApp Business. لم يُربط شيء؛ ألغِ المحاولة واختر مسار «رقم جديد» أو أعد المحاولة واختر رقم التطبيق.', 'In Meta you chose a new number instead of your WhatsApp Business app number. Nothing was connected; cancel and use the new-number route, or retry and pick the app number.']
            : ['اخترت في Meta رقم تطبيق WhatsApp Business، وهذا المسار للأرقام الجديدة فقط. لم يُربط شيء؛ ألغِ المحاولة واستخدم مسار تطبيق WhatsApp Business.', 'In Meta you chose a WhatsApp Business app number, but this route is for new numbers only. Nothing was connected; cancel and use the WhatsApp Business app route.'],
          grant_only: ['أنهيت Meta بمنح صلاحية فقط دون ربط رقم. لم يُربط شيء؛ ألغِ المحاولة وأعدها مع اختيار الرقم.', 'Meta finished with access-only sharing and no number. Nothing was connected; cancel and retry, selecting the number.'],
          multiple_accounts: ['أعادت Meta أكثر من حساب واتساب؛ لن نختار أحدها تلقائيًا. ألغِ المحاولة وأعدها مع اختيار حساب واحد فقط.', 'Meta returned more than one WhatsApp account; none will be chosen automatically. Cancel and retry, selecting a single account.'],
          missing_number: ['لم تُرسل Meta رقم الهاتف المختار؛ لن نختار رقمًا تلقائيًا. استخدم الاسترداد أو ألغِ المحاولة.', 'Meta did not return the selected phone number; no number will be chosen automatically. Use recovery or cancel the attempt.'],
          meta_error: ['أبلغت Meta عن خطأ داخل نافذتها. لم يُربط شيء؛ راجع الرسالة في Meta ثم استخدم الاسترداد أو ألغِ المحاولة.', 'Meta reported an error in its window. Nothing was connected; check the message in Meta, then use recovery or cancel the attempt.'],
        };
        const [ar, en] = reasonText[popupResult.reason];
        setFeedback(tf(ar, en));
        setInFlight(null);
        onRefresh?.();
        return;
      }
      if (popupResult.kind !== "completed") {
        setFeedback(tf(
          "لم تكتمل نافذة Meta أو أُغلقت قبل التحقق. يمكنك استخدام الاسترداد أو إلغاء المحاولة.",
          "The Meta window did not finish or closed before verification. You can recover or cancel the attempt.",
        ));
        setInFlight(null);
        onRefresh?.();
        return;
      }
      if(currentTime()>=expiresAt){trace('attempt_expired_before_server');setInFlight(null);setFeedback(tf('انتهت صلاحية المحاولة؛ لم يُرسل التفويض للإكمال. راجع حالة الأصول أولًا.','The attempt expired; authorization was not submitted. Review the existing assets first.'));onRefresh?.();return;}
      setInFlight("completing");
      // Registration follows Embedded Signup; never collect or persist the PIN before authorization.
      let registrationPin='';
      let authorizationTicket:string|undefined;
      if(started.launch.flow==='wa_new_number'){
        if(!popupResult.code||!popupResult.wabaId||!popupResult.phoneNumberId){setInFlight(null);setFeedback(tf('بيانات تفويض Meta غير مكتملة. راجع حالة المحاولة قبل المتابعة.','Meta authorization data is incomplete. Review the attempt status before continuing.'));return;}
        const prepared=await resolved.prepareRegistration?.({expectedAccountId:scope.expectedAccountId,companyId:scope.companyId,branchId:scope.branchId,channel:'whatsapp',flow:'wa_new_number',attemptId:started.launch.attemptId,generation,completion:{attemptId:started.launch.attemptId,nonce:started.launch.nonce,code:popupResult.code,wabaId:popupResult.wabaId,phoneNumberId:popupResult.phoneNumberId,pin:''}}).catch(()=>({ok:false as const}));
        if(!mounted.current||!checkCurrent())return;
        if(!prepared?.ok){
          setInFlight(null);setFeedback(tf('نتيجة التفويض غير مؤكدة. استخدم استكمال المحاولة للتحقق من الحالة المحفوظة قبل بدء ربط جديد.','Authorization outcome is unconfirmed. Recover the attempt to check its saved state before starting a new connection.'));onRefresh?.();return;
        }
        authorizationTicket=prepared.authorizationTicket;
        if(prepared.registrationRequired&&prepared.autoPinEligible)setFeedback(tf('يُستكمل تسجيل الرقم تلقائيًا دون طلب PIN.','Completing phone registration automatically without a PIN prompt.'));
        if(prepared.registrationRequired&&!prepared.autoPinEligible){
        setPin('');setAwaitingPin(true);
        const answer=await new Promise<string|null>(resolve=>{pinAnswer.current=resolve;});
        if(!mounted.current||!checkCurrent())return;
        setAwaitingPin(false);setPin('');
        if(answer===null){
          if(currentTime()>=expiresAt){setInFlight(null);setFeedback(tf('انتهت المحاولة. راجع المحاولة والأصول المحفوظة قبل المتابعة.','The attempt expired. Review the attempt and saved assets before proceeding.'));return;}
          setInFlight('cancelling');
          const cancelled=await resolved.cancelConnection!({expectedAccountId:scope.expectedAccountId,companyId:scope.companyId,branchId:scope.branchId,channel:'whatsapp',flow:selectedWhatsappFlow,attemptId:started.launch.attemptId,generation});
          if(!mounted.current||!checkCurrent())return;
          setLocalConnection(cancelled.read);setInFlight(null);onRefresh?.();return;
        }
        registrationPin=answer;
        }
      }
      const completion = started.launch.flow === "wa_new_number"
        ? {
            attemptId: started.launch.attemptId,
            nonce: started.launch.nonce,
            code: popupResult.code,
            wabaId: popupResult.wabaId ?? "",
            phoneNumberId: popupResult.phoneNumberId ?? "",
            pin:registrationPin,
            authorizationTicket,
          }
        : {
            attemptId: started.launch.attemptId,
            nonce: started.launch.nonce,
            code: popupResult.code,
            // Number is entered inside Meta and read server-side from Meta's phone_number_id.
            ...(popupResult.wabaId ? { wabaId: popupResult.wabaId } : {}),
            ...(popupResult.phoneNumberId ? { phoneNumberId: popupResult.phoneNumberId } : {}),
          };
      const completed = await resolved.completeConnection!({
        expectedAccountId: scope.expectedAccountId,
        companyId: scope.companyId,
        branchId: scope.branchId,
        channel: "whatsapp",
        flow: selectedWhatsappFlow,
        attemptId: started.launch.attemptId,
        generation,
        completion,
      });
      registrationPin='';
      if (!mounted.current || !checkCurrent()) return;
      setLocalConnection(completed.read);
      if (!completed.ok) {
        if (completed.code === 'invalid_input') {
          setFeedback(tf('إذن إكمال التسجيل غير صالح أو انتهت صلاحيته. راجع المحاولة والأصول المحفوظة قبل المتابعة.', 'The registration continuation is invalid or expired. Review the attempt and saved assets before proceeding.'));
        } else if (completed.code === 'reconciliation_required') {
          setFeedback(tf('تحتاج بيانات الربط إلى مصالحة ومراجعة مع الخادم. استخدم الاسترداد للتحقق من الحالة المحفوظة قبل أي محاولة جديدة.', 'Connection data requires server reconciliation. Use recovery to verify the saved state before trying again.'));
        } else if (completed.code === 'forbidden') {
          setFeedback(tf('الجلسة الحالية غير مصرح لها بإتمام هذا الربط. تحقّق من حسابك وأعد المحاولة.', 'The current session is not authorized to complete this connection. Verify your account and try again.'));
        } else if (completed.code === 'expired') {
          setFeedback(tf('انتهت صلاحية محاولة الربط. راجع المحاولة والأصول المحفوظة قبل المتابعة.', 'The connection attempt has expired. Review the attempt and saved assets before proceeding.'));
        } else if (completed.code === 'setup_required') {
          setFeedback(tf('متطلبات الربط أو إعدادات الحساب غير مكتملة على الخادم. راجع الإعدادات ثم أعد المحاولة.', 'Connection prerequisites or server setup are incomplete. Review settings and retry.'));
        } else {
          setFeedback(tf('تعذّر إتمام التحقق من الربط وحفظه. استخدم الاسترداد للتحقق من الحالة المحفوظة.', 'Connection verification and save could not be completed. Use recovery to check the saved state.'));
        }
      }
      setInFlight(null);
      onRefresh?.();
    } catch {
      if (!mounted.current) return;
      setInFlight(null);
      setFeedback(tf("تعذر إتمام عملية الربط حاليًا. حدّث الحالة أو استخدم الاسترداد.", "Connection could not be completed right now. Refresh status or use recovery."));
    }finally{eager?.bind(null);eager?.abort();if (ownsReservation) connectReserved.current=false;}
  };

  // SDK script preload when the requirements screen mounts: no server attempt is created here.
  useEffect(()=>{
    if (screen!=="requirements" || !route || actions?.launchWhatsappSdk || window.location.protocol!=='https:') return;
    preloadMetaFacebookSdkScript();
  },[screen,route,actions?.launchWhatsappSdk]);

  // Read existing attempts first; preload SDK/actions only. Never start from an effect.
  useEffect(()=>{
    const flow=route==='new-number'?'wa_new_number':route==='coexistence'?'wa_coexistence':null;
    if(screen!=='requirements'||!flow||!connection?.revision||!viewModel.canStartFlow(flow))return;
    if(actions && !actions.readWhatsappBootstrap)return; // Explicit test ports retain the prepared-attempt path.
    if(!actions?.launchUnboundWhatsappSdk && window.location.protocol!=='https:')return;
    let live=true;
    void (async()=>{
      try {
        const resolved=actions??await resolveDefaultActions();
        const readBootstrap=actions?.readWhatsappBootstrap??(await import('@/lib/tenancy/paid-branch-connection-actions')).readOwnedPaidBranchWhatsappBootstrapAction;
        const result=await readBootstrap({...scope,channel:'whatsapp',flow});
        if(!live||!mounted.current||!checkCurrent())return;
        if(!result.ok){setFeedback(tf('تعذر تجهيز الربط. حدّث الحالة وحاول تاني.','Could not prepare the connection. Refresh status and try again.'));return;}
        if('blockedReason' in result && result.blockedReason==='review_replacement_required'){
          setLocalConnection({...result.read,capabilities:{...result.read.capabilities,allowedFlows:result.read.capabilities.allowedFlows.filter(flow=>flow==='wa_coexistence')}});
          setFeedback(tf('مراجعة سابقة تتطلب ربط تطبيق WhatsApp Business الحالي. ارجع واختر المسار ده؛ الرقم هنتحقق منه من Meta قبل تثبيت الربط.','A previous review requires your current WhatsApp Business App. Go back and choose that route; the server will verify the number from Meta before saving the connection.'));
          return;
        }
        if(result.read.revision!==connection.revision || !result.read.capabilities.canStart){setLocalConnection(result.read);return;}
        if(!result.config || result.config.flow!==flow)return;
        const fb=actions?.launchUnboundWhatsappSdk?null:await loadMetaFacebookSdk(result.config.appId,result.config.graphVersion,()=>{});
        if(!live||!mounted.current||!checkCurrent()||(!fb&&!actions?.launchUnboundWhatsappSdk))return;
        setClickReady({config:result.config,fb,resolved,revision:result.read.revision!});
      }catch{if(live)setFeedback(tf('تعذر تجهيز الربط. حدّث الحالة وحاول تاني.','Could not prepare the connection. Refresh status and try again.'));}
    })();
    return ()=>{live=false;};
    // Scope changes remount ChannelView; a refreshed revision invalidates preloaded material.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[screen,route,connection?.revision,viewModel.canStart,actions]);

  const handleFreshFacebook = () => {
    if(!clickReady){void handleWhatsappConnect();return;}
    const ready=clickReady;
    if(connectReserved.current||inFlight||!checkCurrent()||!connection||connection.revision!==ready.revision||!viewModel.canStartFlow(ready.config.flow))return;
    let resolveBinding!:(start:PaidBranchConnectionStartResult|null)=>void;
    const binding=new Promise<PaidBranchConnectionStartResult|null>(resolve=>{resolveBinding=resolve;});
    const controller=new AbortController();popupCapture.current=controller;
    const correlationId=makeClientOpId();
    const capture:WhatsappPopupConfig={...ready.config,captureId:correlationId}; // Browser correlation only, never server authority.
    let codeReceivedAt:number|null=null;
    const codeValid=()=>codeReceivedAt===null || Date.now()-codeReceivedAt<30_000;
    const lifecycle:PopupLifecycle={onCodeReceived:()=>{codeReceivedAt??=Date.now();},expiresAt:Date.now()+15*60_000,isCurrent:()=>mounted.current&&(currentAuthority.current?.()??true),signal:controller.signal,
      onCode:ready.config.flow==='wa_new_number'?async code=>{
        const started=await binding;
        if(!started||!codeValid()||!mounted.current||!checkCurrent()||controller.signal.aborted||started.launch.flow!=='wa_new_number')return false;
        const attempt=started.read.connection.attempt;
        if(!attempt||Date.parse(attempt.expiresAt)<=Date.now()||!ready.resolved.captureAuthorization)return false;
        const captured=await ready.resolved.captureAuthorization({...scope,channel:'whatsapp',attemptId:attempt.id,generation:attempt.generation,nonce:started.launch.nonce,code,correlationId});
        return captured.ok&&mounted.current&&checkCurrent();
      }:undefined};
    // This call (and FB.login inside it) must remain before any await or server call.
    let popup:Promise<WhatsappSdkPopupResult>;
    try{popup=actions?.launchUnboundWhatsappSdk?actions.launchUnboundWhatsappSdk(capture,lifecycle):launchPreparedWhatsappSdkPopup(capture,ready.fb!,()=>{},lifecycle);}
    catch{resolveBinding(null);controller.abort();return;}
    popup=popup.catch(()=>({kind:"error" as const}));
    void handleWhatsappConnect(ready.config.flow,undefined,{popup,config:ready.config,resolved:ready.resolved,bind:resolveBinding,abort:()=>controller.abort(),codeValid})
      .finally(()=>{resolveBinding(null);controller.abort();});
  };

  // F5 one-click resume: an existing, unexpired, same-session pending WhatsApp attempt gets its launch re-issued
  // read-only (no attempt is created, no Meta call, no popup) so the next explicit click opens Facebook directly.
  useEffect(()=>{
    const attempt=connection?.connection.attempt;const flow=connection?.connection.flow;
    if (channel!=="whatsapp" || !attempt || attempt.status!=="pending" || (flow!=="wa_new_number"&&flow!=="wa_coexistence")) return;
    if (resumeTried.current===attempt.id || preparedPopup.current || connectReserved.current || inFlight || awaitingPin) return;
    const expiresAt=Date.parse(attempt.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt<=currentTime()+15_000) return;
    if (!actions?.launchWhatsappSdk && window.location.protocol!=='https:') return;
    if (!checkCurrent()) return;
    resumeTried.current=attempt.id;
    // Rehydrate presentation from an existing server attempt; never creates a new attempt.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRoute(flow==="wa_new_number"?"new-number":"coexistence");setScreen("requirements");
    void handleWhatsappConnect(flow,{attemptId:attempt.id});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[channel,connection?.connection.attempt?.id,connection?.connection.attempt?.status,connection?.connection.flow]);

  // F5: read the server-persisted number decision once the connection is verified.
  const numberKey=`${connection?.connection.link?.id}:${connection?.connection.link?.generation}`;
  useEffect(()=>{
    if (channel!=="whatsapp" || !viewModel.isReady || !connection?.linkedNumber) return;
    if (numberCheck?.key===numberKey && numberCheck.status!=="loading") return;
    let live=true;
    void (async()=>{
      try{
        const readFn=actions?.readNumberConfirmation??(await import("@/lib/whatsapp/number-confirmation-actions")).readNumberConfirmationAction;
        const result=await readFn(scope.companyId);
        if(!live||!mounted.current)return;
        setNumberCheck(result.ok?{key:numberKey,status:result.status,linkId:result.linkId,linkGeneration:result.linkGeneration}:{key:numberKey,status:"unavailable"});
      }catch{if(live&&mounted.current)setNumberCheck({key:numberKey,status:"unavailable"});}
    })();
    return ()=>{live=false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[channel,viewModel.isReady,numberKey,connection?.linkedNumber,scope.companyId]);
  const decideNumber=async(answer:"confirmed"|"rejected")=>{
    const current=numberCheck;
    if(!current||current.busy||current.status!=="pending"||!current.linkId||current.linkGeneration===undefined||!checkCurrent())return;
    setNumberCheck({...current,busy:true,error:false});
    try{
      const decideFn=actions?.decideNumberConfirmation??(await import("@/lib/whatsapp/number-confirmation-actions")).decideNumberConfirmationAction;
      const result=await decideFn({companyId:scope.companyId,linkId:current.linkId,linkGeneration:current.linkGeneration,answer});
      if(!mounted.current)return;
      if(result.ok){setNumberCheck({...current,status:result.status,busy:false});if(result.status==="rejected")onRefresh?.();}
      else setNumberCheck({...current,busy:false,error:true});
    }catch{if(mounted.current)setNumberCheck({...current,busy:false,error:true});}
  };

  const handlePreparedFacebook = () => {
    const prepared = preparedPopup.current;
    const current = connection?.connection.attempt;
    if (!prepared || connectReserved.current || inFlight || !checkCurrent() || !current || current.id !== prepared.attemptId || current.generation !== prepared.generation || current.status !== "pending" || prepared.expiresAt <= currentTime()) {
      if (prepared) { prepared.abandon(); preparedPopup.current = null; setPopupReady(false); }
      return;
    }
    prepared.launch();
  };

  const handleInstagramConnect = async () => {
    if (!checkCurrent() || !connection || !connection.revision || !canStartInstagram) return;
    setFeedback(null);
    setInFlight("starting");
    try {
      const startFn = actions?.startConnection ?? (await resolveDefaultActions()).startConnection;
      const started = await startFn({
        expectedAccountId: scope.expectedAccountId,
        companyId: scope.companyId,
        branchId: scope.branchId,
        channel: "instagram",
        flow: "instagram_direct",
        clientOpId: makeClientOpId(),
        expectedRevision: connection.revision,
      });
      if (!mounted.current || !checkCurrent()) return;
      setLocalConnection(started.read);
      if (!started.ok || started.launch.flow !== "instagram_direct") {
        setInFlight(null);
        return;
      }
      const target = new URL(started.launch.authorizationUrl);
      if (target.origin !== "https://www.instagram.com" || target.pathname !== "/oauth/authorize") {
        setInFlight(null);
        return;
      }
      const navigate = actions?.navigateToUrl ?? ((url: string) => window.location.assign(url));
      navigate(target.href);
    } catch {
      if (!mounted.current) return;
      setInFlight(null);
      setFeedback(tf("تعذر بدء تفويض Instagram حاليًا. حاول مرة أخرى.", "Could not start Instagram authorization right now. Try again."));
    }
  };

  const handleRecover = async () => {
    const attempt = connection?.connection.attempt;
    const flow = connection?.connection.flow;
    if (connectReserved.current || !checkCurrent() || !connection || !attempt || !flow || !viewModel.canRecover) return;
    preparedPopup.current?.abandon(); preparedPopup.current = null; setPopupReady(false);
    connectReserved.current=true;
    setFeedback(null);
    setInFlight("recovering");
    try {
      const recoverFn = actions?.recoverConnection ?? (await resolveDefaultActions()).recoverConnection;
      const recovered = await recoverFn({
        expectedAccountId: scope.expectedAccountId,
        companyId: scope.companyId,
        branchId: scope.branchId,
        channel,
        flow,
        attemptId: attempt.id,
        generation: attempt.generation,
      });
      if (!mounted.current || !checkCurrent()) return;
      setLocalConnection(recovered.read);
      if(recovered.ok&&recovered.continuation&&flow==='wa_new_number'){
        const continuation=recovered.continuation;
        let registrationPin='';
        if(continuation.registrationRequired&&continuation.autoPinEligible)setFeedback(tf('يُستكمل تسجيل الرقم تلقائيًا دون طلب PIN.','Completing phone registration automatically without a PIN prompt.'));
        if(continuation.registrationRequired&&!continuation.autoPinEligible){
          setPin('');setAwaitingPin(true);
          const answer=await new Promise<string|null>(resolve=>{pinAnswer.current=resolve;});
          if(!mounted.current||!checkCurrent())return;
          setAwaitingPin(false);setPin('');
          if(answer===null){
            const cancelFn=actions?.cancelConnection??(await resolveDefaultActions()).cancelConnection;
            const cancelled=await cancelFn({expectedAccountId:scope.expectedAccountId,companyId:scope.companyId,branchId:scope.branchId,channel:'whatsapp',flow,attemptId:attempt.id,generation:attempt.generation});
            if(!mounted.current||!checkCurrent())return;
            setLocalConnection(cancelled.read);setInFlight(null);onRefresh?.();return;
          }
          registrationPin=answer;
        }
        setInFlight('completing');
        const completeFn=actions?.completeConnection??(await resolveDefaultActions()).completeConnection;
        const completed=await completeFn({expectedAccountId:scope.expectedAccountId,companyId:scope.companyId,branchId:scope.branchId,channel:'whatsapp',flow,attemptId:attempt.id,generation:attempt.generation,completion:{attemptId:attempt.id,nonce:continuation.nonce,code:'durable-checkpoint',wabaId:continuation.wabaId,phoneNumberId:continuation.phoneNumberId,pin:registrationPin,authorizationTicket:continuation.authorizationTicket}});
        registrationPin='';
        if(!mounted.current||!checkCurrent())return;
        setLocalConnection(completed.read);
        if (!completed.ok) {
          if (completed.code === 'reconciliation_required') {
            setFeedback(tf('تحتاج بيانات الربط إلى مصالحة ومراجعة مع الخادم. تفاصيل المحاولة محفوظة.', 'Connection data requires server reconciliation. Attempt details are preserved.'));
          } else if (completed.code === 'forbidden') {
            setFeedback(tf('الجلسة الحالية غير مصرح لها بإتمام هذا الربط.', 'The current session is not authorized to complete this connection.'));
          } else if (completed.code === 'expired') {
            setFeedback(tf('انتهت صلاحية المحاولة أثناء الاسترداد. راجع الحالة المحفوظة.', 'The attempt expired during recovery. Review the saved state.'));
          } else {
            setFeedback(tf('تعذّر إتمام استرداد الربط. راجع الحالة المحفوظة.', 'Connection recovery could not be completed. Review the saved state.'));
          }
        }
      }
      setInFlight(null);
      onRefresh?.();
    } catch {
      if (!mounted.current) return;
      setInFlight(null);
      setFeedback(tf('تعذّر التحقق الآن. المحاولة محفوظة؛ حاول استكمالها مرة أخرى.','Verification is unavailable. Your attempt is saved; try recovery again.'));
    }finally{connectReserved.current=false;}
  };

  const handleCancel = async () => {
    const attempt = connection?.connection.attempt;
    const flow = connection?.connection.flow;
    if (cancelUncertain || connectReserved.current || !checkCurrent() || !connection || !attempt || !flow || !viewModel.canCancel) return;
    preparedPopup.current?.abandon(); preparedPopup.current = null; setPopupReady(false);
    connectReserved.current=true;
    setFeedback(null);
    setInFlight("cancelling");
    try {
      const cancelFn = actions?.cancelConnection ?? (await resolveDefaultActions()).cancelConnection;
      const operation=cancelFn({
        expectedAccountId: scope.expectedAccountId,
        companyId: scope.companyId,
        branchId: scope.branchId,
        channel,
        flow,
        attemptId: attempt.id,
        generation: attempt.generation,
      });
      let timer:ReturnType<typeof setTimeout>|undefined;
      const cancelled=await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('CANCEL_TIMEOUT')),15000);})]).finally(()=>{if(timer)clearTimeout(timer);});
      if (!mounted.current || !checkCurrent()) return;
      if(cancelled.read.sourceStatus==='ready')setLocalConnection(cancelled.read);
      if(cancelled.ok){
        setScreen('choice');setRoute(null);setPin('');
        setFeedback(tf('تم إلغاء المحاولة. اختر طريقة الربط عندما تكون مستعدًا.','Attempt cancelled. Choose a connection method when you are ready.'));
      }else{
        if(flow==='wa_new_number'&&cancelled.code==='reconciliation_required'){
          setCancelUncertain(true);
          setFeedback(tf('تحتاج المحاولة إلى مراجعة إدارية قبل تأكيد الإلغاء. تبقى المحاولة محفوظة؛ لا تبدأ ربطًا جديدًا.','Administrative review is required before cancellation can be confirmed. The attempt is preserved; do not start a new connection.'));
          return;
        }
        setFeedback(cancelled.code==='forbidden'
          ? tf('تعذّر إلغاء المحاولة من هذه الجلسة. المحاولة محفوظة وتحتاج مراجعة قبل بدء ربط جديد.','This session cannot cancel the attempt. It is preserved and needs review before starting a new connection.')
          : tf('لم يتم تأكيد الإلغاء. المحاولة محفوظة؛ يمكنك إعادة المحاولة دون بدء ربط جديد.','Cancellation was not confirmed. Your attempt is preserved; you can retry without starting a new connection.'));
      }
    } catch {
      if (!mounted.current || !checkCurrent()) return;
      setCancelUncertain(true);
      setFeedback(tf('لم تتأكد نتيجة الإلغاء. تحقق من الحالة قبل أي محاولة أخرى.','Cancellation is unconfirmed. Check the status before trying again.'));
    }finally{connectReserved.current=false;if(mounted.current)setInFlight(null);}
  };

  const checkCancellation = async () => {
    if(connectReserved.current||!checkCurrent()||!connection?.connection.attempt)return;
    connectReserved.current=true;setInFlight('recovering');
    try{
      const readFn=actions?.readConnection??(await resolveDefaultActions()).readConnection;
      let timer:ReturnType<typeof setTimeout>|undefined;
      const latest=await Promise.race([readFn({expectedAccountId:scope.expectedAccountId,companyId:scope.companyId,branchId:scope.branchId,channel}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('READ_TIMEOUT')),15000);})]).finally(()=>{if(timer)clearTimeout(timer);});
      if(!mounted.current||!checkCurrent())return;
      const old=connection.connection.attempt;
      if(latest.sourceStatus==='ready'&&latest.connection.attempt?.id===old.id&&latest.connection.attempt.generation===old.generation&&latest.connection.attempt.status==='cancelled'){
        setLocalConnection(latest);setCancelUncertain(false);setScreen('choice');setRoute(null);
        setFeedback(tf('تم إلغاء المحاولة. اختر طريقة الربط عندما تكون مستعدًا.','Attempt cancelled. Choose a connection method when you are ready.'));
      }else{
        setFeedback(tf('لم يتأكد الإلغاء بعد. انتظر ثم تحقق مجددًا، دون بدء ربط جديد.','Cancellation is not confirmed yet. Wait and check again before starting a new connection.'));
      }
    }catch{if(mounted.current&&checkCurrent())setFeedback(tf('تعذّر قراءة الحالة. حاول التحقق مجددًا.','Could not read the status. Try checking again.'));}
    finally{connectReserved.current=false;if(mounted.current)setInFlight(null);}
  };


  const commercialIncomplete = channel === "whatsapp" && !(connection?.connection.verified && connection.connection.state === "connected");
  // A server-scoped verified link or unresolved attempt must never offer a new signup.
  const showWhatsappOnboarding = !viewModel.isReady && (!connection || viewModel.canStart || popupReady || !!inFlight || awaitingPin);
  const feedbackInGuide = showWhatsappOnboarding && !!route && !awaitingPin && (screen === "guide" || screen === "requirements");


  return <section className={styles.view} data-setup-unsaved={unsavedConnection?'true':undefined} dir={ar ? "rtl" : "ltr"} aria-label={channel==='whatsapp'?t('ربط واتساب','Connect WhatsApp'):t('ربط إنستغرام','Connect Instagram')}>
    <header className={styles.header}>
      {available && effectiveRead !== undefined && <div className={hideStatusBadge?undefined:styles.statusBanner} data-connection-ui-state={viewModel.uiState} data-commercial-link={commercialIncomplete ? "incomplete" : "verified"}>
        {!hideStatusBadge&&<span className={styles.statusBadge} role="status" aria-label={channelConnectionLabel(connection, locale)}>{viewModel.badgeLabel}</span>}
        {viewModel.guidance && !(channel==='whatsapp'&&(viewModel.isReady||awaitingPin)) && <p>{viewModel.guidance}</p>}
        {feedback && !feedbackInGuide && <p role="alert">{feedback}</p>}
        {canRequestReview&&!awaitingPin&&<div className={styles.recoveryActions}>
          {reviewReceipt&&<p role="status">{t('المراجعة قيد الانتظار','Review pending')} <bdi>{reviewReceipt.id}</bdi></p>}
          <button type="button" className={styles.primary} data-request-review disabled={!!inFlight||!!reviewReceipt} onClick={()=>void handleReviewRequest(true)}>{t('طلب مراجعة إدارية','Request administrative review')}</button>
          <button type="button" className={styles.back} data-refresh-review disabled={!!inFlight} onClick={()=>void handleReviewRequest(false)}>{t('تحديث حالة المراجعة','Refresh review status')}</button>
        </div>}
        {!awaitingPin&&(viewModel.canRecover || viewModel.canCancel || cancelUncertain) && <div className={styles.recoveryActions}>
          {cancelUncertain && <button type="button" className={styles.back} data-check-cancellation="true" disabled={!!inFlight} onClick={() => void checkCancellation()}>{t('التحقق من حالة الإلغاء','Check cancellation status')}</button>}
          {viewModel.canRecover && !cancelUncertain && <button type="button" className={styles.primary} data-recover-action="true" onClick={() => void handleRecover()}>
            {inFlight === "recovering" ? t("جارٍ التحقق…", "Verifying…") : t("استرداد والتحقق من الربط", "Recover and verify connection")}
          </button>}
          {viewModel.canCancel && !cancelUncertain && <button type="button" className={styles.back} data-cancel-action="true" onClick={() => void handleCancel()}>
            {inFlight === "cancelling" ? t("جارٍ الإلغاء…", "Cancelling…") : t("إلغاء المحاولة الحالية", "Cancel current attempt")}
          </button>}
        </div>}
      </div>}
    </header>
    {!available ? <p role="status">{t("هذه القناة غير متاحة لهذا الفرع. ارجع إلى قائمة الإعداد للتحقق من اختيارك.", "This channel is unavailable for this branch. Return to setup to check your selection.")}</p> :
      channel === "whatsapp" ? <>
        {viewModel.isReady && (()=>{
          const state=numberCheck?.key===numberKey?numberCheck:null;
          const linked=connection?.linkedNumber??null;
          const answer=!linked?null:state?.status==='confirmed'||state?.status==='not_required'?'confirmed':state?.status==='rejected'?'wrong':state?.status==='pending'?null:undefined;
          return <section className={`${styles.requirements} ${styles.connectionCard}`} data-whatsapp-connected data-number-check={!linked?'unavailable':answer===null?'pending':answer===undefined?(state?.status==='unavailable'?'unavailable':'loading'):answer} aria-labelledby={titleId+'-linked'}>
          <span className={`${styles.connectionIcon} ${answer==='wrong'?styles.connectionIconNeutral:styles.connectionIconSuccess}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/>{answer==='wrong'?<path d="m9 9 6 6m0-6-6 6"/>:<path d="m8 12 3 3 5-6"/>}</svg></span>
          <h3 id={titleId+'-linked'}>{answer==='wrong'?t('تم فصل الرقم','Number disconnected'):linked&&answer===null?t('ده رقم واتساب الصحيح؟','Is this your WhatsApp number?'):t('واتساب متصل','WhatsApp connected')}</h3>
          <p role="status">{answer==='wrong'?t('أعد الربط بالرقم الصحيح.','Reconnect with the correct number.'):linked&&answer===null?t('راجع الرقم قبل المتابعة.','Check your number before continuing.'):t('تم التحقق من ربط القناة لهذا الفرع.','This branch’s channel connection has been verified.')}</p>
          {linked ? <div className={styles.linkedNumberCard}><span>{t('رقم واتساب المربوط','Connected WhatsApp number')}</span><bdi dir="ltr" data-linked-number>{linked}</bdi></div>
            : <p role="status">{t('تعذّر عرض الرقم المربوط الآن. راجعه في إعدادات واتساب.','The linked number cannot be shown right now. Check it in WhatsApp settings.')}</p>}
          {linked && answer===null && <p>{t('تأكد أن هذا هو رقمك. لن تُرسل أي ردود من هذا الرقم قبل تأكيدك.','Confirm this is your number. No replies are sent from this number until you confirm.')}</p>}
          {linked && answer===null && <div className={styles.requirementActions} role="group" aria-label={t('هل هذا رقمك؟','Is this your number?')}>
            <button type="button" className={styles.primary} disabled={!!state?.busy} onClick={()=>void decideNumber('confirmed')}>{t('نعم، هذا رقمي','Yes, this is my number')}</button>
            <button type="button" className={styles.back} disabled={!!state?.busy} onClick={()=>void decideNumber('rejected')}>{t('هذا ليس رقمي','This is not my number')}</button>
          </div>}
          {state?.error && <p role="alert">{t('تعذّر حفظ إجابتك الآن. لم يتغير شيء؛ أعد المحاولة.','Your answer could not be saved right now. Nothing changed; try again.')}</p>}
          {linked && state?.status==='unavailable' && <p role="status">{t('تعذّر التحقق من حالة تأكيد الرقم. حدّث الصفحة.','The number confirmation status could not be checked. Refresh the page.')}</p>}
          {answer==='wrong' && <p role="alert">{t('تم فصل هذا الرقم ولن تُرسل منه أي ردود. أعد الربط واختر الرقم الصحيح داخل نافذة Meta.','This number was disconnected and no replies will be sent from it. Reconnect and pick the correct number in the Meta window.')}</p>}
          {answer==='confirmed' && connection?.connection.flow==='wa_coexistence' && <CoexistenceImportPanel companyId={scope.companyId} locale={ar?'ar':'en'}/>}
          <a className={styles.settingsLink} href="/app/settings?tab=whatsapp">{t('إدارة إعدادات واتساب','Manage WhatsApp settings')}</a></section>;})()}
        {connection && !viewModel.isReady && !showWhatsappOnboarding && <p role="status">{t('راجع حالة المحاولة الحالية قبل بدء ربط آخر.','Review the current connection attempt before starting another.')}</p>}
        {awaitingPin&&!viewModel.isReady&&<form className={`${styles.requirements} ${styles.connectionCard}`} data-registration-pin onSubmit={event=>{event.preventDefault();if(checkCurrent()&&/^\d{6}$/.test(pin)){const answer=pinAnswer.current;pinAnswer.current=null;answer?.(pin);}}}>
          <span className={styles.connectionIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 4 6v6c0 4 5 7 8 9 3-2 8-5 8-9V6l-8-3Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg></span>
          <h3>{t('احمِ رقم واتساب','Protect your WhatsApp number')}</h3>
          <p role="status">{t('تحقق الخادم من تفويض Meta، والرقم ما زال يحتاج إكمال التسجيل. الربط لم يكتمل بعد.','The server checked Meta authorization. This number still needs registration; connection is not complete.')}</p>
          <label htmlFor={titleId+'-pin'}>{t('رقم PIN لحماية واتساب (6 أرقام)','WhatsApp security PIN (6 digits)')}</label>
          <p id={titleId+'-pin-help'}>{t('اختر PIN جديدًا واحفظه بأمان. إذا كان التحقق بخطوتين مفعّلًا بالفعل لهذا الرقم، استخدم PIN الموجود. هذا ليس كود SMS أو المكالمة.','Choose a new PIN and keep it safe. If two-step verification is already enabled for this number, use its existing PIN. This is not the SMS or call verification code.')}</p>
          <input id={titleId+'-pin'} aria-describedby={titleId+'-pin-help'} className={`${styles.textInput} ${styles.pinInput}`} type="password" inputMode="numeric" maxLength={6} autoComplete="off" dir="ltr" value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,'').slice(0,6))}/>
          <div className={styles.requirementActions}><button type="submit" className={styles.primary} disabled={!/^\d{6}$/.test(pin)}>{t('إكمال التسجيل والتحقق','Finish registration and verify')}</button><button type="button" className={styles.back} onClick={()=>{if(checkCurrent()){const answer=pinAnswer.current;pinAnswer.current=null;answer?.(null);}}}>{t('إلغاء المحاولة','Cancel attempt')}</button></div>
        </form>}
        {showWhatsappOnboarding&&screen==="choice"&&<><p className={styles.stageCaption}>{t("الخطوة ١/٢","Step 1/2")}</p><div className={styles.connectLayout} data-wa-screen="choice" data-route-selected={!!route}>
        <div className={styles.intro} hidden={!!route}>
          <p>{t("اختر طريقة استخدام رقمك، ثم أكمل الربط مع Meta.","Choose how you use your number, then connect with Meta.")}</p>

        </div><div className={styles.routeCard}><fieldset className={styles.routes} disabled={!!inFlight} hidden={!!route}>
          <legend>{t("كيف تستخدم هذا الرقم؟", "How do you use this number?")}</legend>
          {(["new-number", "coexistence"] as const).map(value => <label key={value} className={styles.choice}>
            <input type="radio" name={titleId + "-route"} value={value} checked={route === value} onChange={() => {
              if(!checkCurrent())return;
              setClickReady(null);setRoute(value);
              // Route selection only prepares read-only SDK configuration; it never creates an attempt.
              // Both routes look and behave the same; only the Meta config and guide images differ.
              // F5: choosing "connect current app" never creates an attempt; the explicit Facebook click does.
              setScreen("requirements");
            }}/>
            <span>{value === "new-number" ? t("استخدام رقم جديد", "Use a new number") : t("ربط تطبيق WhatsApp Business الحالي", "Connect your WhatsApp Business App")}</span>
            <small>{value==="new-number"?t("رقم تملكه وغير مربوط بأي حساب واتساب.","A number you own that isn't on WhatsApp."):t("احتفظ بالتطبيق على هاتفك وأدِر المحادثات من فيلورا. لا تحذف حسابك أو رقمك.","Keep the app on your phone and manage chats in Velora. Don't delete your account or number.")}</small>
          </label>)}
        </fieldset>
        </div></div></>}
        {showWhatsappOnboarding&&screen==="guide"&&route&&<div data-wa-screen="guide"><button type="button" className={styles.back} data-back-to-choice onClick={()=>setScreen("choice")}>{t("رجوع","Go back")}</button><WhatsappConnectionGuide route={route} locale={locale} connectionStatus={effectiveRead === undefined ? t("دليل الربط", "Connection guide") : channelConnectionLabel(connection, locale)} connectEnabled={!!selectedWhatsappFlow && viewModel.canStartFlow(selectedWhatsappFlow)} connecting={inFlight === "starting" || inFlight === "completing"} onConnect={()=>setScreen("requirements")} onReviewRequirements={()=>setScreen("requirements")} feedback={feedback}/></div>}
        {showWhatsappOnboarding&&screen==="requirements"&&route&&!awaitingPin&&<div className={styles.requirements} data-wa-screen="requirements">
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}><p className={styles.stageCaption} style={{margin:0}}>{t("الخطوة ٢/٢","Step 2/2")}</p><GuideStatusBadge label={channelConnectionLabel(connection,locale)}/></div>
          <WhatsappConnectionGuide route={route} locale={locale} connectEnabled={(popupReady || (canStartSelectedWhatsapp && (!!clickReady || (!!actions && !actions.readWhatsappBootstrap) || window.location.protocol!=='https:')))&&!inFlight} connecting={!!inFlight} preparing={!popupReady&&!clickReady} onConnect={popupReady ? handlePreparedFacebook : handleFreshFacebook} feedback={feedback}/>
          {!feedback&&!inFlight&&!popupReady&&!canStartSelectedWhatsapp&&<div role="status">{effectiveRead === undefined ? <span className={styles.srOnly} data-visually-hidden>{t("يتم التحقق من حالة الاتصال.","Checking connection status.")}</span> : connection?.sourceStatus === "ready" && !!connection.revision ? t("طريقة الربط غير متاحة الآن. راجع حالة القناة.","This connection route is unavailable. Review the channel status.") : t("تعذّر التحقق من حالة القناة. حدّث الحالة قبل المحاولة.","The channel status could not be verified. Refresh the status before trying.")}{effectiveRead !== undefined&&onRefresh&&<button type="button" className={styles.back} onClick={()=>{if(checkCurrent())onRefresh();}}>{t("تحديث الحالة","Refresh status")}</button>}</div>}
          <div className={styles.requirementActions} data-channel-back>
            <button type="button" className={styles.back} disabled={!!inFlight || popupReady} onClick={()=>{setRoute(null);setScreen("choice");}}>{t("رجوع","Back")}</button>

          </div>
        </div>}
      </> : <div className={styles.connectLayout} data-ig-screen={viewModel.isReady?"connected":"connect"}>
        {viewModel.isReady ? <section className={styles.requirements} data-instagram-connected aria-labelledby={titleId+"-ig-linked"}>
          <h3 id={titleId+"-ig-linked"}>{t("إنستغرام متصل","Instagram connected")}</h3>
          <p role="status">{t("تم التحقق من ربط حساب إنستغرام الاحترافي لهذا الفرع.","This branch’s Instagram professional account connection has been verified.")}</p>
        </section> : <>
          <p className={styles.stageCaption}>{t("ربط إنستغرام","Connect Instagram")}</p>
          <div className={styles.intro}>
            <p>{t("اربط حسابًا احترافيًا تملك صلاحية إدارته. الصلاحيات تُراجع أثناء التفويض مع Meta؛ قراءة التعليمات لا تمنحها.","Connect a professional account you have permission to manage. Permissions are checked during Meta authorization; reading these instructions does not grant them.")}</p>
          </div>
          <div className={styles.routeCard}>
            <fieldset className={styles.routes} disabled={!!inFlight}>
              <legend>{t("قبل المتابعة تأكد من","Before you continue, confirm")}</legend>
              {([
                [t("حساب احترافي (Business أو Creator)","A professional account (Business or Creator)")],
                [t("صلاحية إدارة الحساب لهذا النشاط","Permission to manage the account for this business")],
                [t("ستُحوَّل إلى Instagram لإتمام التفويض","You will be redirected to Instagram to finish authorization")],
              ] as const).map(([label], index) => (
                <div key={index} className={styles.igRequirement} role="listitem">
                  <span>{label}</span>
                </div>
              ))}
            </fieldset>
          </div>
          <section className={styles.requirements} aria-labelledby={titleId+"-ig-action"}>
            <h3 id={titleId+"-ig-action"}>{t("حساب Instagram الاحترافي","Instagram professional account")}</h3>
            <p role="status">{canStartInstagram
              ? t("جاهز لبدء تفويض حساب Instagram الاحترافي لهذا الفرع.","Ready to start Instagram professional account authorization for this branch.")
              : t("الربط غير متاح بعد. ستبقى الخطوة دون تغيير حتى يتم التحقق من الربط لهذا الفرع.","Connection is not available yet. This step stays unchanged until connection is verified for this branch.")}</p>
            {feedback && <p role="alert">{feedback}</p>}
            <div className={styles.requirementActions}>
              <button type="button" className={styles.primary} data-connect-action="true" disabled={!canStartInstagram||!!inFlight} onClick={() => void handleInstagramConnect()}>
                {inFlight === "starting" ? t("جارٍ التحويل إلى Instagram…","Redirecting to Instagram…") : t("ربط Instagram","Connect Instagram")}
              </button>
            </div>
          </section>
        </>}
      </div>}
  </section>;
}
