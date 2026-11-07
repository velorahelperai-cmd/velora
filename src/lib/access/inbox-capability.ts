import 'server-only';
import {createClient} from '@/lib/supabase/server';
import {reportInboxReadFailure} from '@/lib/whatsapp/inbox-diagnostics';

type InboxReadCapability = 'wa.conversations.read' | 'ig.conversations.read';
export type InboxCapabilityResult =
 | {ok:true;allowed:boolean}
 | {ok:false;code:'UNAVAILABLE'|'FORBIDDEN'};

/** Read aggregation only. No legacy grant fallback; shared write checks stay unchanged. */
export async function readInboxCapability(companyId:string,capability:InboxReadCapability):Promise<InboxCapabilityResult>{
 try{
  const client=await createClient();
  let {data,error}=await client.rpc('has_company_capability',{p_company_id:companyId,p_capability:capability});
  // One retry for definite statement timeouts: preview traffic can cancel the
  // first capability probe while the inbox list/thread reads compete.
  if(error?.code==='57014')({data,error}=await client.rpc('has_company_capability',{p_company_id:companyId,p_capability:capability}));
  if(error){
   if(capability==='wa.conversations.read')reportInboxReadFailure('read_capability_rpc','RPC_ERROR',error);
   return {ok:false,code:['42501','PGRST301'].includes(String(error.code))?'FORBIDDEN':'UNAVAILABLE'};
  }
  if(typeof data==='boolean')return {ok:true,allowed:data};
  return {ok:false,code:'UNAVAILABLE'};
 }catch(error){
  if(capability==='wa.conversations.read')reportInboxReadFailure('read_capability_rpc','EXCEPTION',error);
  return {ok:false,code:'UNAVAILABLE'};
 }
}
