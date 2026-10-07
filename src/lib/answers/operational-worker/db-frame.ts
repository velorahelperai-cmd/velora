import "server-only";
import type {SupabaseClient} from "@supabase/supabase-js";
import {createAdminClient} from "@/lib/supabase/admin";
import {loadApprovedAnswerContext} from "@/lib/answers/context";
import type {Database} from "@/lib/database.types";
import {operationRpc} from "@/lib/billing/operations/db";
import type {WorkerFrame} from "./run";
type StoredFrame={job_id:string;company_id:string;message_id:string;conversation_id:string;phone_number_id:string;automation_generation:number;link_generation:number;question:string;operation_key:string};
export async function loadOperationalWorkerFrame(jobId:string,claimToken:string):Promise<WorkerFrame|null>{
 const result=await operationRpc<StoredFrame>("billing_load_worker_frame",{p_job_id:jobId,p_claim_token:claimToken},true);if(!result.ok)return null;
 const admin=createAdminClient() as SupabaseClient<Database>|null;if(!admin)return null;
 const context=await loadApprovedAnswerContext(result.data.company_id,admin);if(!context.ok)return null;
 const f=result.data;return {companyId:f.company_id,phoneNumberId:f.phone_number_id,conversationId:f.conversation_id,jobId:f.job_id,operationKey:f.operation_key,automationGeneration:f.automation_generation,linkGeneration:f.link_generation,question:f.question,chunks:context.chunks};
}
