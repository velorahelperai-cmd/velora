import {notFound} from 'next/navigation';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {smartOnboardingEnabled} from '@/lib/tenancy/smart-rollout';
import {readSmartSetup} from '@/lib/tenancy/smart-onboarding-actions';
import {SmartBranchWorkspace} from '@/components/app/smart-branch-workspace';
import {AccessGate} from '@/components/app/access-gate';

export const metadata={title:'Prepare branches · Velora'};
export default async function Page(){
  if(!smartOnboardingEnabled())notFound();
  const access=await getCompanyAccess('owner');
  if(!access.ok)return <AccessGate code={access.code==='FORBIDDEN'?'FORBIDDEN':'UNAVAILABLE'}/>;
  if(!access.context.company||access.context.needsCompanyContext)return <AccessGate code="FORBIDDEN"/>;
  const result=await readSmartSetup({expectedUserId:access.context.userId,expectedCompanyId:access.context.company.id});
  if(!result.ok)return <AccessGate code={result.code==='FORBIDDEN'?'FORBIDDEN':'UNAVAILABLE'}/>;
  return <SmartBranchWorkspace key={`${access.context.userId}:${access.context.company.id}`} userId={access.context.userId} companyId={access.context.company.id} initial={result.data.branchSetup}/>;
}
