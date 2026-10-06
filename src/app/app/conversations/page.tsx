import { Suspense } from "react";
import type { Metadata } from "next";
import { ConversationsPage } from "@/components/app/conversations";
import { loadWhatsappInbox } from "@/lib/whatsapp/inbox";

export const metadata: Metadata = { title: "Conversations · Velora" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const loaded = await loadWhatsappInbox();
  return (
    <Suspense fallback={<main className="min-h-svh bg-[#07110d]" aria-busy="true" />}>
      <ConversationsPage
        inbox={loaded.ok ? loaded.conversations : []}
        loadFailed={!loaded.ok && loaded.code === "UNAVAILABLE"}
        noCompany={!loaded.ok && loaded.code === "NO_COMPANY"}
      />
    </Suspense>
  );
}
