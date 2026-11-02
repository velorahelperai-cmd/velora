import type {readServiceInbox} from './service-inbox-actions';
export type ServiceInboxSnapshot=Awaited<ReturnType<typeof readServiceInbox>>;

/** Read-only fetch; writes keep their existing native Server Actions. */
export async function fetchServiceInbox(scope:{companyId:string;actorId:string}):Promise<ServiceInboxSnapshot>{
 try{
  const response=await fetch(`/api/inbox/read?${new URLSearchParams(scope)}`,{method:'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(45000)});
  if(!response.ok)return {ok:false,code:response.status===409?'SCOPE_CHANGED':'UNAVAILABLE'};
  const result=await response.json() as ServiceInboxSnapshot;
  if(!result||typeof result.ok!=='boolean')return {ok:false,code:'UNAVAILABLE'};
  if(result.ok&&(result.companyId!==scope.companyId||result.actorId!==scope.actorId))return {ok:false,code:'SCOPE_CHANGED'};
  return result;
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
