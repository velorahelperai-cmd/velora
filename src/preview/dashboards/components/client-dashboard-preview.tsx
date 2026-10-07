"use client";

import { useState } from "react";
import { fill, previewCopy } from "../copy";
import { CLIENT_SCENARIO_ORDER, CLIENT_SCENARIOS } from "../fixtures/client";
import type { UiScenario } from "../fixtures/types";
import {
  DesignPreviewBadge,
  PreviewAction,
  PreviewEmpty,
  PreviewNotice,
  PreviewPanel,
  PreviewShell,
  SkeletonBlock,
  TonePill,
  previewStyles as styles,
  usePreviewLocale,
} from "./preview-shell";

function tierLabel(locale: "ar" | "en", id: string | null) {
  const c = previewCopy(locale);
  if (!id) return "—";
  return fill(c.tierNeutral, { n: id.replace("level_", "") });
}

export function ClientDashboardPreview({
  initialScenario = "active",
}: {
  initialScenario?: UiScenario;
}) {
  const { locale, setLocale } = usePreviewLocale("ar");
  const c = previewCopy(locale);
  const [scenario, setScenario] = useState<UiScenario>(initialScenario);
  const data = CLIENT_SCENARIOS[scenario];

  return (
    <PreviewShell
      locale={locale}
      onLocale={setLocale}
      title={c.clientTitle}
      scenario={scenario}
      scenarios={CLIENT_SCENARIO_ORDER}
      onScenario={setScenario}
    >
      <p data-preview-hero className={`mb-5 ${styles.muted}`}>
        {fill(c.hello, { name: data.ownerDisplayName })}
        <span className="ms-2 inline-block align-middle">
          <DesignPreviewBadge locale={locale} />
        </span>
      </p>

      {data.banner?.kind === "expired" ? (
        <div className="mb-4">
          <PreviewNotice tone="warn">
            <strong>{c.stateExpired}</strong>
            <p className="mt-1 text-xs opacity-90">{c.expiredExplain}</p>
          </PreviewNotice>
        </div>
      ) : null}
      {data.banner?.kind === "suspended" ? (
        <div className="mb-4">
          <PreviewNotice tone="error">
            <strong>{c.stateSuspended}</strong>
            <p className="mt-1 text-xs opacity-90">{c.suspendedExplain}</p>
          </PreviewNotice>
        </div>
      ) : null}
      {data.banner?.kind === "stale" ? (
        <div className="mb-4">
          <PreviewNotice tone="warn">{c.stateStale}</PreviewNotice>
        </div>
      ) : null}
      {data.banner?.kind === "error" ? (
        <div className="mb-4">
          <PreviewNotice tone="error">{c.stateError}</PreviewNotice>
        </div>
      ) : null}
      {data.banner?.kind === "unconfigured" ? (
        <div className="mb-4">
          <PreviewNotice tone="info">{c.stateUnconfigured}</PreviewNotice>
        </div>
      ) : null}

      {data.nextStep ? (
        <section
          data-preview-next
          className={`mb-4 flex flex-wrap items-center justify-between gap-3 ${styles.nextStep}`}
        >
          <div className="min-w-0">
            <p className={`text-sm font-medium ${styles.linkAccent}`}>{c.nextStep}</p>
            <p className={`text-xs ${styles.muted}`}>{data.nextStep.label}</p>
          </div>
          <PreviewAction
            locale={locale}
            label={
              data.nextStep.dest === "#renew"
                ? c.renewHint
                : data.nextStep.dest.includes("knowledge")
                  ? c.continueSetup
                  : data.nextStep.dest.includes("conversations")
                    ? c.openConversations
                    : c.continueSetup
            }
            dest={data.nextStep.dest}
            kind={data.nextStep.dest === "#renew" ? "payment" : "nav"}
          />
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-12">
        <PreviewPanel
          className="lg:col-span-3"
          title={c.characterSlot}
          aside={<TonePill tone="muted">{c.statusLabels.unconfigured}</TonePill>}
        >
          <div
            data-preview-character
            className={`flex aspect-[3/4] max-h-56 flex-col items-center justify-center rounded-2xl border border-dashed p-4 text-center ${styles.characterSlot}`}
          >
            <div
              data-preview-avatar
              className="mb-3 h-16 w-16 rounded-full border border-[rgba(8,116,67,0.25)] bg-[#def5e7]"
              aria-hidden
            />
            <p className={`text-xs leading-5 ${styles.soft}`}>{c.characterDeferred}</p>
          </div>
        </PreviewPanel>

        <div className="grid gap-4 lg:col-span-9">
          <div className="grid gap-4 sm:grid-cols-2">
            <PreviewPanel title={c.planTitle}>
              {scenario === "loading" ? (
                <div className="grid gap-2">
                  <SkeletonBlock className="h-4 w-2/3" />
                  <SkeletonBlock className="h-10 w-full" />
                </div>
              ) : scenario === "error" ? (
                <PreviewNotice tone="error">{c.stateError}</PreviewNotice>
              ) : (
                <>
                  <p className="text-sm">{c.planProduct}</p>
                  <p className={`mt-1 text-xs ${styles.soft}`}>{c.planLevelsHint}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {data.availableTiers.map((t) => {
                      const active = data.activeTier === t;
                      return (
                        <span
                          key={t}
                          className={`rounded-full border px-3 py-1.5 text-xs ${
                            active
                              ? "border-[rgba(8,116,67,0.4)] bg-[rgba(56,220,137,0.22)] text-[#066338]"
                              : "border-[rgba(16,27,22,0.12)] text-[#6a8072]"
                          }`}
                        >
                          {tierLabel(locale, t)}
                        </span>
                      );
                    })}
                  </div>
                  {scenario === "unconfigured" || !data.activeTier ? (
                    <p className={`mt-3 text-xs ${styles.linkAccent}`}>{c.stateUnconfigured}</p>
                  ) : null}
                </>
              )}
            </PreviewPanel>

            <PreviewPanel title={c.periodTitle}>
              {scenario === "loading" ? (
                <SkeletonBlock className="h-8 w-full" />
              ) : scenario === "empty" || !data.periodLabel ? (
                <PreviewEmpty title={c.stateEmpty} body={c.stateUnconfigured} />
              ) : (
                <>
                  <p className="text-sm leading-6">{data.periodLabel}</p>
                  {data.periodEndsAt ? (
                    <p className={`mt-2 text-xs ${styles.soft}`} dir="ltr">
                      {data.periodEndsAt}
                    </p>
                  ) : null}
                </>
              )}
            </PreviewPanel>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <PreviewPanel title={c.usageTitle}>
              {scenario === "loading" ? (
                <SkeletonBlock className="h-10" />
              ) : data.usage == null ? (
                <p className={`text-sm ${styles.soft}`}>{c.stateUnconfigured}</p>
              ) : (
                <>
                  <p className="text-2xl font-bold tabular-nums">
                    {data.usage.used}
                    <span className={`ms-2 text-sm font-normal ${styles.muted}`}>{data.usage.unit}</span>
                  </p>
                  <p className={`mt-2 text-xs ${styles.soft}`}>{c.usageNote}</p>
                </>
              )}
            </PreviewPanel>
            <PreviewPanel title={c.whatsappTitle}>
              {scenario === "loading" ? (
                <SkeletonBlock className="h-10" />
              ) : (
                <>
                  <TonePill tone={data.whatsapp.tone}>{data.whatsapp.detail}</TonePill>
                  <div className="mt-3">
                    <PreviewAction locale={locale} label={c.openWhatsapp} dest="/app/settings" />
                  </div>
                </>
              )}
            </PreviewPanel>
            <PreviewPanel title={c.knowledgeTitle}>
              {scenario === "loading" ? (
                <SkeletonBlock className="h-10" />
              ) : (
                <>
                  <TonePill tone={data.knowledge.tone}>{data.knowledge.detail}</TonePill>
                  <div className="mt-3">
                    <PreviewAction locale={locale} label={c.openKnowledge} dest="/app/knowledge" />
                  </div>
                </>
              )}
            </PreviewPanel>
          </div>

          <PreviewPanel title={c.followUpTitle}>
            {scenario === "loading" ? (
              <div className="grid gap-2">
                <SkeletonBlock className="h-12" />
                <SkeletonBlock className="h-12" />
              </div>
            ) : data.followUps.length === 0 ? (
              <PreviewEmpty title={c.stateEmpty} />
            ) : (
              <ul className="grid gap-2">
                {data.followUps.map((f) => (
                  <li
                    key={f.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[rgba(16,27,22,0.1)] bg-[#f7fbf8] px-4 py-3"
                  >
                    <span className="text-sm">{f.title}</span>
                    <span className={`text-xs ${styles.soft}`}>{f.ageLabel}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3">
              <PreviewAction locale={locale} label={c.openConversations} dest="/app/conversations" />
            </div>
          </PreviewPanel>
        </div>
      </div>

      {scenario === "error" ? (
        <div className="mt-4">
          <PreviewAction locale={locale} label={c.retry} kind="illustrative" />
        </div>
      ) : null}
    </PreviewShell>
  );
}
