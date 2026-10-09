/**
 * Inbound worker contract — callable, not scheduled.
 * Does not start cron or a new runtime. Live send/AI stay off until entitlement + provider exist.
 */

import { readCompanyEntitlement, entitlementAllowsAutomation } from "@/lib/billing/entitlement";
import { evaluateInboundClaim, processInboundJobAnswer, type ClaimedJobRow } from "@/lib/answers/channel-adapter";
import { createAdminClient } from "@/lib/supabase/admin";
import {runPersistedInboundJob,type IntegrationPorts,type IntegrationOutcome} from "./integration-worker";

export type WorkerStep =
  | "claim"
  | "answer"
  | "recheck"
  | "intent"
  | "send"
  | "record";

export type WorkerPlan = {
  scheduled: false;
  steps: WorkerStep[];
};

export function inboundWorkerPlan(): WorkerPlan {
  return {
    scheduled: false,
    steps: ["claim", "answer", "recheck", "intent", "send", "record"],
  };
}

export type WorkerRunResult =
  IntegrationOutcome;

function blocked(code: string): WorkerRunResult {
  return { ok: false, code, jobCompleted: false, sendAccepted: false, delivered: false };
}

/**
 * Resume-safe entry: answer staging only. Never marks the job complete or Graph-sends.
 * Staff takeover / paused automation / generation change are handled inside processInboundJobAnswer.
 */
export async function runInboundWorkerAnswer(input: {
  jobId: string;
  claimToken: string;
  companyId: string;
  locale?: "ar" | "en";
},ports?:IntegrationPorts): Promise<WorkerRunResult> {
  if (!input.jobId?.trim() || !input.claimToken?.trim() || !input.companyId?.trim()) return blocked("INVALID_INPUT");
  if(ports)return runPersistedInboundJob(input,ports);
  const entitlement = readCompanyEntitlement(input.companyId);
  if (!entitlementAllowsAutomation(entitlement)) {
    return {
      ok: false,
      code: "ENTITLEMENT_NOT_CONFIGURED",
      jobCompleted: false,
      sendAccepted: false,
      delivered: false,
    };
  }
  try {
    // Bind the entitlement's company to the actual stored claim before AI preparation.
    const admin = createAdminClient();
    if (!admin) return blocked("UNAVAILABLE");
    const { data, error } = await admin.from("whatsapp_inbound_jobs")
      .select("id,company_id,message_id,wa_message_id,status,claim_token,claim_expires_at")
      .eq("id", input.jobId).eq("company_id", input.companyId).maybeSingle();
    if (error) return blocked("UNAVAILABLE");
    const job = data as ClaimedJobRow | null;
    const claimError = evaluateInboundClaim(job, input.claimToken);
    if (claimError || !job || job.id !== input.jobId || job.company_id !== input.companyId) return blocked(claimError ?? "CLAIM_INVALID");
    const { data: message, error: messageError } = await admin.from("whatsapp_messages")
      .select("id,company_id,conversation_id,wa_message_id,direction,sender,message_type")
      .eq("id", job.message_id).eq("company_id", input.companyId).maybeSingle();
    if (messageError) return blocked("UNAVAILABLE");
    if (!message || message.wa_message_id !== job.wa_message_id || message.direction !== "inbound" || message.sender !== "customer") return blocked("INVALID_INPUT");
    // Media/unknown placeholders remain in the inbox for human handling.
    if (message.message_type !== "text") return blocked("UNSUPPORTED_MESSAGE");
    const staged = await processInboundJobAnswer({
      jobId: input.jobId,
      claimToken: input.claimToken,
      locale: input.locale,
      admin,
    });
    if (!staged.ok) return blocked(staged.code);
    if (staged.jobId !== input.jobId || staged.companyId !== input.companyId ||
        staged.messageId !== job.message_id || staged.conversationId !== message.conversation_id) return blocked("INVALID_INPUT");
    return blocked("SEND_NOT_WIRED");
  } catch {
    // Preserve pending durable work. Failure is not completion or a safe resend.
    return blocked("UNAVAILABLE");
  }
}
