import { Suspense } from "react";
import type { Metadata } from "next";
import { UnifiedInbox } from "@/components/app/unified-inbox";
import { readServiceInbox } from "@/lib/customer/service-inbox-actions";
import { instagramReviewMode } from '@/lib/instagram/config';
import {whatsappConfigurationMode,whatsappConfig} from '@/lib/whatsapp/config';

export const metadata: Metadata = { title: "Conversations · Velora" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const loaded = await readServiceInbox();
  return (
    <Suspense fallback={<main className="app-shell" aria-busy="true" />}>
      <UnifiedInbox key={loaded.ok?`${loaded.actorId}:${loaded.companyId}`:'unavailable'} initial={loaded}
       waReview={loaded.ok&&whatsappConfigurationMode()==='meta_test'&&loaded.companyId===whatsappConfig().companyId}
       igReview={loaded.ok&&instagramReviewMode(loaded.companyId)}/>
    </Suspense>
  );
}
