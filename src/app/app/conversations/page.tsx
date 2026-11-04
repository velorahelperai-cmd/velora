import {runWithVerifiedReadClient} from '@/lib/supabase/server';
import {runWithVerifiedCompanyRead} from '@/lib/tenancy/access';
import { Suspense } from "react";
import type { Metadata } from "next";
import { UnifiedInbox } from "@/components/app/unified-inbox";
import { readServiceInbox } from "@/lib/customer/service-inbox-actions";
import { instagramReviewMode } from '@/lib/instagram/config';
import { whatsappConfigurationMode, whatsappConfig } from '@/lib/whatsapp/config';

export const metadata: Metadata = { title: "Conversations · Velora" };
export const dynamic = "force-dynamic";

async function ConversationsContent() {
  // Use the same existing fenced read composition as /api/inbox/read.
  let loaded:Awaited<ReturnType<typeof readServiceInbox>>;
  try{
    const {value,actorId}=await runWithVerifiedReadClient(()=>runWithVerifiedCompanyRead(readServiceInbox));
    loaded=value.ok&&value.actorId!==actorId?{ok:false,code:'SCOPE_CHANGED'}:value;
  }catch{loaded={ok:false,code:'UNAVAILABLE'};}
  const key = loaded.ok ? `${loaded.actorId}:${loaded.companyId}` : `unavailable:${loaded.code}`;
  return (
    <UnifiedInbox
      key={key}
      initial={loaded}
      waReview={loaded.ok && whatsappConfigurationMode() === 'meta_test' && loaded.companyId === whatsappConfig().companyId}
      igReview={loaded.ok && instagramReviewMode(loaded.companyId)}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="app-shell" aria-busy="true" />}>
      <ConversationsContent />
    </Suspense>
  );
}
