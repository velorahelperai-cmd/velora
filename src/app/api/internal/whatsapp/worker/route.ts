import {createHmac,timingSafeEqual} from "node:crypto";
import {createAdminClient} from "@/lib/supabase/admin";
import {createIntegrationPorts,workerRolloutEnabled} from "@/lib/whatsapp/integration-store";
import {fixedAckConfig,runFixedAcknowledgementBatch,type FixedAckRpc} from "@/lib/whatsapp/fixed-ack";
import {summarizeWorkerOutcomes} from "@/lib/whatsapp/worker-observation";
import type {IntegrationOutcome} from "@/lib/whatsapp/integration-worker";
import {runInboundWorkerAnswer} from "@/lib/whatsapp/inbound-worker";
import {recordWorkerTiming} from "@/lib/whatsapp/worker-timing";
export const runtime="nodejs";
export const maxDuration=300;
const MAX_JOBS_PER_REQUEST=5;
const CLAIM_BUDGET_MS=20_000;
export async function POST(request:Request){
 const expected=process.env.WHATSAPP_WORKER_SECRET?.trim();const actual=request.headers.get("authorization")?.replace(/^Bearer /,"")??"";
 if(!expected||expected.length<32)return Response.json({code:"WORKER_NOT_CONFIGURED"},{status:503});
 const a=Buffer.from(actual),b=Buffer.from(expected);
 const direct=a.length===b.length&&timingSafeEqual(a,b);
 const tick=/^tick\.([0-9a-f]{64})\.([0-9a-f]{64})$/.exec(actual);
 const signature=tick?Buffer.from(tick[2],"hex"):null;
 const expectedSignature=tick?createHmac("sha256",expected).update(tick[1]).digest():null;
 const signed=!!signature&&!!expectedSignature&&timingSafeEqual(signature,expectedSignature);
 if(!direct&&!signed)return Response.json({code:"UNAUTHORIZED"},{status:401});
 if(process.env.WHATSAPP_WORKER_ENABLED!=="true")return Response.json({code:"WORKER_DISABLED"},{status:503});
 let stage:"client"|"tick"|"repair"|"claim"|"execute"|"fixed_ack"="client";
 try{
 const client=createAdminClient();if(!client)return Response.json({code:"STORE_NOT_CONFIGURED"},{status:503});
 const rpc=client.rpc as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
 if(!direct&&tick){
  stage="tick";
  const redeemed=await rpc.call(client,"whatsapp_redeem_worker_tick",{p_token:tick[1]});
  if(redeemed.error)return Response.json({code:"TICK_AUTH_UNAVAILABLE"},{status:503});
  if(redeemed.data!==true)return Response.json({code:"UNAUTHORIZED"},{status:401});
 }
 if(process.env.WHATSAPP_FIXED_ACK_ENABLED==="true"){
  stage="fixed_ack";
  const scope=fixedAckConfig();if(!scope)return Response.json({code:"FIXED_ACK_NOT_CONFIGURED"},{status:503});
  const fixed=await runFixedAcknowledgementBatch(scope,client as unknown as FixedAckRpc);
  return Response.json(fixed,{status:fixed.code==="COMPLETE"?200:503});
 }
 stage="repair";
 const repaired=await rpc.call(client,"whatsapp_repair_accepted_jobs",{p_limit:10});
 const repair=repaired.data as {ok?:boolean;repaired?:number;pending?:number}|null;
 if(repaired.error||repair?.ok!==true||!Number.isSafeInteger(repair.repaired)||!Number.isSafeInteger(repair.pending)
 ||Number(repair.repaired)<0||Number(repair.pending)<0||Number(repair.repaired)+Number(repair.pending)>10)
 return Response.json({code:"REPAIR_UNAVAILABLE"},{status:503});
 if(!workerRolloutEnabled())return Response.json({code:Number(repair.pending)>0?"RECONCILIATION_REQUIRED":"CUSTOMER_ANSWERING_DISABLED",repairOnly:true,repair:{repaired:Number(repair.repaired),pending:Number(repair.pending)},automaticRetry:false},{status:Number(repair.pending)>0?202:200});
 const outcomes:IntegrationOutcome[]=[];
 const claimDeadline=performance.now()+CLAIM_BUDGET_MS;
 for(let index=0;index<MAX_JOBS_PER_REQUEST;index++){
  if(index>0&&(performance.now()>=claimDeadline||!workerRolloutEnabled()))break;
  stage="claim";
  let claimed;
  try{claimed=await rpc.call(client,"whatsapp_claim_inbound_batch",{p_limit:1});}
  catch{
   if(!outcomes.length)throw Error("CLAIM_UNAVAILABLE");
   const observed=summarizeWorkerOutcomes(outcomes,{repaired:Number(repair.repaired),pending:Number(repair.pending)});
   return Response.json({...observed.body,code:"WORKER_BATCH_FAILED",claimUnavailable:true},{status:503});
  }
  const row=claimed.data as {ok?:boolean;jobs?:{job_id:string;claim_token:string;company_id:string}[]}|null;
  if(claimed.error||row?.ok!==true||!Array.isArray(row.jobs)||row.jobs.length>1||row.jobs.some(j=>!j||typeof j.job_id!=="string"||typeof j.claim_token!=="string"||typeof j.company_id!=="string")){
   if(!outcomes.length)return Response.json({code:"CLAIM_FAILED"},{status:503});
   const observed=summarizeWorkerOutcomes(outcomes,{repaired:Number(repair.repaired),pending:Number(repair.pending)});
   return Response.json({...observed.body,code:"WORKER_BATCH_FAILED",claimUnavailable:true},{status:503});
  }
  if(!row.jobs.length)break;
  stage="execute";
  const job=row.jobs[0],input={jobId:job.job_id,claimToken:job.claim_token,companyId:job.company_id};
  recordWorkerTiming(job.job_id,"claimed_at");
  let outcome:IntegrationOutcome;
  try{outcome=await runInboundWorkerAnswer(input,createIntegrationPorts(input));}
  catch{
   const observed=summarizeWorkerOutcomes(outcomes,{repaired:Number(repair.repaired),pending:Number(repair.pending)});
   return Response.json({...observed.body,code:"RECONCILIATION_REQUIRED",unknown:observed.body.unknown+1,executionUnavailable:true},{status:202});
  }
  outcomes.push(outcome);
  // Do not spin on a blocked, uncertain, or unfinished job; recovery remains independent.
  if(!outcome.ok)break;
 }
 // No capabilities, secrets, customer bodies or provider text are returned.
 const observation=summarizeWorkerOutcomes(outcomes,{repaired:Number(repair.repaired),pending:Number(repair.pending)});
 return Response.json(observation.body,{status:observation.httpStatus});
 }catch{
 // Transport errors must not expose provider/database details or masquerade as a drained queue.
 return Response.json({code:"WORKER_UNAVAILABLE",stage},{status:503});
 }
}
