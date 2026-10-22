"use client";

import {useEffect, useId, useRef, useState} from "react";
import type {PaidBranchSetupRead, PaidSetupChannel} from "@/lib/tenancy/paid-setup-contracts";
import {checklistSteps, paidChecklistFromRead, type PaidSetupFlowProps} from "./paid-assistant-checklist";
import {WhatsappConnectionGuide} from "./whatsapp-connection-guide";
import styles from "./paid-channel-view.module.css";
import {
  normalizeConfirmedPhone,
  type CancelOwnedPaidBranchConnectionInput,
  type CompleteOwnedPaidBranchConnectionInput,
  type PaidBranchConnectionFlow,
  type PaidBranchConnectionLaunch,
  type PaidBranchConnectionMutation,
  type PaidBranchConnectionRead,
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
import {joinSignupSignals, parseSignupMessage, signupLoginOptions, type SignupSignals} from "@/lib/whatsapp/embedded-signup-browser";
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
  startConnection?: (input: StartOwnedPaidBranchConnectionInput) => Promise<PaidBranchConnectionStartResult | PaidBranchConnectionDenial>;
  completeConnection?: (input: CompleteOwnedPaidBranchConnectionInput) => Promise<PaidBranchConnectionMutation>;
  recoverConnection?: (input: RecoverOwnedPaidBranchConnectionInput) => Promise<PaidBranchConnectionMutation>;
  cancelConnection?: (input: CancelOwnedPaidBranchConnectionInput) => Promise<PaidBranchConnectionMutation>;
  launchWhatsappSdk?: (launch: Extract<PaidBranchConnectionLaunch, { flow: "wa_new_number" | "wa_coexistence" }>) => Promise<WhatsappSdkPopupResult>;
  navigateToUrl?: (url: string) => void;
};

export type PaidChannelViewProps = {
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

async function resolveDefaultActions(): Promise<Required<Pick<PaidChannelViewActions, "startConnection" | "completeConnection" | "recoverConnection" | "cancelConnection">>> {
  const mod = await import("@/lib/tenancy/paid-branch-connection-actions");
  return {
    startConnection: mod.startOwnedPaidBranchConnectionAction,
    completeConnection: mod.completeOwnedPaidBranchConnectionAction,
    recoverConnection: mod.recoverOwnedPaidBranchConnectionAction,
    cancelConnection: mod.cancelOwnedPaidBranchConnectionAction,
  };
}

function loadMetaFacebookSdk(appId: string, graphVersion: string): Promise<FbSdk | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.resolve(null);
  const win = window as unknown as { FB?: FbSdk; fbAsyncInit?: () => void };
  if (win.FB) {
    win.FB.init({ appId, autoLogAppEvents: true, xfbml: true, version: graphVersion });
    return Promise.resolve(win.FB);
  }
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(null), 15_000);
    win.fbAsyncInit = () => {
      window.clearTimeout(timeout);
      if (win.FB) {
        win.FB.init({ appId, autoLogAppEvents: true, xfbml: true, version: graphVersion });
        resolve(win.FB);
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
        resolve(null);
      };
      document.head.appendChild(script);
    }
  });
}

async function runBrowserWhatsappSdkPopup(
  launch: Extract<PaidBranchConnectionLaunch, { flow: "wa_new_number" | "wa_coexistence" }>,
): Promise<WhatsappSdkPopupResult> {
  const fb = await loadMetaFacebookSdk(launch.appId, launch.graphVersion);
  if (!fb) return { kind: "error" };

  return new Promise((resolve) => {
    let settled = false;
    let onMessage: (event: MessageEvent) => void = () => {};
    const finishOnce = (result: WhatsappSdkPopupResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("message", onMessage);
      resolve(result);
    };

    if (launch.flow === "wa_new_number") {
      let signals: SignupSignals = {};
      const checkReady = () => {
        if (signals.code && signals.wabaId && signals.phoneNumberId) {
          finishOnce({ kind: "completed", code: signals.code, wabaId: signals.wabaId, phoneNumberId: signals.phoneNumberId });
        }
      };
      onMessage = (event: MessageEvent) => {
        const parsed = parseSignupMessage(event.origin, event.data);
        if (!parsed) return;
        if (parsed.event === "CANCEL") {
          finishOnce({ kind: "cancelled" });
          return;
        }
        if (parsed.event === "ERROR" || parsed.event === "UNSUPPORTED") {
          finishOnce({ kind: "error" });
          return;
        }
        signals = joinSignupSignals(signals, parsed);
        checkReady();
      };
      window.addEventListener("message", onMessage);
      fb.login((response) => {
        const code = response?.authResponse?.code;
        if (typeof code === "string" && code.trim().length > 0) {
          signals = joinSignupSignals(signals, { code });
          checkReady();
        } else if (!settled) {
          finishOnce({ kind: "cancelled" });
        }
      }, signupLoginOptions(launch.configId));
      return;
    }

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
      const obs = parseEmbeddedSignupMessage({ origin: event.origin, data: event.data }, "coexistence");
      if (obs.kind === "ignored") return;
      attempt = joinSignupSignal(attempt, launch.attemptId, obs);
      checkCoexistence();
    };
    window.addEventListener("message", onMessage);
    fb.login((response) => {
      const code = response?.authResponse?.code;
      if (typeof code === "string" && code.trim().length > 0) {
        attempt = joinSignupSignal(attempt, launch.attemptId, { kind: "code", code });
        checkCoexistence();
      } else if (!settled) {
        finishOnce({ kind: "cancelled" });
      }
    }, coexistenceLoginOptions(launch.configId));
  });
}

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

function ChannelView({locale, scope, read, channel, connectionRead, isCurrent, onRefresh, actions}: PaidChannelViewProps) {
  const [route, setRoute] = useState<"new-number" | "coexistence" | null>(null);
  const [screen, setScreen] = useState<"choice" | "guide" | "requirements">("choice");
  const [pin, setPin] = useState("");
  const [confirmedPhone, setConfirmedPhone] = useState("");
  const [phoneConfirmed, setPhoneConfirmed] = useState(false);
  const [localOverride, setLocalOverride] = useState<{ base: PaidBranchConnectionRead | null | undefined; read: PaidBranchConnectionRead } | null>(null);
  const [inFlight, setInFlight] = useState<"starting" | "completing" | "recovering" | "cancelling" | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const mounted = useRef(true);
  const titleId = useId();
  const setLocalConnection = (next: PaidBranchConnectionRead) => setLocalOverride({ base: connectionRead, read: next });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
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
  const available = !!scope.expectedAccountId && !!scope.boundaryFingerprint && !!branch &&
    !!channelStep && (channelStep.status === "pending" || channelStep.status === "verified") &&
    channelStep.dependencyIds.every(id => steps.some(step => step.id === id && step.status === "verified"));

  const selectedWhatsappFlow: PaidBranchConnectionFlow | null =
    route === "new-number" ? "wa_new_number" : route === "coexistence" ? "wa_coexistence" : null;
  const normalizedPhone = normalizeConfirmedPhone(confirmedPhone);
  const whatsappInputsValid =
    route === "new-number"
      ? /^\d{6}$/.test(pin)
      : route === "coexistence"
        ? !!normalizedPhone && phoneConfirmed
        : false;
  const canStartSelectedWhatsapp =
    !!selectedWhatsappFlow && viewModel.canStartFlow(selectedWhatsappFlow) && whatsappInputsValid;
  const canStartInstagram = viewModel.canStartFlow("instagram_direct");

  const handleWhatsappConnect = async () => {
    if (!checkCurrent() || !connection || !connection.revision || !selectedWhatsappFlow || !canStartSelectedWhatsapp) return;
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
      const runPopup = actions?.launchWhatsappSdk ?? runBrowserWhatsappSdkPopup;
      const popupResult = await runPopup(started.launch);
      if (!mounted.current || !checkCurrent()) return;
      const generation = started.read.connection.attempt?.generation ?? 1;
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
      setInFlight("completing");
      const completion = started.launch.flow === "wa_new_number"
        ? {
            attemptId: started.launch.attemptId,
            nonce: started.launch.nonce,
            code: popupResult.code,
            wabaId: popupResult.wabaId ?? "",
            phoneNumberId: popupResult.phoneNumberId ?? "",
            pin,
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
      if (!mounted.current || !checkCurrent()) return;
      setLocalConnection(completed.read);
      setInFlight(null);
      onRefresh?.();
    } catch {
      if (!mounted.current) return;
      setInFlight(null);
      setFeedback(t("تعذر إتمام عملية الربط حاليًا. حدّث الحالة أو استخدم الاسترداد.", "Connection could not be completed right now. Refresh status or use recovery."));
    }
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
    if (!checkCurrent() || !connection || !attempt || !flow || !viewModel.canRecover) return;
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
      setInFlight(null);
      onRefresh?.();
    } catch {
      if (!mounted.current) return;
      setInFlight(null);
    }
  };

  const handleCancel = async () => {
    const attempt = connection?.connection.attempt;
    const flow = connection?.connection.flow;
    if (!checkCurrent() || !connection || !attempt || !flow || !viewModel.canCancel) return;
    setFeedback(null);
    setInFlight("cancelling");
    try {
      const cancelFn = actions?.cancelConnection ?? (await resolveDefaultActions()).cancelConnection;
      const cancelled = await cancelFn({
        expectedAccountId: scope.expectedAccountId,
        companyId: scope.companyId,
        branchId: scope.branchId,
        channel,
        flow,
        attemptId: attempt.id,
        generation: attempt.generation,
      });
      if (!mounted.current || !checkCurrent()) return;
      setLocalConnection(cancelled.read);
      setInFlight(null);
      onRefresh?.();
    } catch {
      if (!mounted.current) return;
      setInFlight(null);
    }
  };

  return <section className={styles.view} dir={ar ? "rtl" : "ltr"} aria-labelledby={titleId}>
    <header className={styles.header}>
      <h2 id={titleId}>{t("ربط القناة", "Connect channel")}</h2>
      {available && <p>{t("الفرع: ", "Branch: ")}<bdi>{branch.label}</bdi></p>}
      {available && effectiveRead !== undefined && <div className={styles.statusBanner} data-connection-ui-state={viewModel.uiState}>
        <span className={styles.statusBadge}>{viewModel.badgeLabel}</span>
        <p role="status">{channelConnectionLabel(connection, locale)}</p>
        {viewModel.guidance && <p>{viewModel.guidance}</p>}
        {feedback && <p role="alert">{feedback}</p>}
        {(viewModel.canRecover || viewModel.canCancel) && <div className={styles.recoveryActions}>
          {viewModel.canRecover && <button type="button" className={styles.primary} data-recover-action="true" onClick={() => void handleRecover()}>
            {inFlight === "recovering" ? t("جارٍ التحقق…", "Verifying…") : t("استرداد والتحقق من الربط", "Recover and verify connection")}
          </button>}
          {viewModel.canCancel && <button type="button" className={styles.back} data-cancel-action="true" onClick={() => void handleCancel()}>
            {inFlight === "cancelling" ? t("جارٍ الإلغاء…", "Cancelling…") : t("إلغاء المحاولة الحالية", "Cancel current attempt")}
          </button>}
        </div>}
      </div>}
    </header>
    {!available ? <p role="status">{t("هذه القناة غير متاحة لهذا الفرع. ارجع إلى قائمة الإعداد للتحقق من اختيارك.", "This channel is unavailable for this branch. Return to setup to check your selection.")}</p> :
      channel === "whatsapp" ? <>
        {screen==="choice"&&<div className={styles.connectLayout} data-wa-screen="choice">
        <div className={styles.intro}>
          <div className={styles.brands} aria-hidden="true"><span>WhatsApp</span><span>↔</span><span>Meta</span></div>
          <h3>{t("اربط رقم واتساب الخاص بنشاطك","Connect your business WhatsApp number")}</h3>
          <p>{t("اختر طريقة الربط المناسبة لرقمك، ثم راجع دليل الخطوات والمتطلبات.","Choose the right connection route for your number, then review the guide and requirements.")}</p>
          <ul><li>{t("رقم نشاطك وهويته","Your business number and identity")}</li><li>{t("ربط القناة بالفرع المحدد","Connection scoped to the selected branch")}</li><li>{t("الردود تبدأ بعد تأكيد التشغيل","Replies start after launch confirmation")}</li></ul>
        </div><div className={styles.routeCard}><fieldset className={styles.routes}>
          <legend>{t("كيف تستخدم هذا الرقم؟", "How do you use this number?")}</legend>
          {(["new-number", "coexistence"] as const).map(value => <label key={value} className={styles.choice}>
            <input type="radio" name={titleId + "-route"} value={value} checked={route === value} onChange={() => setRoute(value)}/>
            <span>{value === "new-number" ? t("رقم جديد", "New number") : t("رقم على تطبيق WhatsApp Business", "WhatsApp Business App number")}</span>
            <small>{value==="new-number"?t("رقم غير مرتبط بحساب واتساب أو مزود آخر.","A number not linked to WhatsApp or another provider."):t("ربط متزامن مع تطبيق نشاطك الحالي، إذا كان حسابك مؤهلاً.","Coexistence with your existing Business App, if your account is eligible.")}</small>
          </label>)}
        </fieldset>
        <button className={styles.primary} type="button" disabled={!route} onClick={()=>setScreen("guide")}>{t("عرض خطوات الربط","View connection steps")}</button></div></div>}
        <p className={styles.note}>{t("إذا كان الرقم مرتبطًا بمزود آخر، يلزم تقييم نقل منفصل قبل المتابعة. لا تفصل الرقم ولا تحذفه.", "A number linked to another provider needs a separate migration assessment before continuing. Do not disconnect or delete it.")}</p>
        <p className={styles.note}>{t("تحدد Meta أهلية الحساب والبلد. اختيار المسار أو إنهاء الدليل لا يؤكد الربط ولا يفعّل الردود.", "Meta determines account and country eligibility. Choosing a route or finishing the guide does not confirm connection or enable replies.")}</p>
        {screen==="guide"&&route&&<div data-wa-screen="guide"><button type="button" className={styles.back} onClick={()=>setScreen("choice")}>{t("رجوع","Go back")}</button><WhatsappConnectionGuide route={route} locale={locale} connectionStatus={effectiveRead === undefined ? t("دليل الربط", "Connection guide") : channelConnectionLabel(connection, locale)} connectEnabled={!!selectedWhatsappFlow && viewModel.canStartFlow(selectedWhatsappFlow)} connecting={inFlight === "starting" || inFlight === "completing"} onConnect={()=>setScreen("requirements")} onReviewRequirements={()=>setScreen("requirements")}/></div>}
        {screen==="requirements"&&route&&<div className={styles.requirements} data-wa-screen="requirements">
          <div className={styles.brands} aria-hidden="true"><span>WhatsApp</span><span>↔</span><span>Meta</span></div>
          <h3>{t("تفاصيل مهمة قبل الربط","Key details to check before you connect")}</h3>
          <ul><li>{route==="coexistence"?t("تستخدم تطبيق WhatsApp Business بالفعل على هذا الرقم.","You already use WhatsApp Business App with this number."):t("تملك الرقم ويمكنك استلام رمز التحقق عليه.","You own the number and can receive its verification code.")}</li><li>{t("تحقق من أهلية بلد الرقم وحساب النشاط أثناء خطوات Meta؛ الأهلية غير مضمونة.","Check number-country and business-account eligibility in Meta; eligibility is not guaranteed.")}</li><li>{route==="coexistence"?t("حدّث تطبيق WhatsApp Business إلى أحدث إصدار متاح.","Update WhatsApp Business App to the latest available version."):t("جهّز حساب Meta الذي تملك صلاحية إدارة النشاط من خلاله.","Have the Meta account authorized to manage this business ready.")}</li></ul>
          {route==="new-number"?<div className={styles.inputGroup}>
            <label htmlFor={titleId+"-pin"}>{t("رمز التحقق الثنائي للرقم (6 أرقام)","Two-step verification PIN (6 digits)")}</label>
            <input id={titleId+"-pin"} className={styles.textInput} type="password" inputMode="numeric" maxLength={6} pattern="\d{6}" autoComplete="off" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="000000"/>
          </div>:<div className={styles.inputGroup}>
            <label htmlFor={titleId+"-phone"}>{t("رقم تطبيق WhatsApp Business الحالي (بصيغة دولية مثل +968...)","Existing WhatsApp Business App number (E.164 format e.g. +968...)")}</label>
            <input id={titleId+"-phone"} className={styles.textInput} type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={confirmedPhone} onChange={e=>setConfirmedPhone(e.target.value)} placeholder="+96890000000"/>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={phoneConfirmed} onChange={e=>setPhoneConfirmed(e.target.checked)}/>
              <span>{t("أؤكد أن هذا الرقم مفعل حاليًا على تطبيق WhatsApp Business ولن أقوم بحذفه أو فصله.","I confirm this number is currently active on the WhatsApp Business App and I will not delete or disconnect it.")}</span>
            </label>
          </div>}
          <div className={styles.requirementActions}><button type="button" className={styles.back} onClick={()=>setScreen("guide")}>{t("رجوع","Go back")}</button><button type="button" className={styles.primary} data-connect-action="true" disabled={!canStartSelectedWhatsapp} onClick={()=>void handleWhatsappConnect()}>{inFlight==="starting"||inFlight==="completing"?t("جارٍ التفويض والتحقق…","Authorizing and verifying…"):t("المتابعة مع Facebook","Continue with Facebook")}</button></div>
          <p role="status">{canStartSelectedWhatsapp?t("جاهز لبدء تفويض Meta والتحقق من ملكية الرقم لهذا الفرع.","Ready to start Meta authorization and verify number ownership for this branch."):t("أكمل الحقول المطلوبة وتأكد من جاهزية الفرع لبدء الربط. مراجعة المتطلبات وحدها لا تثبت اكتمال الربط.","Complete the required fields and branch readiness to start connection. Reviewing requirements alone does not prove completion.")}</p>
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
