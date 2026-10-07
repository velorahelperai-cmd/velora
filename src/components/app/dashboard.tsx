"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DashboardLeads } from "./dashboard-leads";
import type { WhatsappInboxLoad } from "@/lib/whatsapp/inbox";
import { fill } from "@/lib/app-copy";
import {
  getCustomerReadiness,
} from "@/lib/tenancy/actions";
import type {
  CustomerReadinessItem,
  CustomerReadinessItemId,
  CustomerReadinessSnapshot,
  ReadinessDetail,
  ReadinessTone,
} from "@/lib/tenancy/customer-readiness";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { Button, Card, LinkButton, Notice, useAppCopy } from "@/components/app/ui";

function toneClass(tone: ReadinessTone): string {
  if (tone === "complete") return "bg-[#38dc89]/15 text-[var(--color-success-fg)]";
  if (tone === "pending") return "bg-[#d9a467]/15 text-[var(--color-warn-fg)]";
  if (tone === "blocked" || tone === "load_failed") return "bg-[#e07a7a]/15 text-[var(--color-danger-fg)]";
  if (tone === "not_configured") return "bg-[var(--color-hover-wash)] text-[var(--color-muted-soft)]";
  return "bg-[var(--color-hover-wash)] text-[var(--color-on-dark)]";
}

function itemLabel(
  id: CustomerReadinessItemId,
  copy: ReturnType<typeof useAppCopy>,
): string {
  return copy.app.readinessItems[id];
}

function detailLabel(
  detail: ReadinessDetail,
  copy: ReturnType<typeof useAppCopy>,
): string {
  return copy.app.readinessDetails[detail];
}

function actionLabel(
  action: CustomerReadinessItem["action"],
  copy: ReturnType<typeof useAppCopy>,
): string | null {
  if (action === "continue") return copy.app.readinessActions.continue;
  if (action === "review") return copy.app.readinessActions.review;
  if (action === "edit") return copy.app.readinessActions.edit;
  return null;
}

export function DashboardPage({
  initialLeads,
  initialReadiness = null,
  readinessLoadFailed = false,
}: {
  initialLeads: WhatsappInboxLoad;
  initialReadiness?: CustomerReadinessSnapshot | null;
  readinessLoadFailed?: boolean;
}) {
  const copy = useAppCopy();
  const router = useRouter();

  const [readiness, setReadiness] = useState<CustomerReadinessSnapshot | null>(initialReadiness);
  const [loadFailed, setLoadFailed] = useState(readinessLoadFailed);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const genRef = useRef(0);
  // Follow-up / needs-info must not be driven by local demo conversations.

  // Adopt newer SSR props after router.refresh; invalidate in-flight client reloads.
  const [trackedProps, setTrackedProps] = useState(() => ({
    readiness: initialReadiness,
    failed: readinessLoadFailed,
  }));
  if (
    trackedProps.readiness !== initialReadiness
    || trackedProps.failed !== readinessLoadFailed
  ) {
    setTrackedProps({ readiness: initialReadiness, failed: readinessLoadFailed });
    setReadiness(initialReadiness);
    setLoadFailed(readinessLoadFailed);
    setRefreshFailed(false);
  }

  useEffect(() => {
    genRef.current += 1;
  }, [initialReadiness, readinessLoadFailed]);

  async function reloadReadiness() {
    const gen = ++genRef.current;
    setBusy(true);
    try {
      const result = await getCustomerReadiness();
      if (gen !== genRef.current) return;
      if (!result.ok) {
        setRefreshFailed(true);
        return;
      }
      setLoadFailed(false);
      setRefreshFailed(false);
      setReadiness(result.data);
      router.refresh();
    } catch {
      if (gen !== genRef.current) return;
      setRefreshFailed(true);
    } finally {
      if (gen === genRef.current) setBusy(false);
    }
  }

  const nextItem = readiness?.nextItemId
    ? readiness.items.find((i) => i.id === readiness.nextItemId) ?? null
    : null;
  const helloName = readiness?.fullName || "";

  return (
    <WorkspaceShell title={copy.app.dashboardTitle}>
      <p className="mb-5 text-[var(--color-muted-on-dark)]">{fill(copy.app.hello, { name: helloName })}</p>

      <section className="mb-4 rounded-3xl border border-[color:var(--color-border-soft)] bg-[var(--color-hover-wash)] p-4 sm:p-5" aria-label={copy.app.readinessTitle}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{copy.app.readinessTitle}</h2>
            <p className="mt-1 text-sm text-[var(--color-muted-on-dark)]">{copy.app.readinessBody}</p>
          </div>
          <Button type="button" variant="secondary" busy={busy} onClick={() => void reloadReadiness()}>
            {copy.app.readinessRetry}
          </Button>
        </div>

        {loadFailed && !readiness ? (
          <div className="mt-4">
            <Notice tone="error">{copy.app.readinessLoadFailed}</Notice>
          </div>
        ) : null}
        {refreshFailed && readiness ? (
          <div className="mt-4">
            <Notice tone="warn">{copy.app.readinessStaleSnapshot}</Notice>
          </div>
        ) : null}

        {nextItem && nextItem.href && nextItem.action !== "none" ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#38dc89]/35 bg-[#38dc89]/10 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--color-success-fg)]">{copy.app.nextAction}</p>
              <p className="text-xs text-[var(--color-muted-on-dark)]">
                {itemLabel(nextItem.id, copy)} — {detailLabel(nextItem.detail, copy)}
              </p>
            </div>
            <LinkButton href={nextItem.href}>
              {actionLabel(nextItem.action, copy) ?? copy.app.continueSetup}
            </LinkButton>
          </div>
        ) : null}

        {readiness ? (
          <ul className="mt-4 grid gap-2">
            {readiness.items.map((item) => {
              const label = actionLabel(item.action, copy);
              return (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[color:var(--color-border-soft)] px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-sm">{itemLabel(item.id, copy)}</strong>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${toneClass(item.tone)}`}>
                        {copy.app.readinessTones[item.tone]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--color-muted-soft)]">{detailLabel(item.detail, copy)}</p>
                  </div>
                  {item.href && label ? (
                    <Link
                      href={item.href}
                      className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-[color:var(--color-border-soft)] px-3 text-xs"
                    >
                      {label}
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : !loadFailed ? (
          <p className="mt-4 text-sm text-[var(--color-muted-soft)]">{copy.loading}</p>
        ) : null}
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <DashboardLeads snapshot={initialLeads}/>
        <Card title={copy.app.needsInfo}>
          <Notice tone="warn">{copy.app.needsInfoUnavailable}</Notice>
          <div className="mt-3">
            <LinkButton href="/app/knowledge" variant="secondary">{copy.app.nav.knowledge}</LinkButton>
          </div>
        </Card>
      </div>

      {readiness?.role === "staff" ? (
        <p className="mt-4 text-xs text-[var(--color-muted-soft)]">{copy.app.readinessDetails.review_owner_only}</p>
      ) : null}
    </WorkspaceShell>
  );
}
