import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";
import {billingUuid} from "@/lib/billing/wiring/public-offer-policy";
import {externalSendAllowed,metaGraphVersion,whatsappRoutingMode} from "./config";
import {sendWhatsappText} from "./send";
export const FIXED_ACK_TEXT="أهلًا بيك 👋 شكرًا لتواصلك معانا، استلمنا رسالتك وفريقنا هيرد عليك قريبًا.";
export type FixedAckConfig={companyId:string;phoneNumberId:string;recipientWaId:string};
export type FixedAckRpc={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
export function fixedAckConfig():FixedAckConfig|null{
 const companyId=process.env.WHATSAPP_FIXED_ACK_COMPANY_ID?.trim(),phoneNumberId=process.env.WHATSAPP_FIXED_ACK_PHONE_NUMBER_ID?.trim(),recipientWaId=process.env.WHATSAPP_FIXED_ACK_RECIPIENT_WA_ID?.trim();
 if(process.env.WHATSAPP_FIXED_ACK_ENABLED!=="true"||process.env.WHATSAPP_WORKER_ENABLED!=="true"||!externalSendAllowed()||whatsappRoutingMode()!=="tenant_registry"||!metaGraphVersion()
 ||!billingUuid(companyId)||!phoneNumberId||!recipientWaId||!/^\d{6,20}$/.test(phoneNumberId)||!/^\d{7,20}$/.test(recipientWaId))return null;
 return {companyId:companyId!,phoneNumberId,recipientWaId};
}
export async function runFixedAcknowledgementBatch(config:FixedAckConfig,injected?:FixedAckRpc){
 const result={processed:0,accepted:0,delivered:0,code:"COMPLETE"};
 const client=injected??createAdminClient() as unknown as FixedAckRpc|null;if(!client)return {...result,code:"STORE_NOT_CONFIGURED"};
 async function rpc(name:string,args:Record<string,unknown>){const r=await client!.rpc(name,args);const d=object(r.data);if(r.error||!d||d.ok!==true)throw Error("FIXED_ACK_UNAVAILABLE");return d;}
 const scope={p_company_id:config.companyId,p_phone_number_id:config.phoneNumberId,p_recipient_wa_id:config.recipientWaId};
 try{
 const repair=await rpc("whatsapp_repair_fixed_ack",scope);if(!Number.isSafeInteger(repair.repaired)||!Number.isSafeInteger(repair.pending)||Number(repair.repaired)<0||Number(repair.pending)<0||Number(repair.repaired)+Number(repair.pending)>3)return {...result,code:"REPAIR_UNAVAILABLE"};
 const batch=await rpc("whatsapp_claim_fixed_ack",scope);if(!Array.isArray(batch.jobs)||batch.jobs.length>1)return {...result,code:"CLAIM_REJECTED"};
 for(const v of batch.jobs){const job=object(v);if(!job||!billingUuid(job.job_id)||!billingUuid(job.claim_token)||job.company_id!==config.companyId)return {...result,code:"CLAIM_REJECTED"};
 result.processed++;const binding={p_job_id:job.job_id,p_claim_token:job.claim_token};
 const staged=await rpc("whatsapp_stage_fixed_ack",binding);const preview=object(staged.intent);
 if(!preview||preview.body!==FIXED_ACK_TEXT||preview.response_kind!=="fixed_ack_v1")return {...result,code:"RESPONSE_BINDING_REJECTED"};
 const claimed=await rpc("whatsapp_claim_fixed_ack_send",binding);const i=object(claimed.intent);
 if(!i||!billingUuid(i.id)||i.id!==preview.id||i.company_id!==config.companyId||!billingUuid(i.conversation_id)||i.phone_number_id!==config.phoneNumberId||i.recipient_wa_id!==config.recipientWaId
 ||i.response_kind!=="fixed_ack_v1"||i.body!==FIXED_ACK_TEXT||!billingUuid(i.link_id)||!Number.isSafeInteger(i.link_generation)||Number(i.link_generation)<1)return {...result,code:"RESPONSE_BINDING_REJECTED"};
 if(claimed.claimed!==true)return {...result,code:"SEND_REQUIRES_REVIEW"};if(!billingUuid(claimed.attempt_token)||i.outcome!=="attempting")return {...result,code:"SEND_CAPABILITY_MISSING"};
 const secret=await rpc("whatsapp_read_link_access_secret",{p_company_id:config.companyId,p_link_id:i.link_id,p_phone_number_id:i.phone_number_id,p_link_generation:i.link_generation});
 if(secret.company_id!==i.company_id||secret.link_id!==i.link_id||secret.phone_number_id!==i.phone_number_id||secret.link_generation!==i.link_generation||typeof secret.access_token!=="string"||!secret.access_token.trim())return {...result,code:"SECRET_BINDING_REJECTED"};
 // Last await before transport is the one-time DB dispatch capability. No AI executor exists in this module.
 const auth=await rpc("whatsapp_authorize_fixed_ack",{...binding,p_intent_id:i.id,p_attempt_token:claimed.attempt_token});const expires=typeof auth.service_window_expires_at==="string"?Date.parse(auth.service_window_expires_at):NaN;
 if(auth.intent_id!==i.id||auth.company_id!==i.company_id||auth.conversation_id!==i.conversation_id||auth.phone_number_id!==i.phone_number_id||auth.recipient_wa_id!==i.recipient_wa_id||auth.link_id!==i.link_id||auth.link_generation!==i.link_generation||auth.response_kind!=="fixed_ack_v1"||!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+86400000)return {...result,code:"DISPATCH_REJECTED"};
 let sent;try{sent=await sendWhatsappText({toWaId:config.recipientWaId,body:FIXED_ACK_TEXT,phoneNumberId:config.phoneNumberId,accessToken:secret.access_token,serviceWindowExpiresAt:auth.service_window_expires_at as string});}catch{sent={ok:false as const,code:"AMBIGUOUS" as const};}
 const outcome=sent.ok?"accepted":["GRAPH_REJECTED","SEND_DISABLED","NEEDS_SETUP","SERVICE_WINDOW_CLOSED"].includes(sent.code)?"rejected":"unknown";
 const final={p_intent_id:i.id,p_attempt_token:claimed.attempt_token,p_result:outcome,p_wa_message_id:sent.ok?sent.waMessageId:null,p_error_code:outcome==="unknown"?"fixed_ack_unknown":!sent.ok&&sent.detail==="graph_190"?"graph_190":null,p_actor_user_id:null};
 if(sent.ok)result.accepted++;
 await rpc("finalize_whatsapp_send_attempt",final);
 if(outcome==="unknown")result.code="SEND_REQUIRES_REVIEW";
 if(outcome==="rejected")result.code="SEND_REJECTED";
 try{const settled=await rpc("billing_finalize_automated_usage",{p_company_id:config.companyId,p_intent_id:i.id});if(settled.status!==outcome&&!(outcome==="rejected"&&settled.status==="released"))result.code="ACCOUNTING_PENDING";}catch{result.code="ACCOUNTING_PENDING";}
 }
 return result;
 }catch{return {...result,code:"FIXED_ACK_UNAVAILABLE"};}
}
