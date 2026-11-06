import "server-only";
import {createHash} from "node:crypto";
import type {AnswerContextChunk,AnswerCitation} from "@/lib/answers/types";
import {classifyHandoffPolicy} from "@/lib/answers/routing/handoff-policy";
import {classifyPureSocialSmallTalk} from "@/lib/answers/routing/small-talk";
import {recordWorkerTiming} from "./worker-timing";
import {isTransientWorkerCode} from "./worker-codes";
import {continuityAckGate,decideInboundContinuity,type ContinuityPlan,type HumanOwnership} from "./response-continuity";
export type IntegrationFrame={authority?:"es02";job_id:string;company_id:string;branch_id?:string;created_at?:string;message_id:string;conversation_id:string;phone_number_id:string;recipient_wa_id:string;
 automation_generation:number;link_id:string;link_generation:number;question:string;service_window_expires_at?:string;ai_status:string|null;reply_text:string|null;
 ai_attempt_id:string|null;intent_id:string|null;staged_citations:AnswerCitation[]|null;
 human_ownership?:HumanOwnership|null;handoff_reason?:string|null;service_window_open?:boolean;send_unknown?:boolean;inbound_elapsed_ms?:number;};
export type SendIntent={id:string;outcome:string;company_id:string;conversation_id:string;phone_number_id:string;recipient_wa_id:string;body:string};
export type VerificationFailureCode = "WORKER_DISABLED" | "WORKER_UNAVAILABLE" | "KNOWLEDGE_OR_AUTOMATION_CHANGED";
export type VerificationResult = { ok: true } | { ok: false; code: VerificationFailureCode };
export type VerifyPortResult = boolean | VerificationResult;
export type IntegrationPorts={enabled:boolean;frame:()=>Promise<IntegrationFrame|null>;context:(f:IntegrationFrame)=>Promise<AnswerContextChunk[]|null>;
 verify:(f:IntegrationFrame,citations:AnswerCitation[])=>Promise<VerifyPortResult>;secret:(f:IntegrationFrame)=>Promise<string|null>;reserve:()=>Promise<boolean>;
 answer:(f:IntegrationFrame,chunks:AnswerContextChunk[],history?:{role:"customer"|"assistant";text:string}[])=>Promise<{ok:boolean;complete?:boolean;text?:string;attempts:{id:string;status?:string}[];error?:string}>;
 stage:(attempt:string,citations:AnswerCitation[])=>Promise<string|null>;
 claimSend:()=>Promise<{ok:boolean;claimed?:boolean;attempt_token?:string|null;intent?:SendIntent}>;
 send:(i:SendIntent,secret:string)=>Promise<{ok:boolean;waMessageId?:string;code?:string;detail?:string}>;
 finalize:(id:string,token:string,result:"accepted"|"rejected"|"unknown",wamid:string|null,errorCode?:"graph_190")=>Promise<boolean>;
 abortSend?:(id:string,token:string)=>Promise<boolean>;
 finish:(id:string)=>Promise<string>;repair:(id:string)=>Promise<boolean>;
 retry:(code:string,uncertain:boolean,permanent?:boolean)=>Promise<void>;heartbeat:()=>Promise<boolean>;
 history?:(f:IntegrationFrame)=>Promise<{role:"customer"|"assistant";text:string}[]>;
 noteContinuity?:(plan:ContinuityPlan)=>Promise<void>;
 rereadOwnership?:()=>Promise<HumanOwnership|null>;};
export type IntegrationOutcome={ok:false;code:string;jobCompleted:boolean;sendAccepted:boolean;delivered:false}|{ok:true;code:"ACCEPTED";jobCompleted:true;sendAccepted:true;delivered:false};
const blocked=(code:string):IntegrationOutcome=>({ok:false,code,jobCompleted:false,sendAccepted:false,delivered:false});
const acceptedPending=(code:string,settled=false):IntegrationOutcome=>({ok:false,code,jobCompleted:settled,sendAccepted:true,delivered:false});
export class WorkerInputError extends Error{constructor(readonly code:string){super(code);}}

function isVerified(result: VerifyPortResult): result is true | { ok: true } {
  return result === true || (typeof result === "object" && result !== null && result.ok === true);
}

function verifyFailureCode(result: VerifyPortResult): VerificationFailureCode {
  if (typeof result === "object" && result !== null && !result.ok && result.code) {
    return result.code;
  }
  return "KNOWLEDGE_OR_AUTOMATION_CHANGED";
}

export async function runPersistedInboundJob(input:{jobId:string;claimToken:string;companyId:string},ports:IntegrationPorts):Promise<IntegrationOutcome>{
 if(!ports.enabled)return blocked("WORKER_DISABLED");
 let externalAttempt=false;
 const fail=async(code:string,uncertain=false,permanent=true)=>{await ports.retry(code,uncertain,permanent);return blocked(code);};
 try{
 const frame=await ports.frame();
 if(!frame||frame.job_id!==input.jobId||frame.company_id!==input.companyId)return blocked("CLAIM_BINDING_REJECTED");
 if(["reserved","running","uncertain"].includes(frame.ai_status??""))return await fail("AI_REQUIRES_RECONCILIATION",true);
 // handed_over is not a staff claim. A supplied ownership snapshot decides
 // whether a safe answer may continue. Sensitive and explicit human requests
 // still never become a generated answer. The continuity note cannot send.
 const handoff=classifyHandoffPolicy(frame.question);
 const humanReview=!!handoff.previewReason;
 const continuity=frame.human_ownership||frame.handoff_reason||frame.service_window_open===false||frame.send_unknown===true||frame.inbound_elapsed_ms!==undefined
  ? decideInboundContinuity({
    ownership:frame.human_ownership??(frame.handoff_reason?"REQUESTED_UNCLAIMED":"NONE"),
    handoffReason:frame.handoff_reason,
    previewReason:handoff.previewReason,
    elapsedMs:frame.inbound_elapsed_ms,
    answerReady:frame.ai_status==="success"&&!!frame.reply_text&&!!frame.ai_attempt_id,
    serviceWindowOpen:frame.service_window_open,
    workerEnabled:true,
    ackGateOpen:continuityAckGate().open,
    sendUnknown:frame.send_unknown===true,
    staffReplied:frame.human_ownership==="CLAIMED_ACTIVE",
   })
  :null;
 const stopAi=humanReview||continuity?.ai==="stop";
 const stopCode=continuity?.stopCode==="HUMAN_CLAIMED"?"HUMAN_CLAIMED"
  :continuity?.stopCode==="SERVICE_WINDOW_CLOSED"?"SERVICE_WINDOW_CLOSED"
  :continuity?.stopCode==="SEND_REQUIRES_RECONCILIATION"?"SEND_REQUIRES_RECONCILIATION"
  :continuity?.stopCode==="AUTHORITY_BLOCKED"?"AUTHORITY_BLOCKED"
  :"HUMAN_REVIEW_REQUIRED";
 if(ports.noteContinuity&&continuity&&(continuity.ack==="schedule"||continuity.ack==="cancel")){
  try{await ports.noteContinuity(continuity.plan);}catch{/* Ledger notes stay inside the existing send guards. */}
 }
 if(stopAi&&!frame.intent_id)return await fail(stopCode);
 if(stopAi&&!(frame.ai_status==="success"&&frame.reply_text&&frame.ai_attempt_id))return blocked("SEND_REQUIRES_RECONCILIATION");
 const social=classifyPureSocialSmallTalk(frame.question);
 let chunks:AnswerContextChunk[];
 let captured:AnswerCitation[];
 if(social.isPureSocial){
  chunks=[];
  captured=frame.staged_citations??[];
 }else{
  const raw=await ports.context(frame);
  if(raw===null){
   try{await ports.retry("RETRIEVAL_UNAVAILABLE",false,false);}catch{}
   return blocked("RETRIEVAL_UNAVAILABLE");
  }
  chunks=raw;
  captured=frame.staged_citations??(chunks.length>0?chunks.map(({sourceId,title,contentVersion})=>({sourceId,title,contentVersion})):[]);
  if(captured.length===0){
   const question_hash=createHash("sha256").update(frame.question).digest("hex").slice(0,16);
   console.info("[UNANSWERED_QUESTION_LOG]",{
    company_id:frame.company_id,
    conversation_id:frame.conversation_id,
    job_id:frame.job_id,
    question_hash,
    question_length:frame.question.length,
    timestamp:new Date().toISOString(),
   });
  }
 }
 const v1=await ports.verify(frame,captured);
 if(!isVerified(v1)){
  const code=verifyFailureCode(v1);
  if(code==="WORKER_UNAVAILABLE"){
   try{await ports.retry("WORKER_UNAVAILABLE",false,false);}catch{}
   return blocked("WORKER_UNAVAILABLE");
  }
  if(code==="WORKER_DISABLED"){
   try{await ports.retry("WORKER_DISABLED",false,false);}catch{}
   return blocked("WORKER_DISABLED");
  }
  return await fail(code);
 }
 const secret=await ports.secret(frame);if(!secret)return await fail("TENANT_SECRET_NOT_CONFIGURED");
 if(!await ports.reserve())return await fail("ENTITLEMENT_OR_USAGE_DENIED");
 let attemptId=frame.ai_attempt_id;
 if(!(frame.ai_status==="success"&&frame.reply_text&&attemptId)){
 let heartbeatBusy=false;
 const timer=setInterval(()=>{if(heartbeatBusy)return;heartbeatBusy=true;void ports.heartbeat().catch(()=>false).finally(()=>{heartbeatBusy=false;});},30_000);
 let generated;
 const history=ports.history?await ports.history(frame).catch(()=>[]):undefined;
 try{generated=await ports.answer(frame,chunks,history);}finally{clearInterval(timer);}
 if(!generated.ok||generated.complete!==true)return await fail(generated.error??"AI_REQUIRES_RECONCILIATION",
 generated.attempts.some(a=>a.status==="uncertain")||generated.error?.includes("SETTLEMENT")===true);
 attemptId=generated.attempts.at(-1)?.id??null;
 }
 if(!attemptId)return await fail("KNOWLEDGE_OR_AUTOMATION_CHANGED");
 const v2=await ports.verify(frame,captured);
 if(!isVerified(v2)){
  const code=verifyFailureCode(v2);
  if(code==="WORKER_UNAVAILABLE"){
   try{await ports.retry("WORKER_UNAVAILABLE",false,false);}catch{}
   return blocked("WORKER_UNAVAILABLE");
  }
  if(code==="WORKER_DISABLED"){
   try{await ports.retry("WORKER_DISABLED",false,false);}catch{}
   return blocked("WORKER_DISABLED");
  }
  return await fail(code);
 }
 const intentId=frame.intent_id??await ports.stage(attemptId,captured);if(!intentId)return await fail("STAGE_REJECTED");
 const claimed=await ports.claimSend();const intent=claimed.intent;
 if(!claimed.ok||!intent||intent.id!==intentId||intent.company_id!==frame.company_id||intent.conversation_id!==frame.conversation_id
 ||intent.phone_number_id!==frame.phone_number_id||intent.recipient_wa_id!==frame.recipient_wa_id)return await fail("SEND_BINDING_REJECTED");
 if(claimed.claimed!==true){
 if(intent.outcome==="accepted"){
 try{if(await ports.finish(intent.id)!=="accepted")return acceptedPending("ACCEPTANCE_ACCOUNTING_PENDING");}catch{return acceptedPending("ACCEPTANCE_ACCOUNTING_PENDING");}
 try{if(!await ports.repair(intent.id))return acceptedPending("ACCEPTANCE_PERSIST_PENDING",true);}catch{return acceptedPending("ACCEPTANCE_PERSIST_PENDING",true);}
 return {ok:true,code:"ACCEPTED",jobCompleted:true,sendAccepted:true,delivered:false};}
 if(intent.outcome==="attempting")return blocked("SEND_IN_PROGRESS_REQUIRES_REVIEW");
 return await fail("SEND_REQUIRES_RECONCILIATION",true);
 }
 if(!claimed.attempt_token)return await fail("SEND_CAPABILITY_MISSING",true);
 if(stopAi){
  if(!await ports.finalize(intent.id,claimed.attempt_token,"rejected",null))return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");
  return await fail(stopCode);
 }
 // This fresh generation/link/source check is the last local gate before Graph.
 const v3=await ports.verify(frame,captured);
 if(!isVerified(v3)){
  const code=verifyFailureCode(v3);
  if(code==="WORKER_UNAVAILABLE"){
   let aborted = false;
   if(ports.abortSend){
    try{aborted = await ports.abortSend(intent.id,claimed.attempt_token);}catch{aborted = false;}
   }
   if(aborted){
    try{await ports.retry("WORKER_UNAVAILABLE",false,false);}catch{}
    return blocked("WORKER_UNAVAILABLE");
   }else{
    try{await ports.retry("SEND_PERSIST_REQUIRES_RECONCILIATION",true,false);}catch{}
    return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");
   }
  }
  if(code==="WORKER_DISABLED"){
   try{
    if(!await ports.finalize(intent.id,claimed.attempt_token,"rejected",null))return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");
    if(await ports.finish(intent.id)!=="released")return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");
   }catch{return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");}
   try{await ports.retry("WORKER_DISABLED",false,false);}catch{}
   return blocked("WORKER_DISABLED");
  }
  try{
   if(!await ports.finalize(intent.id,claimed.attempt_token,"rejected",null))return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");
   if(await ports.finish(intent.id)!=="released")return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");
  }catch{return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");}
  return blocked("AUTOMATION_CHANGED_BEFORE_SEND");
 }
 if(ports.rereadOwnership){
  let live:HumanOwnership|null=null;
  try{live=await ports.rereadOwnership();}catch{
   try{if(!await ports.finalize(intent.id,claimed.attempt_token,"rejected",null))return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");}catch{return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");}
   return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");
  }
  if(live==="CLAIMED_ACTIVE"||live==="CLAIMED_IDLE"){
   try{
    if(!await ports.finalize(intent.id,claimed.attempt_token,"rejected",null))return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");
    if(await ports.finish(intent.id)!=="released")return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");
   }catch{return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");}
   return blocked("HUMAN_CLAIMED");
  }
 }
 externalAttempt=true;
 let sent;
 try{sent=await ports.send(intent,secret);}catch{sent={ok:false,code:"AMBIGUOUS"};}
 const outcome=sent.ok&&sent.waMessageId?"accepted":sent.code==="GRAPH_REJECTED"||sent.code==="SEND_DISABLED"||sent.code==="NEEDS_SETUP"||sent.code==="SERVICE_WINDOW_CLOSED"?"rejected":"unknown";
 if(outcome==="accepted")recordWorkerTiming(input.jobId,"provider_accepted_at");
 const finalized=!sent.ok&&sent.code==="GRAPH_REJECTED"&&sent.detail==="graph_190"
 ?await ports.finalize(intent.id,claimed.attempt_token,"rejected",null,"graph_190")
 :await ports.finalize(intent.id,claimed.attempt_token,outcome,sent.waMessageId??null);
 if(!finalized)return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");
 if(outcome==="accepted"){
 if(ports.noteContinuity){try{await ports.noteContinuity({responseKind:"ack_v1",phase:"CANCELLED",authority:"AUTHORIZED",body:null,reason:"answer_accepted"});}catch{/* Acceptance stays; ack cancellation is retried by the watchdog. */}}
 try{if(await ports.finish(intent.id)!=="accepted")return acceptedPending("ACCEPTANCE_ACCOUNTING_PENDING");}catch{return acceptedPending("ACCEPTANCE_ACCOUNTING_PENDING");}
 try{if(!await ports.repair(intent.id))return acceptedPending("ACCEPTANCE_PERSIST_PENDING",true);}catch{return acceptedPending("ACCEPTANCE_PERSIST_PENDING",true);}
 return {ok:true,code:"ACCEPTED",jobCompleted:true,sendAccepted:true,delivered:false};}
 if(outcome==="unknown")return blocked("SEND_REQUIRES_RECONCILIATION");
 let settled:string;
 try{settled=await ports.finish(intent.id);}catch{return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");}
 return blocked(settled==="released"?"SEND_REJECTED":"SEND_PERSIST_REQUIRES_RECONCILIATION");
 }catch(error){
 if(error instanceof WorkerInputError){const transient=isTransientWorkerCode(error.code);try{return await fail(error.code,false,!transient);}catch{return blocked(error.code);}}
 try{await ports.retry("WORKER_UNAVAILABLE",externalAttempt,false);}catch{/* Durable reservations and intent remain for recovery. */}
 return blocked(externalAttempt?"SEND_PERSIST_REQUIRES_RECONCILIATION":"WORKER_UNAVAILABLE");
 }
}
