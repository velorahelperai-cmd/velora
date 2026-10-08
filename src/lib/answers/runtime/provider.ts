import "server-only";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { getSecureProviderKey } from "../config/env";
import type { AIModelId } from "../types";
import { REAL_OUTPUT_LIMIT, REAL_TIMEOUT_MS, type RealTokenUsage } from "./economics";
import { safeProviderError } from "./errors";
import { matchesRequestedModel } from "../adapters/response-identity";
import { priceRealUsage,realModelPricing } from "./economics";

export type RealProviderResult = {
 status:"success"|"incomplete"|"rejected"|"uncertain"; text:string;
 usage?:RealTokenUsage;requestId?:string;responseId?:string;actualModelId?:string;errorCode?:string;message?:string;latencyMs:number;
};
export async function callRealModel(input:{model:AIModelId;system:string;prompt:string;maxOutputTokens?:number}):Promise<RealProviderResult> {
 const maxOutputTokens=input.maxOutputTokens??REAL_OUTPUT_LIMIT;
 if(!["gpt-6-luna","gpt-6.1-sol","gemini-3.8-flash"].includes(input.model)||!Number.isSafeInteger(maxOutputTokens)||maxOutputTokens<1||maxOutputTokens>REAL_OUTPUT_LIMIT)return {status:"rejected",text:"",errorCode:"INVALID_INPUT",latencyMs:0};
 const started=Date.now(),google=input.model==="gemini-3.8-flash";
 const apiKey=getSecureProviderKey(google?"google":"openai");
 if(!apiKey)return {status:"rejected",text:"",errorCode:"KEY_MISSING",message:"Provider key is missing",latencyMs:0};
 let requestId:string|undefined,responseId:string|undefined,actualModelId:string|undefined;
 try {
  let text:string,usage:RealTokenUsage,complete:boolean;
  if(google){
   const client=new GoogleGenAI({apiKey});
   const response=await client.interactions.create({model:input.model,input:input.prompt,system_instruction:input.system,store:false,stream:false,service_tier:"standard",generation_config:{max_output_tokens:maxOutputTokens,thinking_level:"low"}}, {timeout:REAL_TIMEOUT_MS,maxRetries:0});
   requestId=response.id;
   responseId=response.id;actualModelId=response.model;
   const u=response.usage;
   if(!u||typeof u.total_input_tokens!=="number"||typeof u.total_tokens!=="number")throw Error("PROVIDER_USAGE_MISSING");
   text=response.output_text?.trim()??"";
   const output=u.total_output_tokens,thoughts=u.total_thought_tokens??0;
   if(typeof output!=="number"||!Number.isSafeInteger(output)||output<0||!Number.isSafeInteger(thoughts)||thoughts<0||
    (u.total_tool_use_tokens??0)!==0||u.total_input_tokens+output+thoughts!==u.total_tokens)throw Error("INVALID_PROVIDER_USAGE");
   usage={promptTokens:u.total_input_tokens,completionTokens:output+thoughts,cachedTokens:u.total_cached_tokens??0,reasoningTokens:thoughts,cacheWriteTokens:0,totalTokens:u.total_tokens};
   complete=response.status==="completed";
  }else{
   const client=new OpenAI({apiKey,maxRetries:0,timeout:REAL_TIMEOUT_MS});
   const response=await client.responses.create({model:input.model,instructions:input.system,input:input.prompt,max_output_tokens:maxOutputTokens,store:false,service_tier:"default",reasoning:{effort:"low"}});
   requestId=response._request_id??response.id;
   responseId=response.id;actualModelId=response.model;
   const u=response.usage;if(!u)throw Error("PROVIDER_USAGE_MISSING");
   text=response.output_text.trim();
   usage={promptTokens:u.input_tokens,completionTokens:u.output_tokens,cachedTokens:u.input_tokens_details.cached_tokens??0,cacheWriteTokens:u.input_tokens_details.cache_write_tokens??0,reasoningTokens:u.output_tokens_details.reasoning_tokens??0,totalTokens:u.total_tokens};
   complete=response.status==="completed";
  }
  priceRealUsage(usage,realModelPricing(input.model));
  if(!matchesRequestedModel(actualModelId,input.model))return {status:"uncertain",text:"",usage,requestId,responseId,actualModelId,errorCode:"PROVIDER_MODEL_MISMATCH",latencyMs:Date.now()-started};
  return {status:complete&&text?"success":"incomplete",text,usage,requestId,responseId,actualModelId,latencyMs:Date.now()-started};
 }catch(error){
  const safe=safeProviderError(error);
  const rejected=safe.status!==null&&[400,401,403,404,422,429].includes(safe.status);
  return {status:rejected?"rejected":"uncertain",text:"",requestId:requestId??(error as {request_id?:string})?.request_id,responseId,actualModelId,errorCode:safe.code,message:safe.message,latencyMs:Date.now()-started};
 }
}
