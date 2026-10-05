/**
 * Inbound worker contract — callable, not scheduled.
 * Does not start cron or a new runtime. Live send/AI stay off until entitlement + provider exist.
 */

import { readCompanyEntitlement, entitlementAllowsAutomation } from "@/lib/billing/entitlement";
import { processInboundJobAnswer } from "@/lib/answers/channel-adapter";

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
  | { ok: false; code: string; jobCompleted: false; sendAccepted: false; delivered: false };

/**
 * Resume-safe entry: answer staging only. Never marks the job complete or Graph-sends.
 * Staff takeover / paused automation / generation change are handled inside processInboundJobAnswer.
 */
export async function runInboundWorkerAnswer(input: {
  jobId: string;
  claimToken: string;
  companyId: string;
  locale?: "ar" | "en";
}): Promise<WorkerRunResult> {
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
  const staged = await processInboundJobAnswer({
    jobId: input.jobId,
    claimToken: input.claimToken,
    locale: input.locale,
  });
  if (!staged.ok) {
    return {
      ok: false,
      code: staged.code,
      jobCompleted: false,
      sendAccepted: false,
      delivered: false,
    };
  }
  return {
    ok: false,
    code: "SEND_NOT_WIRED",
    jobCompleted: false,
    sendAccepted: false,
    delivered: false,
  };
}
