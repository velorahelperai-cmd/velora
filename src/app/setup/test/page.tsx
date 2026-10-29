import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {AccessGate} from '@/components/app/access-gate';
import {SetupMetaTest} from '@/components/app/setup-meta-test';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {readOwnedSetupMetaTestAction} from '@/lib/tenancy/setup-meta-test-actions';

export const metadata:Metadata={title:'Setup test · Velora',robots:{index:false,follow:false}};
export default async function Page({searchParams}:{searchParams:Promise<{branch?:string}>}){
 const access=await getCompanyAccess('owner');
 if(!access.ok){if(access.code==='UNAUTHENTICATED')redirect('/login?next=%2Fsetup%2Ftest');if(access.code==='UNVERIFIED')redirect('/verify-email?next=%2Fsetup%2Ftest');return <AccessGate code={access.code==='UNAVAILABLE'?'UNAVAILABLE':'FORBIDDEN'}/>;}
 if(access.context.needsCompanyContext||!access.context.company||access.context.membership?.role!=='owner')return <AccessGate code="FORBIDDEN"/>;
 const requested=(await searchParams).branch;
 const branchId=requested??process.env.VELORA_SETUP_META_TEST_BRANCH_ID??'';
 const initial=await readOwnedSetupMetaTestAction({expectedAccountId:access.context.userId,companyId:access.context.company.id,branchId});
 if(!initial)return <AccessGate code="FORBIDDEN"/>;
 return <SetupMetaTest initial={initial} companyName={access.context.company.display_name}/>;
}
