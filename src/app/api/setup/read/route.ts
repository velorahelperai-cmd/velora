import {readSessionIdentity} from '@/lib/auth/server-identity';
import {readOwnedPaidSetupShellAction,readOwnedPaidSetupWorkspaceAction} from '@/lib/tenancy/paid-setup-workspace-actions';
import {readOwnedBranchHoursAction} from '@/lib/tenancy/branch-hours-actions';
import {readOwnedBranchKnowledgeAction} from '@/lib/tenancy/paid-branch-knowledge-actions';
import {readOwnedBranchReplyLanguageAction} from '@/lib/tenancy/paid-reply-language-actions';
import {readOwnedBranchAssistantTrialAction} from '@/lib/tenancy/paid-assistant-trial-actions';
import {readOwnedBranchLaunchSummaryAction} from '@/lib/tenancy/paid-launch-actions';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const readers={shell:readOwnedPaidSetupShellAction,workspace:readOwnedPaidSetupWorkspaceAction,hours:readOwnedBranchHoursAction,knowledge:readOwnedBranchKnowledgeAction,language:readOwnedBranchReplyLanguageAction,trial:readOwnedBranchAssistantTrialAction,launch:readOwnedBranchLaunchSummaryAction};
const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Read transport avoids the browser Server Action queue. Mutations remain actions.
 * Existing native RPCs still enforce owner, entitlement, branch and RLS checks. */
export async function GET(request:Request){
 const started=performance.now();
 const query=new URL(request.url).searchParams;
 const resource=query.get('resource')??'';
 const scope={expectedAccountId:query.get('expectedAccountId')??'',companyId:query.get('companyId')??'',branchId:query.get('branchId')??''};
 if(!Object.hasOwn(readers,resource)||Object.values(scope).some(id=>!uuid.test(id))||[...query.keys()].some(key=>query.getAll(key).length!==1))return Response.json({error:'INVALID_INPUT'},{status:400,headers});
 try{
  const identity=await readSessionIdentity();
  if(!identity.ok)return Response.json({error:identity.code},{status:identity.code==='UNAVAILABLE'?503:401,headers});
  if(identity.userId!==scope.expectedAccountId||identity.boundaryFingerprint!==request.headers.get('x-velora-boundary'))return Response.json({error:'SCOPE_CHANGED'},{status:403,headers});
  const data=await readers[resource as keyof typeof readers](scope);
  return Response.json({data},{headers:{...headers,'Server-Timing':`setup-read;dur=${(performance.now()-started).toFixed(1)}`}});
 }catch{return Response.json({error:'UNAVAILABLE'},{status:503,headers});}
}
