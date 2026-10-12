'use server';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {getCompanyAccess} from '@/lib/tenancy/access';
import type {InstagramRpcClient} from './connection-store';
import type {InstagramSendFailureCode,InstagramSendProgress} from './send-contracts';
import {captureSendProgress,sendObject,sendText,sendTextHash,sendUuid} from './send-validation';
import {createInstagramSendStore} from './send-store';
import {dispatchInstagramIntent} from './send-flow';
import {instagramConfig} from './config';
import {sendInstagramText} from './meta';
type Ref=Readonly<{companyId:string;conversationId:string;intentId:string}>;
type Failure={ok:false;code:InstagramSendFailureCode|'WORKSPACE_CHANGED'|'SCHEMA_UNAVAILABLE'};
type Saved=InstagramSendProgress&Readonly<{text:string}>;
type SavedResult={ok:true;data:Saved}|Failure;
const fail=(code:Failure['code']):Failure=>({ok:false,code});
function reference(v:unknown,withText=false):v is Ref&{text:string}{
 const keys=withText?['companyId','conversationId','intentId','text']:['companyId','conversationId','intentId'];
 return sendObject(v)&&Object.keys(v).length===keys.length&&keys.every(k=>k in v)
  &&[v.companyId,v.conversationId,v.intentId].every(sendUuid)&&(!withText||sendText(v.text));
}
async function native(companyId:string){
 const access=await getCompanyAccess();
 if(!access.ok)return fail('FORBIDDEN');
 if(access.context.company?.id!==companyId.toLowerCase())return fail('WORKSPACE_CHANGED');
 return {client:await createClient() as unknown as InstagramRpcClient,actor:access.context.userId.toLowerCase()};
}
function errorCode(error:unknown):Failure{
 return fail(sendObject(error)&&['PGRST202','42883'].includes(String(error.code))?'SCHEMA_UNAVAILABLE':'UNAVAILABLE');
}
function denial(data:Record<string,unknown>):Failure|null{
 if(data.ok!==false)return null;
 const codes=['FORBIDDEN','NOT_FOUND','INVALID_INPUT','CONFLICT','SEND_DISABLED','ENTITLEMENT_DENIED','WINDOW_CLOSED','BINDING_CHANGED','RECONCILIATION_REQUIRED'];
 return fail(codes.includes(String(data.code))?data.code as Failure['code']:'UNAVAILABLE');
}
async function saved(name:string,input:Ref,text?:string):Promise<SavedResult>{
 try{
  const session=await native(input.companyId);if('ok' in session)return session;
  const {data,error}=await session.client.rpc(name,{p_company_id:input.companyId.toLowerCase(),p_conversation_id:input.conversationId.toLowerCase(),p_intent_id:input.intentId.toLowerCase(),...(text===undefined?{}:{p_text:text})});
  if(error)return errorCode(error);if(!sendObject(data))return fail('UNAVAILABLE');
  const denied=denial(data);if(denied)return denied;
  if(data.ok!==true||!sendText(data.text))return fail('UNAVAILABLE');
  const progress=captureSendProgress(data),b=progress.binding;
  if(b.companyId!==input.companyId.toLowerCase()||b.conversationId!==input.conversationId.toLowerCase()||b.intentId!==input.intentId.toLowerCase()
   ||b.actorId!==session.actor||b.textHash!==sendTextHash(data.text)||(text!==undefined&&text!==data.text))return fail('UNAVAILABLE');
  return {ok:true,data:{...progress,text:data.text}};
 }catch{return fail('UNAVAILABLE');}
}
export async function saveInstagramReply(input:Ref&Readonly<{text:string}>):Promise<SavedResult>{
 if(!reference(input,true))return fail('INVALID_INPUT');
 // Snapshot before authentication awaits; client mutation cannot replace the body.
 const captured={companyId:input.companyId,conversationId:input.conversationId,intentId:input.intentId,text:input.text};
 return saved('instagram_save_reply',captured,captured.text);
}
export async function loadInstagramReply(input:Ref):Promise<SavedResult>{
 if(!reference(input))return fail('INVALID_INPUT');
 return saved('instagram_get_reply',{...input});
}
export async function sendSavedInstagramReply(input:Ref){
 if(!reference(input))return fail('INVALID_INPUT');
 const existing=await loadInstagramReply({...input});if(!existing.ok)return existing;
 // Native saved authority precedes any server credential or irreversible claim.
 if(!instagramConfig().sendEnabled)return fail('SEND_DISABLED');
 const server=createAdminClient();if(!server)return fail('UNAVAILABLE');
 const store=createInstagramSendStore(await createClient() as unknown as InstagramRpcClient,server as unknown as InstagramRpcClient);
 return dispatchInstagramIntent(existing.data.binding,{...store,enabled:()=>instagramConfig().sendEnabled,transport:claim=>sendInstagramText({
  professionalAccountId:claim.binding.accountId,recipientId:claim.binding.recipientId,text:claim.text,accessToken:claim.accessToken,
 })});
}
export async function loadInstagramSendReadiness(input:Pick<Ref,'companyId'|'conversationId'>){
 try{
  if(!sendObject(input)||!sendUuid(input.companyId)||!sendUuid(input.conversationId))return fail('INVALID_INPUT');
  const company=input.companyId.toLowerCase(),conversation=input.conversationId.toLowerCase();
  const session=await native(company);if('ok' in session)return session;
  const {data,error}=await session.client.rpc('instagram_send_readiness',{p_company_id:company,p_conversation_id:conversation});
  if(error)return errorCode(error);if(!sendObject(data))return fail('UNAVAILABLE');
  const denied=denial(data);if(denied)return denied;
  const allowed=['REPLY_PERMISSION_REQUIRED','ENTITLEMENT_DENIED','SIGNED_INBOUND_REQUIRED','TIMESTAMP_CONTRACT_UNVERIFIED','INSTALLED_SECRET_UNVERIFIED','WINDOW_CLOSED','ROLLOUT_DISABLED','BINDING_CHANGED'];
  if(data.ok!==true||!Array.isArray(data.blockers)||data.blockers.some(v=>typeof v!=='string'||!allowed.includes(v)))return fail('UNAVAILABLE');
  const blockers=[...data.blockers];if(!instagramConfig().sendEnabled&&!blockers.includes('ROLLOUT_DISABLED'))blockers.push('ROLLOUT_DISABLED');
  return {ok:true as const,data:{blockers,ready:blockers.length===0}};
 }catch{return fail('UNAVAILABLE');}
}
