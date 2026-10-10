import "server-only";
import type {AnswerContextChunk,AnswerCitation} from "@/lib/answers/types";
export type IntegrationFrame={job_id:string;company_id:string;message_id:string;conversation_id:string;phone_number_id:string;recipient_wa_id:string;
 automation_generation:number;link_id:string;link_generation:number;question:string;service_window_expires_at?:string;ai_status:string|null;reply_text:string|null;
 ai_attempt_id:string|null;intent_id:string|null;staged_citations:AnswerCitation[]|null};
export type SendIntent={id:string;outcome:string;company_id:string;conversation_id:string;phone_number_id:string;recipient_wa_id:string;body:string};
export type IntegrationPorts={enabled:boolean;frame:()=>Promise<IntegrationFrame|null>;context:(f:IntegrationFrame)=>Promise<AnswerContextChunk[]|null>;
 verify:(f:IntegrationFrame,citations:AnswerCitation[])=>Promise<boolean>;secret:(f:IntegrationFrame)=>Promise<string|null>;reserve:()=>Promise<boolean>;
 answer:(f:IntegrationFrame,chunks:AnswerContextChunk[])=>Promise<{ok:boolean;complete?:boolean;text?:string;attempts:{id:string;status?:string}[];error?:string}>;
 stage:(attempt:string,citations:AnswerCitation[])=>Promise<string|null>;
 claimSend:()=>Promise<{ok:boolean;claimed?:boolean;attempt_token?:string|null;intent?:SendIntent}>;
 send:(i:SendIntent,secret:string)=>Promise<{ok:boolean;waMessageId?:string;code?:string;detail?:string}>;
 finalize:(id:string,token:string,result:"accepted"|"rejected"|"unknown",wamid:string|null,errorCode?:"graph_190")=>Promise<boolean>;
 finish:(id:string)=>Promise<string>;repair:(id:string)=>Promise<boolean>;
 retry:(code:string,uncertain:boolean,permanent?:boolean)=>Promise<void>;heartbeat:()=>Promise<boolean>};
export type IntegrationOutcome={ok:false;code:string;jobCompleted:boolean;sendAccepted:boolean;delivered:false}|{ok:true;code:"ACCEPTED";jobCompleted:true;sendAccepted:true;delivered:false};
const blocked=(code:string):IntegrationOutcome=>({ok:false,code,jobCompleted:false,sendAccepted:false,delivered:false});
const acceptedPending=(code:string,settled=false):IntegrationOutcome=>({ok:false,code,jobCompleted:settled,sendAccepted:true,delivered:false});
export class WorkerInputError extends Error{constructor(readonly code:string){super(code);}}
export async function runPersistedInboundJob(input:{jobId:string;claimToken:string;companyId:string},ports:IntegrationPorts):Promise<IntegrationOutcome>{
 if(!ports.enabled)return blocked("WORKER_DISABLED");
 let externalAttempt=false;
 const fail=async(code:string,uncertain=false,permanent=true)=>{await ports.retry(code,uncertain,permanent);return blocked(code);};
 try{
 const frame=await ports.frame();
 if(!frame||frame.job_id!==input.jobId||frame.company_id!==input.companyId)return blocked("CLAIM_BINDING_REJECTED");
 if(["reserved","running","uncertain"].includes(frame.ai_status??""))return fail("AI_REQUIRES_RECONCILIATION",true);
 const chunks=await ports.context(frame);if(!chunks?.length)return fail("APPROVED_KNOWLEDGE_REQUIRED");
 const captured=frame.staged_citations??chunks.map(({sourceId,title,contentVersion})=>({sourceId,title,contentVersion}));
 if(!await ports.verify(frame,captured))return fail("KNOWLEDGE_OR_AUTOMATION_CHANGED");
 const secret=await ports.secret(frame);if(!secret)return fail("TENANT_SECRET_NOT_CONFIGURED");
 if(!await ports.reserve())return fail("ENTITLEMENT_OR_USAGE_DENIED");
 let attemptId=frame.ai_attempt_id;
 if(!(frame.ai_status==="success"&&frame.reply_text&&attemptId)){
 let heartbeatBusy=false;
 const timer=setInterval(()=>{if(heartbeatBusy)return;heartbeatBusy=true;void ports.heartbeat().catch(()=>false).finally(()=>{heartbeatBusy=false;});},30_000);
 let generated;
 try{generated=await ports.answer(frame,chunks);}finally{clearInterval(timer);}
 if(!generated.ok||generated.complete!==true)return fail(generated.error??"AI_REQUIRES_RECONCILIATION",
 generated.attempts.some(a=>a.status==="uncertain")||generated.error?.includes("SETTLEMENT")===true);
 attemptId=generated.attempts.at(-1)?.id??null;
 }
 if(!attemptId||!await ports.verify(frame,captured))return fail("KNOWLEDGE_OR_AUTOMATION_CHANGED");
 const intentId=frame.intent_id??await ports.stage(attemptId,captured);if(!intentId)return fail("STAGE_REJECTED");
 const claimed=await ports.claimSend();const intent=claimed.intent;
 if(!claimed.ok||!intent||intent.id!==intentId||intent.company_id!==frame.company_id||intent.conversation_id!==frame.conversation_id
 ||intent.phone_number_id!==frame.phone_number_id||intent.recipient_wa_id!==frame.recipient_wa_id)return fail("SEND_BINDING_REJECTED");
 if(claimed.claimed!==true){
 if(intent.outcome==="accepted"){
 try{if(await ports.finish(intent.id)!=="accepted")return acceptedPending("ACCEPTANCE_ACCOUNTING_PENDING");}catch{return acceptedPending("ACCEPTANCE_ACCOUNTING_PENDING");}
 try{if(!await ports.repair(intent.id))return acceptedPending("ACCEPTANCE_PERSIST_PENDING",true);}catch{return acceptedPending("ACCEPTANCE_PERSIST_PENDING",true);}
 return {ok:true,code:"ACCEPTED",jobCompleted:true,sendAccepted:true,delivered:false};}
 if(intent.outcome==="attempting")return blocked("SEND_IN_PROGRESS_REQUIRES_REVIEW");
 return fail("SEND_REQUIRES_RECONCILIATION",true);
 }
 if(!claimed.attempt_token)return fail("SEND_CAPABILITY_MISSING",true);
 // This fresh generation/link/source check is the last local gate before Graph.
 if(!await ports.verify(frame,captured)){
 await ports.finalize(intent.id,claimed.attempt_token,"rejected",null);await ports.finish(intent.id);return blocked("AUTOMATION_CHANGED_BEFORE_SEND");}
 externalAttempt=true;
 let sent;
 try{sent=await ports.send(intent,secret);}catch{sent={ok:false,code:"AMBIGUOUS"};}
 const outcome=sent.ok&&sent.waMessageId?"accepted":sent.code==="GRAPH_REJECTED"||sent.code==="SEND_DISABLED"||sent.code==="NEEDS_SETUP"||sent.code==="SERVICE_WINDOW_CLOSED"?"rejected":"unknown";
 const finalized=!sent.ok&&sent.code==="GRAPH_REJECTED"&&sent.detail==="graph_190"
 ?await ports.finalize(intent.id,claimed.attempt_token,"rejected",null,"graph_190")
 :await ports.finalize(intent.id,claimed.attempt_token,outcome,sent.waMessageId??null);
 if(!finalized)return blocked("SEND_PERSIST_REQUIRES_RECONCILIATION");
 if(outcome==="accepted"){
 try{if(await ports.finish(intent.id)!=="accepted")return acceptedPending("ACCEPTANCE_ACCOUNTING_PENDING");}catch{return acceptedPending("ACCEPTANCE_ACCOUNTING_PENDING");}
 try{if(!await ports.repair(intent.id))return acceptedPending("ACCEPTANCE_PERSIST_PENDING",true);}catch{return acceptedPending("ACCEPTANCE_PERSIST_PENDING",true);}
 return {ok:true,code:"ACCEPTED",jobCompleted:true,sendAccepted:true,delivered:false};}
 await ports.finish(intent.id);
 return blocked(outcome==="unknown"?"SEND_REQUIRES_RECONCILIATION":"SEND_REJECTED");
 }catch(error){
 if(error instanceof WorkerInputError){try{return await fail(error.code,false,true);}catch{return blocked(error.code);}}
 try{await ports.retry("WORKER_UNAVAILABLE",externalAttempt,false);}catch{/* Durable reservations and intent remain for recovery. */}
 return blocked(externalAttempt?"SEND_PERSIST_REQUIRES_RECONCILIATION":"WORKER_UNAVAILABLE");
 }
}
