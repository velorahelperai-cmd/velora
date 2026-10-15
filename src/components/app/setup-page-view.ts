import type {buildSmartOnboarding,SmartBranchSetup,SetupCardId} from '@/lib/tenancy/smart-onboarding';
import type {CompanyRecord} from '@/lib/tenancy/types';

const pageCards:readonly SetupCardId[]=['profile','branches','subscription','review'];
export function setupPageStep(step:number){return [0,1,7].includes(step)?step:0;}

/** Page data completion is separate from operational readiness. Never mutate its proof. */
export function buildSetupPageView(smart:ReturnType<typeof buildSmartOnboarding>,company:CompanyRecord|null,branch:SmartBranchSetup|null){
 const allowed=!!company&&company.status!=='suspended';
 const profile=allowed&&!!company.display_name.trim()&&!!company.business_type.trim()&&!!company.country.trim();
 const branches=allowed&&branch?.companyId===company.id&&!!branch.mode&&branch.branches.some(b=>b.primary&&!!b.name.trim());
 const completedRequired=Number(profile)+Number(branches);
 const cards=smart.cards.filter(card=>pageCards.includes(card.id)).map(card=>card.id==='branches'&&branches?{...card,status:'ready' as const,missing:null}:card);
 return {cards,completedRequired,totalRequired:2,percent:completedRequired*50};
}
