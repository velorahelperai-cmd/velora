import {canUseAccountPrepDraft} from "@/lib/tenancy/account-prep-eligibility";
import {redirect} from 'next/navigation';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {PrepaymentPreparation} from '@/components/app/prepayment-preparation';
import {AccessGate} from '@/components/app/access-gate';
export const dynamic='force-dynamic';
export default async function Page(){
 const access=await getCompanyAccess();
 if(!access.ok){if(access.code==='UNVERIFIED')redirect('/verify-email?next=%2Faccount%2Fbusinesses%2Fnew');if(access.code==='UNAUTHENTICATED')redirect('/login?next=%2Faccount%2Fbusinesses%2Fnew');return <AccessGate code={access.code==='FORBIDDEN'?'FORBIDDEN':'UNAVAILABLE'}/>;}
 const ctx=access.context;
 if(ctx.needsProfileName)redirect('/complete-profile?next=%2Faccount%2Fbusinesses%2Fnew');
 if(!canUseAccountPrepDraft(ctx))return <AccessGate code="FORBIDDEN"/>;
 // Account-owned preparation draft is separate from business activation. Existing companies remain managed through
 // /setup; phone/payment authority is checked at its later server boundary.
 return <PrepaymentPreparation key={ctx.userId} userId={ctx.userId}/>;
}
