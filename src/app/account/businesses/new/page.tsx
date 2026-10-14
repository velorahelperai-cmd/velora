import {redirect} from 'next/navigation';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {getPersonalPhoneStatus} from '@/lib/tenancy/personal-phone-actions';
import {readActiveSetupDraft} from '@/lib/tenancy/setup-draft-actions';
import {BusinessCreator} from '@/components/app/business-creator';
import {AccessGate} from '@/components/app/access-gate';
import {safeInternalPath} from '@/lib/auth/safe-next';
import {authFlowHref} from '@/lib/auth/auth-journey';
import {masterJourneyEnabled} from '@/lib/master-journey/rollout';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!masterJourneyEnabled())redirect('/setup');
 const params=await searchParams,setupReturnTo=safeInternalPath(typeof params.next==='string'?params.next:null,'/setup');
 const returnTo=`/account/businesses/new?next=${encodeURIComponent(setupReturnTo)}`;
 const access=await getCompanyAccess();
 if(!access.ok){if(access.code==='UNVERIFIED')redirect('/verify-email?next=%2Faccount%2Fbusinesses%2Fnew');if(access.code==='UNAUTHENTICATED')redirect('/login?next=%2Faccount%2Fbusinesses%2Fnew');return <AccessGate code={access.code==='FORBIDDEN'?'FORBIDDEN':'UNAVAILABLE'}/>;}
 const ctx=access.context,owns=(ctx.ownedBusinessCount??0)>0||ctx.membership?.role==='owner'||ctx.workspaceChoices.some(c=>c.role==='owner');
 if(ctx.needsProfileName)redirect('/complete-profile?next=%2Faccount%2Fbusinesses%2Fnew');
 if(ctx.isPlatformAdmin&&!owns||(ctx.membership?.role==='staff'||ctx.hasBusinessMemberships===true)&&!owns)return <AccessGate code="FORBIDDEN"/>;
 const active=await readActiveSetupDraft(ctx.userId);
 if(!active.ok){if(active.code==='UNAUTHENTICATED')redirect('/login?next=%2Faccount%2Fbusinesses%2Fnew');return <AccessGate code="UNAVAILABLE"/>;}
 // Continuing an existing business never starts a new creation attempt.
 if(active.data?.draft.companyId)return <BusinessCreator key={ctx.userId} userId={ctx.userId} activeDraft={active.data} setupReturnTo={setupReturnTo}/>;
 const phone=await getPersonalPhoneStatus(ctx.userId);
 if(!phone.ok){if(phone.code==='EMAIL_REQUIRED')redirect('/verify-email?next=%2Faccount%2Fbusinesses%2Fnew');if(phone.code==='UNAUTHENTICATED')redirect('/login?next=%2Faccount%2Fbusinesses%2Fnew');return <AccessGate code="UNAVAILABLE"/>;}
 if(!phone.data.emailVerified)redirect('/verify-email?next=%2Faccount%2Fbusinesses%2Fnew');
 if(!phone.data.phoneVerified)redirect(authFlowHref('/verify-phone',returnTo));
 return <BusinessCreator key={ctx.userId} userId={ctx.userId} activeDraft={active.data} setupReturnTo={setupReturnTo}/>;
}
