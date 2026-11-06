/**
 * Zero-silence / WhatsApp response continuity.
 *
 * Three independent axes. A conversation status such as handed_over is not a
 * staff claim, an accepted provider response is not delivery, and a closed
 * authority check is never permission to send.
 *
 * This module decides and records intent identity. It does not call Meta or a
 * paid model. WHATSAPP_CONTINUITY_ACK_ENABLED is the independent fallback-ack
 * gate and is closed unless the value is exactly "true". WHATSAPP_WORKER_ENABLED
 * and WHATSAPP_FIXED_ACK_ENABLED do not open it.
 */

export const RESPONSE_KINDS = ["answer_v1", "ack_v1"] as const;
export type ResponseKind = (typeof RESPONSE_KINDS)[number];

export const HUMAN_OWNERSHIP = [
  "NONE",
  "REQUESTED_UNCLAIMED",
  "CLAIMED_IDLE",
  "CLAIMED_ACTIVE",
  "RELEASED",
  "RESOLVED",
] as const;
export type HumanOwnership = (typeof HUMAN_OWNERSHIP)[number];

export const RESPONSE_PHASES = [
  "RECEIVED",
  "PERSISTED",
  "QUEUED",
  "AI_RUNNING",
  "ANSWER_READY",
  "ACK_DUE",
  "SEND_RESERVED",
  "ATTEMPTING",
  "PROVIDER_ACCEPTED",
  "DELIVERED",
  "READ",
  "REJECTED",
  "UNKNOWN",
  "BLOCKED",
  "CANCELLED",
] as const;
export type ResponsePhase = (typeof RESPONSE_PHASES)[number];

export const AUTHORITIES = [
  "AUTHORIZED",
  "TEMP_UNAVAILABLE",
  "REVOKED",
  "CHANNEL_DISABLED",
  "WINDOW_CLOSED",
  "BUDGET_BLOCKED",
] as const;
export type Authority = (typeof AUTHORITIES)[number];

/** Starting SLA from the continuity proposal. A company row may override these. */
export const DEFAULT_CONTINUITY_SLA = {
  ackAfterMs: 20_000,
  unclaimedEscalateMs: 60_000,
  claimedIdleMs: 120_000,
  coalesceMs: 8_000,
} as const;

export type ContinuitySla = {
  ackAfterMs: number;
  unclaimedEscalateMs: number;
  claimedIdleMs: number;
  coalesceMs: number;
  allowSafeAiAfterClaimedIdle: boolean;
};

export const NEUTRAL_ACK_TEXT = "استلمنا رسالتك. سنراجعها ونعود إليك من هنا.";

const COEXISTENCE_TAKEOVER_REASON = "coexistence_signup_ai_disabled";

export type ContinuityPlan = {
  responseKind: ResponseKind | null;
  phase: ResponsePhase;
  authority: Authority;
  body: string | null;
  reason: string;
};

export type ContinuityDecision = {
  ownership: HumanOwnership;
  ai: "answer" | "stop";
  stopCode:
    | "HUMAN_CLAIMED"
    | "HUMAN_REVIEW_REQUIRED"
    | "SERVICE_WINDOW_CLOSED"
    | "SEND_REQUIRES_RECONCILIATION"
    | "AUTHORITY_BLOCKED"
    | "WORKER_DISABLED"
    | null;
  ack: "schedule" | "cancel" | "closed" | "reconcile" | "none";
  freeform: boolean;
  escalate: boolean;
  plan: ContinuityPlan;
};

export type InboundContinuityInput = {
  ownership: HumanOwnership | null;
  handoffReason?: string | null;
  previewReason?: "human_request" | "sensitive" | null;
  elapsedMs?: number;
  idleMs?: number | null;
  answerReady?: boolean;
  staffReplied?: boolean;
  serviceWindowOpen?: boolean;
  authority?: Authority;
  workerEnabled?: boolean;
  ackGateOpen?: boolean;
  sendUnknown?: boolean;
  allowSafeAiAfterClaimedIdle?: boolean;
  sla?: Partial<ContinuitySla>;
};

export function continuityAckGate(env: Record<string, string | undefined> = process.env): { open: boolean; reason: string } {
  if (env.WHATSAPP_CONTINUITY_ACK_ENABLED === "true") {
    return { open: true, reason: "continuity_ack_enabled" };
  }
  return { open: false, reason: "continuity_ack_closed" };
}

export function resolveContinuitySla(override?: Partial<ContinuitySla> | null): ContinuitySla {
  const sla: ContinuitySla = {
    ...DEFAULT_CONTINUITY_SLA,
    allowSafeAiAfterClaimedIdle: false,
  };
  if (!override) return sla;
  for (const key of ["ackAfterMs", "unclaimedEscalateMs", "claimedIdleMs", "coalesceMs"] as const) {
    const value = override[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 1_000 && value <= 600_000) {
      sla[key] = value;
    }
  }
  if (override.allowSafeAiAfterClaimedIdle === true) sla.allowSafeAiAfterClaimedIdle = true;
  return sla;
}

export function deriveHumanOwnership(input: {
  status?: string | null;
  humanOwnership?: string | null;
  handoffReason?: string | null;
  latestControlAction?: string | null;
  latestControlReason?: string | null;
  staffReplied?: boolean;
  idleMs?: number | null;
  claimedIdleMs?: number;
}): HumanOwnership {
  const stored = normalizeOwnership(input.humanOwnership);
  if (input.status === "resolved" || stored === "RESOLVED") return "RESOLVED";
  const coexistenceTakeover = input.latestControlAction === "take_over"
    && input.latestControlReason === COEXISTENCE_TAKEOVER_REASON;
  const explicitClaim = stored === "CLAIMED_ACTIVE" || stored === "CLAIMED_IDLE"
    || (input.latestControlAction === "human_claimed")
    || (input.latestControlAction === "take_over" && !coexistenceTakeover);
  if (explicitClaim) {
    const idleLimit = input.claimedIdleMs ?? DEFAULT_CONTINUITY_SLA.claimedIdleMs;
    if (input.staffReplied || (input.idleMs ?? 0) < idleLimit) return "CLAIMED_ACTIVE";
    return "CLAIMED_IDLE";
  }
  if (stored === "RELEASED" || input.latestControlAction === "resume" || input.latestControlAction === "human_released") {
    return "RELEASED";
  }
  const handoff = Boolean(input.handoffReason)
    || stored === "REQUESTED_UNCLAIMED"
    || input.latestControlAction === "worker_escalation"
    || input.latestControlAction === "handoff_requested"
    || input.status === "handed_over";
  if (handoff) return "REQUESTED_UNCLAIMED";
  return "NONE";
}

function normalizeOwnership(value: string | null | undefined): HumanOwnership | null {
  if (!value) return null;
  const upper = value.toUpperCase();
  return (HUMAN_OWNERSHIP as readonly string[]).includes(upper) ? upper as HumanOwnership : null;
}

export function decideInboundContinuity(input: InboundContinuityInput): ContinuityDecision {
  const sla = resolveContinuitySla(input.sla);
  const ownership = input.ownership ?? "NONE";
  const authority = input.authority ?? "AUTHORIZED";
  const windowOpen = input.serviceWindowOpen !== false && authority !== "WINDOW_CLOSED";
  const effectiveAuthority: Authority = windowOpen ? authority : "WINDOW_CLOSED";
  const sensitive = input.previewReason === "human_request" || input.previewReason === "sensitive";
  const explicitHuman = input.previewReason === "human_request";
  const elapsed = input.elapsedMs ?? 0;
  const idle = input.idleMs ?? elapsed;
  const answerReady = input.answerReady === true;
  const staffReplied = input.staffReplied === true || ownership === "CLAIMED_ACTIVE";
  const workerEnabled = input.workerEnabled !== false;
  const ackGateOpen = input.ackGateOpen === true;
  const sendUnknown = input.sendUnknown === true;

  const planBase = (phase: ResponsePhase, reason: string, kind: ResponseKind | null = null): ContinuityPlan => ({
    responseKind: kind,
    phase,
    authority: effectiveAuthority,
    body: kind === "ack_v1" ? NEUTRAL_ACK_TEXT : null,
    reason,
  });

  if (sendUnknown) {
    return {
      ownership,
      ai: "stop",
      stopCode: "SEND_REQUIRES_RECONCILIATION",
      ack: "reconcile",
      freeform: false,
      escalate: true,
      plan: planBase("UNKNOWN", "provider_result_unknown"),
    };
  }

  if (!windowOpen) {
    return {
      ownership,
      ai: "stop",
      stopCode: "SERVICE_WINDOW_CLOSED",
      ack: "closed",
      freeform: false,
      escalate: true,
      plan: planBase("BLOCKED", "service_window_closed"),
    };
  }

  if (authority !== "AUTHORIZED") {
    return {
      ownership,
      ai: "stop",
      stopCode: "AUTHORITY_BLOCKED",
      ack: "closed",
      freeform: false,
      escalate: true,
      plan: planBase("BLOCKED", "authority_blocked"),
    };
  }

  if (ownership === "RESOLVED") {
    return {
      ownership,
      ai: "stop",
      stopCode: "AUTHORITY_BLOCKED",
      ack: "cancel",
      freeform: false,
      escalate: false,
      plan: planBase("CANCELLED", "conversation_resolved"),
    };
  }

  if (ownership === "CLAIMED_ACTIVE" || staffReplied) {
    return {
      ownership: ownership === "NONE" ? "CLAIMED_ACTIVE" : ownership,
      ai: "stop",
      stopCode: "HUMAN_CLAIMED",
      ack: "cancel",
      freeform: false,
      escalate: false,
      plan: planBase("CANCELLED", "staff_claimed_active"),
    };
  }

  const claimedIdle = ownership === "CLAIMED_IDLE";
  const idleExceeded = claimedIdle && idle >= sla.claimedIdleMs;
  const safeAiAfterIdle = idleExceeded && sla.allowSafeAiAfterClaimedIdle && !explicitHuman && !sensitive;
  if (claimedIdle && !safeAiAfterIdle) {
    const schedule = idleExceeded;
    return {
      ownership,
      ai: "stop",
      stopCode: "HUMAN_CLAIMED",
      ack: schedule ? (ackGateOpen ? "schedule" : "closed") : "none",
      freeform: schedule && ackGateOpen,
      escalate: idleExceeded,
      plan: planBase(schedule && ackGateOpen ? "ACK_DUE" : "BLOCKED", "claimed_idle", schedule ? "ack_v1" : null),
    };
  }

  if (sensitive || explicitHuman) {
    return {
      ownership,
      ai: "stop",
      stopCode: "HUMAN_REVIEW_REQUIRED",
      ack: ackGateOpen ? "schedule" : "closed",
      freeform: ackGateOpen,
      escalate: true,
      plan: planBase(ackGateOpen ? "ACK_DUE" : "BLOCKED", explicitHuman ? "explicit_human_request" : "sensitive", ackGateOpen ? "ack_v1" : null),
    };
  }

  if (!workerEnabled) {
    return {
      ownership,
      ai: "stop",
      stopCode: "WORKER_DISABLED",
      ack: ackGateOpen ? "schedule" : "closed",
      freeform: ackGateOpen,
      escalate: false,
      plan: planBase(ackGateOpen ? "ACK_DUE" : "BLOCKED", "worker_disabled", ackGateOpen ? "ack_v1" : null),
    };
  }

  if (answerReady || staffReplied) {
    return {
      ownership,
      ai: answerReady && workerEnabled ? "answer" : "stop",
      stopCode: null,
      ack: "cancel",
      freeform: true,
      escalate: ownership === "REQUESTED_UNCLAIMED" && elapsed >= sla.unclaimedEscalateMs,
      plan: planBase("ANSWER_READY", "answer_ready", "answer_v1"),
    };
  }

  const ackDue = elapsed >= sla.ackAfterMs;
  const escalate = ownership === "REQUESTED_UNCLAIMED" && elapsed >= sla.unclaimedEscalateMs;
  return {
    ownership,
    ai: workerEnabled ? "answer" : "stop",
    stopCode: workerEnabled ? null : "WORKER_DISABLED",
    ack: ackDue ? (ackGateOpen ? "schedule" : "closed") : "none",
    freeform: true,
    escalate,
    plan: planBase(ackDue && ackGateOpen ? "ACK_DUE" : "QUEUED", ackDue ? "ack_due" : "answer_in_progress", ackDue && ackGateOpen ? "ack_v1" : "answer_v1"),
  };
}

export type IntentIdentity = {
  companyId: string;
  channel: "whatsapp" | "instagram";
  providerMessageId: string;
  responseKind: ResponseKind;
};

export type StoredIntent = IntentIdentity & {
  phase: ResponsePhase;
  generation: number;
  claimToken: string | null;
  body: string | null;
};

export function intentIdentityKey(input: IntentIdentity): string {
  return [input.companyId, input.channel, input.providerMessageId, input.responseKind].join("\u0000");
}

export class ResponseIntentLedger {
  private readonly rows = new Map<string, StoredIntent>();
  private readonly inbound = new Set<string>();

  /** One inbound row per provider message. Repeats return the original. */
  acceptInbound(input: { companyId: string; channel: IntentIdentity["channel"]; providerMessageId: string }): { created: boolean } {
    const key = [input.companyId, input.channel, input.providerMessageId].join("\u0000");
    if (this.inbound.has(key)) return { created: false };
    this.inbound.add(key);
    return { created: true };
  }

  inboundCount(): number {
    return this.inbound.size;
  }

  reserve(input: IntentIdentity & { phase?: ResponsePhase; generation?: number; body?: string | null }): { created: boolean; intent: StoredIntent } {
    if (!(RESPONSE_KINDS as readonly string[]).includes(input.responseKind)) {
      throw new Error("RESPONSE_KIND_REJECTED");
    }
    const key = intentIdentityKey(input);
    const existing = this.rows.get(key);
    if (existing) return { created: false, intent: existing };
    const intent: StoredIntent = {
      companyId: input.companyId,
      channel: input.channel,
      providerMessageId: input.providerMessageId,
      responseKind: input.responseKind,
      phase: input.phase ?? "PERSISTED",
      generation: input.generation ?? 0,
      claimToken: null,
      body: input.body ?? null,
    };
    this.rows.set(key, intent);
    return { created: true, intent };
  }

  read(input: IntentIdentity): StoredIntent | null {
    return this.rows.get(intentIdentityKey(input)) ?? null;
  }

  list(): StoredIntent[] {
    return [...this.rows.values()];
  }

  /**
   * Move a pending ack forward only when the claim token is new, the generation
   * still matches, and no sibling intent is UNKNOWN. Never creates a second ack.
   */
  claimAck(input: IntentIdentity & { generation: number }): { ok: true; claimToken: string; intent: StoredIntent } | { ok: false; code: string } {
    if (input.responseKind !== "ack_v1") return { ok: false, code: "RESPONSE_KIND_REJECTED" };
    const intent = this.read(input);
    if (!intent) return { ok: false, code: "NOT_FOUND" };
    if (intent.phase === "UNKNOWN" || intent.phase === "ATTEMPTING" || intent.phase === "PROVIDER_ACCEPTED" || intent.phase === "DELIVERED" || intent.phase === "READ") {
      return { ok: false, code: "RECONCILE_ONLY" };
    }
    if (this.siblingUnknown(input)) return { ok: false, code: "RECONCILE_ONLY" };
    if (intent.generation !== input.generation) return { ok: false, code: "GENERATION_FENCE" };
    if (intent.phase === "CANCELLED" || intent.phase === "BLOCKED") return { ok: false, code: "NOT_CLAIMABLE" };
    const claimToken = `claim-${intent.providerMessageId}-${intent.generation}`;
    intent.claimToken = claimToken;
    intent.phase = "SEND_RESERVED";
    return { ok: true, claimToken, intent };
  }

  cancelPendingAck(input: Omit<IntentIdentity, "responseKind">): boolean {
    const intent = this.read({ ...input, responseKind: "ack_v1" });
    if (!intent) return false;
    if (intent.phase === "PROVIDER_ACCEPTED" || intent.phase === "DELIVERED" || intent.phase === "READ" || intent.phase === "UNKNOWN" || intent.phase === "ATTEMPTING") {
      return false;
    }
    intent.phase = "CANCELLED";
    intent.claimToken = null;
    return true;
  }

  markPhase(input: IntentIdentity & { phase: ResponsePhase }): StoredIntent | null {
    const intent = this.read(input);
    if (!intent) return null;
    if ((intent.phase === "UNKNOWN" || intent.phase === "ATTEMPTING") && input.phase === "SEND_RESERVED") return intent;
    intent.phase = input.phase;
    return intent;
  }

  siblingUnknown(input: IntentIdentity): boolean {
    return this.list().some(row =>
      row.companyId === input.companyId
      && row.channel === input.channel
      && row.providerMessageId === input.providerMessageId
      && row.phase === "UNKNOWN");
  }
}

export function classifyProviderResult(result: "accepted" | "rejected" | "timeout" | "unknown"): { phase: ResponsePhase; retry: boolean; delivered: false } {
  if (result === "accepted") return { phase: "PROVIDER_ACCEPTED", retry: false, delivered: false };
  if (result === "rejected") return { phase: "REJECTED", retry: false, delivered: false };
  return { phase: "UNKNOWN", retry: false, delivered: false };
}

export function customerVisibleDelivery(phase: ResponsePhase): "accepted" | "delivered" | "read" | "unknown" | "none" {
  if (phase === "PROVIDER_ACCEPTED") return "accepted";
  if (phase === "DELIVERED") return "delivered";
  if (phase === "READ") return "read";
  if (phase === "UNKNOWN" || phase === "ATTEMPTING") return "unknown";
  return "none";
}

export type DispatchAuthorization =
  | { ok: true }
  | { ok: false; code: "ACK_GATE_CLOSED" | "CLAIM_MISMATCH" | "GENERATION_FENCE" | "RECONCILE_ONLY" | "AUTHORITY_BLOCKED" | "WINDOW_CLOSED" | "RESPONSE_KIND_REJECTED" | "NOT_RESERVED" };

/**
 * Same fences a send intent must pass. The worker flag is intentionally ignored:
 * fallback ack is an independent gate, and a disabled worker does not open it.
 */
export function authorizeContinuityDispatch(input: {
  ackGateOpen: boolean;
  intent: StoredIntent;
  claimToken: string;
  expectedGeneration: number;
  siblingUnknown: boolean;
  authority: Authority;
  serviceWindowOpen: boolean;
}): DispatchAuthorization {
  if (!input.ackGateOpen) return { ok: false, code: "ACK_GATE_CLOSED" };
  if (input.intent.responseKind !== "ack_v1" && input.intent.responseKind !== "answer_v1") {
    return { ok: false, code: "RESPONSE_KIND_REJECTED" };
  }
  if (input.intent.phase !== "SEND_RESERVED") return { ok: false, code: "NOT_RESERVED" };
  if (!input.claimToken || input.intent.claimToken !== input.claimToken) return { ok: false, code: "CLAIM_MISMATCH" };
  if (input.intent.generation !== input.expectedGeneration) return { ok: false, code: "GENERATION_FENCE" };
  if (input.siblingUnknown) return { ok: false, code: "RECONCILE_ONLY" };
  if (input.authority !== "AUTHORIZED") return { ok: false, code: "AUTHORITY_BLOCKED" };
  if (!input.serviceWindowOpen) return { ok: false, code: "WINDOW_CLOSED" };
  return { ok: true };
}

export function continuityOwnershipNotice(input: {
  ar: boolean;
  status: string;
  automationAllowed: boolean;
  humanClaimed: boolean;
  sendUnknown?: boolean;
  sendFailed?: boolean;
  ackSent?: boolean;
}): string {
  const ar = input.ar;
  let base = input.status === "resolved"
    ? (ar ? "المحادثة محلولة" : "Conversation resolved")
    : input.humanClaimed
      ? (ar ? "مستلم — الموظف يدير المحادثة" : "Claimed — staff is handling the conversation")
      : input.automationAllowed
        ? (ar ? "في انتظار الذكاء الاصطناعي" : "Waiting for AI")
        : (ar ? "في انتظار موظف" : "Waiting for staff");
  if (input.ackSent) base += ar ? " · تم الإقرار" : " · Acknowledgement sent";
  if (input.sendFailed) base += ar ? " · فشل الإرسال" : " · Send failed";
  if (input.sendUnknown) base += ar ? " · نتيجة الإرسال غير معروفة" : " · Send result unknown";
  return base;
}

export type InboundBatchClaim = {
  claim: boolean;
  freeform: boolean;
  ai: "answer" | "stop";
  reason: "worker_disabled" | "company_suspended" | "human_claimed" | "not_eligible" | "service_window_closed" | "neutral_ack_only" | "safe_answer";
};

/**
 * Mirrors the live batch predicate. A closed service window never authorizes
 * free-form text. The worker flag is checked before the batch is called.
 */
export function inboundBatchMayClaim(input: {
  workerEnabled: boolean;
  serviceWindowOpen: boolean;
  status: string;
  automationAllowed: boolean;
  ownership: HumanOwnership;
  companySuspended?: boolean;
  sensitive?: boolean;
  ackGateOpen?: boolean;
}): InboundBatchClaim {
  if (!input.workerEnabled) return { claim: false, freeform: false, ai: "stop", reason: "worker_disabled" };
  if (input.companySuspended) return { claim: false, freeform: false, ai: "stop", reason: "company_suspended" };
  const claimed = input.ownership === "CLAIMED_ACTIVE" || input.ownership === "CLAIMED_IDLE" || input.ownership === "RESOLVED" || input.status === "resolved";
  if (claimed) return { claim: false, freeform: false, ai: "stop", reason: "human_claimed" };
  const unclaimedHandoff = input.ownership === "REQUESTED_UNCLAIMED"
    || (input.status === "handed_over" && input.ownership === "NONE");
  const openAutomation = input.status === "open" && input.automationAllowed;
  if (!openAutomation && !unclaimedHandoff) return { claim: false, freeform: false, ai: "stop", reason: "not_eligible" };
  if (!input.serviceWindowOpen) return { claim: false, freeform: false, ai: "stop", reason: "service_window_closed" };
  if (input.sensitive) {
    return { claim: true, freeform: input.ackGateOpen === true, ai: "stop", reason: "neutral_ack_only" };
  }
  return { claim: true, freeform: true, ai: "answer", reason: "safe_answer" };
}

export function webhookDurableStatus(input: { signatureValid: boolean; persisted: boolean }): 200 | 401 | 500 {
  if (!input.signatureValid) return 401;
  if (!input.persisted) return 500;
  return 200;
}
