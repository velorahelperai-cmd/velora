import "server-only";
import { buildAnswerSystemPrompt,formatAnswerUserPrompt } from "../adapters/prompt";
import { MultiModelAIRouter } from "../routing/router";
import type { AIModelId,AnswerContextChunk } from "../types";
import { priceRealUsage,realModelPricing,reserveRealCost } from "./economics";
import { callRealModel,type RealProviderResult } from "./provider";
import { createRealRuntimeStore,type RealRuntimeStore } from "./store";
export type RealAnswerInput = {actorId:string;sessionId:string;companyId:string;executionId:string;question:string;locale:"ar"|"en";chunks:AnswerContextChunk[];model?:AIModelId;usageMode:"admin_test"|"company_live"};
export type RealAttempt = {id:string;model:AIModelId;status:string;costUsd:number|null;costBaisa:number|null;latencyMs:number;errorCode?:string;message?:string;usage?:RealProviderResult["usage"];requestId?:string};
export async function executeRealAnswer(input:RealAnswerInput,deps?:{store:RealRuntimeStore;call:typeof callRealModel}) {
 const store=deps?.store??createRealRuntimeStore(),call=deps?.call??callRealModel;
 const first=input.model??new MultiModelAIRouter().classify({question:input.question,locale:input.locale,chunks:input.chunks}).modelId;
 const models:AIModelId[]=input.model?[first]:[first,...(["gpt-6-luna","gemini-3.8-flash","gpt-6.1-sol"] as AIModelId[]).filter(m=>m!==first)];
 const system=buildAnswerSystemPrompt(input.locale),prompt=formatAnswerUserPrompt(input.question,input.chunks,input.locale);
 const attempts:RealAttempt[]=[];
 for(const [index,model] of models.entries()){
  const id=crypto.randomUUID(),pricing=realModelPricing(model),reservedBaisa=reserveRealCost(model,system,prompt,pricing);
  let reservation;
  try{reservation=await store.reserve({id,executionId:input.executionId,attempt:index+1,actorId:input.actorId,sessionId:input.sessionId,companyId:input.companyId,model,provider:model==="gemini-3.8-flash"?"google":"openai",reservedBaisa,pricingVersion:pricing.version,pricingSnapshot:pricing,usageMode:input.usageMode});}
  catch{return {ok:false as const,error:"PERSISTENCE_OR_AUTHORIZATION_FAILED",attempts};}
  if(!reservation?.ok)return {ok:false as const,error:reservation?.code??"RESERVATION_FAILED",attempts};
  try{if(!await store.start(id)){
   await store.settle({id,status:"rejected",costUsd:0,costBaisa:0,usage:{},errorCode:"AUTHORIZATION_CHANGED_BEFORE_EXECUTION",latencyMs:0});
   return {ok:false as const,error:"AUTHORIZATION_CHANGED_BEFORE_EXECUTION",attempts};
  }}catch{return {ok:false as const,error:"LEDGER_WRITE_FAILED",attempts};}
  let result:RealProviderResult;
  try{result=await call({model,system,prompt});}catch{result={status:"uncertain",text:"",errorCode:"PROVIDER_NETWORK_ERROR",latencyMs:0};}
  let cost:{costUsd:number|null;costBaisa:number|null}={costUsd:null,costBaisa:null};
  if(result.usage){try{cost=priceRealUsage(result.usage,pricing);}catch{result={...result,status:"uncertain",text:"",errorCode:"INVALID_PROVIDER_USAGE"};}}
  else if(result.status==="rejected")cost={costUsd:0,costBaisa:0};
  else result={...result,status:"uncertain",text:"",errorCode:result.errorCode??"PROVIDER_USAGE_MISSING"};
  const attempt={id,model,status:result.status,...cost,latencyMs:result.latencyMs,errorCode:result.errorCode,message:result.message,usage:result.usage,requestId:result.requestId};attempts.push(attempt);
  try{if(!await store.settle({...attempt,usage:result.usage??{}}))return {ok:false as const,error:"SETTLEMENT_ALREADY_COMPLETED",attempts};}
  catch{return {ok:false as const,error:"SETTLEMENT_PENDING_RECONCILIATION",attempts};}
  if(result.status==="success"||result.status==="incomplete")return {ok:true as const,text:result.text,complete:result.status==="success",model,attempts};
  // A timeout/5xx can have consumed tokens. Never retry an uncertain execution.
  if(result.status==="uncertain"||input.model||!["KEY_MISSING","PROVIDER_HTTP_403","PROVIDER_HTTP_404","PROVIDER_HTTP_429"].includes(result.errorCode??""))break;
 }
 return {ok:false as const,error:attempts.at(-1)?.errorCode??"PROVIDER_UNAVAILABLE",attempts};
}
