"use client";

import { useState } from "react";
import { fill, previewCopy } from "../copy";
import { ADMIN_SCENARIO_ORDER, ADMIN_SCENARIOS } from "../fixtures/admin";
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

function companyStatusTone(status: string): string {
  if (status === "active") return "ok";
  if (status === "setup") return "info";
  if (status === "expired") return "warn";
  if (status === "suspended") return "bad";
  return "muted";
}

const rowClass =
  "flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[rgba(16,27,22,0.1)] bg-[#f7fbf8] px-3 py-2.5 text-sm";

export function AdminDashboardPreview({
  initialScenario = "active",
}: {
  initialScenario?: UiScenario;
}) {
  const { locale, setLocale } = usePreviewLocale("ar");
  const c = previewCopy(locale);
  const [scenario, setScenario] = useState<UiScenario>(initialScenario);
  const data = ADMIN_SCENARIOS[scenario];

  return (
    <PreviewShell
      locale={locale}
      onLocale={setLocale}
      title={c.adminTitle}
      scenario={scenario}
      scenarios={ADMIN_SCENARIO_ORDER}
      onScenario={setScenario}
    >
      <div data-preview-hero className="mb-4 flex flex-wrap items-center gap-2">
        <DesignPreviewBadge locale={locale} />
        <p className={`text-xs ${styles.soft}`}>{c.noRevenue}</p>
      </div>

      {scenario === "expired" ? (
        <div className="mb-4">
          <PreviewNotice tone="warn">
            <strong>{c.stateExpired}</strong>
            <p className="mt-1 text-xs opacity-90">{c.expiredExplain}</p>
          </PreviewNotice>
        </div>
      ) : null}
      {scenario === "suspended" ? (
        <div className="mb-4">
          <PreviewNotice tone="error">
            <strong>{c.stateSuspended}</strong>
            <p className="mt-1 text-xs opacity-90">{c.suspendedExplain}</p>
          </PreviewNotice>
        </div>
      ) : null}
      {scenario === "stale" ? (
        <div className="mb-4">
          <PreviewNotice tone="warn">{c.stateStale}</PreviewNotice>
        </div>
      ) : null}
      {scenario === "error" ? (
        <div className="mb-4">
          <PreviewNotice tone="error">{c.stateError}</PreviewNotice>
        </div>
      ) : null}
      {scenario === "unconfigured" ? (
        <div className="mb-4">
          <PreviewNotice tone="info">{c.stateUnconfigured}</PreviewNotice>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <PreviewPanel
          title={c.accountsTitle}
          aside={
            data.accounts.total != null ? (
              <span className={`tabular-nums text-sm ${styles.muted}`}>{data.accounts.total}</span>
            ) : null
          }
        >
          {scenario === "loading" ? (
            <div className="grid gap-2">
              <SkeletonBlock className="h-10" />
              <SkeletonBlock className="h-10" />
            </div>
          ) : data.accounts.rows.length === 0 ? (
            <PreviewEmpty title={c.stateEmpty} />
          ) : (
            <ul className="grid gap-2">
              {data.accounts.rows.map((row) => (
                <li key={row.id} className={rowClass}>
                  <span dir="ltr">{row.email}</span>
                  <span className={`text-xs ${styles.soft}`}>{row.companyHint}</span>
                </li>
              ))}
            </ul>
          )}
        </PreviewPanel>

        <PreviewPanel title={c.companiesTitle}>
          {scenario === "loading" ? (
            <SkeletonBlock className="h-24" />
          ) : data.companies.length === 0 ? (
            <PreviewEmpty title={c.stateEmpty} />
          ) : (
            <ul className="grid gap-2">
              {data.companies.map((co) => (
                <li key={co.id} className={rowClass}>
                  <span>{co.name}</span>
                  <TonePill tone={companyStatusTone(co.status)}>
                    {c.statusLabels[co.status as keyof typeof c.statusLabels] ?? co.status}
                  </TonePill>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <PreviewAction locale={locale} label={c.openDetail} dest="/admin/companies/[id]" />
          </div>
        </PreviewPanel>

        <PreviewPanel title={c.subsTitle} className="lg:col-span-2">
          {scenario === "loading" ? (
            <SkeletonBlock className="h-20" />
          ) : data.subscriptions.length === 0 ? (
            <PreviewEmpty title={c.stateEmpty} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-start text-sm">
                <thead className={`text-xs ${styles.soft}`}>
                  <tr>
                    <th className="py-2 pe-3 font-medium">{c.companiesTitle}</th>
                    <th className="py-2 pe-3 font-medium">{c.planTitle}</th>
                    <th className="py-2 font-medium">{c.scenario}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.subscriptions.map((s) => (
                    <tr key={s.companyId} className="border-t border-[rgba(16,27,22,0.1)]">
                      <td className="py-2.5 pe-3">{s.companyName}</td>
                      <td className="py-2.5 pe-3">{tierLabel(locale, s.tier)}</td>
                      <td className="py-2.5">
                        <TonePill tone={companyStatusTone(s.status === "pending" ? "setup" : s.status)}>
                          {c.statusLabels[s.status as keyof typeof c.statusLabels] ?? s.status}
                        </TonePill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PreviewPanel>

        <PreviewPanel title={c.pendingPayTitle}>
          <p className={`mb-3 text-xs ${styles.soft}`}>{c.reviewQueue}</p>
          {scenario === "loading" ? (
            <SkeletonBlock className="h-16" />
          ) : data.pendingPayments.length === 0 ? (
            <PreviewEmpty title={c.stateEmpty} />
          ) : (
            <ul className="grid gap-2">
              {data.pendingPayments.map((p) => (
                <li
                  key={p.id}
                  className="rounded-2xl border border-[rgba(184,134,74,0.35)] bg-[rgba(217,164,103,0.16)] px-3 py-2.5 text-sm"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <strong>{p.companyName}</strong>
                    <span className={`text-xs ${styles.soft}`}>{p.ageLabel}</span>
                  </div>
                  <p className="mt-1 text-xs text-[#8a6230]">{p.purpose}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <PreviewAction locale={locale} label={c.reviewQueue} kind="illustrative" />
          </div>
        </PreviewPanel>

        <PreviewPanel title={c.duplicateTitle}>
          {scenario === "loading" ? (
            <SkeletonBlock className="h-16" />
          ) : data.duplicateCollections.length === 0 ? (
            <PreviewEmpty title={c.stateEmpty} />
          ) : (
            <ul className="grid gap-2">
              {data.duplicateCollections.map((d) => (
                <li
                  key={d.id}
                  className="rounded-2xl border border-[rgba(196,92,69,0.35)] bg-[rgba(224,122,95,0.14)] px-3 py-2.5 text-sm"
                >
                  <strong>{d.companyName}</strong>
                  <p className="mt-1 text-xs text-[#9a3f2e]">{d.reason}</p>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <PreviewAction locale={locale} label={c.btnNoPayment} kind="payment" />
          </div>
        </PreviewPanel>

        <PreviewPanel title={c.activationTitle}>
          {scenario === "loading" ? (
            <SkeletonBlock className="h-16" />
          ) : data.activationRequests.length === 0 ? (
            <PreviewEmpty title={c.stateEmpty} />
          ) : (
            <ul className="grid gap-2">
              {data.activationRequests.map((a) => (
                <li key={a.id} className={rowClass}>
                  <span>
                    {a.companyName}
                    <span className={`ms-2 text-xs ${styles.soft}`}>{a.kind}</span>
                  </span>
                  <span className={`text-xs ${styles.soft}`}>{a.ageLabel}</span>
                </li>
              ))}
            </ul>
          )}
        </PreviewPanel>

        <PreviewPanel title={c.faultsTitle}>
          {scenario === "loading" ? (
            <SkeletonBlock className="h-16" />
          ) : data.faults.length === 0 ? (
            <PreviewEmpty title={c.stateEmpty} />
          ) : (
            <ul className="grid gap-2">
              {data.faults.map((f) => (
                <li
                  key={f.id}
                  className={`rounded-2xl border px-3 py-2.5 text-sm ${
                    f.severity === "bad"
                      ? "border-[rgba(196,92,69,0.35)] bg-[rgba(224,122,95,0.14)]"
                      : "border-[rgba(184,134,74,0.35)] bg-[rgba(217,164,103,0.16)]"
                  }`}
                >
                  <code className="text-xs" dir="ltr">
                    {f.code}
                  </code>
                  <p className={`mt-1 text-xs ${styles.muted}`}>{f.detail}</p>
                </li>
              ))}
            </ul>
          )}
          {scenario === "error" ? (
            <div className="mt-3">
              <PreviewAction locale={locale} label={c.retry} kind="illustrative" />
            </div>
          ) : null}
        </PreviewPanel>
      </div>
    </PreviewShell>
  );
}
