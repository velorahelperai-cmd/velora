"use client";
import {useEffect} from 'react';
import {useRouter} from 'next/navigation';
import {useAccountSession} from './account-chrome';
import {AccessGate} from './access-gate';
import {SetupLoading} from './setup-loading';
import {PrepaymentPreparation} from './prepayment-preparation';
import {PaidSetupWizard} from './setup-wizard';
import {setupDecisionHref} from '@/lib/tenancy/setup-entry-decision';

/** Public route entry: private identifiers arrive only through the account
 * provider's attested read. No company record is serialized in the page payload. */
export function SetupAccountEntry({returnTo,preferredNext}:{returnTo:string;preferredNext:string}) {
 const session=useAccountSession();
 const router=useRouter();
 const identity=session.identity;
 const current=session.status==='ready'&&!!identity&&!!session.boundaryFingerprint&&session.isCurrentUser(identity.userId,identity);
 const decision=current?identity.setupEntry:undefined;
 const destination=session.status==='guest'?setupDecisionHref('login',returnTo):decision?.kind==='redirect'?setupDecisionHref(decision.target,returnTo):null;
 useEffect(()=>{if(destination)router.replace(destination);},[destination,router]);
 if(!current||destination)return <SetupLoading/>;
 if(!decision||identity.accessUnavailable)return <AccessGate code="UNAVAILABLE"/>;
 if(decision.kind==='deny')return <AccessGate code={decision.code}/>;
 if(decision.kind==='redirect')return <SetupLoading/>;
 if(decision.userId!==identity.userId)return <AccessGate code="UNAVAILABLE"/>;
 if(decision.kind==='company'){
  if(decision.companyId!==identity.companyId)return <AccessGate code="UNAVAILABLE"/>;
  return <PaidSetupWizard key={`${decision.userId}:${decision.companyId}`} userId={decision.userId} companyId={decision.companyId}/>;
 }
 if(identity.companyId)return <AccessGate code="UNAVAILABLE"/>;
 return <PrepaymentPreparation key={decision.userId} userId={decision.userId} preferredNext={preferredNext} variant="studio"/>;
}
