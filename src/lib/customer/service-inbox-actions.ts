'use server';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {sessionHasCompanyCapability} from '@/lib/access/actions';
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
  const [waAccess,igAccess,igAssignAllowed]=await measureRead('capabilities',()=>Promise.all([
   sessionHasCompanyCapability(company.id,'wa.conversations.read'),
   sessionHasCompanyCapability(company.id,'ig.conversations.read'),
   sessionHasCompanyCapability(company.id,'ig.conversations.assign'),
  ]));
  // UNCONFIGURED preserves the existing native authority. It is explicitly NOT
  // a plan grant, selection, default channel count or a new activation path.
  const unconfigured=channelContract.plan_entitlements.status==='UNCONFIGURED';
  const waAllowed=unconfigured?waAccess:waAccess===null?null:waAccess&&channelOperationAllowed(channelContract,'whatsapp','read');
  const igAllowed=unconfigured?igAccess:igAccess===null?null:igAccess&&channelOperationAllowed(channelContract,'instagram','read');
  const [wa,ig]=await measureRead('channel_data',()=>Promise.all([
   waAllowed===true?loadWhatsappInboxInitialPage():Promise.resolve({ok:false as const,code:waAllowed===false?'FORBIDDEN' as const:'UNAVAILABLE' as const}),
   igAllowed===true?loadInstagramInboxPage({companyId:company.id}):Promise.resolve({ok:false as const,code:igAllowed===false?'FORBIDDEN' as const:'UNAVAILABLE' as const}),
  ]));
  const current=await measureRead('final_scope',()=>getCompanyAccess());
  if(!current.ok)return {ok:false as const,code:current.code==='UNAVAILABLE'?'UNAVAILABLE' as const:'SCOPE_CHANGED' as const};
  if(current.context.userId!==userId||current.context.company?.id!==company.id||current.context.membership?.role!==membership.role)
   return {ok:false as const,code:'SCOPE_CHANGED' as const};
  const finalResult=await readCompanyChannelContractResult(company.id);
  if(!finalResult.ok)return finalResult;
  const finalContract=finalResult.contract;
  if(hasChannelScopeChanged(channelContract,finalContract))return {ok:false as const,code:'SCOPE_CHANGED' as const};
  if(wa.ok&&wa.meta.companyId!==company.id||ig.ok&&ig.data.companyId!==company.id||ig.ok&&ig.data.actorId!==userId)
   return {ok:false as const,code:'SCOPE_CHANGED' as const};
  return {ok:true as const,companyId:company.id,actorId:userId,owner:membership.role==='owner',
   companyInSetup:company.status==='setup',waAllowed,igAllowed,igAssignAllowed,channelContract,
   channel_access:{whatsapp:waAccess,instagram:igAccess},wa,ig};
 }catch{return {ok:false as const,code:'UNAVAILABLE' as const};}
}
