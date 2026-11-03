'use server';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {sessionHasCompanyCapability} from '@/lib/access/actions';
import {readSessionConversationScope} from '@/lib/access/conversation-scope';
import {readInboxCapability} from '@/lib/access/inbox-capability';
import {loadWhatsappInboxInitialPage} from '@/lib/whatsapp/inbox';
import {loadInstagramInboxPage} from '@/lib/instagram/inbox-actions';
import {readCompanyChannelContractResult} from '@/lib/channels/read';
import {channelOperationAllowed,hasChannelScopeChanged} from '@/lib/channels/contract';
import {traceRead,measureRead} from '@/lib/diagnostics/read-performance';
import {runWithReadScope} from '@/lib/supabase/read-scope';
/** Presentation aggregation only. Native channel stores still enforce session,
 * tenant, account, retention and send authority. Access never implies payment. */
export async function readServiceInbox() {
 return runWithReadScope(()=>traceRead('service_inbox',readServiceInboxData));
}
async function readServiceInboxData() {
 try {
  const access=await measureRead('access',()=>getCompanyAccess());
  if(!access.ok)return {ok:false as const,code:access.code};
  const {company,membership,userId}=access.context;
  if(!company||!membership)return {ok:false as const,code:'NO_COMPANY' as const};
  const contractResult=await measureRead('capabilities',()=>readCompanyChannelContractResult(company.id));
  if(!contractResult.ok)return contractResult;
  const channelContract=contractResult.contract;
  const [waResult,igResult,igAssignAllowed]=await measureRead('capabilities',()=>Promise.all([
   readInboxCapability(company.id,'wa.conversations.read'),
   readInboxCapability(company.id,'ig.conversations.read'),
   sessionHasCompanyCapability(company.id,'ig.conversations.assign'),
  ]));
  const scope=await readSessionConversationScope(company.id);
  // No error response carries retained data or a grant. Recheck all available
  // authority before classification; explicit denials outrank transient errors.
  async function finalAuthority(){
   const current=await measureRead('final_scope',()=>getCompanyAccess());
   if(!current.ok)return {ok:false as const,code:current.code==='UNAVAILABLE'?'UNAVAILABLE' as const:'SCOPE_CHANGED' as const};
   if(current.context.userId!==userId||current.context.company?.id!==company!.id||JSON.stringify(current.context.membership)!==JSON.stringify(membership))
    return {ok:false as const,code:'SCOPE_CHANGED' as const};
   const [contract,finalScope,waFinal,igFinal]=await Promise.all([
    readCompanyChannelContractResult(company!.id),readSessionConversationScope(company!.id),
    readInboxCapability(company!.id,'wa.conversations.read'),readInboxCapability(company!.id,'ig.conversations.read'),
   ]);
   const capabilities=[{initial:waResult,final:waFinal},{initial:igResult,final:igFinal}];
   if((!contract.ok&&contract.code==='FORBIDDEN')||(!finalScope.ok&&finalScope.code==='FORBIDDEN')||(!scope.ok&&scope.code==='FORBIDDEN')||capabilities.some(({initial,final})=>!final.ok?final.code==='FORBIDDEN':!final.allowed&&(!initial.ok||initial.allowed)))
    return {ok:false as const,code:'FORBIDDEN' as const};
   if(contract.ok&&hasChannelScopeChanged(channelContract,contract.contract)||scope.ok&&finalScope.ok&&scope.scope!==finalScope.scope)
    return {ok:false as const,code:'SCOPE_CHANGED' as const};
   if(!contract.ok||!scope.ok||!finalScope.ok||!waFinal.ok||!igFinal.ok)return {ok:false as const,code:'UNAVAILABLE' as const};
   return {ok:true as const,scope:finalScope.scope};
  }
  if(!waResult.ok||!igResult.ok||!scope.ok){
   // A known denial must clear retained rows even if the other channel timed out.
   const denied=[waResult,igResult].some(result=>result.ok?!result.allowed:result.code==='FORBIDDEN');
   if(denied)return {ok:false as const,code:'FORBIDDEN' as const};
   const final=await finalAuthority();
   if(!final.ok)return final;
   return {ok:false as const,code:'UNAVAILABLE' as const};
  }
  const waAccess=waResult.allowed,igAccess=igResult.allowed;
  // UNCONFIGURED preserves the existing native authority. It is explicitly NOT
  // a plan grant, selection, default channel count or a new activation path.
  const unconfigured=channelContract.plan_entitlements.status==='UNCONFIGURED';
  const waAllowed=unconfigured?waAccess:waAccess===null?null:waAccess&&channelOperationAllowed(channelContract,'whatsapp','read');
  const igAllowed=unconfigured?igAccess:igAccess===null?null:igAccess&&channelOperationAllowed(channelContract,'instagram','read');
  const [wa,ig]=await measureRead('channel_data',()=>Promise.all([
   waAllowed===true?loadWhatsappInboxInitialPage():Promise.resolve({ok:false as const,code:waAllowed===false?'FORBIDDEN' as const:'UNAVAILABLE' as const}),
   igAllowed===true?loadInstagramInboxPage({companyId:company.id}):Promise.resolve({ok:false as const,code:igAllowed===false?'FORBIDDEN' as const:'UNAVAILABLE' as const}),
  ]));
  const final=await finalAuthority();
  if(!final.ok)return final;
  if(waAllowed&&!wa.ok&&wa.code==='FORBIDDEN'||igAllowed&&!ig.ok&&ig.code==='FORBIDDEN')return {ok:false as const,code:'FORBIDDEN' as const};
  for(const result of [wa,ig])if(!result.ok&&result.code!=='FORBIDDEN')return {ok:false as const,code:result.code};
  if(wa.ok&&wa.meta.conversationScope!==final.scope||ig.ok&&ig.data.conversationScope!==final.scope)return {ok:false as const,code:'SCOPE_CHANGED' as const};
  if(wa.ok&&wa.meta.companyId!==company.id||ig.ok&&ig.data.companyId!==company.id||ig.ok&&ig.data.actorId!==userId)
   return {ok:false as const,code:'SCOPE_CHANGED' as const};
  return {ok:true as const,companyId:company.id,actorId:userId,owner:membership.role==='owner',
   companyInSetup:company.status==='setup',waAllowed,igAllowed,igAssignAllowed,channelContract,
   channel_access:{whatsapp:waAccess,instagram:igAccess},wa,ig};
 }catch{return {ok:false as const,code:'UNAVAILABLE' as const};}
}
