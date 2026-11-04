import type {loadWhatsappThreadPage} from '@/lib/whatsapp/inbox-contracts';

/** Independent read transport; never waits behind seen/send Server Actions. */
export async function fetchInboxThread(input:Parameters<typeof loadWhatsappThreadPage>[0]):Promise<Awaited<ReturnType<typeof loadWhatsappThreadPage>>>{
 try{
  const query=new URLSearchParams({companyId:input.companyId,conversationId:input.conversationId});
  if(input.before)query.set('before',input.before);
  if(input.limit!==undefined)query.set('limit',String(input.limit));
  const response=await fetch(`/api/inbox/thread?${query}`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(45000)});
  if(!response.ok)return {ok:false,code:response.status===409?'SCOPE_CHANGED':response.status===401||response.status===403?'FORBIDDEN':'UNAVAILABLE'};
  const result=await response.json() as Awaited<ReturnType<typeof loadWhatsappThreadPage>>;
  if(!result||typeof result.ok!=='boolean')return {ok:false,code:'UNAVAILABLE'};
  if(result.ok&&(result.data.companyId!==input.companyId||result.data.conversationId!==input.conversationId))return {ok:false,code:'SCOPE_CHANGED'};
  return result;
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
