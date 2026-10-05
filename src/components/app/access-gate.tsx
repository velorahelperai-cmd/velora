"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Notice, useAppCopy } from "@/components/app/ui";

/** Shown for authenticated sessions that fail FORBIDDEN/UNAVAILABLE — never a login loop. */
export function AccessGate({
  code,
  reason,
}: {
  code: "FORBIDDEN" | "UNAVAILABLE";
  /** Optional machine reason (e.g. DEPENDENCY_MISSING:…) — never secrets. */
  reason?: string | null;
}) {
  const copy = useAppCopy();
  const router = useRouter();
  const dependencyMissing = Boolean(reason?.startsWith("DEPENDENCY_MISSING:"));
  const title = code === "FORBIDDEN"
    ? copy.errors.forbiddenTitle
    : dependencyMissing
      ? copy.admin.conversationsDependencyTitle
      : copy.errors.unavailableTitle;
  const body = code === "FORBIDDEN"
    ? copy.errors.forbiddenBody
    : dependencyMissing
      ? copy.admin.conversationsDependencyBody
      : copy.errors.unavailableBody;

  return (
    <main className="app-shell px-4 py-10">
      <div className="mx-auto grid max-w-lg gap-4">
        <Notice tone={code === "FORBIDDEN" ? "warn" : "error"}>
          <strong>{title}</strong>
          <br />
          {body}
          {dependencyMissing && reason ? (
            <>
              <br />
              <span className="mt-2 block font-mono text-xs text-[#8da195]" dir="ltr">{reason}</span>
            </>
          ) : null}
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => router.refresh()}>
            {copy.errors.accessRetry}
          </Button>
          <Link href="/admin" className="inline-flex min-h-11 items-center rounded-xl border border-white/15 px-4 text-sm text-[#38dc89]">
            {copy.admin.title}
          </Link>
          <Link href="/" className="inline-flex min-h-11 items-center rounded-xl border border-white/15 px-4 text-sm text-[#38dc89]">
            {copy.home}
          </Link>
        </div>
      </div>
    </main>
  );
}
