"use client";

import {useEffect, useLayoutEffect, useId, useRef, useState} from "react";
import type {PaidBranchSetupRead, PaidSetupChannel} from "@/lib/tenancy/paid-setup-contracts";
import {checklistSteps, paidChecklistFromRead, type PaidSetupFlowProps} from "./paid-assistant-checklist";
import {WhatsappConnectionGuide} from "./whatsapp-connection-guide";
import styles from "./paid-channel-view.module.css";
import {useSetupUnsavedChanges} from './paid-setup-unsaved';
import {
  normalizeConfirmedPhone,
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
import {parseSignupMessage, signupLoginOptions} from "@/lib/whatsapp/embedded-signup-browser";
import {
  coexistenceLoginOptions,
  createSignupAttempt,
  joinSignupSignal,
  parseEmbeddedSignupMessage,
} from "@/lib/whatsapp/coexistence/browser";

export type WhatsappSdkPopupResult =
  | { kind: "completed"; code: string; wabaId?: string; phoneNumberId?: string }
  | { kind: "cancelled" }
  | { kind: "error" };

export type PaidChannelViewActions = {
  captureAuthorization?:(input:PaidBranchConnectionScope&{attemptId:string;generation:number;nonce:string;code:string;correlationId?:string})=>Promise<{ok:boolean}>;
  prepareRegistration?:(input:CompleteOwnedPaidBranchConnectionInput)=>Promise<{ok:true;registrationRequired:boolean;autoPinEligible?:boolean;authorizationTicket:string}|{ok:false}>;
  startConnection?: (input: StartOwnedPaidBranchConnectionInput) => Promise<PaidBranchConnectionStartResult | PaidBranchConnectionDenial>;
  completeConnection?: (input: CompleteOwnedPaidBranchConnectionInput) => Promise<PaidBranchConnectionMutation>;
  recoverConnection?: (input: RecoverOwnedPaidBranchConnectionInput) => Promise<PaidBranchConnectionMutation>;
  cancelConnection?: (input: CancelOwnedPaidBranchConnectionInput) => Promise<PaidBranchConnectionMutation>;
  readConnection?: (input: PaidBranchConnectionScope) => Promise<PaidBranchConnectionRead>;
  launchWhatsappSdk?: (launch: Extract<PaidBranchConnectionLaunch, { flow: "wa_new_number" | "wa_coexistence" }>) => Promise<WhatsappSdkPopupResult>;
  navigateToUrl?: (url: string) => void;
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
    captureAuthorization:mod.captureOwnedWhatsappAuthorizationAction,
    prepareRegistration:mod.prepareOwnedWhatsappRegistrationAction,
    startConnection: mod.startOwnedPaidBranchConnectionAction,
    completeConnection: mod.completeOwnedPaidBranchConnectionAction,
    recoverConnection: mod.recoverOwnedPaidBranchConnectionAction,
    cancelConnection: mod.cancelOwnedPaidBranchConnectionAction,
    readConnection: mod.readOwnedPaidBranchConnectionAction,
  };
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

function launchCoexistenceSdkPopup(launch:Extract<PaidBranchConnectionLaunch,{flow:"wa_coexistence"}>,fb:FbSdk,trace:(stage:string,facts?:Record<string,boolean>)=>void):Promise<WhatsappSdkPopupResult>{
  return new Promise(resolve=>{
    let settled=false;let onMessage:(event:MessageEvent)=>void=()=>{};
    const timeout=window.setTimeout(()=>{trace('callback_or_signal_timeout');finishOnce({kind:'error'});},5*60_000);
    const finishOnce=(result:WhatsappSdkPopupResult)=>{if(settled)return;settled=true;window.clearTimeout(timeout);window.removeEventListener('message',onMessage);resolve(result);};
    let attempt = createSignupAttempt(launch.attemptId);
    const checkCoexistence = () => {
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
      if (settled) return;
      const obs = parseEmbeddedSignupMessage({ origin: event.origin, data: event.data }, "coexistence");
      if (obs.kind === "ignored") return;
      trace("signup_signal", { finish: obs.kind === "finish", cancel: obs.kind === "cancel", error: obs.kind === "error" || obs.kind === "invalid" || obs.kind === "unknown", assets_received: obs.kind === "finish" });
      attempt = joinSignupSignal(attempt, launch.attemptId, obs);
      checkCoexistence();
    };
    window.addEventListener("message", onMessage);
    trace("fb_login_invoked");
    fb.login((response) => {
      if (settled) return;
      const code = response?.authResponse?.code;
      trace("oauth_callback_received", { code_received: typeof code === "string" && code.trim().length > 0 });
      if (typeof code === "string" && code.trim().length > 0) {
        attempt = joinSignupSignal(attempt, launch.attemptId, { kind: "code", code });
        checkCoexistence();
      } else if (!settled) {
        finishOnce({ kind: "error" });
      }
    }, coexistenceLoginOptions(launch.configId));
  });
}

type PopupLifecycle={expiresAt:number;isCurrent:()=>boolean;signal?:AbortSignal;onCode?:(code:string)=>Promise<boolean>;onObservation?:(stage:PopupObservation)=>void};
function launchPreparedWhatsappSdkPopup(
 launch:Extract<PaidBranchConnectionLaunch,{flow:"wa_new_number"|"wa_coexistence"}>,fb:FbSdk,
 trace:(stage:string,facts?:Record<string,boolean>)=>void,lifecycle?:PopupLifecycle,
):Promise<WhatsappSdkPopupResult>{
 if(launch.flow==='wa_coexistence')return launchCoexistenceSdkPopup(launch,fb,trace);
 if(lifecycle&&(!lifecycle.isCurrent()||lifecycle.signal?.aborted||!Number.isFinite(lifecycle.expiresAt)||lifecycle.expiresAt<=Date.now())){trace('attempt_not_launchable');return Promise.resolve({kind:'error'});}
 const session=createSignupPopupSession({expiresAt:lifecycle?.expiresAt??Date.now()+5*60_000,isCurrent:lifecycle?.isCurrent??(()=>true),signal:lifecycle?.signal,onCode:lifecycle?.onCode,onObservation:lifecycle?.onObservation,trace});
 const onMessage=(event:MessageEvent)=>{
  const parsed=parseSignupMessage(event.origin,event.data);if(!parsed)return;
  if(parsed.event==='FINISH')session.assets(parsed);else if(parsed.event==='CANCEL')session.cancelled();else session.error();
 };
 window.addEventListener('message',onMessage);
 // Capture only the synchronously opened SDK popup, as in Meta's official sample.
 const originalOpen=window.open;let popup:Window|null=null,closed=false;
 const capture:typeof window.open=function(...args){const opened=originalOpen.apply(window,args);if(opened)popup=opened;return opened;};
 window.open=capture;
 try{trace('fb_login_invoked');fb.login(response=>session.code(response?.authResponse?.code),signupLoginOptions(launch.configId));}
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
  const preparedPopup = useRef<{ attemptId: string; generation: number; expiresAt: number; launch: () => void; abandon: () => void } | null>(null);
  const [popupReady, setPopupReady] = useState(false);
  const [confirmedPhone, setConfirmedPhone] = useState("");
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const unsavedConnection=!!(awaitingPin||pin||confirmedPhone)&&!(connectionRead?.connection.state==='connected'&&connectionRead.connection.verified);
  useSetupUnsavedChanges(unsavedConnection,isCurrent??(()=>false),locale);
  const [localOverride, setLocalOverride] = useState<{ base: PaidBranchConnectionRead | null | undefined; read: PaidBranchConnectionRead } | null>(null);
  const [inFlight, setInFlight] = useState<"starting" | "completing" | "recovering" | "cancelling" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cancelUncertain, setCancelUncertain] = useState(false);
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
  const model = read ? paidChecklistFromRead(read, scope) : null;
  const steps = model ? checklistSteps(model) : [];
  const channelStep = steps.find(step => step.id === channel);
  const branch = model?.branches.find(item => item.id === scope.branchId);
  const effectiveRead = localOverride && localOverride.base === connectionRead ? localOverride.read : connectionRead;
  const connection = scopedChannelConnection(effectiveRead, {...scope, channel});
  const viewModel = derivePaidChannelConnectionViewModel(connection, locale, {inFlight});
  const available = checkCurrent() && !!scope.expectedAccountId && !!scope.boundaryFingerprint && !!branch &&
    !!channelStep && (channelStep.status === "pending" || channelStep.status === "verified") &&
    channelStep.dependencyIds.every(id => steps.some(step => step.id === id && step.status === "verified"));

  const selectedWhatsappFlow: PaidBranchConnectionFlow | null =
    route === "new-number" ? "wa_new_number" : route === "coexistence" ? "wa_coexistence" : null;
  const normalizedPhone = normalizeConfirmedPhone(confirmedPhone);
  const whatsappInputsValid =
    route === "new-number"
      ? true
      : route === "coexistence"
        ? !!normalizedPhone && phoneConfirmed
        : false;
  const canStartSelectedWhatsapp =
    !!selectedWhatsappFlow && viewModel.canStartFlow(selectedWhatsappFlow) && whatsappInputsValid;
  const canStartInstagram = viewModel.canStartFlow("instagram_direct");

  const handleWhatsappConnect = async () => {
    // Same-boundary profile refreshes replace isCurrent. Keep every new-number
    // await fence live; scope changes still remount/abort. Coexistence is unchanged.
    const checkCurrent = () => (selectedWhatsappFlow === 'wa_new_number' ? currentAuthority.current?.() ?? true : isCurrent?.() ?? true);
    if (connectReserved.current || inFlight || !checkCurrent() || !connection || !connection.revision || !selectedWhatsappFlow || !canStartSelectedWhatsapp) return;
    // Meta's JavaScript SDK refuses FB.login on HTTP and may never call back.
    // Check before creating a server attempt; injected launchers are test doubles.
    if (!actions?.launchWhatsappSdk && window.location.protocol !== 'https:') {
      setFeedback(t('يتطلب ربط Facebook صفحة HTTPS. افتح رابط التجهيز الآمن قبل بدء الربط.', 'Facebook connection requires an HTTPS page. Open the secure setup link before starting.'));
      return;
    }
    connectReserved.current=true;
    let ownsReservation = true;
    setFeedback(null);
    setInFlight("starting");
    try {
      const resolved = actions?.startConnection && actions?.completeConnection && actions?.cancelConnection
        ? actions
        : { ...(await resolveDefaultActions()), ...actions };
      const started = await resolved.startConnection!({
        expectedAccountId: scope.expectedAccountId,
        companyId: scope.companyId,
        branchId: scope.branchId,
        channel: "whatsapp",
        flow: selectedWhatsappFlow,
        clientOpId: makeClientOpId(),
        expectedRevision: connection.revision,
        ...(selectedWhatsappFlow === "wa_coexistence" && normalizedPhone
          ? { confirmedPhoneNumber: normalizedPhone, confirmed: true as const }
          : {}),
      });
      if (!mounted.current || !checkCurrent()) return;
      setLocalConnection(started.read);
      if (!started.ok || started.launch.flow === "instagram_direct") {
        setInFlight(null);
        return;
      }
      const attempt = started.read.connection.attempt;
      const expiresAt = Date.parse(attempt?.expiresAt ?? "");
      if (!attempt || attempt.id !== started.launch.attemptId || attempt.status !== "pending" || !Number.isFinite(expiresAt) || expiresAt <= currentTime()) {
        setInFlight(null); setFeedback(t("انتهت المحاولة أو تعذّر التحقق منها. استخدم الاسترداد أو الإلغاء.", "The attempt expired or could not be verified. Use recovery or cancellation.")); return;
      }
      const generation = attempt.generation;
      const correlationId = makeClientOpId();
      const trace = (stage: string, facts: Record<string, boolean> = {}) => console.info("whatsapp_signup_stage", { correlation_id: correlationId, timestamp: new Date().toISOString(), stage, ...facts });
      const fb = actions?.launchWhatsappSdk ? null : await loadMetaFacebookSdk(started.launch.appId, started.launch.graphVersion, trace);
      if (!mounted.current || !checkCurrent()) return;
      if (!actions?.launchWhatsappSdk && !fb) { setInFlight(null); setFeedback(t("تعذر تجهيز Facebook. راجع حالة المحاولة قبل المتابعة.", "Facebook could not be prepared. Review the attempt before continuing.")); return; }
      if (expiresAt <= currentTime()) { setInFlight(null); setFeedback(t("انتهت المحاولة. استخدم الاسترداد أو الإلغاء.", "The attempt expired. Use recovery or cancellation.")); return; }
      let abandoned = false;
      const popupResult = await new Promise<WhatsappSdkPopupResult>((resolve) => {
        const timer = window.setTimeout(() => { abandoned = true; preparedPopup.current = null; setPopupReady(false); setFeedback(t("انتهت المحاولة. استخدم الاسترداد أو الإلغاء.", "The attempt expired. Use recovery or cancellation.")); resolve({kind:"error"}); }, Math.min(expiresAt - Date.now(), 2_147_483_647));
        const abandon = () => { abandoned = true; ownsReservation = false; window.clearTimeout(timer); resolve({kind:"error"}); };
        preparedPopup.current = { attemptId: attempt.id, generation, expiresAt, abandon, launch: () => {
          window.clearTimeout(timer); preparedPopup.current = null; setPopupReady(false); connectReserved.current = true; setInFlight("starting");
          try {
            const controller=new AbortController();popupCapture.current=controller;
            const preparedLaunch=started.launch;
            const lifecycle:PopupLifecycle={expiresAt,onCode:preparedLaunch.flow==='wa_new_number'&&resolved.captureAuthorization?async code=>{if(!mounted.current||!checkCurrent())return false;const result=await resolved.captureAuthorization!({...scope,channel:'whatsapp',attemptId:attempt.id,generation,nonce:preparedLaunch.nonce,code,correlationId});return mounted.current&&checkCurrent()&&result.ok;}:undefined,isCurrent:()=>mounted.current&&(currentAuthority.current?.()??true),signal:controller.signal,onObservation:stage=>{
              if(!mounted.current||!checkCurrent())return;
              if(stage==='waiting_timeout'||stage==='popup_closed'||stage==='callback_without_code'){setInFlight(null);setFeedback(t('نتيجة Meta غير محسومة. ننتظر التفويض ضمن صلاحية المحاولة؛ لا تبدأ محاولة أخرى.','Meta outcome is unconfirmed. Waiting within this attempt’s validity; do not start another attempt.'));}
            }};
            const popup = actions?.launchWhatsappSdk ? actions.launchWhatsappSdk(started.launch as Extract<PaidBranchConnectionLaunch, {flow:"wa_new_number"|"wa_coexistence"}>) : launchPreparedWhatsappSdkPopup(started.launch as Extract<PaidBranchConnectionLaunch, {flow:"wa_new_number"|"wa_coexistence"}>, fb!, trace, lifecycle);
            void popup.then(resolve, () => resolve({kind:"error"}));
          } catch { trace("fb_login_failed"); resolve({kind:"error"}); }
        } };
        connectReserved.current = false; setInFlight(null); setPopupReady(true);
      });
      if (abandoned || !mounted.current || !checkCurrent()) return;
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
      if (popupResult.kind !== "completed") {
        setFeedback(t(
          "لم تكتمل نافذة Meta أو أُغلقت قبل التحقق. يمكنك استخدام الاسترداد أو إلغاء المحاولة.",
          "The Meta window did not finish or closed before verification. You can recover or cancel the attempt.",
        ));
        setInFlight(null);
        onRefresh?.();
        return;
      }
      if(started.launch.flow==='wa_new_number'&&currentTime()>=expiresAt){trace('attempt_expired_before_server');setInFlight(null);setFeedback(t('انتهت صلاحية المحاولة؛ لم يُرسل التفويض للإكمال. راجع حالة الأصول أولًا.','The attempt expired; authorization was not submitted. Review the existing assets first.'));onRefresh?.();return;}
      setInFlight("completing");
      // Registration follows Embedded Signup; never collect or persist the PIN before authorization.
      let registrationPin='';
      let authorizationTicket:string|undefined;
      if(started.launch.flow==='wa_new_number'){
        if(!popupResult.code||!popupResult.wabaId||!popupResult.phoneNumberId){setInFlight(null);setFeedback(t('بيانات تفويض Meta غير مكتملة. راجع حالة المحاولة قبل المتابعة.','Meta authorization data is incomplete. Review the attempt status before continuing.'));return;}
        const prepared=await resolved.prepareRegistration?.({expectedAccountId:scope.expectedAccountId,companyId:scope.companyId,branchId:scope.branchId,channel:'whatsapp',flow:'wa_new_number',attemptId:started.launch.attemptId,generation,completion:{attemptId:started.launch.attemptId,nonce:started.launch.nonce,code:popupResult.code,wabaId:popupResult.wabaId,phoneNumberId:popupResult.phoneNumberId,pin:''}}).catch(()=>({ok:false as const}));
        if(!mounted.current||!checkCurrent())return;
        if(!prepared?.ok){
          setInFlight(null);setFeedback(t('نتيجة التفويض غير مؤكدة. استخدم استكمال المحاولة للتحقق من الحالة المحفوظة قبل بدء ربط جديد.','Authorization outcome is unconfirmed. Recover the attempt to check its saved state before starting a new connection.'));onRefresh?.();return;
        }
        authorizationTicket=prepared.authorizationTicket;
        if(prepared.registrationRequired&&prepared.autoPinEligible)setFeedback(t('يُستكمل تسجيل الرقم تلقائيًا دون طلب PIN.','Completing phone registration automatically without a PIN prompt.'));
        if(prepared.registrationRequired&&!prepared.autoPinEligible){
        setPin('');setAwaitingPin(true);
        const answer=await new Promise<string|null>(resolve=>{pinAnswer.current=resolve;});
        if(!mounted.current||!checkCurrent())return;
        setAwaitingPin(false);setPin('');
        if(answer===null){
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
            confirmedPhoneNumber: started.launch.confirmedPhoneNumber,
            confirmed: true as const,
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
      if(!completed.ok&&completed.code==='invalid_input')setFeedback(t('إذن إكمال التسجيل غير صالح أو انتهت صلاحيته. ألغِ المحاولة ثم ابدأ تفويض Facebook من جديد.','The registration continuation is invalid or expired. Cancel this attempt, then start Facebook authorization again.'));
      setInFlight(null);
      onRefresh?.();
    } catch {
      if (!mounted.current) return;
      setInFlight(null);
      setFeedback(t("تعذر إتمام عملية الربط حاليًا. حدّث الحالة أو استخدم الاسترداد.", "Connection could not be completed right now. Refresh status or use recovery."));
    }finally{if (ownsReservation) connectReserved.current=false;}
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
      setFeedback(t("تعذر بدء تفويض Instagram حاليًا. حاول مرة أخرى.", "Could not start Instagram authorization right now. Try again."));
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
        if(continuation.registrationRequired&&continuation.autoPinEligible)setFeedback(t('يُستكمل تسجيل الرقم تلقائيًا دون طلب PIN.','Completing phone registration automatically without a PIN prompt.'));
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
      }
      setInFlight(null);
      onRefresh?.();
    } catch {
      if (!mounted.current) return;
      setInFlight(null);
      setFeedback(t('تعذّر التحقق الآن. المحاولة محفوظة؛ حاول استكمالها مرة أخرى.','Verification is unavailable. Your attempt is saved; try recovery again.'));
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
        setScreen('choice');setRoute(null);setPin('');setConfirmedPhone('');setPhoneConfirmed(false);
        setFeedback(t('تم إلغاء المحاولة. اختر طريقة الربط عندما تكون مستعدًا.','Attempt cancelled. Choose a connection method when you are ready.'));
      }else{
        setFeedback(cancelled.code==='forbidden'
          ? t('تعذّر إلغاء المحاولة من هذه الجلسة. المحاولة محفوظة وتحتاج مراجعة قبل بدء ربط جديد.','This session cannot cancel the attempt. It is preserved and needs review before starting a new connection.')
          : t('لم يتم تأكيد الإلغاء. المحاولة محفوظة؛ يمكنك إعادة المحاولة دون بدء ربط جديد.','Cancellation was not confirmed. Your attempt is preserved; you can retry without starting a new connection.'));
      }
    } catch {
      if (!mounted.current || !checkCurrent()) return;
      setCancelUncertain(true);
      setFeedback(t('لم تتأكد نتيجة الإلغاء. تحقق من الحالة قبل أي محاولة أخرى.','Cancellation is unconfirmed. Check the status before trying again.'));
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
        setFeedback(t('تم إلغاء المحاولة. اختر طريقة الربط عندما تكون مستعدًا.','Attempt cancelled. Choose a connection method when you are ready.'));
      }else{
        setFeedback(t('لم يتأكد الإلغاء بعد. انتظر ثم تحقق مجددًا، دون بدء ربط جديد.','Cancellation is not confirmed yet. Wait and check again before starting a new connection.'));
      }
    }catch{if(mounted.current&&checkCurrent())setFeedback(t('تعذّر قراءة الحالة. حاول التحقق مجددًا.','Could not read the status. Try checking again.'));}
    finally{connectReserved.current=false;if(mounted.current)setInFlight(null);}
  };

  return <section className={styles.view} data-setup-unsaved={unsavedConnection?'true':undefined} dir={ar ? "rtl" : "ltr"} aria-label={channel==='whatsapp'?t('ربط واتساب','Connect WhatsApp'):t('ربط إنستغرام','Connect Instagram')}>
    <header className={styles.header}>
      {available && !hideStatusBadge && <p>{t("الفرع: ", "Branch: ")}<bdi>{branch.label}</bdi></p>}
      {available && effectiveRead !== undefined && <div className={hideStatusBadge?undefined:styles.statusBanner} data-connection-ui-state={viewModel.uiState}>
        {!hideStatusBadge&&<span className={styles.statusBadge} role="status" aria-label={channelConnectionLabel(connection, locale)}>{viewModel.badgeLabel}</span>}
        {viewModel.guidance && <p>{viewModel.guidance}</p>}
        {feedback && <p role="alert">{feedback}</p>}
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
        {awaitingPin&&<form className={styles.requirements} data-registration-pin onSubmit={event=>{event.preventDefault();if(checkCurrent()&&/^\d{6}$/.test(pin)){const answer=pinAnswer.current;pinAnswer.current=null;answer?.(pin);}}}>
          <h3>{t('خطوة أخيرة لتسجيل الرقم','Complete number registration')}</h3>
          <p role="status">{t('تحقق الخادم من تفويض Meta، والرقم ما زال يحتاج إكمال التسجيل. الربط لم يكتمل بعد.','The server checked Meta authorization. This number still needs registration; connection is not complete.')}</p>
          <label htmlFor={titleId+'-pin'}>{t('رقم PIN لحماية واتساب (6 أرقام)','WhatsApp security PIN (6 digits)')}</label>
          <p id={titleId+'-pin-help'}>{t('اختر PIN جديدًا واحفظه بأمان. إذا كان التحقق بخطوتين مفعّلًا بالفعل لهذا الرقم، استخدم PIN الموجود. هذا ليس كود SMS أو المكالمة.','Choose a new PIN and keep it safe. If two-step verification is already enabled for this number, use its existing PIN. This is not the SMS or call verification code.')}</p>
          <input id={titleId+'-pin'} aria-describedby={titleId+'-pin-help'} className={styles.textInput} type="password" inputMode="numeric" maxLength={6} autoComplete="off" value={pin} onChange={event=>setPin(event.target.value.replace(/\D/g,'').slice(0,6))}/>
          <div className={styles.requirementActions}><button type="submit" className={styles.primary} disabled={!/^\d{6}$/.test(pin)}>{t('إكمال التسجيل والتحقق','Finish registration and verify')}</button><button type="button" className={styles.back} onClick={()=>{if(checkCurrent()){const answer=pinAnswer.current;pinAnswer.current=null;answer?.(null);}}}>{t('إلغاء المحاولة','Cancel attempt')}</button></div>
        </form>}
        {screen==="choice"&&<><p className={styles.stageCaption}>{t("الخطوة ١/٢","Step 1/2")}</p><div className={styles.connectLayout} data-wa-screen="choice">
        <div className={styles.intro}>
          <div className={styles.brands} aria-hidden="true"><span><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M20 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.3A8 8 0 1 1 20 11.5Z"/><path d="M9 7.5c.5 3.5 2 5 5.5 6l1-1.5-2-1-1 1a7 7 0 0 1-3-3l1-1-1-2Z"/></svg></span><span>↔</span><span>Meta</span></div>
          <h3>{t("اربط رقم واتساب الخاص بنشاطك","Connect your business WhatsApp number")}</h3>
          <p>{t("اختر الطريقة المناسبة لرقمك. ستُكمل التفويض مع Meta، ثم نتحقق من الاتصال هنا.","Choose the right route for your number. Authorize with Meta, then return here to verify your connection.")}</p>
          <h4>{t("بعد ربط رقمك", "Once your number is connected")}</h4>
          <ul><li>{t("محادثات عملائك بهوية نشاطك", "Customer conversations with your business identity")}</li><li>{t("إدارة المحادثات من فيلورا", "Manage conversations in Velora")}</li><li>{t("تحكّم في بدء ردود المساعد بعد اكتمال التجهيز", "Start assistant replies after completing setup")}</li></ul>
          <details className={styles.helpDetails}><summary>{t("دليل المساعدة", "Help guide")}</summary><p>{t("جهّز حساب Meta الذي تدير منه نشاطك، واختر طريقة الرقم من البطاقة. ستجد خطوات الربط بعد اختيار الطريقة. لو تستخدم تطبيق WhatsApp Business، اختر Coexistence واحتفظ بالتطبيق ورقمك.","Have the Meta account that manages your business ready and choose your number's route. Connection instructions follow your route selection. If you use WhatsApp Business App, choose Coexistence and keep your app and number.")}</p></details>
        </div><div className={styles.routeCard}><h3>{t("تفاصيل مهمة قبل الربط", "Key details before you connect")}</h3><fieldset className={styles.routes} disabled={!!inFlight}>
          <legend>{t("كيف تستخدم هذا الرقم؟", "How do you use this number?")}</legend>
          {(["new-number", "coexistence"] as const).map(value => <label key={value} className={styles.choice}>
            <input type="radio" name={titleId + "-route"} value={value} checked={route === value} onChange={() => {if(checkCurrent())setRoute(value);}}/>
            <span>{value === "new-number" ? t("استخدام رقم جديد", "Use a new number") : t("ربط تطبيق WhatsApp Business الحالي", "Connect your WhatsApp Business App")}</span>
            <small>{value==="new-number"?t("رقم تملكه وغير مرتبط بحساب واتساب أو مزود آخر. سنراجع متطلبات التحقق قبل المتابعة.","A number you own that is not linked to WhatsApp or another provider. Review verification requirements before continuing."):t("Coexistence: استمر في استخدام التطبيق على هاتفك مع إدارة المحادثات من فيلورا، إذا كان حسابك مؤهلًا. لا تحذف حسابك أو تفصل الرقم.","Coexistence: keep using the app on your phone while managing conversations in Velora, if your account is eligible. Do not delete your account or disconnect your number.")}</small>
          </label>)}
        </fieldset>
        <button className={styles.primary} type="button" data-route-continue disabled={!route || !!inFlight} onClick={()=>{if(checkCurrent())setScreen("requirements");}}>{t("متابعة إلى الربط مع Facebook","Continue to Facebook connection")}</button></div></div></>}
        {screen==="guide"&&route&&<div data-wa-screen="guide"><button type="button" className={styles.back} data-back-to-choice onClick={()=>setScreen("choice")}>{t("رجوع","Go back")}</button><WhatsappConnectionGuide route={route} locale={locale} connectionStatus={effectiveRead === undefined ? t("دليل الربط", "Connection guide") : channelConnectionLabel(connection, locale)} connectEnabled={!!selectedWhatsappFlow && viewModel.canStartFlow(selectedWhatsappFlow)} connecting={inFlight === "starting" || inFlight === "completing"} onConnect={()=>setScreen("requirements")} onReviewRequirements={()=>setScreen("requirements")}/></div>}
        {screen==="requirements"&&route&&!awaitingPin&&<div className={styles.requirements} data-wa-screen="requirements">
          <p className={styles.stageCaption}>{t("الخطوة ٢/٢","Step 2/2")}</p>
          {route==="coexistence"&&<div className={styles.inputGroup}>
            <label htmlFor={titleId+"-phone"}>{t("رقم تطبيق WhatsApp Business الحالي (بصيغة دولية مثل +968...)","Existing WhatsApp Business App number (E.164 format e.g. +968...)")}</label>
            <input id={titleId+"-phone"} className={styles.textInput} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={confirmedPhone} onChange={e=>setConfirmedPhone(e.target.value)} placeholder="+96890000000"/>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={phoneConfirmed} onChange={e=>setPhoneConfirmed(e.target.checked)}/>
              <span>{t("أؤكد أن هذا الرقم مفعل حاليًا على تطبيق WhatsApp Business ولن أقوم بحذفه أو فصله.","I confirm this number is currently active on the WhatsApp Business App and I will not delete or disconnect it.")}</span>
            </label>
          </div>}
          <WhatsappConnectionGuide route={route} locale={locale} connectionStatus={channelConnectionLabel(connection,locale)} connectEnabled={(popupReady || canStartSelectedWhatsapp)&&!inFlight} connecting={!!inFlight} preparing={!popupReady} onConnect={popupReady ? handlePreparedFacebook : ()=>void handleWhatsappConnect()}/>
          <button type="button" className={styles.back} disabled={!!inFlight || popupReady} onClick={()=>setScreen("choice")}>{t("رجوع","Go back")}</button>
        </div>}
      </> : <div className={styles.instagram}>
        <h3>{t("حساب Instagram الاحترافي", "Instagram professional account")}</h3>
        <p>{t("استخدم حسابًا احترافيًا تملك صلاحية إدارته. تُراجع الصلاحيات خلال التفويض الفعلي؛ قراءة التعليمات لا تمنحها.", "Use a professional account you have permission to manage. Permissions are checked during authorization; reading these instructions does not grant them.")}</p>
        <p role="status">{canStartInstagram ? t("جاهز لبدء تفويض حساب Instagram الاحترافي لهذا الفرع.", "Ready to start Instagram professional account authorization for this branch.") : t("الربط غير متاح بعد. ستبقى الخطوة دون تغيير حتى يتم التحقق من الربط لهذا الفرع.", "Connection is not available yet. This step stays unchanged until connection is verified for this branch.")}</p>
        <button type="button" data-connect-action="true" disabled={!canStartInstagram} onClick={() => void handleInstagramConnect()}>
          {inFlight === "starting" ? t("جارٍ التحويل إلى Instagram…", "Redirecting to Instagram…") : t("ربط Instagram", "Connect Instagram")}
        </button>
      </div>}
  </section>;
}
