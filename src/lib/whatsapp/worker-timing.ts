import "server-only";
import {createHash} from "node:crypto";

export type WorkerTimingStage="webhook_received_at"|"persisted_at"|"claimed_at"|"ai_started_at"|"ai_completed_at"|"send_started_at"|"provider_accepted_at";
const stages=new Set<WorkerTimingStage>(["webhook_received_at","persisted_at","claimed_at","ai_started_at","ai_completed_at","send_started_at","provider_accepted_at"]);

/** Optional diagnostic timestamps; never include message, tenant, recipient or provider data. */
export function recordWorkerTiming(jobId:string,stage:WorkerTimingStage,at=Date.now()):void{
 try{
  if(process.env.WHATSAPP_WORKER_TIMING_ENABLED!=="true"||!stages.has(stage)||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)||!Number.isFinite(at))return;
  const jobHash=createHash("sha256").update("velora-wa-job:").update(jobId.toLowerCase()).digest("hex");
  console.info(JSON.stringify({event:"whatsapp.worker.timing",job_hash:jobHash,stage,at:new Date(at).toISOString()}));
 }catch{/* Diagnostics must never interrupt message processing. */}
}
