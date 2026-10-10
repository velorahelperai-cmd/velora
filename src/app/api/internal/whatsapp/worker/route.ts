import {timingSafeEqual} from "node:crypto";
import {createAdminClient} from "@/lib/supabase/admin";
import {createIntegrationPorts,workerRolloutEnabled} from "@/lib/whatsapp/integration-store";
import {fixedAckConfig,runFixedAcknowledgementBatch,type FixedAckRpc} from "@/lib/whatsapp/fixed-ack";
import {runInboundWorkerAnswer} from "@/lib/whatsapp/inbound-worker";
export const runtime="nodejs";
export const maxDuration=300;
export async function POST(request:Request){
 const expected=process.env.WHATSAPP_WORKER_SECRET?.trim();const actual=request.headers.get("authorization")?.replace(/^Bearer /,"")??"";
 if(!expected||expected.length<32)return Response.json({code:"WORKER_NOT_CONFIGURED"},{status:503});
 const a=Buffer.from(actual),b=Buffer.from(expected);if(a.length!==b.length||!timingSafeEqual(a,b))return Response.json({code:"UNAUTHORIZED"},{status:401});
 if(process.env.WHATSAPP_WORKER_ENABLED!=="true")return Response.json({code:"WORKER_DISABLED"},{status:503});
 try{
 const client=createAdminClient();if(!client)return Response.json({code:"STORE_NOT_CONFIGURED"},{status:503});
 const rpc=client.rpc as unknown as (name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
 if(process.env.WHATSAPP_FIXED_ACK_ENABLED==="true"){
  const scope=fixedAckConfig();if(!scope)return Response.json({code:"FIXED_ACK_NOT_CONFIGURED"},{status:503});
  const fixed=await runFixedAcknowledgementBatch(scope,client as unknown as FixedAckRpc);
  return Response.json(fixed,{status:fixed.code==="COMPLETE"?200:503});
 }
 const repaired=await rpc.call(client,"whatsapp_repair_accepted_jobs",{p_limit:10});
 const repair=repaired.data as {ok?:boolean;repaired?:number;pending?:number}|null;
 if(repaired.error||repair?.ok!==true||!Number.isSafeInteger(repair.repaired)||!Number.isSafeInteger(repair.pending)
 ||Number(repair.repaired)<0||Number(repair.pending)<0||Number(repair.repaired)+Number(repair.pending)>10)
 return Response.json({code:"REPAIR_UNAVAILABLE"},{status:503});
 if(!workerRolloutEnabled())return Response.json({code:"CUSTOMER_ANSWERING_DISABLED",repairOnly:true},{status:200});
 const claimed=await rpc.call(client,"whatsapp_claim_inbound_batch",{p_limit:1});
 const row=claimed.data as {ok?:boolean;jobs?:{job_id:string;claim_token:string;company_id:string}[]}|null;
 if(claimed.error||row?.ok!==true||!Array.isArray(row.jobs)||row.jobs.length>1||row.jobs.some(j=>!j||typeof j.job_id!=="string"||typeof j.claim_token!=="string"||typeof j.company_id!=="string"))return Response.json({code:"CLAIM_FAILED"},{status:503});
 let accepted=0;for(const job of row.jobs){const input={jobId:job.job_id,claimToken:job.claim_token,companyId:job.company_id};const r=await runInboundWorkerAnswer(input,createIntegrationPorts(input));if(r.sendAccepted)accepted++;}
 // No capabilities, secrets, customer bodies or provider text are returned.
 return Response.json({processed:row.jobs.length,accepted,delivered:0});
 }catch{
 // Transport errors must not expose provider/database details or masquerade as a drained queue.
 return Response.json({code:"WORKER_UNAVAILABLE"},{status:503});
 }
}
