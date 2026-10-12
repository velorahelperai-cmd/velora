import {Suspense} from 'react';
import type {Metadata} from 'next';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {InstagramInbox} from '@/components/app/instagram-inbox';
export const metadata:Metadata={title:'Instagram · Velora'};
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{connection?:string|string[]}>}){
 const [access,query]=await Promise.all([getCompanyAccess(),searchParams]);
 return <Suspense fallback={<main aria-busy="true"/>}><InstagramInbox companyId={access.ok?access.context.company?.id??null:null} owner={access.ok&&access.context.membership?.role==='owner'} callbackResult={typeof query.connection==='string'?query.connection:undefined}/></Suspense>;
}
