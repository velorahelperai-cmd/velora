import {notFound} from 'next/navigation';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {canUseQaSetupSimulation} from '@/lib/tenancy/qa-setup-simulation';
import {QaSetupSimulation} from '@/components/app/qa-setup-simulation';

export const dynamic='force-dynamic';
export const metadata={title:'VELORA QA · Internal simulation',robots:{index:false,follow:false}};
export default async function Page(){
 const access=await getCompanyAccess();
 if(!access.ok || !canUseQaSetupSimulation(access.context))notFound();
 return <QaSetupSimulation accountId={access.context.userId}/>;
}
