"use client";

import { useState } from "react";
import Link from "next/link";
import {
  getWhatsappCompanyLink,
  saveWhatsappLinkRequest,
} from "@/lib/whatsapp/connection-actions";
import type { WhatsappCompanyLink, WhatsappLinkStatus } from "@/lib/whatsapp/connection";
import type { SingleTenantReceptionStatus } from "@/lib/whatsapp/config";
import { useDemo } from "@/lib/demo-state";
import {WhatsappFixedAckOptIn} from "./whatsapp-fixed-ack-opt-in";
import {ChannelReviewStatus} from './channel-review';
import { WhatsappEmbeddedSignup } from "@/components/app/whatsapp-embedded-signup";
import { whatsappUiState } from "./onboarding-contracts";
import {
  Button, Card, Field, Notice, useAction, useAppCopy, isPhone,
} from "@/components/app/ui";

function statusLabel(
  status: WhatsappLinkStatus,
  copy: ReturnType<typeof useAppCopy>,
): string {
  return copy.app.waLinkStatuses[status];
}

function formatStamp(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function WhatsappSettingsPanel({
  companyId,
  initialLink = null,
  initialLoadFailed = false,
  liveOpsReady = false,
  singleTenant = null,
}: {
  companyId: string;
  initialLink?: WhatsappCompanyLink | null;
  initialLoadFailed?: boolean;
  liveOpsReady?: boolean;
  /** Server env presence for single_tenant test receive — not Meta verification. */
  singleTenant?: SingleTenantReceptionStatus | null;
}) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const { busy, run } = useAction();
  const [link, setLink] = useState<WhatsappCompanyLink | null>(initialLink);
  const [loadError, setLoadError] = useState(initialLoadFailed);
  const showSingleTenant = singleTenant?.mode === "single_tenant";
  const [number, setNumber] = useState(initialLink?.requestedDisplayNumber ?? "");
  const [keepOnPhone, setKeepOnPhone] = useState(initialLink?.keepOnPhone ?? false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    setError(null);
    const result = await getWhatsappCompanyLink();
    if (!result.ok || result.data.companyId !== companyId) {
      setLoadError(true);
      setError(
        !result.ok && result.code === "COMPANY_SUSPENDED" ? copy.app.waLinkCompanySuspended
          : !result.ok && (result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED") ? copy.app.waLinkForbidden
            : copy.app.waLinkLoadFailed,
      );
      return;
    }
    setLoadError(false);
    setLink(result.data);
    setNumber(result.data.requestedDisplayNumber || "");
    setKeepOnPhone(result.data.keepOnPhone);
  }

  const connection = whatsappUiState(loadError ? null : link, liveOpsReady);
  const verified = connection.verified;
  const nextStep = !link || link.status === "not_connected"
    ? copy.app.waLinkNextSaveRequest
    : link.status === "request_saved"
      ? copy.app.waLinkNextAwaitTeam
      : link.status === "needs_external_action"
        ? copy.app.waLinkNextExternal
        : link.status === "verified"
          ? copy.app.waLinkNextVerified
          : link.status === "error"
            ? copy.app.waLinkNextError
            : copy.app.waLinkNextDisconnected;

  const currentStatus: WhatsappLinkStatus = link?.status ?? "not_connected";

  // Connection stages stepper calculation
  const stage1Done = Boolean(link?.requestedDisplayNumber?.trim());
  const stage2Done = verified;
  const stage3Done = connection.tested;

  if(singleTenant?.configurationMode==='meta_test')return <Card title={locale==='ar'?'واتساب — اختبار Meta':'WhatsApp — Meta test'}>
    <Notice>{locale==='ar'?'وضع اختبار ميتا. الاتصال والرسائل الفعلية يحتاجان إثباتًا منفصلًا.':'Meta test mode. Actual connection and messages require separate evidence.'}</Notice>
    {singleTenant.currentCompanyMatches?<>
      <p dir="ltr">Test Phone Number ID: {singleTenant.testPhoneNumberId??'—'}</p>
      <p>{locale==='ar'?(singleTenant.receiveConfigured?'إعداد الاستقبال موجود؛ وصول رسالة فعلية لم يُثبت بهذه الحالة.':'إعداد استقبال الاختبار غير مكتمل.'):(singleTenant.receiveConfigured?'Receive configuration is present; this status does not prove actual receipt.':'Test receive configuration is incomplete.')}</p>
      <ChannelReviewStatus companyId={companyId} channel="whatsapp"/>
      <Link href="/app/conversations">{locale==='ar'?'فتح محادثات الاختبار':'Open test conversations'}</Link>
    </>:<Notice>{locale==='ar'?'هذه الشركة ليست مساحة اختبار واتساب المحددة.':'This company is outside the configured WhatsApp test workspace.'}</Notice>}
  </Card>;

  return (
    <Card title={copy.app.tabs.whatsapp}>
      <WhatsappEmbeddedSignup key={companyId} companyId={companyId} keepOnPhone={keepOnPhone} onConnected={() => void load()} onDisconnected={() => void load()} />
      <WhatsappFixedAckOptIn key={companyId+":fixed-ack"} companyId={companyId} />
      {/* Meta Cloud API Architecture Header Banner */}
      <div className="mb-5 rounded-2xl border border-[#38dc89]/30 bg-gradient-to-r from-[#12281e] via-[#0d1a14] to-[#07110d] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#25d366]/20 border border-[#25d366]/40 text-2xl font-bold shadow-sm">
              📱
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-bold text-[#f7fbf8] text-base">
                  ربط واتساب التجاري (Meta Cloud API)
                </h3>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-semibold ${
                    verified
                      ? "bg-[#38dc89]/20 text-[#9af0c3] border border-[#38dc89]/40"
                      : link?.status === "request_saved"
                        ? "bg-[#38dc89]/15 text-[#9af0c3] border border-[#38dc89]/30"
                        : link?.status === "needs_external_action"
                          ? "bg-[#d9a467]/20 text-[#f0cf9d] border border-[#d9a467]/40"
                          : link?.status === "error"
                            ? "bg-[#e07a5f]/20 text-[#e07a5f] border border-[#e07a5f]/40"
                            : "bg-white/10 text-[#b7c6b9] border border-white/15"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      verified
                        ? "bg-[#38dc89] animate-pulse"
                        : link?.status === "error"
                          ? "bg-[#e07a5f]"
                          : "bg-[#d9a467]"
                    }`}
                  />
                  {statusLabel(currentStatus, copy)}
                </span>
              </div>
              <p className="text-xs text-[#b7c6b9] mt-1">
                ربط موثوق لمعالجة الرسائل الواردة والصادرة تلقائياً عبر خوادم Meta الرسمية.
              </p>
            </div>
          </div>

          <Button type="button" variant="secondary" busy={busy} onClick={() => void run(load)}>
            {copy.app.waLinkRetry}
          </Button>
        </div>
      </div>

      {/* 3-Step Connection Stepper */}
      <div className="mb-6 grid grid-cols-1 gap-2.5 sm:grid-cols-3 text-xs">
        <div
          className={`rounded-xl border p-3 ${
            stage1Done
              ? "border-[#38dc89]/40 bg-[#38dc89]/10 text-[#9af0c3]"
              : "border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] text-[#b7c6b9]"
          }`}
        >
          <div className="flex items-center gap-2 font-bold mb-1">
            <span>{stage1Done ? "✓" : "1"}</span>
            <span>تسجيل رقم النشاط</span>
          </div>
          <p className="text-[11px] text-[#8aa394]">
            {stage1Done ? (link?.requestedDisplayNumber || "تم التسجيل") : "إدخال رقم هاتف النشاط"}
          </p>
        </div>

        <div
          className={`rounded-xl border p-3 ${
            stage2Done
              ? "border-[#38dc89]/40 bg-[#38dc89]/10 text-[#9af0c3]"
              : "border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] text-[#b7c6b9]"
          }`}
        >
          <div className="flex items-center gap-2 font-bold mb-1">
            <span>{stage2Done ? "✓" : "2"}</span>
            <span>الربط والتحقق من Meta</span>
          </div>
          <p className="text-[11px] text-[#8aa394]">
            {verified ? "موثق لدى Meta Cloud" : "بانتظار إجراء التحقق الخارجي"}
          </p>
        </div>

        <div
          className={`rounded-xl border p-3 ${
            stage3Done
              ? "border-[#38dc89]/40 bg-[#38dc89]/10 text-[#9af0c3]"
              : "border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] text-[#b7c6b9]"
          }`}
        >
          <div className="flex items-center gap-2 font-bold mb-1">
            <span>{stage3Done ? "✓" : "3"}</span>
            <span>دليل اختبار الاستقبال والإرسال</span>
          </div>
          <p className="text-[11px] text-[#8aa394]">
            {stage3Done ? "اختبار مسجل؛ الإطلاق الحي منفصل" : "لا يوجد اختبار مؤكد للربط الحالي"}
          </p>
        </div>
      </div>

      {showSingleTenant && singleTenant ? (
        <div className="mb-5 grid gap-2 rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-4 text-sm">
          <p className="font-semibold text-[var(--color-on-dark)]">{copy.app.waSingleTenantTitle}</p>
          <p className="text-xs leading-5 text-[var(--color-muted-soft)]">{copy.app.waSingleTenantBody}</p>
          <Notice tone={singleTenant.receiveConfigured ? "info" : "warn"}>
            {singleTenant.receiveConfigured
              ? copy.app.waSingleTenantConfigured
              : copy.app.waSingleTenantIncomplete}
          </Notice>
          <p className="text-xs leading-5 text-[var(--color-muted-soft)]" dir="ltr">
            app_secret={singleTenant.hasAppSecret ? "yes" : "no"}
            {" · "}verify_token={singleTenant.hasVerifyToken ? "yes" : "no"}
            {" · "}phone_number_id={singleTenant.hasPhoneNumberId ? "yes" : "no"}
            {" · "}company_id={singleTenant.hasCompanyId ? "yes" : "no"}
          </p>
          <p className="text-xs leading-5 text-[var(--color-muted-soft)]">{copy.app.waSingleTenantSendOff}</p>
        </div>
      ) : null}

      {loadError && !link ? (
        <div className="grid gap-3">
          <Notice tone="error">{error ?? copy.app.waLinkLoadFailed}</Notice>
          {!showSingleTenant ? (
            <Button type="button" variant="secondary" busy={busy} onClick={() => void run(load)}>
              {copy.app.waLinkRetry}
            </Button>
          ) : (
            <p className="text-xs text-[var(--color-muted-soft)]">{copy.app.waSingleTenantBody}</p>
          )}
        </div>
      ) : !link ? (
        <div className="grid gap-3">
          <p className="text-sm text-[var(--color-muted-on-dark)]">{copy.app.waLinkLoading}</p>
          <Button type="button" variant="secondary" busy={busy} onClick={() => void run(load)}>
            {copy.app.waLinkRetry}
          </Button>
        </div>
      ) : (
        <div className="grid gap-5">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {notice ? <Notice tone="info">{notice}</Notice> : null}

          {/* Connection Details Table */}
          <div className="rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-4">
            <h4 className="font-bold text-[#f7fbf8] text-sm mb-3">بيانات الاتصال الفعلية</h4>
            <dl className="grid gap-3 text-sm">
              <div className="flex flex-wrap justify-between gap-3 border-b border-white/5 pb-2">
                <dt className="text-[var(--color-muted-on-dark)]">{copy.app.whatsappStatus}</dt>
                <dd className="rounded-full bg-[var(--color-hover-wash)] px-2.5 py-0.5 text-xs font-semibold">
                  {statusLabel(link.status, copy)}
                </dd>
              </div>
              <div className="flex flex-wrap justify-between gap-3 border-b border-white/5 pb-2">
                <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkCurrentRequest}</dt>
                <dd dir="ltr" className="font-semibold text-[#f7fbf8]">
                  {link.requestedDisplayNumber.trim() || "—"}
                </dd>
              </div>
              {verified ? (
                <>
                  <div className="flex flex-wrap justify-between gap-3 border-b border-white/5 pb-2">
                    <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkVerifiedCurrent}</dt>
                    <dd dir="ltr" className="font-mono text-[#9af0c3]">
                      {link.verifiedDisplayNumber || "—"}
                    </dd>
                  </div>
                  <div className="flex flex-wrap justify-between gap-3 border-b border-white/5 pb-2">
                    <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkTestedLabel}</dt>
                    <dd className="text-xs">
                      {link.receptionSendTested ? copy.app.waLinkTestedYes : copy.app.waLinkTestedNo}
                    </dd>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap justify-between gap-3 border-b border-white/5 pb-2">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkTestedLabel}</dt>
                  <dd className="text-xs text-[#8aa394]">{copy.app.waLinkTestedNo}</dd>
                </div>
              )}
            </dl>
          </div>

          <dl className="grid gap-3 text-sm">
            <div className="flex flex-wrap justify-between gap-3">
              <dt>تفويض ميتا الحالي / Current Meta authorization</dt>
              <dd>{connection.authorizationReady ? "صالح / Valid" : "غير جاهز / Not ready"}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-3">
              <dt>جاهزية الإطلاق / Rollout readiness</dt>
              <dd>{connection.rolloutReady ? "جاهز تقنيًا؛ كل إرسال يخضع للقيود / Eligible; per-send checks apply" : "غير مفعّل / Disabled"}</dd>
            </div>
            {link.authorizationExpiresAt ? <div className="flex flex-wrap justify-between gap-3">
              <dt>انتهاء تفويض ميتا / Meta authorization expiry</dt>
              <dd dir="ltr">{formatStamp(link.authorizationExpiresAt)}</dd>
            </div> : null}
          </dl>
          {link.priorLinkEvidence ? (
            <div className="grid gap-2 rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-4 text-sm">
              <p className="text-xs font-medium text-[var(--color-muted-soft)]">{copy.app.waLinkPriorEvidenceTitle}</p>
              <p className="text-xs leading-5 text-[var(--color-muted-soft)]">{copy.app.waLinkPriorEvidenceNote}</p>
              <dl className="grid gap-2 mt-2 text-xs">
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkPriorVerifiedNumber}</dt>
                  <dd dir="ltr">{link.verifiedDisplayNumber || "—"}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkPriorInboundTested}</dt>
                  <dd dir="ltr">{formatStamp(link.inboundTestedAt)}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkPriorOutboundTested}</dt>
                  <dd dir="ltr">{formatStamp(link.outboundTestedAt)}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {/* Next Step Guidance Banner */}
          <div className="rounded-2xl border border-[#38dc89]/30 bg-[#38dc89]/10 p-4">
            <h5 className="font-bold text-[#9af0c3] text-xs mb-1">الخطوة القادمة:</h5>
            <p className="text-sm leading-6 text-[#f7fbf8]">{nextStep}</p>
            <p className="text-xs leading-5 text-[#8aa394] mt-1">{copy.app.waLinkHonestNote}</p>
          </div>

          {!liveOpsReady ? (
            <p className="text-xs leading-5 text-[#8aa394]">{copy.app.waLinkLiveOpsOff}</p>
          ) : null}

          {/* Number Registration & Coexistence Form */}
          {!verified ? (
            <form
              className="grid gap-4 rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-panel-deep)] p-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (busy) return;
                setError(null);
                setNotice(null);
                const trimmed = number.trim();
                if (!isPhone(trimmed)) {
                  setError(copy.errors.phone);
                  return;
                }
                void run(async () => {
                  const result = await saveWhatsappLinkRequest({
                  expectedCompanyId: companyId,
                    requestedDisplayNumber: trimmed,
                    keepOnPhone,
                  });
                  if (!result.ok) {
                    setError(
                      result.code === "ALREADY_VERIFIED" ? copy.app.waLinkAlreadyVerified
                        : result.code === "COMPANY_SUSPENDED" ? copy.app.waLinkCompanySuspended
                          : result.code === "FORBIDDEN" ? copy.app.waLinkForbidden
                            : result.code === "INVALID_INPUT" ? copy.errors.phone
                              : copy.app.waLinkSaveFailed,
                    );
                    return;
                  }
                  setLink(result.data);
                  setNumber(result.data.requestedDisplayNumber);
                  setKeepOnPhone(result.data.keepOnPhone);
                  setNotice(copy.app.waLinkSaved);
                });
              }}
            >
              <h4 className="font-bold text-[#f7fbf8] text-sm">تسجيل أو تعديل رقم واتساب</h4>
              <Field label={copy.app.waLinkRequestNumber} required hint="+968 …">
                {(p) => (
                  <input
                    {...p}
                    dir="ltr"
                    inputMode="tel"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    disabled={busy}
                    placeholder="+968 91234567"
                  />
                )}
              </Field>

              <div className="rounded-xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-3.5">
                <label className="flex min-h-6 items-start gap-3 text-sm text-[var(--color-on-dark)] cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[#38dc89]"
                    checked={keepOnPhone}
                    disabled={busy}
                    onChange={(e) => setKeepOnPhone(e.target.checked)}
                  />
                  <div>
                    <span className="font-semibold block">{copy.app.waLinkKeepOnPhone}</span>
                    <p className="text-xs leading-5 text-[#8aa394] mt-0.5">
                      {copy.app.waLinkCoexistenceNote}
                    </p>
                  </div>
                </label>
              </div>

              <div>
                <Button type="submit" busy={busy}>
                  {copy.app.waLinkSaveRequest}
                </Button>
              </div>
            </form>
          ) : null}

          {/* Action and Navigation links */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Link
              href="/setup"
              className="inline-flex min-h-11 items-center rounded-full border border-[#38dc89]/40 bg-[#38dc89]/15 px-5 text-sm font-semibold text-[#9af0c3] transition hover:bg-[#38dc89]/25"
            >
              🚀 متابعة رحلة التجهيز الشاملة ({copy.setup.title})
            </Link>
            <Link
              href="/app/conversations"
              className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--color-border-soft)] px-5 text-sm text-[#b7c6b9] hover:text-[#f7fbf8]"
            >
              💬 فتح صندوق المحادثات
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}
