import { Suspense } from "react";
import type { Metadata } from "next";
import { ConversationsPage } from "@/components/app/conversations";

export const metadata: Metadata = { title: "Conversations · Velora" };

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <ConversationsPage />
    </Suspense>
  );
}
