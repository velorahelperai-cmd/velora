import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";
import {loadApprovedAnswerContext,verifyAnswerCitationsStillValid} from "@/lib/answers/context";
import {isLiveAnsweringEnabled} from "@/lib/answers/guards";
import {createClaimedWhatsappAnswerExecutor} from "@/lib/answers/runtime/whatsapp-cost";
import {externalSendAllowed,whatsappRoutingMode} from "./config";
import {sendWhatsappText} from "./send";
import type {IntegrationFrame,IntegrationPorts} from "./integration-worker";
import {WorkerInputError} from "./integration-worker";
type RpcClient={rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
const object=(x:unknown):Record<string,unknown>|null=>x!==null&&typeof x==="object"&&!Array.isArray(x)?x as Record<string,unknown>:null;
export function workerRolloutEnabled(){return process.env.WHATSAPP_WORKER_ENABLED==="true"&&isLiveAnsweringEnabled()&&externalSendAllowed()&&whatsappRoutingMode()==="tenant_registry";}
export function createIntegrationPorts(binding:{jobId:string;claimToken:string;companyId:string;locale?:"ar"|"en"},injectedClient?:ReturnType<typeof createAdminClient>):IntegrationPorts{
 const enabled=workerRolloutEnabled();let cachedFrame:IntegrationFrame|null=null;
 const admin=injectedClient===undefined?(enabled?createAdminClient():null):injectedClient;
 const client=admin as unknown as RpcClient|null;
 async function rpc(name:string,args:Record<string,unknown>){if(!client)throw Error("STORE_NOT_CONFIGURED");const r=await client.rpc(name,args);if(r.error)throw Error("PERSISTENCE_UNAVAILABLE");return r.data;}
 const args={p_job_id:binding.jobId,p_claim_token:binding.claimToken};
 async function frame():Promise<IntegrationFrame|null>{
 const r=object(await rpc("billing_load_worker_frame",args));const d=object(r?.data);
 if(r?.ok!==true){if(["unsupported_message","link_unavailable"].includes(String(r?.code)))throw new WorkerInputError(String(r?.code));return null;}if(!d)return null;
 const ids=["job_id","company_id","message_id","conversation_id","phone_number_id","recipient_wa_id","link_id","question"];
 if(ids.some(k=>typeof d[k]!=="string"||!String(d[k]).trim())||d.job_id!==binding.jobId||d.company_id!==binding.companyId||
 !Number.isSafeInteger(d.automation_generation)||Number(d.automation_generation)<0||!Number.isSafeInteger(d.link_generation)||Number(d.link_generation)<1)return null;
 if(d.staged_citations!==null&&(!Array.isArray(d.staged_citations)||d.staged_citations.some(c=>{const x=object(c);return !x||typeof x.sourceId!=="string"||typeof x.title!=="string"||!Number.isSafeInteger(x.contentVersion)||Number(x.contentVersion)<1;})))return null;
 for(const key of ["ai_status","reply_text","ai_attempt_id","intent_id"])if(d[key]!==null&&typeof d[key]!=="string")return null;
 cachedFrame=d as unknown as IntegrationFrame;return cachedFrame;
 }
 const executor=createClaimedWhatsappAnswerExecutor();
 return {enabled,frame,
 context:async f=>{if(!admin)return null;const c=await loadApprovedAnswerContext(f.company_id,admin);return c.ok?c.chunks:null;},
 verify:async(f,citations)=>{const current=await frame();if(!current||!admin||current.conversation_id!==f.conversation_id||current.automation_generation!==f.automation_generation||current.link_id!==f.link_id||current.link_generation!==f.link_generation)return false;
 const context=await loadApprovedAnswerContext(f.company_id,admin);if(!context.ok)return false;
 const chunks=citations.map(c=>context.chunks.find(x=>x.sourceId===c.sourceId&&x.contentVersion===c.contentVersion&&x.title===c.title));
 return chunks.every(Boolean)&&await verifyAnswerCitationsStillValid(f.company_id,chunks as NonNullable<typeof chunks[number]>[],admin);},
 secret:async f=>{const r=object(await rpc("whatsapp_read_link_access_secret",{p_company_id:f.company_id,p_link_id:f.link_id,p_phone_number_id:f.phone_number_id,p_link_generation:f.link_generation}));
 return r?.ok===true&&r.company_id===f.company_id&&r.link_id===f.link_id&&r.phone_number_id===f.phone_number_id&&r.link_generation===f.link_generation&&typeof r.access_token==="string"&&r.access_token.trim()?r.access_token:null;},
 reserve:async()=>object(await rpc("whatsapp_reserve_job_usage",args))?.ok===true,
 answer:async(f,chunks)=>executor({jobId:f.job_id,claimToken:binding.claimToken,question:f.question,chunks,locale:binding.locale??"ar",maxOutputTokens:512}),
 stage:async(attempt,citations)=>{const r=object(await rpc("whatsapp_stage_job_reply",{...args,p_ai_attempt_id:attempt,p_citations:citations}));return r?.ok===true&&typeof r.intent_id==="string"?r.intent_id:null;},
 claimSend:async()=>{const r=object(await rpc("whatsapp_claim_assistant_job_send",args));if(!r||r.ok!==true)return {ok:false};const i=object(r.intent);
 if(!i||["id","outcome","company_id","conversation_id","phone_number_id","recipient_wa_id","body"].some(k=>typeof i[k]!=="string"))return {ok:false};
 return {ok:true,claimed:r.claimed===true,attempt_token:typeof r.attempt_token==="string"?r.attempt_token:null,intent:i as unknown as NonNullable<Awaited<ReturnType<IntegrationPorts["claimSend"]>>["intent"]>};},
 send:async(i,secret)=>{if(!cachedFrame||i.company_id!==cachedFrame.company_id)return {ok:false,code:"NEEDS_SETUP"};
 if(i.body!==i.body.trim()||i.body.length>4096)return {ok:false,code:"GRAPH_REJECTED"};
 return sendWhatsappText({toWaId:i.recipient_wa_id,body:i.body,phoneNumberId:i.phone_number_id,accessToken:secret});},
 finalize:async(id,token,result,wamid)=>object(await rpc("finalize_whatsapp_send_attempt",{p_intent_id:id,p_attempt_token:token,p_result:result,p_wa_message_id:wamid,p_error_code:result==="unknown"?"worker_unknown":null,p_actor_user_id:null}))?.ok===true,
 finish:async id=>{const r=object(await rpc("billing_finalize_automated_usage",{p_company_id:binding.companyId,p_intent_id:id}));if(r?.ok!==true)throw Error("USAGE_SETTLEMENT_PENDING");return String(r.status);},
 repair:async id=>object(await rpc("retry_whatsapp_send_persist",{p_intent_id:id,p_actor_user_id:null}))?.ok===true,
 retry:async(code,uncertain,permanent)=>{await rpc("whatsapp_retry_inbound_job",{...args,p_code:code,p_uncertain:uncertain,p_terminal:permanent??false});},
 heartbeat:async()=>await rpc("whatsapp_heartbeat_inbound_job",args)===true};
}
