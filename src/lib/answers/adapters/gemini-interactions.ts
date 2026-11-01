import 'server-only';
import type {GoogleGenAI} from '@google/genai';
import type {AnswerFailure,AnswerProviderRequest,TrialProviderHandle,TrialProviderResult} from '../types';
import {buildAnswerSystemPrompt,formatAnswerUserPrompt} from './prompt';
import {providerRequestLimits,validTokenCount} from './request-limits';
import {matchesRequestedModel} from './response-identity';
import {logEvent} from '@/lib/logging/logger.mjs';
const model='gemini-3.8-flash' as const;
const options={timeout:30_000,maxRetries:0};
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(id);
function failure(code:AnswerFailure['providerErrorCode'],startedAt:number,requestId?:string):AnswerFailure{
 return {ok:false,code:'UNAVAILABLE',providerErrorCode:code,provider:'google',modelId:model,providerAttempted:true,retrySafe:false,latencyMs:Math.max(0,Date.now()-startedAt),requestId,message:'Provider outcome requires review.'};
}
export async function startGeminiTrial(client:GoogleGenAI,input:AnswerProviderRequest):Promise<TrialProviderResult>{
 const limits=providerRequestLimits(input);const startedAt=Date.now();
 if(!limits||input.signal?.aborted)return {ok:false,code:'INVALID_INPUT',providerAttempted:false,retrySafe:false};
 try{
  const response=await client.interactions.create({model,input:formatAnswerUserPrompt(input.question,input.chunks,input.locale),system_instruction:buildAnswerSystemPrompt(input.locale,input.persona),background:true,store:true,generation_config:{thinking_level:'low',max_output_tokens:limits.maxOutputTokens}},options);
  if(!validId(response.id))return failure('GEMINI_USAGE_UNVERIFIED',startedAt);
  // Persist the ID before consuming even an immediately completed result.
  return {pending:true,handle:{id:response.id,modelId:model,startedAt,promptChars:input.question.length,contextChars:input.chunks.reduce((n,c)=>n+c.text.length,0),sourceCount:input.chunks.length}};
 }catch(error){
  const status=error&&typeof error==='object'&&'status'in error?error.status:null;
  const evidence=failure(typeof status==='number'&&Number.isInteger(status)&&status>=400&&status<=599?`GEMINI_HTTP_${status}`:'GEMINI_TRANSPORT_ERROR',startedAt);
  return {...evidence,...(typeof status==='number'?{providerHttpStatus:status}:{})};
 }
}
export async function retrieveGeminiTrial(client:GoogleGenAI,handle:TrialProviderHandle):Promise<TrialProviderResult>{
 if(!validId(handle.id)||handle.modelId!==model)return {ok:false,code:'INVALID_INPUT',providerAttempted:false,retrySafe:false};
 let response:Awaited<ReturnType<typeof client.interactions.create>>;
 try{response=await client.interactions.get(handle.id,undefined,options);}catch(error){
  const status=error&&typeof error==='object'&&'status'in error&&typeof error.status==='number'?error.status:null;
  logEvent('warn','es02.branch_assistant_trial.retrieve_transport',{provider_request_id:handle.id,error_code:status?`GEMINI_HTTP_${status}`:'GEMINI_TRANSPORT_ERROR',latency_ms:Math.max(0,Date.now()-handle.startedAt)});
  if(error&&typeof error==='object'&&'status'in error&&error.status===404)return failure('GEMINI_HTTP_404',handle.startedAt,handle.id);
  // GET failure says nothing about the generation; preserve its identity and hold.
  return {pending:true,handle};
 }
 if('next'in response)return {pending:true,handle};
 logEvent('info','es02.branch_assistant_trial.retrieve_status',{provider_request_id:handle.id,provider_status:['queued','in_progress','completed','failed','cancelled','requires_action','incomplete','budget_exceeded'].includes(response.status)?response.status:'unrecognized',latency_ms:Math.max(0,Date.now()-handle.startedAt)});
 if(response.id!==handle.id)return failure('GEMINI_MODEL_MISMATCH',handle.startedAt,handle.id);
 if(!['completed','failed','cancelled','requires_action','incomplete','budget_exceeded'].includes(response.status))return {pending:true,handle};
 if(!response.model||!matchesRequestedModel(response.model,model))return failure('GEMINI_MODEL_MISMATCH',handle.startedAt,handle.id);
 const usage=response.usage;
 const prompt=usage?.total_input_tokens,output=usage?.total_output_tokens,thought=usage?.total_thought_tokens??0,cached=usage?.total_cached_tokens??0;
 if(!validTokenCount(prompt)||!validTokenCount(output)||!validTokenCount(thought)||!validTokenCount(cached)||cached>prompt||usage?.total_tokens!==prompt+output+thought||(usage?.total_tool_use_tokens??0)!==0)return failure('GEMINI_USAGE_UNVERIFIED',handle.startedAt,handle.id);
 const normalized={promptChars:handle.promptChars,contextChars:handle.contextChars,sourceCount:handle.sourceCount,promptTokens:prompt,completionTokens:output+thought,reasoningTokens:thought,cachedTokens:cached,totalTokens:prompt+output+thought,modelId:model,provider:'google' as const,requestId:handle.id,responseId:handle.id,actualModelId:response.model,latencyMs:Math.max(0,Date.now()-handle.startedAt)};
 const text=response.steps.flatMap(step=>step.type==='model_output'?(step.content??[]).filter(part=>part.type==='text').map(part=>part.text):[]).join('').trim();
 if(response.status!=='completed'||!text)return {...failure('GEMINI_INCOMPLETE_RESPONSE',handle.startedAt,handle.id),usage:normalized};
 return {ok:true,text,citations:[],usage:normalized,modelId:model,attemptsCount:1};
}
