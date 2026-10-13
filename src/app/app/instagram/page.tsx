import {Suspense} from 'react';
import type {Metadata} from 'next';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {InstagramInbox} from '@/components/app/instagram-inbox';
import {validDiagnostic} from '@/lib/diagnostics/contract';
export const metadata:Metadata={title:'Instagram · Velora'};
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{connection?:string|string[];support?:string|string[];phase?:string|string[]}>}){
 const [access,query]=await Promise.all([getCompanyAccess(),searchParams]);
 const diagnostic={reference:query.support,stage:query.phase,operation:'instagram_connect',code:query.connection==='needs_review'?'OUTCOME_UNKNOWN':'PROVIDER_REJECTED'};
 return <Suspense fallback={<main aria-busy="true"/>}><InstagramInbox companyId={access.ok?access.context.company?.id??null:null} owner={access.ok&&access.context.membership?.role==='owner'} companyInSetup={access.ok&&access.context.company?.status==='setup'} callbackResult={typeof query.connection==='string'?query.connection:undefined} callbackDiagnostic={validDiagnostic(diagnostic)?diagnostic:undefined}/></Suspense>;
}
