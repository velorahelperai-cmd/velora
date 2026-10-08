import "server-only";
import { buildAnswerSystemPrompt,formatAnswerUserPrompt } from "../adapters/prompt";
import { MultiModelAIRouter } from "../routing/router";
import type { AIModelId,AnswerContextChunk } from "../types";
import { priceRealUsage,realModelPricing,reserveRealCost } from "./economics";
import { callRealModel,type RealProviderResult } from "./provider";
import { createRealRuntimeStore,type RealRuntimeStore,type ReservedRuntimeStore } from "./store";
import { ANSWER_MAX_CONTEXT_CHARS,ANSWER_MAX_QUESTION_CHARS,ANSWER_MAX_SOURCES } from "../constants";
import { REAL_OUTPUT_LIMIT } from "./economics";
import { matchesRequestedModel } from "../adapters/response-identity";
export type RealAnswerPayload = {question:string;locale:"ar"|"en";chunks:AnswerContextChunk[];model?:AIModelId;maxOutputTokens?:number;maxCostBaisa?:number};
export type RealAnswerInput = RealAnswerPayload & {actorId:string;sessionId:string;companyId:string;executionId:string;usageMode:"admin_test"|"company_live"};
export type RealAttempt = {id:string;model:AIModelId;status:string;costUsd:number|null;costBaisa:number|null;latencyMs:number;errorCode?:string;message?:string;usage?:RealProviderResult["usage"];requestId?:string;responseId?:string;actualModelId?:string};
function validPayload(input:RealAnswerPayload) {
 const maxOutputTokens=input.maxOutputTokens??REAL_OUTPUT_LIMIT,maxCostBaisa=input.maxCostBaisa??1000;
 return typeof input.question==="string"&&!!input.question.trim()&&input.question.length<=ANSWER_MAX_QUESTION_CHARS&&
  ["ar","en"].includes(input.locale)&&Array.isArray(input.chunks)&&input.chunks.length<=ANSWER_MAX_SOURCES&&
  !input.chunks.some(c=>!c||typeof c.text!=="string"||typeof c.title!=="string"||!c.sourceId||!Number.isSafeInteger(c.contentVersion)||c.contentVersion<1||!c.text.trim())&&
  input.chunks.reduce((sum,c)=>sum+c.title.length+c.text.length,0)<=ANSWER_MAX_CONTEXT_CHARS&&
  (input.model===undefined||["gpt-6-luna","gpt-6.1-sol","gemini-3.8-flash"].includes(input.model))&&
  Number.isSafeInteger(maxOutputTokens)&&maxOutputTokens>=1&&maxOutputTokens<=REAL_OUTPUT_LIMIT&&Number.isFinite(maxCostBaisa)&&maxCostBaisa>0&&maxCostBaisa<=1000;
}
export async function executeRealAnswer(input:RealAnswerInput,deps?:{store:RealRuntimeStore;call:typeof callRealModel}) {
 const attempts:RealAttempt[]=[];
 if(input.usageMode==="company_live")return {ok:false as const,error:"LIVE_AI_DISABLED",attempts};
 if(input.usageMode!=="admin_test"||!input.actorId?.trim()||!input.sessionId?.trim()||!input.companyId?.trim()||!input.executionId?.trim()||!validPayload(input))return {ok:false as const,error:"INVALID_INPUT",attempts};
 let store:RealRuntimeStore;
 try{store=deps?.store??createRealRuntimeStore();}catch{return {ok:false as const,error:"PERSISTENCE_UNAVAILABLE",attempts};}
 return executeReservedRealAnswer(input,{store:{reserve:i=>store.reserve({...i,executionId:input.executionId,actorId:input.actorId,sessionId:input.sessionId,companyId:input.companyId,usageMode:input.usageMode}),start:id=>store.start(id),settle:i=>store.settle(i)},call:deps?.call??callRealModel});
}

/** Shared paid loop. Its callers supply their distinct durable authorization store. */
export async function executeReservedRealAnswer(input:RealAnswerPayload,deps:{store:ReservedRuntimeStore;call:typeof callRealModel;requireProviderIdentity?:boolean}) {
 const attempts:RealAttempt[]=[];
 const maxOutputTokens=input.maxOutputTokens??REAL_OUTPUT_LIMIT,maxCostBaisa=input.maxCostBaisa??1000;
 if(!validPayload(input))return {ok:false as const,error:"INVALID_INPUT",attempts};
 const {store,call}=deps;
 const models=new MultiModelAIRouter().getEligibleModels({question:input.question,locale:input.locale,chunks:input.chunks,forceModelId:input.model});
 const system=buildAnswerSystemPrompt(input.locale),prompt=formatAnswerUserPrompt(input.question,input.chunks,input.locale);
 const sourceCitations=input.chunks.map(({sourceId,title,contentVersion})=>({sourceId,title,contentVersion}));
 for(const [index,model] of models.entries()){
  const id=crypto.randomUUID(),pricing=realModelPricing(model),reservedBaisa=reserveRealCost(model,system,prompt,pricing);
  if(reservedBaisa>maxCostBaisa)return {ok:false as const,error:"TEST_COST_LIMIT_EXCEEDED",attempts};
  let reservation;
  try{reservation=await store.reserve({id,attempt:index+1,model,provider:model==="gemini-3.8-flash"?"google":"openai",reservedBaisa,pricingVersion:pricing.version,pricingSnapshot:pricing,sourceCitations});}
  catch{return {ok:false as const,error:"PERSISTENCE_OR_AUTHORIZATION_FAILED",attempts};}
  if(reservation?.ok!==true)return {ok:false as const,error:reservation?.code??"RESERVATION_FAILED",attempts};
  try{if(!await store.start(id)){
   if(!await store.settle({id,status:"rejected",costUsd:0,costBaisa:0,usage:{},errorCode:"AUTHORIZATION_CHANGED_BEFORE_EXECUTION",latencyMs:0}))return {ok:false as const,error:"LEDGER_WRITE_FAILED",attempts};
   return {ok:false as const,error:"AUTHORIZATION_CHANGED_BEFORE_EXECUTION",attempts};
  }}catch{return {ok:false as const,error:"LEDGER_WRITE_FAILED",attempts};}
  let result:RealProviderResult;
  try{result=await call({model,system,prompt,maxOutputTokens});}catch{result={status:"uncertain",text:"",errorCode:"PROVIDER_NETWORK_ERROR",latencyMs:0};}
  if(!result||!["success","incomplete","rejected","uncertain"].includes(result.status)||typeof result.text!=="string"||!Number.isSafeInteger(result.latencyMs)||result.latencyMs<0)result={status:"uncertain",text:"",errorCode:"INVALID_PROVIDER_RESULT",latencyMs:0};
  if(result.status==="success"&&!result.text.trim())result={...result,status:"incomplete"};
  let cost:{costUsd:number|null;costBaisa:number|null}={costUsd:null,costBaisa:null};
  if((deps.requireProviderIdentity&&["success","incomplete"].includes(result.status)&&!result.actualModelId)||!matchesRequestedModel(result.actualModelId,model))result={...result,status:"uncertain",text:"",errorCode:result.actualModelId?"PROVIDER_MODEL_MISMATCH":"PROVIDER_MODEL_MISSING"};
  else if(result.usage){try{cost=priceRealUsage(result.usage,pricing);}catch{result={...result,status:"uncertain",text:"",errorCode:"INVALID_PROVIDER_USAGE"};}}
  else if(result.status==="rejected")cost={costUsd:0,costBaisa:0};
  else result={...result,status:"uncertain",text:"",errorCode:result.errorCode??"PROVIDER_USAGE_MISSING"};
  const attempt={id,model,status:result.status,...cost,latencyMs:result.latencyMs,errorCode:result.errorCode,message:result.message,usage:result.usage,requestId:result.requestId,responseId:result.responseId,actualModelId:result.actualModelId};attempts.push(attempt);
  try{if(!await store.settle({...attempt,usage:result.usage??{},responseText:result.status==="success"?result.text:undefined}))return {ok:false as const,error:"SETTLEMENT_ALREADY_COMPLETED",attempts};}
  catch{return {ok:false as const,error:"SETTLEMENT_PENDING_RECONCILIATION",attempts};}
  if(result.status==="success"||result.status==="incomplete")return {ok:true as const,text:result.text,complete:result.status==="success",model,attempts};
  // A timeout/5xx can have consumed tokens. Never retry an uncertain execution.
  if(result.status==="uncertain"||input.model||!["KEY_MISSING","PROVIDER_HTTP_403","PROVIDER_HTTP_404"].includes(result.errorCode??""))break;
 }
 return {ok:false as const,error:attempts.at(-1)?.errorCode??"PROVIDER_UNAVAILABLE",attempts};
}
export type RealAnswerResult = Awaited<ReturnType<typeof executeReservedRealAnswer>>;
