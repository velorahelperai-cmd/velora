import 'server-only';
import type {InstagramRpcClient} from './connection-store';
import type {InstagramSendBinding,InstagramSendResultValue,InstagramSendProgress,InstagramSendStore} from './send-contracts';
import {captureFreshSendClaim,captureSendBinding,captureSendProgress,sendDenial,sendMid,sendObject,sendText,sendTextHash,sendUnavailable,sendUuid} from './send-validation';
/** Native client is used ONLY for prepare/read; server client ONLY for irreversible
 * final claim, settlement and recovery. Awaited RPC success must mean COMMIT.
 * No retry, logging, secret-bearing action, environment token or service fallback. */
export function createInstagramSendStore(native:InstagramRpcClient,server:InstagramRpcClient):InstagramSendStore{
 async function rpc<T>(client:InstagramRpcClient,name:string,args:Record<string,unknown>,parse:(data:Record<string,unknown>)=>T):Promise<T>{
  try{const r=await client.rpc(name,args);if(r.error||!sendObject(r.data))return sendUnavailable();return parse(r.data);}catch{return sendUnavailable();}
 }
 const result=(data:Record<string,unknown>,b?:InstagramSendBinding):InstagramSendResultValue<InstagramSendProgress>=>{const denied=sendDenial(data);if(denied)return denied;if(data.ok!==true)return sendUnavailable();return {ok:true,data:captureSendProgress(data,b)};};
 return {
  async prepare(input){
   if(!sendObject(input)||![input.companyId,input.conversationId,input.intentId].every(sendUuid)||!sendText(input.text))return {ok:false,code:'INVALID_INPUT'};
   const companyId=input.companyId.toLowerCase(),conversationId=input.conversationId.toLowerCase(),intentId=input.intentId.toLowerCase(),text=input.text;
   return rpc(native,'instagram_prepare_send',{p_company_id:companyId,p_conversation_id:conversationId,p_intent_id:intentId,p_text:text},data=>{const r=result(data);if(r.ok&&(r.data.binding.companyId!==companyId||r.data.binding.conversationId!==conversationId||r.data.binding.intentId!==intentId||r.data.binding.textHash!==sendTextHash(text)))return sendUnavailable();return r;});
  },
  async read(supplied){const b=captureSendBinding(supplied);return rpc(native,'instagram_read_send',{p_binding:b},data=>result(data,b));},
  async claim(supplied){const b=captureSendBinding(supplied);return rpc(server,'instagram_claim_send',{p_binding:b},data=>{const denied=sendDenial(data);if(denied)return denied;if(data.kind==='existing')return {kind:'existing',progress:captureSendProgress(data.progress,b)};return captureFreshSendClaim(data,b);});},
  async settle(supplied,receipt,outcome){
   const b=captureSendBinding(supplied);
   if(!sendUuid(receipt)||!sendObject(outcome)||!['unknown','blocked','rejected','accepted'].includes(outcome.status)
   ||(outcome.status==='accepted'&&(outcome.recipientId!==b.recipientId||!sendMid(outcome.messageId))))return {ok:false,code:'INVALID_INPUT'};
   const captured=outcome.status==='accepted'?{status:'accepted',recipientId:outcome.recipientId,messageId:outcome.messageId}:{status:outcome.status};
   return rpc(server,'instagram_settle_send',{p_binding:b,p_claim_receipt:receipt.toLowerCase(),p_outcome:captured},data=>result(data,b));
  },
  async project(supplied){const b=captureSendBinding(supplied);return rpc(server,'instagram_project_send',{p_binding:b},data=>result(data,b));},
  async recover(supplied){const b=captureSendBinding(supplied);return rpc(server,'instagram_recover_send',{p_binding:b},data=>result(data,b));},
 };
}
