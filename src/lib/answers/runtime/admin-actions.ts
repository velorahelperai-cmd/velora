"use server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVerifiedUser } from "@/lib/tenancy/access";
import { loadApprovedAnswerContext,verifyAnswerCitationsStillValid } from "../context";
import { ANSWER_MAX_QUESTION_CHARS } from "../constants";
import { executeRealAnswer } from "./execute";
import type {AdminAIActionInput} from "./admin-types";
import { isAdminAIState } from "./admin-snapshot";
import type {AnswerContextChunk} from "../types";

async function ownerGate(){
 const gate=await requireVerifiedUser();if(!gate.ok)return {ok:false as const,error:gate.code};
 const client=await createClient();const owner=await client.rpc("is_platform_owner");
 if(owner.error||owner.data!==true)return {ok:false as const,error:"OWNER_REQUIRED"};
 const {data,error}=await client.auth.getClaims();const sessionId=data?.claims.session_id;
 if(error||typeof sessionId!=="string")return {ok:false as const,error:"SESSION_UNAVAILABLE"};
 return {ok:true as const,actorId:gate.context.userId,sessionId};
}
export async function readAdminAIState(){
 const gate=await ownerGate();if(!gate.ok)return gate;
 const admin=createAdminClient();if(!admin)return {ok:false as const,error:"PERSISTENCE_UNAVAILABLE"};
 const rpc=admin.rpc as unknown as (name:string)=>PromiseLike<{data:unknown;error:unknown}>;
 const result=await rpc.call(admin,"ai_admin_snapshot");
 if(result.error||!isAdminAIState(result.data))return {ok:false as const,error:"AI_DATABASE_UNAVAILABLE"};
 return {ok:true as const,data:result.data};
}
export async function runAdminAITrial(input:AdminAIActionInput){
 const gate=await ownerGate();if(!gate.ok)return gate;
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!input||typeof input.question!=="string"||!input.question.trim()||input.question.length>ANSWER_MAX_QUESTION_CHARS||!uuid.test(input.companyId??"")||!uuid.test(input.executionId??"")||!["auto","gpt-6-luna","gpt-6.1-sol","gemini-3.8-flash"].includes(input.model)||!["connection","company"].includes(input.contextMode))return {ok:false as const,error:"INVALID_INPUT"};
 const admin=createAdminClient();if(!admin)return {ok:false as const,error:"PERSISTENCE_UNAVAILABLE"};
 const {data:company,error}=await admin.from("companies").select("id,status").eq("id",input.companyId).maybeSingle();
 if(error||!company||company.status==="suspended")return {ok:false as const,error:"COMPANY_UNAVAILABLE"};
 let chunks:AnswerContextChunk[]=[];
 if(input.contextMode==="company"){
  const packed=await loadApprovedAnswerContext(input.companyId,admin);if(!packed.ok)return {ok:false as const,error:packed.code};chunks=packed.chunks;
 }
 const result=await executeRealAnswer({actorId:gate.actorId,sessionId:gate.sessionId,companyId:company.id,executionId:input.executionId,question:input.question.trim(),locale:input.locale==="en"?"en":"ar",chunks,model:input.model==="auto"?undefined:input.model,usageMode:"admin_test",maxOutputTokens:input.maxOutputTokens,maxCostBaisa:input.maxCostBaisa});
 const again=await ownerGate();
 if(!again.ok||again.actorId!==gate.actorId||again.sessionId!==gate.sessionId)return {ok:false as const,error:"ACCESS_CHANGED_AFTER_EXECUTION"};
 if(chunks.length&&!await verifyAnswerCitationsStillValid(company.id,chunks,admin))return {ok:false as const,error:"KNOWLEDGE_CHANGED_AFTER_EXECUTION"};
 return result.ok?{...result,citations:chunks.map(({sourceId,title,contentVersion})=>({sourceId,title,contentVersion}))}:result;
}

/** Separate synthetic owner test action. Confirmation remains off unless supplied explicitly. */
export async function runAdminAIConnectivityTest(input:{modelId:"gpt-6-luna"|"gpt-6.1-sol"|"gemini-3.8-flash";companyId?:string;executionId?:string;executeConfirmed?:boolean}){
 const {executeLiveModelPing}=await import("../diagnostics/ping-test");
 return executeLiveModelPing({...input,executeConfirmed:input?.executeConfirmed===true});
}

/** Calendar-month provider expense from the existing ledger; this is not a provider invoice. */
export async function readAdminMonthlyAIUsage(input:{companyId:string;month:string}) {
 const gate=await ownerGate();if(!gate.ok)return gate;
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!input||!uuid.test(input.companyId??'')||typeof input.month!=='string')return {ok:false as const,error:'INVALID_INPUT'};
 const asOf=new Date();
 const {monthlyUsagePeriod}=await import('./monthly-usage');
 try{monthlyUsagePeriod(input.month,asOf);}catch{return {ok:false as const,error:'INVALID_INPUT'};}
 const admin=createAdminClient();if(!admin)return {ok:false as const,error:'PERSISTENCE_UNAVAILABLE'};
 try {
  const {readMonthlyAIUsage}=await import('./monthly-usage-read');
  const data=await readMonthlyAIUsage(admin as unknown as import('./monthly-usage-read').MonthlyUsageDb,input.companyId,input.month,asOf);
  const again=await ownerGate();
  if(!again.ok||again.actorId!==gate.actorId||again.sessionId!==gate.sessionId)return {ok:false as const,error:'ACCESS_CHANGED_AFTER_READ'};
  return {ok:true as const,data};
 }catch(error){return {ok:false as const,error:error instanceof Error&&error.message==='USAGE_READ_LIMIT'?'REPORT_LIMIT':'USAGE_REPORT_UNAVAILABLE'};}
}
