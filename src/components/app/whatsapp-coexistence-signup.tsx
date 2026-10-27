"use client";

import Script from "next/script";
import {diagnosticText} from "@/lib/diagnostics/contract";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  getCoexistenceSetup, startCoexistenceSignup, completeCoexistenceSignup,
  cancelCoexistenceSignup, disconnectCoexistenceSignup,
  getCoexistenceSyncSetup, requestCoexistenceHistorySync,
} from "@/lib/whatsapp/coexistence/actions";
import {
  coexistenceLoginOptions, createSignupAttempt, joinSignupSignal,
  parseEmbeddedSignupMessage, type SignupAttempt, type SignupSignal,
} from "@/lib/whatsapp/coexistence/browser";
import {
  parsePublicCoexistenceConfig, normalizeConfirmedCompanyPhone, coexistenceCodeFromResponse,
  coexistenceCompletionInput, signupSignalDeadline, type PublicCoexistenceClientConfig,
} from "@/lib/whatsapp/coexistence/client-config";
import { useDemo } from "@/lib/demo-state";
import { Button, Field, Notice } from "./ui";

type DurableStatus = Extract<Awaited<ReturnType<typeof getCoexistenceSetup>>, { ok: true }>["status"];
type SyncSetup = Extract<Awaited<ReturnType<typeof getCoexistenceSyncSetup>>, { ok: true }>;
type SyncType = "history" | "smb_app_state_sync";
type Owner = { companyId: string };
type ActiveAttempt = {
  attemptId: string; nonce: string; expiresAt: string;
  confirmedPhoneNumber: string; config: PublicCoexistenceClientConfig;
  signals: SignupAttempt; codeReceivedAt?: number;
  launched: boolean; submitted: boolean; uncertain?: boolean; detach?: () => void;
};
type FacebookSDK = {
  init(options: { appId: string; version: string; xfbml: boolean; autoLogAppEvents: boolean }): void;
  login(callback: (response: unknown) => void, options: ReturnType<typeof coexistenceLoginOptions>): void;
};
// Local type avoids changing the legacy component's Window.FB declaration.
const facebookSDK = () => (window as unknown as { FB?: FacebookSDK }).FB;
const configSignature = (value: PublicCoexistenceClientConfig) => `${value.appId}:${value.configId}:${value.graphVersion}`;
type Phase = "idle" | "preparing" | "prepared" | "meta" | "validating" | "cancelling" | "disconnecting" | "requesting-sync";

export function WhatsappCoexistenceSignup({ companyId, onConnected, onDisconnected }: {
  companyId: string; onConnected?: () => void; onDisconnected?: () => void;
}) {
  const { locale } = useDemo();
  const t = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [config, setConfig] = useState<PublicCoexistenceClientConfig | null>(null);
  const [durable, setDurable] = useState<DurableStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sdkReadyConfig, setSdkReadyConfig] = useState<string | null>(null);
  const sdkReady = config !== null && sdkReadyConfig === configSignature(config);
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<unknown>(null);
  const [phone, setPhone] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [popupPending, setPopupPending] = useState(false);
  const [syncSetup, setSyncSetup] = useState<SyncSetup | null>(null);
  const [syncDiagnostic, setSyncDiagnostic] = useState<unknown>(null);
  const [syncConsent, setSyncConsent] = useState<{ binding: string; types: SyncType[] } | null>(null);
  const [blockedSyncKeys, setBlockedSyncKeys] = useState<string[]>([]);
  const [stateCompanyId, setStateCompanyId] = useState(companyId);
  const syncBlockedRef = useRef(new Set<string>());
  const ownerRef = useRef<Owner | null>(null);
  const activeRef = useRef<ActiveAttempt | null>(null);
  const operationRef = useRef<object | null>(null);
  const popupPendingRef = useRef(false);
  const popupAttemptRef = useRef<ActiveAttempt | null>(null);
  const readSequenceRef = useRef(0);

  // React restarts this render before committing a new company's UI. Initial mount
  // already has these defaults; asynchronous status reads remain owner-bound below.
  if (stateCompanyId !== companyId) {
    setStateCompanyId(companyId);
    setLoading(true); setDurable(null); setConfig(null); setSdkReadyConfig(null);
    setPhone(""); setConfirmed(false); setPhase("idle"); setNotice(null); setDiagnostic(null);
    setSyncSetup(null); setSyncDiagnostic(null); setSyncConsent(null); setBlockedSyncKeys([]);
  }

  const reloadFor = useCallback((owner: Owner) => {
    const readSequence = ++readSequenceRef.current;
    return Promise.allSettled([
      getCoexistenceSetup(owner.companyId), getCoexistenceSyncSetup(owner.companyId),
    ]).then(([setupRead, syncRead]) => {
      if (ownerRef.current !== owner || readSequenceRef.current !== readSequence) return null;
      setSyncSetup(syncRead.status === "fulfilled" && syncRead.value.ok ? syncRead.value : null);
      setSyncDiagnostic(syncRead.status === "fulfilled" && !syncRead.value.ok ? syncRead.value.diagnostic : null);
      const result = setupRead.status === "fulfilled" ? setupRead.value : null;
      if (!result || !result.ok || result.status.companyId !== owner.companyId) {
        setDurable(null); setConfig(null); setLoading(false);
        setNotice(result && !result.ok ? result.code : "UNAVAILABLE");
        setDiagnostic(result && !result.ok ? result.diagnostic : null);
        return null;
      }
      const nextConfig = parsePublicCoexistenceConfig(result.config);
      setDurable(result.status); setConfig(nextConfig); setLoading(false);
      if (result.config !== null && nextConfig === null) setNotice("INVALID_CONFIG");
      return result.status;
    }).catch(() => {
      if (ownerRef.current === owner && readSequenceRef.current === readSequence) {
        setDurable(null); setConfig(null); setSyncSetup(null); setSyncDiagnostic(null); setLoading(false); setNotice("UNAVAILABLE");
      }
      return null;
    });
  }, []);

  async function retire(current: ActiveAttempt, reason: string) {
    const owner = ownerRef.current;
    if (!owner || activeRef.current !== current || current.submitted) return;
    const operation = {}; operationRef.current = operation;
    current.detach?.(); activeRef.current = null;
    current.signals = createSignupAttempt(current.attemptId); // Discard ephemeral code and selectors.
    setPhase("cancelling"); setNotice(reason);
    try {
      const result = await cancelCoexistenceSignup({ attemptId: current.attemptId, nonce: current.nonce });
      if (ownerRef.current !== owner) return;
      if (!result.ok) { setNotice(result.code); setDiagnostic(result.diagnostic); }
      await reloadFor(owner);
    } catch {
      if (ownerRef.current === owner) { setNotice("UNAVAILABLE"); await reloadFor(owner); }
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        if (ownerRef.current === owner) setPhase("idle");
      }
    }
  }

  // Invalidate prior-company callbacks in the commit phase, before promise
  // microtasks can settle between paint and passive-effect cleanup.
  useLayoutEffect(() => {
    const owner: Owner = { companyId };
    ownerRef.current = owner;
    syncBlockedRef.current.clear();
    void reloadFor(owner);
    const timer = window.setInterval(() => {
      const current = activeRef.current;
      if (!current || current.submitted || current.uncertain || ownerRef.current !== owner) return;
      const deadline = signupSignalDeadline(current.expiresAt, current.codeReceivedAt);
      if (deadline === null || deadline <= Date.now()) void retire(current, "EXPIRED");
    }, 500);
    return () => {
      if (ownerRef.current === owner) ownerRef.current = null;
      operationRef.current = null;
      window.clearInterval(timer);
      const current = activeRef.current;
      current?.detach?.(); activeRef.current = null;
      if (current) {
        current.signals = createSignupAttempt(current.attemptId);
        if (!current.submitted && !current.uncertain) void cancelCoexistenceSignup({ attemptId: current.attemptId, nonce: current.nonce }).catch(() => undefined);
      }
    };
    // retire operates only on identity-bound refs; locale and render callbacks are irrelevant here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, reloadFor]);

  async function prepare() {
    const owner = ownerRef.current;
    const selected = normalizeConfirmedCompanyPhone(phone, confirmed);
    if (!owner || operationRef.current || activeRef.current || popupPendingRef.current || !config || !selected) return;
    const operation = {}; operationRef.current = operation;
    setPhase("preparing"); setNotice(null); setDiagnostic(null);
    try {
      const result = await startCoexistenceSignup({ companyId: owner.companyId, internationalPhoneNumber: selected, confirmed: true });
      if (ownerRef.current !== owner || operationRef.current !== operation) {
        if (result.ok) void cancelCoexistenceSignup({ attemptId: result.attemptId, nonce: result.nonce }).catch(() => undefined);
        return;
      }
      if (!result.ok) { setNotice(result.code); setDiagnostic(result.diagnostic); setPhase("idle"); return; }
      const attemptConfig = parsePublicCoexistenceConfig(result.config);
      const deadline = signupSignalDeadline(result.expiresAt);
      if (!attemptConfig || deadline === null || deadline <= Date.now()
        || attemptConfig.appId !== config.appId || attemptConfig.configId !== config.configId
        || attemptConfig.graphVersion !== config.graphVersion) {
        void cancelCoexistenceSignup({ attemptId: result.attemptId, nonce: result.nonce }).catch(() => undefined);
        setNotice("INVALID_CONFIG"); setPhase("idle"); return;
      }
      activeRef.current = {
        attemptId: result.attemptId, nonce: result.nonce, expiresAt: result.expiresAt,
        config: attemptConfig, confirmedPhoneNumber: selected,
        signals: createSignupAttempt(result.attemptId), launched: false, submitted: false,
      };
      setPhase("prepared");
    } catch {
      if (ownerRef.current === owner) { setNotice("UNAVAILABLE"); setPhase("idle"); }
    } finally {
      if (operationRef.current === operation) operationRef.current = null;
    }
  }

  function launch() {
    const owner = ownerRef.current, current = activeRef.current, sdk = facebookSDK();
    if (!owner || !current || current.launched || current.submitted || !sdk || !sdkReady || popupPendingRef.current) return;
    const deadline = signupSignalDeadline(current.expiresAt);
    if (deadline === null || deadline <= Date.now()) { void retire(current, "EXPIRED"); return; }
    current.launched = true; setPhase("meta"); setNotice(null); setDiagnostic(null);
    popupAttemptRef.current = current; popupPendingRef.current = true; setPopupPending(true);

    // Both listener and SDK callback capture this exact attempt, never a later active slot.
    const receiveSignal = (signal: SignupSignal) => {
      if (ownerRef.current !== owner || activeRef.current !== current || current.submitted) return;
      const expires = signupSignalDeadline(current.expiresAt, current.codeReceivedAt);
      if (expires === null || expires <= Date.now()) { void retire(current, "EXPIRED"); return; }
      const next = joinSignupSignal(current.signals, current.attemptId, signal);
      current.signals = next;
      if (next.status === "cancelled" || next.status === "error" || next.status === "conflict") {
        void retire(current, next.status === "cancelled" ? "CANCELLED" : next.status === "conflict" ? "SIGNAL_CONFLICT" : "FAILED");
        return;
      }
      if (next.status !== "ready-for-server-validation") return;
      const request = coexistenceCompletionInput(current, next);
      if (!request) { void retire(current, "FAILED"); return; }
      current.submitted = true; current.detach?.();
      current.signals = createSignupAttempt(current.attemptId);
      setPhase("validating");
      void completeCoexistenceSignup(request).then(async result => {
        if (ownerRef.current !== owner || activeRef.current !== current) return;
        activeRef.current = null;
        setNotice(result.ok ? null : result.code); setDiagnostic(result.diagnostic ?? null);
        const status = await reloadFor(owner);
        if (ownerRef.current === owner) {
          setPhase("idle");
          if (status?.connectionStatus === "connected") onConnected?.();
        }
      }).catch(async () => {
        if (ownerRef.current !== owner || activeRef.current !== current) return;
        activeRef.current = null; setNotice("RECONCILIATION_REQUIRED");
        await reloadFor(owner);
        if (ownerRef.current === owner) setPhase("idle");
      });
    };
    const receive = (event: MessageEvent) => {
      if (ownerRef.current !== owner || activeRef.current !== current || current.submitted) return;
      const signal = parseEmbeddedSignupMessage({ origin: event.origin, data: event.data }, "coexistence");
      if (signal.kind === "ignored") return;
      if (signal.kind === "unknown" || signal.kind === "invalid") { void retire(current, "UNSUPPORTED_FLOW"); return; }
      receiveSignal(signal);
    };
    window.addEventListener("message", receive);
    current.detach = () => window.removeEventListener("message", receive);
    try {
      // Synchronous user click preserves the popup gesture after preparation completed.
      sdk.login(response => {
        if (popupAttemptRef.current === current) {
          popupAttemptRef.current = null; popupPendingRef.current = false;
          if (ownerRef.current !== null) setPopupPending(false);
        }
        if (ownerRef.current !== owner || activeRef.current !== current || current.submitted || current.uncertain) return;
        const code = coexistenceCodeFromResponse(response);
        if (!code) { current.uncertain = true; current.detach?.(); setNotice("RECONCILIATION_REQUIRED"); return; }
        if (current.codeReceivedAt === undefined) current.codeReceivedAt = Date.now();
        receiveSignal({ kind: "code", code });
      }, coexistenceLoginOptions(current.config.configId));
    } catch {
      popupAttemptRef.current = null; popupPendingRef.current = false; setPopupPending(false);
      current.uncertain = true; current.detach?.(); setNotice("RECONCILIATION_REQUIRED");
    }
  }

  async function disconnect() {
    const owner = ownerRef.current;
    if (!owner || operationRef.current || activeRef.current || phase !== "idle") return;
    const operation = {}; operationRef.current = operation;
    setPhase("disconnecting"); setNotice(null); setDiagnostic(null);
    try {
      const result = await disconnectCoexistenceSignup(owner.companyId);
      if (ownerRef.current !== owner) return;
      if (!result.ok) { setNotice(result.code); setDiagnostic(result.diagnostic); }
      const status = await reloadFor(owner);
      if (ownerRef.current === owner && status?.connectionStatus === "disconnected") onDisconnected?.();
    } catch {
      if (ownerRef.current === owner) { setNotice("UNAVAILABLE"); await reloadFor(owner); }
    } finally {
      if (operationRef.current === operation) {
        operationRef.current = null;
        if (ownerRef.current === owner) setPhase("idle");
      }
    }
  }

  const syncBinding = syncSetup?.linkId && syncSetup.linkGeneration
    ? `${companyId}:${syncSetup.linkId}:${syncSetup.linkGeneration}` : null;
  function syncAvailable(syncType: SyncType) {
    const saved = syncSetup?.syncs.find(item => item.syncType === syncType);
    return Boolean(syncBinding && syncSetup?.ready && durable?.connectionStatus === "connected" && !loading
      && phase === "idle" && saved?.state === "not_requested"
      && !saved.requested && !saved.declined && saved.errorCode === null && saved.providerRequestId === null
      && !blockedSyncKeys.includes(`${syncBinding}:${syncType}`));
  }
  function syncRequestAllowed(syncType: SyncType) {
    return syncAvailable(syncType) && !operationRef.current && !activeRef.current
      && !syncBlockedRef.current.has(`${syncBinding}:${syncType}`);
  }
  async function requestSync(syncType: SyncType) {
    const owner = ownerRef.current;
    if (!owner || owner.companyId !== companyId || !syncBinding || !syncSetup?.linkId || !syncSetup.linkGeneration
      || !syncRequestAllowed(syncType) || syncConsent?.binding !== syncBinding || !syncConsent.types.includes(syncType)) return;
    const operation = {}; operationRef.current = operation;
    const key = `${syncBinding}:${syncType}`;
    // Claim outcome can be ambiguous. Never automatically replay a submitted type in this generation.
    syncBlockedRef.current.add(key); setBlockedSyncKeys(previous => [...previous, key]);
    const input = { companyId: owner.companyId, linkId: syncSetup.linkId, linkGeneration: syncSetup.linkGeneration, syncType, consent: true as const };
    setPhase("requesting-sync"); setNotice(null); setDiagnostic(null);
    try {
      const result = await requestCoexistenceHistorySync(input);
      if (ownerRef.current !== owner || operationRef.current !== operation) return;
      setNotice(result.ok ? "SYNC_ACCEPTED" : result.code); setDiagnostic(result.diagnostic ?? null);
      await reloadFor(owner);
    } catch {
      if (ownerRef.current === owner && operationRef.current === operation) {
        setNotice("RECONCILIATION_REQUIRED"); await reloadFor(owner);
      }
    } finally {
      if (ownerRef.current === owner && operationRef.current === operation) {
        operationRef.current = null; setPhase("idle");
      }
    }
  }

  function initializeSDK() {
    const sdk = facebookSDK();
    if (!config || !sdk) { setSdkReadyConfig(null); setNotice("SDK_UNAVAILABLE"); return; }
    try {
      sdk.init({ appId: config.appId, version: config.graphVersion, xfbml: false, autoLogAppEvents: false });
      setSdkReadyConfig(configSignature(config));
    } catch { setSdkReadyConfig(null); setNotice("SDK_UNAVAILABLE"); }
  }

  const messages: Record<string, string> = {
    SYNC_ACCEPTED: t("Request accepted. Synchronization completion is confirmed by saved webhook status; live messaging remains separately verified.", "تم قبول الطلب. تؤكد حالة الإشعارات المحفوظة اكتمال المزامنة، ويُتحقق من الرسائل المباشرة بشكل منفصل."),
    EXPIRED: t("The signup expired. Close the Meta window, then prepare a new connection.", "انتهت صلاحية الربط. أغلق نافذة ميتا ثم ابدأ ربطاً جديداً."),
    CANCELLED: t("Signup cancelled. Close the Meta window before trying again.", "تم إلغاء الربط. أغلق نافذة ميتا قبل المحاولة مجدداً."),
    SIGNAL_CONFLICT: t("Meta returned conflicting account details. Close the window and start again.", "أعادت ميتا بيانات حساب متعارضة. أغلق النافذة وابدأ مجدداً."),
    UNSUPPORTED_FLOW: t("Meta did not return a supported WhatsApp Business app completion. Close the window and check setup.", "لم يكتمل مسار واتساب للأعمال المدعوم. أغلق النافذة وتحقق من الإعداد."),
    RECONCILIATION_REQUIRED: t("The result needs review before another attempt. Refresh the saved status.", "تحتاج النتيجة إلى مراجعة قبل محاولة أخرى. حدّث الحالة المحفوظة."),
    NEEDS_SETUP: t("Keeping WhatsApp on your phone is awaiting Meta setup.", "الاحتفاظ بواتساب على هاتفك ينتظر إعداد ميتا."),
    FORBIDDEN: t("You do not have permission to manage this company's connection.", "ليس لديك إذن لإدارة ربط هذه الشركة."),
    UNAUTHENTICATED: t("Sign in again to manage this connection.", "سجّل الدخول مجدداً لإدارة هذا الربط."),
    INVALID_CONFIG: t("Signup configuration is unavailable. Refresh the saved status before retrying.", "إعداد الربط غير متاح. حدّث الحالة المحفوظة قبل المحاولة."),
    SDK_UNAVAILABLE: t("Meta signup could not load. Refresh this page before retrying.", "تعذر تحميل ربط ميتا. حدّث الصفحة قبل المحاولة."),
  };
  const busy = phase === "preparing" || phase === "meta" || phase === "validating" || phase === "cancelling" || phase === "disconnecting" || phase === "requesting-sync";
  const selected = normalizeConfirmedCompanyPhone(phone, confirmed);
  const connected = durable?.connectionStatus === "connected";
  const historyLabel: Record<string, string> = {
    not_requested: t("Not requested", "لم يُطلب"), pending: t("Pending", "قيد الانتظار"),
    syncing: t("Synchronization in progress", "المزامنة جارية"), completed: t("Synchronization complete", "اكتملت المزامنة"),
    failed: t("Synchronization failed", "فشلت المزامنة"), reconcile_required: t("Needs review", "تحتاج إلى مراجعة"),
  };
  return <section className="grid gap-4 rounded-xl border border-[color:var(--color-border-soft)] p-4" aria-label={t("Keep WhatsApp on your phone", "احتفظ بواتساب على هاتفك")}>
    <div>
      <h3 className="font-semibold">{t("Keep WhatsApp on your phone", "احتفظ بواتساب على هاتفك")}</h3>
      <p className="mt-1 text-sm text-[var(--color-muted-soft)]">{t("Authorize your existing WhatsApp Business app number in Meta. You can continue using the app on your phone.", "اربط رقم تطبيق واتساب للأعمال الحالي عبر ميتا مع الاستمرار في استخدام التطبيق على هاتفك.")}</p>
    </div>
    {notice ? <Notice tone="warn">{messages[notice] ?? t("The action did not complete. Refresh the saved status before trying again.", "لم يكتمل الإجراء. حدّث الحالة المحفوظة قبل المحاولة مجدداً.")}</Notice> : null}
    {diagnosticText(diagnostic,locale) ? <p className="text-sm break-words" dir={locale === "ar" ? "rtl" : "ltr"}>{diagnosticText(diagnostic,locale)}</p> : null}
    {loading ? <p role="status" className="text-sm">{t("Loading saved connection status…", "جارٍ تحميل حالة الربط المحفوظة…")}</p> : durable ? <dl className="grid gap-2 text-sm">
      <div><dt className="text-[var(--color-muted-soft)]">{t("Connection", "الربط")}</dt><dd>{connected ? t("Meta authorization saved", "تم حفظ تفويض ميتا") : durable.connectionStatus === "disconnected" ? t("Velora access stopped", "تم فصل الربط") : durable.connectionStatus === "needs_review" ? t("Needs review", "تحتاج إلى مراجعة") : t("Not connected", "غير مرتبط")}</dd></div>
      {durable.displayPhoneNumber ? <div><dt className="text-[var(--color-muted-soft)]">{t("Business number", "رقم الشركة")}</dt><dd dir="ltr">{durable.displayPhoneNumber}</dd></div> : null}
      <div><dt className="text-[var(--color-muted-soft)]">{t("Live messaging", "الرسائل الفعلية")}</dt><dd>{connected && durable.liveVerified ? t("Inbound and outbound messaging verified", "تم التحقق من استقبال الرسائل وإرسالها") : t("Not yet verified", "لم يتم التحقق بعد")}</dd></div>
      <div><dt className="text-[var(--color-muted-soft)]">{t("Chat history", "سجل المحادثات")}</dt><dd>{historyLabel[durable.historySyncStatus ?? "not_requested"] ?? t("Needs review", "تحتاج إلى مراجعة")}</dd></div>
      {durable.projectionRecovery ? <div><dt className="text-[var(--color-muted-soft)]">{t("Local data recovery", "استعادة البيانات المحلية")}</dt><dd>{t(`${durable.projectionRecovery.pending} pending · ${durable.projectionRecovery.conflicts} conflicts`, `${durable.projectionRecovery.pending} معلّق · ${durable.projectionRecovery.conflicts} تعارضات`)}</dd></div> : null}
    </dl> : <Notice tone="warn">{t("Saved status is unavailable. Refresh before connecting.", "الحالة المحفوظة غير متاحة. حدّثها قبل الربط.")}</Notice>}
    {!connected && durable?.connectionStatus !== "needs_review" && config ? <>
      <Script key={configSignature(config)} src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive" onReady={initializeSDK} onError={() => { setSdkReadyConfig(null); setNotice("SDK_UNAVAILABLE"); }} />
      <Field label={t("Company WhatsApp number", "رقم واتساب الشركة")} required dir="ltr" hint={t("Include the country code, for example +96891234567. Use your existing WhatsApp Business app number.", "أدخل رمز الدولة مثل +96891234567 ورقم تطبيق واتساب للأعمال الحالي.")}>
        {props => <input {...props} value={phone} type="tel" autoComplete="tel" maxLength={64} disabled={phase !== "idle" || popupPending} onChange={event => { setPhone(event.target.value); setConfirmed(false); }} />}
      </Field>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={phase !== "idle" || popupPending} onChange={event => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4" /><span>{t("I confirm this is the company's WhatsApp Business app number and I can authorize its connection.", "أؤكد أن هذا رقم تطبيق واتساب للأعمال الخاص بالشركة وأنني مخوّل لربطه.")}</span></label>
      <div className="flex flex-wrap gap-2">
        {phase === "prepared" ? <Button type="button" disabled={!sdkReady || popupPending} onClick={launch}>{t("Continue to Meta", "المتابعة إلى ميتا")}</Button> : <Button type="button" disabled={!selected || !sdkReady || popupPending || loading || !durable || phase !== "idle"} busy={phase === "preparing"} onClick={() => void prepare()}>{t("Prepare secure connection", "تجهيز الربط الآمن")}</Button>}
        {phase === "prepared" || phase === "meta" ? <Button type="button" variant="secondary" onClick={() => { const current = activeRef.current; if (current) void retire(current, "CANCELLED"); }}>{t("Cancel signup", "إلغاء الربط")}</Button> : null}
      </div>
      {phase === "meta" ? <p role="status" className="text-sm">{t("Complete the steps in Meta. Scan the code from inside your WhatsApp Business app.", "أكمل الخطوات في ميتا وامسح الرمز من داخل تطبيق واتساب للأعمال.")}</p> : null}
      {phase === "validating" ? <p role="status" className="text-sm">{t("Verifying the authorized account and confirmed number…", "جارٍ التحقق من الحساب المفوّض والرقم المؤكد…")}</p> : null}
      {popupPending && phase === "idle" ? <Notice tone="warn">{t("Close the previous Meta window before starting a new attempt. If signup does not respond, close it and reload this page.", "أغلق نافذة ميتا السابقة قبل بدء محاولة جديدة. إذا لم تستجب، أغلقها ثم حدّث هذه الصفحة.")}</Notice> : null}
    </> : !connected && !config && durable ? <Notice tone="info">{t("This signup is awaiting setup. Saved status and disconnection remain available.", "هذا الربط ينتظر الإعداد. يمكنك عرض الحالة المحفوظة وفصل الربط.")}</Notice> : null}
    <p className="text-sm text-[var(--color-muted-soft)]">{t("Chat history is optional and limited to the previous 180 days. Group chats are excluded; media is limited to the most recent 14 days. Keep the Business app open during synchronization, which must start within 24 hours. Messages from unsupported linked devices may not appear here. This signup does not enable AI replies.", "مشاركة السجل اختيارية وتقتصر على آخر 180 يوماً، دون المجموعات، والوسائط لآخر 14 يوماً. أبقِ تطبيق الأعمال مفتوحاً أثناء المزامنة التي يجب أن تبدأ خلال 24 ساعة. قد لا تظهر رسائل الأجهزة المرتبطة غير المدعومة. هذا الربط لا يفعّل ردود الذكاء الاصطناعي.")}</p>
    <div className="grid gap-3 rounded-lg border border-[color:var(--color-border-soft)] p-3" aria-label={t("Optional synchronization", "المزامنة الاختيارية")}>
      {diagnosticText(syncDiagnostic, locale) ? <p className="break-words text-sm" dir={locale === "ar" ? "rtl" : "ltr"}>{diagnosticText(syncDiagnostic, locale)}</p> : null}
      <p className="text-sm">{t("Choose each synchronization separately. Each type can be requested once for this connection and must start within 24 hours of onboarding. Declined, failed, or uncertain requests need review and cannot be retried here. These requests do not enable AI replies.", "اختر كل مزامنة بشكل منفصل. يمكن طلب كل نوع مرة واحدة لهذا الاتصال، ويجب أن يبدأ خلال 24 ساعة من الربط. تحتاج الطلبات المرفوضة أو الفاشلة أو غير المؤكدة إلى مراجعة ولا يمكن إعادة طلبها هنا. هذه الطلبات لا تفعّل ردود الذكاء الاصطناعي.")}</p>
      {(["history", "smb_app_state_sync"] as const).map(syncType => {
        const saved = syncSetup?.syncs.find(item => item.syncType === syncType);
        const available = syncAvailable(syncType);
        const consented = syncConsent?.binding === syncBinding && syncConsent.types.includes(syncType);
        const heading = syncType === "history" ? t("Chat history", "سجل المحادثات") : t("App state and contacts", "حالة التطبيق وجهات الاتصال");
        return <div key={syncType} className="grid gap-2 text-sm">
          <p><span className="font-medium">{heading}</span>: {saved?.declined ? t("Sharing declined", "رُفضت المشاركة") : saved ? historyLabel[saved.state] ?? t("Needs review", "تحتاج إلى مراجعة") : t("Saved synchronization status unavailable", "حالة المزامنة المحفوظة غير متاحة")}</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={Boolean(consented)} disabled={!available}
            aria-label={syncType === "history" ? t("Consent to chat history synchronization", "الموافقة على مزامنة سجل المحادثات") : t("Consent to app state synchronization", "الموافقة على مزامنة حالة التطبيق")}
            onChange={event => {
              if (!syncBinding || !syncRequestAllowed(syncType)) return;
              const checked = event.target.checked;
              setSyncConsent(previous => {
                const types = previous?.binding === syncBinding ? previous.types.filter(item => item !== syncType) : [];
                return { binding: syncBinding, types: checked ? [...types, syncType] : types };
              });
            }} className="mt-1 h-4 w-4" /><span>{syncType === "history" ? t("I consent to importing the eligible chat history into Velora.", "أوافق على استيراد سجل المحادثات المؤهل إلى Velora.") : t("I consent to synchronizing Business app state and contacts with Velora.", "أوافق على مزامنة حالة تطبيق الأعمال وجهات الاتصال مع Velora.")}</span></label>
          <Button type="button" variant="secondary" disabled={!available || !consented} onClick={() => void requestSync(syncType)}>{syncType === "history" ? t("Request chat history", "طلب سجل المحادثات") : t("Request app state", "طلب حالة التطبيق")}</Button>
        </div>;
      })}
      {syncSetup && !syncSetup.ready ? <p className="text-sm">{t("Synchronization is awaiting setup. Saved request status remains available.", "تنتظر المزامنة اكتمال الإعداد. تظل حالة الطلب المحفوظة متاحة.")}</p> : null}
      {phase === "requesting-sync" ? <p role="status" className="text-sm">{t("Requesting synchronization and refreshing the saved result.", "جارٍ طلب المزامنة وتحديث النتيجة المحفوظة.")}</p> : null}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" disabled={busy || phase === "prepared"} onClick={() => { const owner = ownerRef.current; if (owner) { setLoading(true); setNotice(null); setDiagnostic(null); void reloadFor(owner); } }}>{t("Refresh saved status", "تحديث الحالة المحفوظة")}</Button>
      {durable && durable.connectionStatus !== "not_connected" && durable.connectionStatus !== "disconnected" ? <Button type="button" variant="danger" disabled={busy || phase !== "idle"} busy={phase === "disconnecting"} onClick={() => void disconnect()}>{t("Disconnect Velora access", "فصل وصول فيلورا")}</Button> : null}
    </div>
    {durable && durable.connectionStatus !== "not_connected" ? <p className="text-xs text-[var(--color-muted-soft)]">{t("Stopping Velora access does not remove the Meta connection. To disconnect the Business app from Cloud API, use WhatsApp Business app → Settings → Account → Business Platform → Disconnect Account.", "إيقاف وصول Velora لا يزيل اتصال Meta. لفصل تطبيق الأعمال عن Cloud API، افتح تطبيق واتساب للأعمال ← الإعدادات ← الحساب ← منصة الأعمال ← فصل الحساب.")}</p> : null}
  </section>;
}
