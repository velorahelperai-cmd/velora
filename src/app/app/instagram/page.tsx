import {Suspense} from 'react';
import type {Metadata} from 'next';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {InstagramConnectionPage} from '@/components/app/instagram-connection-page';
import {redirect} from 'next/navigation';
import {validDiagnostic} from '@/lib/diagnostics/contract';
export const metadata:Metadata={title:'Instagram · Velora'};
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{connection?:string|string[];support?:string|string[];phase?:string|string[];thread?:string|string[];intent?:string|string[]}>}){
 const [access,query]=await Promise.all([getCompanyAccess(),searchParams]);
 if(typeof query.thread==='string'&&/^[0-9a-f-]{36}$/i.test(query.thread)){
  const p=new URLSearchParams({source:'instagram',thread:query.thread});
  if(typeof query.intent==='string'&&/^[0-9a-f-]{36}$/i.test(query.intent))p.set('intent',query.intent);
  redirect('/app/conversations?'+p.toString());
 }
 const diagnostic={reference:query.support,stage:query.phase,operation:'instagram_connect',code:query.connection==='needs_review'?'OUTCOME_UNKNOWN':'PROVIDER_REJECTED'};
 return <Suspense fallback={<main className="app-shell" aria-busy="true"/>}><InstagramConnectionPage companyId={access.ok?access.context.company?.id??null:null} owner={access.ok&&access.context.membership?.role==='owner'} callbackResult={typeof query.connection==='string'?query.connection:undefined} callbackDiagnostic={validDiagnostic(diagnostic)?diagnostic:undefined}/></Suspense>;
}
