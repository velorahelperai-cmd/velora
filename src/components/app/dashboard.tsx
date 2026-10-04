"use client";

import Link from "next/link";
import { useDemo } from "@/lib/demo-state";
import { fill } from "@/lib/app-copy";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { Card, EmptyState, LinkButton, SimTag, useAppCopy } from "@/components/app/ui";

export function DashboardPage() {
  const copy = useAppCopy();
  const { state, effectiveRole } = useDemo();
  const done = state.setupDone.filter(Boolean).length;
  const followUp = state.conversations.filter((c) => c.status === "follow_up" || c.status === "handed_over");
  const needsInfo = state.conversations.filter((c) => c.needsInfo && c.status !== "resolved");
  const pending = state.activation.status === "pending_review";
  const setupComplete = done >= 4 || pending;

  return (
    <WorkspaceShell title={copy.app.dashboardTitle}>
      <p className="mb-5 text-[#adbeaf]">{fill(copy.app.hello, { name: state.account?.name ?? "" })}</p>

      {effectiveRole === "owner" && !setupComplete ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#38dc89]/35 bg-[#38dc89]/10 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-[#9af0c3]">{copy.app.nextAction}</p>
            <p className="text-xs text-[#adbeaf]">{fill(copy.setup.progress, { n: Math.min(done + 1, 4) })}</p>
          </div>
          <LinkButton href="/setup">{copy.app.continueSetup}</LinkButton>
        </div>
      ) : null}

      {effectiveRole === "owner" && pending ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#d9a467]/40 bg-[#d9a467]/10 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-[#f0cf9d]">{copy.app.activationPending}</p>
            <p className="text-xs text-[#adbeaf]">{copy.app.nextAction}: {copy.app.nav.conversations}</p>
          </div>
          <LinkButton href="/app/conversations" variant="secondary">{copy.app.openConversation}</LinkButton>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {effectiveRole === "owner" ? (
          <Card title={copy.app.setupCard}>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
              <div className="h-full bg-[#38dc89] transition-all" style={{ width: `${(Math.min(done, 4) / 4) * 100}%` }} />
            </div>
            <p className="mt-2 text-sm text-[#adbeaf]">
              {setupComplete ? copy.app.setupComplete : fill(copy.setup.progress, { n: Math.min(done + 1, 4) })}
            </p>
            {!setupComplete ? <LinkButton href="/setup" className="mt-4">{copy.app.continueSetup}</LinkButton> : null}
            {setupComplete && !pending ? (
              <LinkButton href="/setup" variant="secondary" className="mt-4">{copy.setup.title}</LinkButton>
            ) : null}
          </Card>
        ) : null}
        <Card title={copy.app.numberCard}>
          <p className="text-sm" dir="ltr">{state.activation.whatsappNumber || "—"}</p>
          <p className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs ${pending ? "bg-[#d9a467]/15 text-[#f0cf9d]" : "bg-white/10 text-[#dfe9e2]"}`}>
            {pending ? copy.app.activationPending : copy.setup.notConnected}
          </p>
          {!pending && effectiveRole === "owner" ? (
            <>
              <p className="mt-2 text-xs text-[#8da195]">{copy.app.activationNone}</p>
              <Link href="/setup" className="mt-3 inline-flex min-h-10 items-center text-sm text-[#38dc89] underline">{copy.app.continueSetup}</Link>
            </>
          ) : null}
        </Card>
        <Card title={copy.app.sampleStats} aside={<SimTag />}>
          <dl className="grid grid-cols-3 gap-3 text-center">
            {[[copy.app.stats.conversations, 12], [copy.app.stats.answered, 9], [copy.app.stats.handed, 2]].map(([k, v]) => (
              <div key={String(k)}>
                <dd className="text-2xl font-bold">{v}</dd>
                <dt className="text-xs text-[#8da195]">{k}</dt>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={copy.app.followUp}>
          {followUp.length === 0 ? (
            <EmptyState title={copy.app.emptyFollowUp} action={<LinkButton href="/app/conversations" variant="secondary">{copy.app.nav.conversations}</LinkButton>} />
          ) : (
            <ul className="grid gap-2">
              {followUp.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{c.customer} · {c.topic}</p>
                    <p className="truncate text-xs text-[#8da195]">{copy.app.statuses[c.status]} · {copy.app.ownerLabel}: {c.owner === "assistant" ? copy.app.assistant : c.owner === "staff" ? copy.app.staff : c.owner}</p>
                  </div>
                  <Link href={`/app/conversations?c=${c.id}`} className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-white/20 px-3 text-xs">{copy.app.openConversation}</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={copy.app.needsInfo}>
          {needsInfo.length === 0 ? (
            <EmptyState title={copy.app.emptyNeedsInfo} />
          ) : (
            <ul className="grid gap-2">
              {needsInfo.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{c.needsInfo}</p>
                    <p className="truncate text-xs text-[#8da195]">{c.customer}: {c.messages[0]?.text}</p>
                  </div>
                  <Link href={`/app/knowledge?topic=${encodeURIComponent(c.needsInfo ?? "")}`} className="inline-flex min-h-10 shrink-0 items-center rounded-full bg-[#38dc89] px-3 text-xs font-medium text-[#072317]">{copy.app.addKnowledge}</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </WorkspaceShell>
  );
}
