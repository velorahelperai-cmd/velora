import type {readServiceInbox} from './service-inbox-actions';
export type ServiceInboxSnapshot=Awaited<ReturnType<typeof readServiceInbox>>;

/** Read-only fetch; writes keep their existing native Server Actions. */
export async function fetchServiceInbox(scope:{companyId:string;actorId:string}):Promise<ServiceInboxSnapshot|{ok:false;code:'UNAVAILABLE';transportUnavailable:true}>{
 try{
  let response:Response;
  try{response=await fetch(`/api/inbox/read?${new URLSearchParams(scope)}`,{method:'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(45000)});}catch{return {ok:false,code:'UNAVAILABLE',transportUnavailable:true};}
  if(response.status===409)return {ok:false,code:'SCOPE_CHANGED'};
  if(response.status===401||response.status===403)return {ok:false,code:'FORBIDDEN'};
  // Preview/platform request budget exhaustion is transport loss; keep the last verified list.
  if(response.status===503||response.status===504||response.status===408)return {ok:false,code:'UNAVAILABLE',transportUnavailable:true};
  if(!response.ok)return {ok:false,code:'UNAVAILABLE'};
  const result=await response.json() as ServiceInboxSnapshot;
  if(!result||typeof result.ok!=='boolean')return {ok:false,code:'UNAVAILABLE'};
  if(result.ok&&(result.companyId!==scope.companyId||result.actorId!==scope.actorId))return {ok:false,code:'SCOPE_CHANGED'};
  const clean={...result} as typeof result & {transportUnavailable?:unknown};
  delete clean.transportUnavailable;
  return clean;
 }catch{return {ok:false,code:'UNAVAILABLE'};}
}
