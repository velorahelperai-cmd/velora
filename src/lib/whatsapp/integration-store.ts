import "server-only";
import {createAdminClient} from "@/lib/supabase/admin";
import {loadApprovedAnswerContext,verifyAnswerCitationsStillValid} from "@/lib/answers/context";
import {isLiveAnsweringEnabled} from "@/lib/answers/guards";
import {createClaimedWhatsappAnswerExecutor} from "@/lib/answers/runtime/whatsapp-cost";
import {externalSendAllowed,whatsappRoutingMode} from "./config";
import {sendWhatsappText} from "./send";
import type {IntegrationFrame,IntegrationPorts,VerificationResult} from "./integration-worker";
import {WorkerInputError} from "./integration-worker";
import {canonicalizeRpcWorkerCode} from "./worker-codes";
import {readServiceWindow} from "./service-window";
import {bindOperationalRecipient} from "./operational-recipient";
import {recordWorkerTiming} from "./worker-timing";
import {validateLiveTestScope} from "./live-test-gate";
import {continuityAckGate} from "./response-continuity";
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
 // A failed refresh must not leave an earlier frame eligible for reserve/send.
 cachedFrame=null;
 await bindOperationalRecipient(rpc,binding);
 const r=object(await rpc("billing_load_worker_frame",args));const d=object(r?.data);
 if(r?.ok!==true){const mapped=canonicalizeRpcWorkerCode(r?.code);if(mapped)throw new WorkerInputError(mapped);return null;}if(!d)return null;
 if(d.authority!==undefined&&d.authority!=="es02")return null;
 const ids=["job_id","company_id","message_id","conversation_id","phone_number_id","recipient_wa_id","link_id","question"];
 if(ids.some(k=>typeof d[k]!=="string"||!String(d[k]).trim())||d.job_id!==binding.jobId||d.company_id!==binding.companyId||
 !Number.isSafeInteger(d.automation_generation)||Number(d.automation_generation)<0||!Number.isSafeInteger(d.link_generation)||Number(d.link_generation)<1)return null;
 const scope=validateLiveTestScope({companyId:String(d.company_id),recipientWaId:String(d.recipient_wa_id),branchId:typeof d.branch_id==="string"?d.branch_id:null,createdAt:typeof d.created_at==="string"?d.created_at:null});
 if(!scope.ok)return null;
 if(d.staged_citations!==null&&(!Array.isArray(d.staged_citations)||d.staged_citations.some(c=>{const x=object(c);return !x||typeof x.sourceId!=="string"||typeof x.title!=="string"||!Number.isSafeInteger(x.contentVersion)||Number(x.contentVersion)<1;})))return null;
 for(const key of ["ai_status","reply_text","ai_attempt_id","intent_id"])if(d[key]!==null&&typeof d[key]!=="string")return null;
 if(!admin)return null;
 const expires=await readServiceWindow(admin,{companyId:String(d.company_id),conversationId:String(d.conversation_id),phoneNumberId:String(d.phone_number_id),recipientWaId:String(d.recipient_wa_id)});
 if(!expires)throw new WorkerInputError("SERVICE_WINDOW_CLOSED");
 d.service_window_expires_at=expires;
 cachedFrame=d as unknown as IntegrationFrame;return cachedFrame;
 }
 const executor=createClaimedWhatsappAnswerExecutor();
 return {enabled,frame,
 context:async f=>{
  if(!admin)return null;
  try{
   const c=await loadApprovedAnswerContext(f.company_id,admin,{question:f.question,jobId:f.job_id,claimToken:binding.claimToken});
   if(c.ok)return c.chunks;
   if(c.code==="NO_KNOWLEDGE")return [];
   return null;
  }catch{return null;}
 },
 history:async f=>{
  if(!admin||!("from" in admin)||typeof (admin as {from:unknown}).from!=="function"||!f.company_id||!f.conversation_id||!f.message_id)return [];
  try{
   const query=admin as unknown as {from:(table:string)=>{select:(cols:string)=>{eq:(c1:string,v1:unknown)=>{eq:(c2:string,v2:unknown)=>{eq?:(c3:string,v3:unknown)=>{maybeSingle:()=>PromiseLike<{data:Record<string,unknown>|null;error:unknown}>};lt?:(c3:string,v3:unknown)=>{order:(o:string,opt:{ascending:boolean})=>{limit:(n:number)=>PromiseLike<{data:Array<Record<string,unknown>>|null;error:unknown}>}};lte?:(c3:string,v3:unknown)=>{order:(o:string,opt:{ascending:boolean})=>{limit:(n:number)=>PromiseLike<{data:Array<Record<string,unknown>>|null;error:unknown}>}};order?:(o:string,opt:{ascending:boolean})=>{limit:(n:number)=>PromiseLike<{data:Array<Record<string,unknown>>|null;error:unknown}>}}}}}};
   const {data:curr,error:currErr}=await query.from("whatsapp_messages").select("id, arrival_sequence, received_at, created_at").eq("id",f.message_id).eq("company_id",f.company_id).eq!("conversation_id",f.conversation_id).maybeSingle();
   if(currErr)return [];

   let rawList:Array<Record<string,unknown>>=[];
   const currSeq=curr&&curr.arrival_sequence!==null&&curr.arrival_sequence!==undefined?Number(curr.arrival_sequence):null;
   if(currSeq!==null&&Number.isFinite(currSeq)){
    const {data,error}=await query.from("whatsapp_messages").select("id, body, direction, sender, arrival_sequence, received_at").eq("company_id",f.company_id).eq("conversation_id",f.conversation_id).lt!("arrival_sequence",currSeq).order("arrival_sequence",{ascending:false}).limit(6);
    if(error||!Array.isArray(data))return [];
    rawList=data;
   }else{
    const refReceived=typeof curr?.received_at==="string"?curr.received_at:(typeof f.created_at==="string"?f.created_at:new Date().toISOString());
    const {data,error}=await query.from("whatsapp_messages").select("id, body, direction, sender, arrival_sequence, received_at").eq("company_id",f.company_id).eq("conversation_id",f.conversation_id).lte!("received_at",refReceived).order("received_at",{ascending:false}).limit(8);
    if(error||!Array.isArray(data))return [];
    rawList=data.filter(m=>{
     if(m.id===f.message_id)return false;
     if(!curr)return true;
     if(typeof m.received_at==="string"&&typeof curr.received_at==="string"){
      if(m.received_at<curr.received_at)return true;
      if(m.received_at>curr.received_at)return false;
      return String(m.id)<String(curr.id);
     }
     return true;
    });
   }

   const past=rawList.filter(m=>m.id!==f.message_id&&typeof m.body==="string"&&String(m.body).trim()).slice(0,4).reverse();
   let totalChars=0;
   const maxTotal=1100,maxTurn=300;
   const turns:Array<{role:"customer"|"assistant";text:string}>=[];
   for(const m of past){
    const text=String(m.body).trim().slice(0,maxTurn);
    if(totalChars+text.length>maxTotal){
     const rem=maxTotal-totalChars;
     if(rem>20){
      turns.push({role:m.direction==="inbound"||m.sender==="customer"?"customer":"assistant",text:text.slice(0,rem)});
      totalChars+=rem;
     }
     break;
    }
    turns.push({role:m.direction==="inbound"||m.sender==="customer"?"customer":"assistant",text});
    totalChars+=text.length;
   }
   return turns;
  }catch{return [];}
 },
 verify:async(f,citations):Promise<VerificationResult>=>{
  if(injectedClient===undefined&&!workerRolloutEnabled())return {ok:false,code:"WORKER_DISABLED"};
  let active:unknown;
  try{active=await rpc("whatsapp_worker_live_active",{});}
  catch{return {ok:false,code:"WORKER_UNAVAILABLE"};}
  if(active===false)return {ok:false,code:"WORKER_DISABLED"};
  if(active!==true)return {ok:false,code:"WORKER_UNAVAILABLE"};
  const current=await frame();
  if(!current||!admin||f.job_id!==binding.jobId||f.company_id!==binding.companyId||current.authority!==f.authority||current.conversation_id!==f.conversation_id||current.automation_generation!==f.automation_generation||current.link_id!==f.link_id||current.link_generation!==f.link_generation)return {ok:false,code:"KNOWLEDGE_OR_AUTOMATION_CHANGED"};
  const scope=validateLiveTestScope({companyId:current.company_id,recipientWaId:current.recipient_wa_id,branchId:current.branch_id,createdAt:current.created_at});
  if(!scope.ok)return {ok:false,code:"KNOWLEDGE_OR_AUTOMATION_CHANGED"};
  if(current.authority==="es02"){
   try{const proof=object(await rpc("es02_verify_claimed_reply_citations",{...args,p_source_citations:citations}));
   if(proof?.ok===true&&proof.company_id===current.company_id&&proof.job_id===current.job_id)return {ok:true};
   return {ok:false,code:"KNOWLEDGE_OR_AUTOMATION_CHANGED"};
   }catch{return {ok:false,code:"KNOWLEDGE_OR_AUTOMATION_CHANGED"};}
  }
  if(!citations.length)return {ok:true};
  // Revalidate the original citation snapshot directly, even during draft recovery.
  // A new query result may never substitute different versions or require loading the whole corpus.
  const valid=await verifyAnswerCitationsStillValid(f.company_id,citations.map(c=>({...c,text:"citation snapshot"})),admin);
  if(!valid)return {ok:false,code:"KNOWLEDGE_OR_AUTOMATION_CHANGED"};
  return {ok:true};
 },
 secret:async f=>{const r=object(await rpc("whatsapp_read_link_access_secret",{p_company_id:f.company_id,p_link_id:f.link_id,p_phone_number_id:f.phone_number_id,p_link_generation:f.link_generation}));
 return r?.ok===true&&r.company_id===f.company_id&&r.link_id===f.link_id&&r.phone_number_id===f.phone_number_id&&r.link_generation===f.link_generation&&typeof r.access_token==="string"&&r.access_token.trim()?r.access_token:null;},
 reserve:async()=>{
 // Fresh generation reserves message capacity and model cost together in the
 // runtime store. Recovery revalidates the original already-paid draft's quota.
 if(!cachedFrame)return false;
 return cachedFrame.ai_status!=="success"||object(await rpc("whatsapp_reserve_job_usage",args))?.ok===true;
 },
 answer:async(f,chunks,history)=>executor({jobId:f.job_id,claimToken:binding.claimToken,question:f.question,chunks,history,locale:binding.locale??"ar",maxOutputTokens:512}),
 stage:async(attempt,citations)=>{const r=object(await rpc("whatsapp_stage_job_reply",{...args,p_ai_attempt_id:attempt,p_citations:citations}));return r?.ok===true&&typeof r.intent_id==="string"?r.intent_id:null;},
 claimSend:async()=>{const r=object(await rpc("whatsapp_claim_assistant_job_send",args));if(!r||r.ok!==true)return {ok:false};const i=object(r.intent);
 if(!i||["id","outcome","company_id","conversation_id","phone_number_id","recipient_wa_id","body"].some(k=>typeof i[k]!=="string"))return {ok:false};
 return {ok:true,claimed:r.claimed===true,attempt_token:typeof r.attempt_token==="string"?r.attempt_token:null,intent:i as unknown as NonNullable<Awaited<ReturnType<IntegrationPorts["claimSend"]>>["intent"]>};},
 send:async(i,secret)=>{if(!cachedFrame||i.company_id!==cachedFrame.company_id)return {ok:false,code:"NEEDS_SETUP"};
 const scope=validateLiveTestScope({companyId:i.company_id,recipientWaId:i.recipient_wa_id});
 if(!scope.ok)return {ok:false,code:"SEND_DISABLED"};
 if(i.body!==i.body.trim()||i.body.length>4096)return {ok:false,code:"GRAPH_REJECTED"};
 if(!admin)return {ok:false,code:"SERVICE_WINDOW_CLOSED"};
 const expires=await readServiceWindow(admin,{companyId:i.company_id,conversationId:i.conversation_id,phoneNumberId:i.phone_number_id,recipientWaId:i.recipient_wa_id});
 if(!expires)return {ok:false,code:"SERVICE_WINDOW_CLOSED"};
 const sent=await sendWhatsappText({toWaId:i.recipient_wa_id,body:i.body,phoneNumberId:i.phone_number_id,accessToken:secret,serviceWindowExpiresAt:expires,onTransportStart:()=>recordWorkerTiming(binding.jobId,"send_started_at")});
 return sent;},
 finalize:async(id,token,result,wamid,errorCode)=>object(await rpc("finalize_whatsapp_send_attempt",{p_intent_id:id,p_attempt_token:token,p_result:result,p_wa_message_id:wamid,p_error_code:errorCode??(result==="unknown"?"worker_unknown":null),p_actor_user_id:null}))?.ok===true,
  abortSend:async(id,token)=>{
   if(!admin)return false;
   try{
    if("from" in admin&&typeof(admin as unknown as {from:(table:string)=>unknown}).from==="function"){
     const query=admin as unknown as {from:(table:string)=>{update:(values:Record<string,unknown>)=>{eq:(col:string,val:unknown)=>{eq:(col2:string,val2:unknown)=>{eq:(col3:string,val3:unknown)=>{select:(cols:string)=>PromiseLike<{data:Array<{id:string}>|null;error:unknown}>}}}}}};
     const {data,error}=await query.from("whatsapp_send_intents").update({outcome:"ready",attempt_token:null,attempt_started_at:null,attempt_expires_at:null}).eq("id",id).eq("attempt_token",token).eq("outcome","attempting").select("id");
     return !error && Array.isArray(data) && data.length === 1;
    }
    return false;
   }catch{return false;}
  },
 finish:async id=>{const r=object(await rpc("billing_finalize_automated_usage",{p_company_id:binding.companyId,p_intent_id:id}));if(r?.ok!==true)throw Error("USAGE_SETTLEMENT_PENDING");return String(r.status);},
 repair:async id=>object(await rpc("retry_whatsapp_send_persist",{p_intent_id:id,p_actor_user_id:null}))?.ok===true,
 retry:async(code,uncertain,permanent)=>{const result=object(await rpc("whatsapp_retry_inbound_job",{...args,p_code:code,p_uncertain:uncertain,p_terminal:permanent??false}));
 if(result?.ok!==true||!["retry_wait","dead_letter","review_required"].includes(String(result.status)))throw Error("JOB_DISPOSITION_UNCONFIRMED");},
 heartbeat:async()=>await rpc("whatsapp_heartbeat_inbound_job",args)===true,
 noteContinuity:async plan=>{
  if(!client)return;
  const action=plan.phase==="ACK_DUE"?"schedule":plan.phase==="CANCELLED"?"cancel":null;
  if(!action||(action==="schedule"&&!continuityAckGate().open))return;
  try{await client.rpc("whatsapp_note_continuity",{p_job_id:binding.jobId,p_claim_token:binding.claimToken,p_action:action});}catch{/* A ledger note must not send or fail the answer. */}
 }};
}
