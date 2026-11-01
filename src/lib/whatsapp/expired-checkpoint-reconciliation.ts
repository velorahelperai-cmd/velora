import 'server-only';
import {onboardMetaSignup,type MetaSignupConfig} from './embedded-signup-meta';

/** The reader must enforce the complete binding in a privileged database RPC. */
export type ExpiredCheckpointBinding={accountId:string;sessionId:string;companyId:string;branchId:string;attemptId:string;generation:number};
type Checkpoint={token:string;phoneNumberId:string;wabaId:string;appId:string;configId:string;graphVersion:string};
type Ports={read:(binding:ExpiredCheckpointBinding)=>Promise<Checkpoint|null>;fetcher:(url:string,init?:RequestInit)=>Promise<Response>;config:MetaSignupConfig & {configId:string}};
export type ExpiredCheckpointReviewResult={outcome:'UNKNOWN';reason:'UNAVAILABLE'|'REVIEW_REQUIRED'}|{outcome:'REVIEW_REQUIRED';evidence:'META_ACCESS_REGISTERED_SUBSCRIBED'};

/** Read-only diagnostic; no provider response currently proves closure safe. */
export async function inspectExpiredCheckpoint(binding:ExpiredCheckpointBinding,ports:Ports):Promise<ExpiredCheckpointReviewResult>{
 const unavailable:ExpiredCheckpointReviewResult={outcome:'UNKNOWN',reason:'UNAVAILABLE'};
 try{
  if(!binding.accountId||!binding.sessionId||!binding.companyId||!binding.branchId||!binding.attemptId||!Number.isSafeInteger(binding.generation)||binding.generation<1||!/^v\d+\.0$/.test(ports.config.graphVersion))return unavailable;
  const checkpoint=await ports.read(binding);
  if(!checkpoint||!checkpoint.token||!/^\d{1,64}$/.test(checkpoint.phoneNumberId)||!/^\d{1,64}$/.test(checkpoint.wabaId)||
    checkpoint.appId!==ports.config.appId||checkpoint.configId!==ports.config.configId||checkpoint.graphVersion!==ports.config.graphVersion)return unavailable;
  const getOnly:typeof ports.fetcher=async(url,init)=>{
   if(init?.method!=='GET'||!url.startsWith(`https://graph.facebook.com/${ports.config.graphVersion}/`)||url.includes('/oauth/'))throw Error('READ_ONLY_REQUIRED');
   return ports.fetcher(url,init);
  };
  const result=await onboardMetaSignup(ports.config,{code:'checkpoint-review',wabaId:checkpoint.wabaId,phoneNumberId:checkpoint.phoneNumberId,pin:'',keepOnPhone:false},getOnly,{token:checkpoint.token,readOnly:true});
  if(!result.ok)return {outcome:'UNKNOWN',reason:'REVIEW_REQUIRED'};
  const rechecked=await ports.read(binding);
  if(!rechecked||rechecked.token!==checkpoint.token||rechecked.wabaId!==checkpoint.wabaId||rechecked.phoneNumberId!==checkpoint.phoneNumberId||rechecked.appId!==checkpoint.appId||rechecked.configId!==checkpoint.configId||rechecked.graphVersion!==checkpoint.graphVersion)return unavailable;
  return {outcome:'REVIEW_REQUIRED',evidence:'META_ACCESS_REGISTERED_SUBSCRIBED'};
 }catch{return unavailable;}
}


/** Service-role-only reader. Never serialize or log its result. */
export function createExpiredCheckpointReader(client:{rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>}){
 return async(binding:ExpiredCheckpointBinding):Promise<Checkpoint|null>=>{
  try{
   const result=await client.rpc('wa_expired_checkpoint_review',{p_binding:binding});
   const row=result.data;
   if(result.error||!row||typeof row!=='object'||Array.isArray(row))return null;
   const value=row as Record<string,unknown>;
   if(value.ok!==true||typeof value.token!=='string'||!value.token||value.token.length>16384||typeof value.wabaId!=='string'||!/^\d{1,64}$/.test(value.wabaId)||typeof value.phoneNumberId!=='string'||!/^\d{1,64}$/.test(value.phoneNumberId)||typeof value.appId!=='string'||typeof value.configId!=='string'||typeof value.graphVersion!=='string')return null;
   return {token:value.token,wabaId:value.wabaId,phoneNumberId:value.phoneNumberId,appId:value.appId,configId:value.configId,graphVersion:value.graphVersion};
  }catch{return null;}
 };
}
