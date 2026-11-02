import {readSessionIdentity} from '@/lib/auth/server-identity';
import {runWithVerifiedReadClient} from '@/lib/supabase/server';
import {traceRead} from '@/lib/diagnostics/read-performance';
import {readOwnedPaidBranchSetupEntryAction} from '@/lib/tenancy/paid-setup-actions';
import {readOwnedPaidSetupShellAction,readOwnedPaidSetupWorkspaceAction} from '@/lib/tenancy/paid-setup-workspace-actions';
import {readOwnedBranchHoursAction} from '@/lib/tenancy/branch-hours-actions';
import {readOwnedBranchKnowledgeAction} from '@/lib/tenancy/paid-branch-knowledge-actions';
import {readOwnedBranchReplyLanguageAction} from '@/lib/tenancy/paid-reply-language-actions';
import {readOwnedBranchAssistantTrialAction} from '@/lib/tenancy/paid-assistant-trial-actions';
import {readOwnedBranchTeamAction} from '@/lib/tenancy/paid-team-actions';
import {readOwnedBranchLaunchSummaryAction} from '@/lib/tenancy/paid-launch-actions';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const readers={shell:readOwnedPaidSetupShellAction,workspace:readOwnedPaidSetupWorkspaceAction,hours:readOwnedBranchHoursAction,knowledge:readOwnedBranchKnowledgeAction,language:readOwnedBranchReplyLanguageAction,trial:readOwnedBranchAssistantTrialAction,team:readOwnedBranchTeamAction,launch:readOwnedBranchLaunchSummaryAction};
const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Read transport avoids the browser Server Action queue. Mutations remain actions.
 * Existing native RPCs still enforce owner, entitlement, branch and RLS checks. */
export async function GET(request:Request){
 const started=performance.now();
 const requestId=crypto.randomUUID();
 let stage:'validation'|'identity'|'scope'|'reader'='validation';
 const failure=(error:string,status:number)=>{
  console.warn(JSON.stringify({service:'velora.setup.read',stage,status,requestId,resource:stage==='validation'?undefined:resource}));
  return Response.json({error},{status,headers:{...headers,'X-Request-Id':requestId,'X-Setup-Stage':stage}});
 };
 const query=new URL(request.url).searchParams;
 const resource=query.get('resource')??'';
 const scope={expectedAccountId:query.get('expectedAccountId')??'',companyId:query.get('companyId')??'',branchId:query.get('branchId')??''};
 const entry=resource==='entry';
 const required=entry?[scope.expectedAccountId,scope.companyId]:Object.values(scope);
 if((!entry&&!Object.hasOwn(readers,resource))||required.some(id=>!uuid.test(id))||[...query.keys()].some(key=>query.getAll(key).length!==1)||
   (entry&&[...query.keys()].some(key=>!['resource','expectedAccountId','companyId'].includes(key))))return failure('INVALID_INPUT',400);
 const origin=request.headers.get('origin');
 if(request.headers.get('sec-fetch-site')==='cross-site'||(origin&&origin!==new URL(request.url).origin))return failure('FORBIDDEN',403);
 try{
  const dispatch=async()=>{
  stage='identity';
  const identity=await readSessionIdentity(entry?{readOnly:true}:undefined);
  if(!identity.ok)return failure(identity.code,identity.code==='UNAVAILABLE'?503:401);
  stage='scope';
  if(identity.userId!==scope.expectedAccountId||identity.boundaryFingerprint!==request.headers.get('x-velora-boundary'))return failure('SCOPE_CHANGED',403);
  stage='reader';
  const data=entry?await readOwnedPaidBranchSetupEntryAction({expectedAccountId:scope.expectedAccountId,companyId:scope.companyId}):await readers[resource as keyof typeof readers](scope);
  return Response.json({data},{headers:{...headers,'Server-Timing':`setup-read;dur=${(performance.now()-started).toFixed(1)}`}});
  };
  if(!entry)return await dispatch();
  // Reuse only this read's transport. Native identity/RPC checks still run;
  // no response escapes until the fresh broker and cookie fence completes.
  const verified=await traceRead('setup_entry_http',()=>runWithVerifiedReadClient(dispatch));
  if(verified.actorId!==scope.expectedAccountId){stage='scope';return failure('SCOPE_CHANGED',403);}
  verified.value.headers.set('Server-Timing',`setup-read;dur=${(performance.now()-started).toFixed(1)}`);
  return verified.value;
 }catch{return failure('UNAVAILABLE',503);}
}
