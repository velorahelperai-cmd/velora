"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { KnowledgeApprovalFoundation, KnowledgeSourceRecord } from "@/lib/knowledge/types";
import { useDemo } from "@/lib/demo-state";
import { AssistantTester } from "@/components/app/assistant-tester";
import { KnowledgeEditor } from "@/components/app/knowledge-editor";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { LangSwitch, LinkButton, useAppCopy } from "@/components/app/ui";

export function KnowledgePage({
  canWrite,
  canDelete,
  initialSources,
  initialLoadFailed,
  approvalFoundation = "ready",
}: {
  canWrite: boolean;
  canDelete?: boolean;
  initialSources: KnowledgeSourceRecord[];
  initialLoadFailed: boolean;
  approvalFoundation?: KnowledgeApprovalFoundation;
}) {
  const copy = useAppCopy();
  const topic = useSearchParams().get("topic") ?? undefined;
  return (
    <WorkspaceShell title={copy.knowledge.title}>
      <KnowledgeEditor
        focusTitle={topic}
        canWrite={canWrite}
        canDelete={canDelete}
        initialSources={initialSources}
        initialLoadFailed={initialLoadFailed}
        approvalFoundation={approvalFoundation}
      />
    </WorkspaceShell>
  );
}

export function TestPage() {
  const copy = useAppCopy();
  const router = useRouter();
  return (
    <WorkspaceShell title={copy.tester.title}>
      <AssistantTester onImprove={(q) => router.push(`/app/knowledge?topic=${encodeURIComponent(q)}`)} />
    </WorkspaceShell>
  );
}

export function LegalPage({ kind }: { kind: "privacy" | "terms" | "deletion" }) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const title = kind === "privacy" ? copy.legal.privacyTitle : kind === "terms" ? copy.legal.termsTitle : copy.legal.deletionTitle;
  const items = kind === "privacy" ? copy.legal.privacy : kind === "terms" ? copy.legal.terms : copy.legal.deletion;
  return (
    <main className="min-h-svh overflow-x-hidden bg-[var(--color-panel-deep)] px-4 py-5 text-[var(--color-on-dark)] sm:py-6" lang={locale}>
      <div className="mx-auto flex max-w-[800px] items-center justify-between gap-2">
        <Link href="/" className="inline-flex min-h-11 min-w-0 items-center gap-2 text-xl font-bold sm:text-2xl">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#38dc89] text-sm text-[#072317] sm:h-9 sm:w-9 sm:text-base">V</span>
          <span className="truncate">{copy.brand}</span>
        </Link>
        <LangSwitch />
      </div>
      <article className="mx-auto mt-8 max-w-[800px] sm:mt-10">
        <h1 className="text-2xl font-bold leading-snug sm:text-3xl lg:text-4xl">{title}</h1>
        <p className="mt-4 text-sm leading-7 text-[var(--color-muted-on-dark)] sm:text-base">{copy.legal.operator}</p>
        <a href={`mailto:${copy.legal.contactEmail}`} dir="ltr" className="mt-2 inline-flex min-h-11 max-w-full items-center break-all text-sm text-[#38dc89] underline underline-offset-4 sm:text-base">{copy.legal.contactEmail}</a>
        <ol className="mt-6 grid gap-3 text-base leading-7 text-[var(--color-on-dark)] sm:gap-4 sm:text-lg sm:leading-8">
          {items.map((item, index) => (
            <li key={item} className="rounded-2xl border border-[color:var(--color-border-soft)] bg-[#0d1a14] p-4 sm:p-5">
              <span className="me-2 text-sm text-[var(--color-muted-soft)]">{index + 1}.</span>
              {item}
            </li>
          ))}
        </ol>
        <div className="mt-8"><LinkButton href="/" variant="secondary">{copy.legal.backHome}</LinkButton></div>
      </article>
    </main>
  );
}
