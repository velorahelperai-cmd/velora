import "server-only";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { getSecureProviderKey } from "../config/env";
import type { AIModelId } from "../types";
import { REAL_OUTPUT_LIMIT, REAL_TIMEOUT_MS, type RealTokenUsage } from "./economics";
import { safeProviderError } from "./errors";

export type RealProviderResult = {
 status:"success"|"incomplete"|"rejected"|"uncertain"; text:string;
 usage?:RealTokenUsage;requestId?:string;errorCode?:string;message?:string;latencyMs:number;
};
export async function callRealModel(input:{model:AIModelId;system:string;prompt:string}):Promise<RealProviderResult> {
 const started=Date.now(),google=input.model==="gemini-3.8-flash";
 const apiKey=getSecureProviderKey(google?"google":"openai");
 if(!apiKey)return {status:"rejected",text:"",errorCode:"KEY_MISSING",message:"Provider key is missing",latencyMs:0};
 let requestId:string|undefined;
 try {
  let text:string,usage:RealTokenUsage,complete:boolean;
  if(google){
   const client=new GoogleGenAI({apiKey});
   const response=await client.interactions.create({model:input.model,input:input.prompt,system_instruction:input.system,store:false,stream:false,generation_config:{max_output_tokens:REAL_OUTPUT_LIMIT,thinking_level:"low"}}, {timeout:REAL_TIMEOUT_MS,maxRetries:0});
   requestId=response.id;
   const u=response.usage;
   if(!u||typeof u.total_input_tokens!=="number"||typeof u.total_tokens!=="number")throw Error("PROVIDER_USAGE_MISSING");
   text=response.output_text?.trim()??"";
   usage={promptTokens:u.total_input_tokens,completionTokens:u.total_tokens-u.total_input_tokens,cachedTokens:u.total_cached_tokens??0,reasoningTokens:u.total_thought_tokens??0,cacheWriteTokens:0};
   complete=response.status==="completed";
  }else{
   const client=new OpenAI({apiKey,maxRetries:0,timeout:REAL_TIMEOUT_MS});
   const response=await client.responses.create({model:input.model,instructions:input.system,input:input.prompt,max_output_tokens:REAL_OUTPUT_LIMIT,store:false,service_tier:"default",reasoning:{effort:"low"}});
   requestId=response._request_id??response.id;
   const u=response.usage;if(!u)throw Error("PROVIDER_USAGE_MISSING");
   text=response.output_text.trim();
   usage={promptTokens:u.input_tokens,completionTokens:u.output_tokens,cachedTokens:u.input_tokens_details.cached_tokens??0,cacheWriteTokens:u.input_tokens_details.cache_write_tokens??0,reasoningTokens:u.output_tokens_details.reasoning_tokens??0};
   complete=response.status==="completed";
  }
  return {status:complete&&text?"success":"incomplete",text,usage,requestId,latencyMs:Date.now()-started};
 }catch(error){
  const safe=safeProviderError(error);
  const rejected=safe.status!==null&&[400,401,403,404,422,429].includes(safe.status);
  return {status:rejected?"rejected":"uncertain",text:"",requestId:requestId??(error as {request_id?:string})?.request_id,errorCode:safe.code,message:safe.message,latencyMs:Date.now()-started};
 }
}
