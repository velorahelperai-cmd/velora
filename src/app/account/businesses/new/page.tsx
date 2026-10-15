import {redirect} from 'next/navigation';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {PrepaymentPreparation} from '@/components/app/prepayment-preparation';
import {AccessGate} from '@/components/app/access-gate';
export const dynamic='force-dynamic';
export default async function Page(){
 const access=await getCompanyAccess();
 if(!access.ok){if(access.code==='UNVERIFIED')redirect('/verify-email?next=%2Faccount%2Fbusinesses%2Fnew');if(access.code==='UNAUTHENTICATED')redirect('/login?next=%2Faccount%2Fbusinesses%2Fnew');return <AccessGate code={access.code==='FORBIDDEN'?'FORBIDDEN':'UNAVAILABLE'}/>;}
 const ctx=access.context,owns=(ctx.ownedBusinessCount??0)>0||ctx.membership?.role==='owner'||ctx.workspaceChoices.some(c=>c.role==='owner');
 if(ctx.needsProfileName)redirect('/complete-profile?next=%2Faccount%2Fbusinesses%2Fnew');
 if(ctx.isPlatformAdmin&&!owns||(ctx.membership?.role==='staff'||ctx.hasBusinessMemberships===true)&&!owns)return <AccessGate code="FORBIDDEN"/>;
 // New preparation is local only. Existing companies remain managed through
 // /setup; phone/payment authority is checked at its later server boundary.
 return <PrepaymentPreparation key={ctx.userId} userId={ctx.userId}/>;
}
