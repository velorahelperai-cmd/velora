import type {CompanyContext} from './types';

/** Identity and membership are server-derived. Never grants billing authority. */
export function canUseQaSetupSimulation(context:CompanyContext):boolean {
 return context.userId==='83ad69f7-cbb0-4e3a-a34e-8085e5203dc7'
  && context.email.trim().toLowerCase()==='velorahelperai+meta-review@gmail.com'
  && context.emailConfirmed && context.identityVerified && !context.company
  && !context.membership && !context.needsCompanyContext
  && context.workspaceChoices.length===0 && !context.hasBranchMemberships
  && !context.hasBusinessMemberships && (context.ownedBusinessCount??0)===0;
}
