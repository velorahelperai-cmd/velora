"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useDemo } from "@/lib/demo-state";
import { AssistantTester } from "@/components/app/assistant-tester";
import { KnowledgeEditor } from "@/components/app/knowledge-editor";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { LangSwitch, LinkButton, useAppCopy } from "@/components/app/ui";

export function KnowledgePage() {
  const copy = useAppCopy();
  const topic = useSearchParams().get("topic") ?? undefined;
  return (
    <WorkspaceShell title={copy.knowledge.title}>
      <KnowledgeEditor focusTitle={topic} />
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

export function LegalPage({ kind }: { kind: "privacy" | "terms" }) {
  const copy = useAppCopy();
  const { locale } = useDemo();
  const title = kind === "privacy" ? copy.legal.privacyTitle : copy.legal.termsTitle;
  const items = kind === "privacy" ? copy.legal.privacy : copy.legal.terms;
  return (
    <main className="min-h-svh bg-[#07110d] px-4 py-6 text-[#f7fbf8]" lang={locale}>
      <div className="mx-auto flex max-w-[800px] items-center justify-between gap-3">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2 text-2xl font-bold">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#38dc89] text-base text-[#072317]">V</span>
          {copy.brand}
        </Link>
        <LangSwitch />
      </div>
      <article className="mx-auto mt-10 max-w-[800px]">
        <span className="inline-flex rounded-full border border-[#d9a467]/50 bg-[#d9a467]/10 px-3 py-1 text-xs text-[#f0cf9d]">{copy.legal.draftBadge}</span>
        <h1 className="mt-4 text-3xl font-bold lg:text-4xl">{title}</h1>
        <ul className="mt-6 grid gap-4 text-lg leading-8 text-[#dfe9e2]">
          {items.map((item) => (
            <li key={item} className="rounded-2xl border border-white/10 bg-[#0d1a14] p-5">{item}</li>
          ))}
        </ul>
        <div className="mt-8"><LinkButton href="/" variant="secondary">{copy.legal.backHome}</LinkButton></div>
      </article>
    </main>
  );
}
