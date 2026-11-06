import {InboxLoadingFrame} from '@/components/app/conversations-entry';
import {UnifiedInbox} from '@/components/app/unified-inbox';
import {readServiceInbox} from '@/lib/customer/service-inbox-actions';
import {instagramReviewMode} from '@/lib/instagram/config';
import {runWithVerifiedReadClient} from '@/lib/supabase/server';
import {runWithVerifiedCompanyRead} from '@/lib/tenancy/access';
import {whatsappConfig,whatsappConfigurationMode} from '@/lib/whatsapp/config';
import type {Metadata} from 'next';
import {Suspense} from 'react';

export const metadata: Metadata = { title: "Conversations · Velora" };
export const dynamic = "force-dynamic";

async function ConversationsContent() {
  // Use the same existing fenced read composition as /api/inbox/read.
  // A hung channel read must still release the shell instead of leaving a blank page.
  let loaded:Awaited<ReturnType<typeof readServiceInbox>>;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    const read=runWithVerifiedReadClient(()=>runWithVerifiedCompanyRead(readServiceInbox));
    const {value,actorId}=await Promise.race([
      read.then(result=>{clearTimeout(timer);return result;}),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('inbox-read-timeout')),12000);}),
    ]);
    loaded=value.ok&&value.actorId!==actorId?{ok:false,code:'SCOPE_CHANGED'}:value;
  }catch{clearTimeout(timer);loaded={ok:false,code:'UNAVAILABLE'};}
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
    <Suspense fallback={<InboxLoadingFrame />}>
      <ConversationsContent />
    </Suspense>
  );
}
