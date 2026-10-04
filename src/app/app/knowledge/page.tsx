import { Suspense } from "react";
import type { Metadata } from "next";
import { KnowledgePage } from "@/components/app/workspace-pages";

export const metadata: Metadata = { title: "Knowledge · Velora" };

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <KnowledgePage />
    </Suspense>
  );
}
