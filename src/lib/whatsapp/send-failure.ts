/**
 * Pre-Graph blocks (config, binding, secrets) must not be recorded as unknown
 * provider outcomes and must not trigger automatic resend.
 */

const PRE_GRAPH = new Set([
  "SERVICE_WINDOW_CLOSED",
  "service_window_closed",
  "NEEDS_SETUP",
  "NOT_CONFIGURED",
  "SEND_DISABLED",
  "PHONE_MISMATCH",
  "COMPANY_SUSPENDED",
  "LINK_CHANGED",
  "BINDING_MISMATCH",
  "UNKNOWN_OR_INACTIVE",
  "UNAVAILABLE",
  "needs_setup",
  "not_configured",
  "send_disabled",
  "phone_mismatch",
  "company_suspended",
  "link_changed",
  "binding_mismatch",
  "unknown_or_inactive",
  "unavailable",
]);

export type SendFinalizeKind = "rejected" | "unknown";

export function isPreGraphSendFailure(code: string): boolean {
  return PRE_GRAPH.has(code) || PRE_GRAPH.has(code.toUpperCase());
}

export function sendFinalizeKind(code: string): SendFinalizeKind {
  return isPreGraphSendFailure(code) ? "rejected" : "unknown";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function intentOutcome(data: unknown): string {
  const row = record(data);
  const intent = record(row?.intent);
  return typeof intent?.outcome === "string" ? intent.outcome : "";
}

export type PreGraphSettlement =
  | {
      status: "rejected_not_attempted";
      replyCode: "REJECTED";
      outcome: "rejected";
      notAttempted: true;
      mintNewClientOp: true;
    }
  | {
      status: "keep_lock";
      replyCode: "IN_PROGRESS" | "SAVE_FAILED" | "UNKNOWN_OUTCOME";
      outcome: "attempting" | "unknown" | "accepted" | "rejected";
      notAttempted: false;
      mintNewClientOp: false;
    }
  | {
      status: "keep_original";
      replyCode: "UNKNOWN_OUTCOME" | "PERSIST_PENDING";
      outcome: "accepted" | "unknown";
      notAttempted: false;
      mintNewClientOp: false;
    };

/**
 * Maps finalize_whatsapp_send_attempt after a pre-Graph block.
 * Graph was not contacted; only a confirmed rejected write unlocks a new client_op_id.
 */
export function classifyPreGraphSettlement(rpc: {
  error: unknown;
  data: unknown;
}): PreGraphSettlement {
  if (rpc.error) {
    return {
      status: "keep_lock",
      replyCode: "SAVE_FAILED",
      outcome: "attempting",
      notAttempted: false,
      mintNewClientOp: false,
    };
  }
  const row = record(rpc.data);
  if (!row) {
    return {
      status: "keep_lock",
      replyCode: "SAVE_FAILED",
      outcome: "attempting",
      notAttempted: false,
      mintNewClientOp: false,
    };
  }

  const outcome = intentOutcome(row);
  const alreadyFinal = row.already_final === true;
  const ok = row.ok === true;
  const rpcCode = typeof row.code === "string" ? row.code : "";

  if (alreadyFinal && (outcome === "accepted" || outcome === "unknown")) {
    return {
      status: "keep_original",
      replyCode: outcome === "accepted" ? "PERSIST_PENDING" : "UNKNOWN_OUTCOME",
      outcome,
      notAttempted: false,
      mintNewClientOp: false,
    };
  }

  if (!ok) {
    const stillAttempting = outcome === "attempting" || rpcCode === "claim_rejected";
    return {
      status: "keep_lock",
      replyCode: stillAttempting ? "IN_PROGRESS" : "UNKNOWN_OUTCOME",
      outcome: stillAttempting ? "attempting" : (outcome === "unknown" || outcome === "accepted" || outcome === "rejected"
        ? outcome
        : "attempting"),
      notAttempted: false,
      mintNewClientOp: false,
    };
  }

  if (outcome === "rejected") {
    return {
      status: "rejected_not_attempted",
      replyCode: "REJECTED",
      outcome: "rejected",
      notAttempted: true,
      mintNewClientOp: true,
    };
  }

  if (outcome === "accepted" || outcome === "unknown") {
    return {
      status: "keep_original",
      replyCode: outcome === "accepted" ? "PERSIST_PENDING" : "UNKNOWN_OUTCOME",
      outcome,
      notAttempted: false,
      mintNewClientOp: false,
    };
  }

  return {
    status: "keep_lock",
    replyCode: "UNKNOWN_OUTCOME",
    outcome: "attempting",
    notAttempted: false,
    mintNewClientOp: false,
  };
}

export type PreGraphActionResult = {
  ok: false;
  code: PreGraphSettlement["replyCode"];
  message: string;
  clientOpId: string;
  outcome: PreGraphSettlement["outcome"];
  notAttempted?: true;
};

export function replyFromPreGraphSettlement(
  settlement: PreGraphSettlement,
  clientOpId: string,
  message: string,
): PreGraphActionResult {
  return {
    ok: false,
    code: settlement.replyCode,
    message,
    clientOpId,
    outcome: settlement.outcome,
    ...(settlement.notAttempted ? { notAttempted: true as const } : {}),
  };
}
