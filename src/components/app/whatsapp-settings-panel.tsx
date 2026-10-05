"use client";

import { useState } from "react";
import Link from "next/link";
import {
  getWhatsappCompanyLink,
  saveWhatsappLinkRequest,
} from "@/lib/whatsapp/connection-actions";
import type { WhatsappCompanyLink, WhatsappLinkStatus } from "@/lib/whatsapp/connection";
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
}: {
  initialLink?: WhatsappCompanyLink | null;
  initialLoadFailed?: boolean;
  liveOpsReady?: boolean;
}) {
  const copy = useAppCopy();
  const { busy, run } = useAction();
  const [link, setLink] = useState<WhatsappCompanyLink | null>(initialLink);
  const [loadError, setLoadError] = useState(initialLoadFailed);
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
      {loadError && !link ? (
        <div className="grid gap-3">
          <Notice tone="error">{error ?? copy.app.waLinkLoadFailed}</Notice>
          <Button type="button" variant="secondary" busy={busy} onClick={() => void run(load)}>
            {copy.app.waLinkRetry}
          </Button>
        </div>
      ) : !link ? (
        <div className="grid gap-3">
          <p className="text-sm text-[#adbeaf]">{copy.app.waLinkLoading}</p>
          <Button type="button" variant="secondary" busy={busy} onClick={() => void run(load)}>
            {copy.app.waLinkRetry}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          {error ? <Notice tone="error">{error}</Notice> : null}
          {notice ? <Notice tone="info">{notice}</Notice> : null}

          <dl className="grid gap-3 text-sm">
            <div className="flex flex-wrap justify-between gap-3">
              <dt className="text-[#adbeaf]">{copy.app.whatsappStatus}</dt>
              <dd className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{statusLabel(link.status, copy)}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-3">
              <dt className="text-[#adbeaf]">{copy.app.waLinkCurrentRequest}</dt>
              <dd dir="ltr">{link.requestedDisplayNumber.trim() || "—"}</dd>
            </div>
            {verified ? (
              <>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[#adbeaf]">{copy.app.waLinkVerifiedCurrent}</dt>
                  <dd dir="ltr">{link.verifiedDisplayNumber || "—"}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[#adbeaf]">{copy.app.waLinkTestedLabel}</dt>
                  <dd className="text-xs">
                    {link.receptionSendTested ? copy.app.waLinkTestedYes : copy.app.waLinkTestedNo}
                  </dd>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap justify-between gap-3">
                <dt className="text-[#adbeaf]">{copy.app.waLinkTestedLabel}</dt>
                <dd className="text-xs">{copy.app.waLinkTestedNo}</dd>
              </div>
            )}
          </dl>

          {link.priorLinkEvidence ? (
            <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/5 p-3 text-sm">
              <p className="text-xs font-medium text-[#8da195]">{copy.app.waLinkPriorEvidenceTitle}</p>
              <p className="text-xs leading-5 text-[#8da195]">{copy.app.waLinkPriorEvidenceNote}</p>
              <dl className="grid gap-2">
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[#adbeaf]">{copy.app.waLinkPriorVerifiedNumber}</dt>
                  <dd dir="ltr">{link.verifiedDisplayNumber || "—"}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[#adbeaf]">{copy.app.waLinkPriorInboundTested}</dt>
                  <dd dir="ltr" className="text-xs">{formatStamp(link.inboundTestedAt)}</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-3">
                  <dt className="text-[#adbeaf]">{copy.app.waLinkPriorOutboundTested}</dt>
                  <dd dir="ltr" className="text-xs">{formatStamp(link.outboundTestedAt)}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          <p className="text-sm leading-6 text-[#adbeaf]">{nextStep}</p>
          <p className="text-xs leading-5 text-[#8da195]">{copy.app.waLinkHonestNote}</p>
          {!liveOpsReady ? (
            <p className="text-xs leading-5 text-[#8da195]">{copy.app.waLinkLiveOpsOff}</p>
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
              <label className="flex min-h-11 items-start gap-3 text-sm text-[#adbeaf]">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[#38dc89]"
                  checked={keepOnPhone}
                  disabled={busy}
                  onChange={(e) => setKeepOnPhone(e.target.checked)}
                />
                <span>{copy.app.waLinkKeepOnPhone}</span>
              </label>
              <p className="text-xs leading-5 text-[#8da195]">{copy.app.waLinkCoexistenceNote}</p>
              <Button type="submit" busy={busy}>{copy.app.waLinkSaveRequest}</Button>
            </form>
          ) : null}

          <p className="text-xs leading-5 text-[#8da195]">{copy.app.waLinkOauthDeferred}</p>
          <Button type="button" variant="secondary" disabled>
            {copy.app.waLinkSignupDisabled}
          </Button>
          <Link href="/setup" className="inline-flex min-h-11 items-center rounded-full border border-white/20 px-4 text-sm">
            {copy.setup.title}
          </Link>
        </div>
      )}
    </Card>
  );
}
