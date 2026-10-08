"use client";

import { useState } from "react";
import Link from "next/link";
import {
  getWhatsappCompanyLink,
  saveWhatsappLinkRequest,
} from "@/lib/whatsapp/connection-actions";
import type { WhatsappCompanyLink, WhatsappLinkStatus } from "@/lib/whatsapp/connection";
import type { SingleTenantReceptionStatus } from "@/lib/whatsapp/config";
import { WhatsappEmbeddedSignup } from "@/components/app/whatsapp-embedded-signup";
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
  initialLink = null,
  initialLoadFailed = false,
  liveOpsReady = false,
  singleTenant = null,
}: {
  initialLink?: WhatsappCompanyLink | null;
  initialLoadFailed?: boolean;
  liveOpsReady?: boolean;
  /** Server env presence for single_tenant test receive — not Meta verification. */
  singleTenant?: SingleTenantReceptionStatus | null;
}) {
  const copy = useAppCopy();
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
    if (!result.ok) {
      setLoadError(true);
      setError(
        result.code === "COMPANY_SUSPENDED" ? copy.app.waLinkCompanySuspended
          : result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED" ? copy.app.waLinkForbidden
            : copy.app.waLinkLoadFailed,
      );
      return;
    }
    setLoadError(false);
    setLink(result.data);
    setNumber(result.data.requestedDisplayNumber || "");
    setKeepOnPhone(result.data.keepOnPhone);
  }

  const verified = link?.status === "verified";
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

  return (
    <Card title={copy.app.tabs.whatsapp}>
      <WhatsappEmbeddedSignup keepOnPhone={keepOnPhone} onConnected={() => void load()} onDisconnected={() => void load()} />
      {showSingleTenant && singleTenant ? (
        <div className="mb-4 grid gap-2 rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-3 text-sm">
          <p className="font-medium text-[var(--color-on-dark)]">{copy.app.waSingleTenantTitle}</p>
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
        <div className="grid gap-4">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {notice ? <Notice tone="info">{notice}</Notice> : null}

          <div className="rounded-2xl border border-[#38dc89]/30 bg-gradient-to-r from-[#12281e] via-[#0d1a14] to-[#07110d] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.3)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#25d366]/20 border border-[#25d366]/40 text-2xl">
                  📱
                </div>
                <div>
                  <h3 className="font-bold text-[#f7fbf8] text-base">ربط واتساب التجاري (WhatsApp Cloud API)</h3>
                  <p className="text-xs text-[#b7c6b9]">تفعيل الردود الآلية المباشرة واستقبال محادثات العملاء</p>
                </div>
              </div>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${verified ? "bg-[#38dc89]/20 text-[#9af0c3] border border-[#38dc89]/40" : "bg-[#d9a467]/20 text-[#f0cf9d] border border-[#d9a467]/40"}`}>
                <span className={`h-2 w-2 rounded-full ${verified ? "bg-[#38dc89] animate-pulse" : "bg-[#d9a467]"}`} />
                {statusLabel(link.status, copy)}
              </span>
            </div>
          </div>

          <dl className="grid gap-3 text-sm">
            {link.authorizationExpiresAt ? <div className="flex flex-wrap justify-between gap-3">
              <dt>انتهاء تفويض ميتا / Meta authorization expiry</dt>
              <dd dir="ltr">{formatStamp(link.authorizationExpiresAt)}</dd>
            </div> : null}
            <div className="flex flex-wrap justify-between gap-3">
              <dt className="text-[var(--color-muted-on-dark)]">{copy.app.whatsappStatus}</dt>
              <dd className="rounded-full bg-[var(--color-hover-wash)] px-2 py-0.5 text-xs">{statusLabel(link.status, copy)}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-3">
              <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkCurrentRequest}</dt>
              <dd dir="ltr" className="font-semibold text-[#f7fbf8]">{link.requestedDisplayNumber.trim() || "—"}</dd>
            </div>
            {verified ? (
              <>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkVerifiedCurrent}</dt>
                  <dd dir="ltr">{link.verifiedDisplayNumber || "—"}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkTestedLabel}</dt>
                  <dd className="text-xs">
                    {link.receptionSendTested ? copy.app.waLinkTestedYes : copy.app.waLinkTestedNo}
                  </dd>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap justify-between gap-3">
                <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkTestedLabel}</dt>
                <dd className="text-xs">{copy.app.waLinkTestedNo}</dd>
              </div>
            )}
          </dl>

          {link.priorLinkEvidence ? (
            <div className="grid gap-2 rounded-2xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-3 text-sm">
              <p className="text-xs font-medium text-[var(--color-muted-soft)]">{copy.app.waLinkPriorEvidenceTitle}</p>
              <p className="text-xs leading-5 text-[var(--color-muted-soft)]">{copy.app.waLinkPriorEvidenceNote}</p>
              <dl className="grid gap-2">
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkPriorVerifiedNumber}</dt>
                  <dd dir="ltr">{link.verifiedDisplayNumber || "—"}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkPriorInboundTested}</dt>
                  <dd dir="ltr" className="text-xs">{formatStamp(link.inboundTestedAt)}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[var(--color-muted-on-dark)]">{copy.app.waLinkPriorOutboundTested}</dt>
                  <dd dir="ltr" className="text-xs">{formatStamp(link.outboundTestedAt)}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          <p className="text-sm leading-6 text-[var(--color-muted-on-dark)]">{nextStep}</p>
          <p className="text-xs leading-5 text-[var(--color-muted-soft)]">{copy.app.waLinkHonestNote}</p>
          {!liveOpsReady ? (
            <p className="text-xs leading-5 text-[var(--color-muted-soft)]">{copy.app.waLinkLiveOpsOff}</p>
          ) : null}

          {!verified ? (
            <form
              className="grid gap-3"
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
              <Field label={copy.app.waLinkRequestNumber} required hint="+968 …">
                {(p) => (
                  <input
                    {...p}
                    dir="ltr"
                    inputMode="tel"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    disabled={busy}
                  />
                )}
              </Field>
              <label className="flex min-h-11 items-start gap-3 text-sm text-[var(--color-muted-on-dark)]">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[#38dc89]"
                  checked={keepOnPhone}
                  disabled={busy}
                  onChange={(e) => setKeepOnPhone(e.target.checked)}
                />
                <span>{copy.app.waLinkKeepOnPhone}</span>
              </label>
              <p className="text-xs leading-5 text-[var(--color-muted-soft)]">{copy.app.waLinkCoexistenceNote}</p>
              <Button type="submit" busy={busy}>{copy.app.waLinkSaveRequest}</Button>
            </form>
          ) : null}

          <p className="text-xs leading-5 text-[var(--color-muted-soft)]">{copy.app.waLinkOauthDeferred}</p>
          <Button type="button" variant="secondary" disabled>
            {copy.app.waLinkSignupDisabled}
          </Button>
          <Link href="/setup" className="inline-flex min-h-11 items-center rounded-full border border-[color:var(--color-border-soft)] px-4 text-sm">
            {copy.setup.title}
          </Link>
        </div>
      )}
    </Card>
  );
}
