import type {loadWhatsappThreadPage} from '@/lib/whatsapp/inbox-contracts';

/** Independent read transport; never waits behind seen/send Server Actions. */
export async function fetchInboxThread(input:Parameters<typeof loadWhatsappThreadPage>[0]):Promise<Awaited<ReturnType<typeof loadWhatsappThreadPage>>|{ok:false;code:'UNAVAILABLE';transportUnavailable:true}>{
 try{
  const query=new URLSearchParams({companyId:input.companyId,conversationId:input.conversationId});
  if(input.before)query.set('before',input.before);
  if(input.limit!==undefined)query.set('limit',String(input.limit));
  let response:Response;
  try{response=await fetch(`/api/inbox/thread?${query}`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(45000)});}catch{return {ok:false,code:'UNAVAILABLE',transportUnavailable:true};}
  if(response.status===409)return {ok:false,code:'SCOPE_CHANGED'};
  if(response.status===401||response.status===403)return {ok:false,code:'FORBIDDEN'};
  // Platform timeouts/gateway errors are transport loss, not a permission denial.
  if(response.status===503||response.status===504||response.status===408)return {ok:false,code:'UNAVAILABLE',transportUnavailable:true};
  if(!response.ok)return {ok:false,code:'UNAVAILABLE'};
  const result=await response.json() as Awaited<ReturnType<typeof loadWhatsappThreadPage>>;
  if(!result||typeof result.ok!=='boolean')return {ok:false,code:'UNAVAILABLE'};
  if(result.ok&&(result.data.companyId!==input.companyId||result.data.conversationId!==input.conversationId))return {ok:false,code:'SCOPE_CHANGED'};
  const clean={...result} as typeof result & {transportUnavailable?:unknown};
  delete clean.transportUnavailable;
  return clean;
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
