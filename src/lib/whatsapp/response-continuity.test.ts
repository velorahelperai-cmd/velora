import { describe, expect, it } from "vitest";
import {
  authorizeContinuityDispatch,
  classifyProviderResult,
  continuityAckGate,
  continuityOwnershipNotice,
  customerVisibleDelivery,
  decideInboundContinuity,
  deriveHumanOwnership,
  NEUTRAL_ACK_TEXT,
  ResponseIntentLedger,
  webhookDurableStatus,
} from "./response-continuity";

const message = { companyId: "company", channel: "whatsapp" as const, providerMessageId: "wamid.1" };

describe("human ownership is independent of handed_over", () => {
  it("treats handed_over without a staff claim as requested and unclaimed", () => {
    expect(deriveHumanOwnership({ status: "handed_over" })).toBe("REQUESTED_UNCLAIMED");
    expect(deriveHumanOwnership({
      status: "handed_over",
      latestControlAction: "worker_escalation",
      handoffReason: "attempts_exhausted",
    })).toBe("REQUESTED_UNCLAIMED");
  });

  it("does not treat a coexistence automation stop as a staff claim", () => {
    expect(deriveHumanOwnership({
      status: "handed_over",
      latestControlAction: "take_over",
      latestControlReason: "coexistence_signup_ai_disabled",
    })).toBe("REQUESTED_UNCLAIMED");
  });

  it("records an explicit take_over or human_claimed event as staff ownership", () => {
    expect(deriveHumanOwnership({ status: "handed_over", latestControlAction: "human_claimed", staffReplied: true })).toBe("CLAIMED_ACTIVE");
    expect(deriveHumanOwnership({ status: "open", latestControlAction: "take_over", idleMs: 10_000 })).toBe("CLAIMED_ACTIVE");
    expect(deriveHumanOwnership({ status: "open", latestControlAction: "take_over", idleMs: 130_000 })).toBe("CLAIMED_IDLE");
  });
});

describe("continuity decisions", () => {
  it("answers a safe question while a handoff is still unclaimed", () => {
    const decision = decideInboundContinuity({
      ownership: "REQUESTED_UNCLAIMED",
      previewReason: null,
      workerEnabled: true,
      ackGateOpen: false,
      elapsedMs: 1_000,
    });
    expect(decision.ai).toBe("answer");
    expect(decision.ack).toBe("none");
    expect(decision.freeform).toBe(true);
  });

  it("stops AI while a claim is active", () => {
    const decision = decideInboundContinuity({
      ownership: "CLAIMED_ACTIVE",
      previewReason: null,
      workerEnabled: true,
      ackGateOpen: true,
    });
    expect(decision).toMatchObject({ ai: "stop", stopCode: "HUMAN_CLAIMED", ack: "cancel" });
  });

  it("schedules one neutral ack after the answer SLA when the independent gate is open", () => {
    const decision = decideInboundContinuity({
      ownership: "NONE",
      elapsedMs: 20_000,
      answerReady: false,
      workerEnabled: true,
      ackGateOpen: true,
    });
    expect(decision.ack).toBe("schedule");
    expect(decision.plan).toMatchObject({ responseKind: "ack_v1", phase: "ACK_DUE", body: NEUTRAL_ACK_TEXT });
    expect(decision.ai).toBe("answer");
  });

  it("keeps the fallback ack closed unless its own gate is exactly true", () => {
    expect(continuityAckGate({ WHATSAPP_WORKER_ENABLED: "true", WHATSAPP_FIXED_ACK_ENABLED: "true" })).toEqual({
      open: false,
      reason: "continuity_ack_closed",
    });
    expect(continuityAckGate({ WHATSAPP_CONTINUITY_ACK_ENABLED: "true", WHATSAPP_WORKER_ENABLED: "false" }).open).toBe(true);
    const closed = decideInboundContinuity({
      ownership: "NONE",
      elapsedMs: 30_000,
      workerEnabled: false,
      ackGateOpen: false,
    });
    expect(closed).toMatchObject({ ai: "stop", stopCode: "WORKER_DISABLED", ack: "closed", freeform: false });
  });

  it("sends no substantive answer for a sensitive or explicit human request", () => {
    for (const previewReason of ["sensitive", "human_request"] as const) {
      const decision = decideInboundContinuity({
        ownership: "REQUESTED_UNCLAIMED",
        previewReason,
        workerEnabled: true,
        ackGateOpen: true,
      });
      expect(decision.ai).toBe("stop");
      expect(decision.stopCode).toBe("HUMAN_REVIEW_REQUIRED");
      expect(decision.plan.body).toBe(NEUTRAL_ACK_TEXT);
      expect(decision.plan.body).not.toMatch(/سعر|موعد|تم الحجز|refund/i);
    }
  });

  it("reconciles an unknown provider result and never authorizes another send", () => {
    expect(classifyProviderResult("timeout")).toEqual({ phase: "UNKNOWN", retry: false, delivered: false });
    expect(classifyProviderResult("unknown").retry).toBe(false);
    expect(classifyProviderResult("accepted")).toMatchObject({ phase: "PROVIDER_ACCEPTED", delivered: false });
    expect(customerVisibleDelivery("PROVIDER_ACCEPTED")).toBe("accepted");
    expect(customerVisibleDelivery("DELIVERED")).toBe("delivered");
    const decision = decideInboundContinuity({ ownership: "NONE", sendUnknown: true, ackGateOpen: true, workerEnabled: true });
    expect(decision).toMatchObject({ ack: "reconcile", ai: "stop", freeform: false });
  });

  it("refuses free-form text when the 24h window is closed", () => {
    const decision = decideInboundContinuity({
      ownership: "NONE",
      serviceWindowOpen: false,
      ackGateOpen: true,
      workerEnabled: true,
      elapsedMs: 30_000,
    });
    expect(decision.freeform).toBe(false);
    expect(decision.ack).toBe("closed");
    expect(decision.stopCode).toBe("SERVICE_WINDOW_CLOSED");
    expect(decision.plan.body).toBeNull();
  });

  it("escalates an unclaimed handoff after 60s without stopping a safe answer", () => {
    const decision = decideInboundContinuity({
      ownership: "REQUESTED_UNCLAIMED",
      elapsedMs: 60_000,
      workerEnabled: true,
      ackGateOpen: false,
    });
    expect(decision.escalate).toBe(true);
    expect(decision.ai).toBe("answer");
  });
});

describe("intent identity and webhook durability", () => {
  it("keeps one inbound, one ack, and one answer across three deliveries", () => {
    const ledger = new ResponseIntentLedger();
    const deliveries = [1, 2, 3].map(() => ledger.acceptInbound(message));
    expect(deliveries.map(row => row.created)).toEqual([true, false, false]);
    expect(ledger.inboundCount()).toBe(1);
    expect(ledger.reserve({ ...message, responseKind: "ack_v1", phase: "ACK_DUE" }).created).toBe(true);
    expect(ledger.reserve({ ...message, responseKind: "ack_v1", phase: "SEND_RESERVED" }).created).toBe(false);
    expect(ledger.reserve({ ...message, responseKind: "answer_v1" }).created).toBe(true);
    expect(ledger.reserve({ ...message, responseKind: "answer_v1" }).created).toBe(false);
    expect(ledger.list().map(row => row.responseKind).sort()).toEqual(["ack_v1", "answer_v1"]);
  });

  it("cancels a pending ack when staff replies and refuses a blind reclaim after UNKNOWN", () => {
    const ledger = new ResponseIntentLedger();
    ledger.reserve({ ...message, responseKind: "ack_v1", phase: "ACK_DUE", generation: 4 });
    expect(ledger.cancelPendingAck(message)).toBe(true);
    expect(ledger.read({ ...message, responseKind: "ack_v1" })?.phase).toBe("CANCELLED");
    const pending = { ...message, providerMessageId: "wamid.unknown" };
    ledger.reserve({ ...pending, responseKind: "answer_v1", generation: 4 });
    ledger.markPhase({ ...pending, responseKind: "answer_v1", phase: "UNKNOWN" });
    ledger.reserve({ ...pending, responseKind: "ack_v1", phase: "ACK_DUE", generation: 4 });
    expect(ledger.claimAck({ ...pending, responseKind: "ack_v1", generation: 4 })).toEqual({ ok: false, code: "RECONCILE_ONLY" });
  });

  it("returns a retryable status when durable persist fails and 200 only after persist", () => {
    expect(webhookDurableStatus({ signatureValid: false, persisted: false })).toBe(401);
    expect(webhookDurableStatus({ signatureValid: true, persisted: false })).toBe(500);
    expect(webhookDurableStatus({ signatureValid: true, persisted: true })).toBe(200);
  });

  it("requires the ack gate, claim token, and generation before dispatch, and does not call a sender otherwise", () => {
    const ledger = new ResponseIntentLedger();
    const reserved = ledger.reserve({ ...message, responseKind: "ack_v1", phase: "ACK_DUE", generation: 2 });
    const claimed = ledger.claimAck({ ...reserved.intent, generation: 2 });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    const sends: string[] = [];
    const send = () => { sends.push("meta"); return { ok: true as const }; };
    const blocked = authorizeContinuityDispatch({
      ackGateOpen: false,
      intent: claimed.intent,
      claimToken: claimed.claimToken,
      expectedGeneration: 2,
      siblingUnknown: false,
      authority: "AUTHORIZED",
      serviceWindowOpen: true,
    });
    expect(blocked).toEqual({ ok: false, code: "ACK_GATE_CLOSED" });
    if (blocked.ok) send();
    expect(sends).toEqual([]);
    expect(authorizeContinuityDispatch({
      ackGateOpen: true,
      intent: claimed.intent,
      claimToken: "other",
      expectedGeneration: 2,
      siblingUnknown: false,
      authority: "AUTHORIZED",
      serviceWindowOpen: true,
    }).ok).toBe(false);
    expect(authorizeContinuityDispatch({
      ackGateOpen: true,
      intent: claimed.intent,
      claimToken: claimed.claimToken,
      expectedGeneration: 3,
      siblingUnknown: false,
      authority: "AUTHORIZED",
      serviceWindowOpen: true,
    })).toEqual({ ok: false, code: "GENERATION_FENCE" });
    expect(authorizeContinuityDispatch({
      ackGateOpen: true,
      intent: claimed.intent,
      claimToken: claimed.claimToken,
      expectedGeneration: 2,
      siblingUnknown: true,
      authority: "AUTHORIZED",
      serviceWindowOpen: true,
    })).toEqual({ ok: false, code: "RECONCILE_ONLY" });
    expect(authorizeContinuityDispatch({
      ackGateOpen: true,
      intent: claimed.intent,
      claimToken: claimed.claimToken,
      expectedGeneration: 2,
      siblingUnknown: false,
      authority: "AUTHORIZED",
      serviceWindowOpen: false,
    })).toEqual({ ok: false, code: "WINDOW_CLOSED" });
  });
});

describe("inbox continuity notice", () => {
  it("names waiting staff, claimed, waiting AI, ack, and send failure from existing signals", () => {
    expect(continuityOwnershipNotice({ ar: true, status: "handed_over", automationAllowed: false, humanClaimed: false })).toBe("في انتظار موظف");
    expect(continuityOwnershipNotice({ ar: true, status: "open", automationAllowed: false, humanClaimed: true })).toBe("مستلم — الموظف يدير المحادثة");
    expect(continuityOwnershipNotice({ ar: false, status: "open", automationAllowed: true, humanClaimed: false })).toBe("Waiting for AI");
    expect(continuityOwnershipNotice({
      ar: true, status: "open", automationAllowed: true, humanClaimed: false, ackSent: true, sendFailed: true, sendUnknown: true,
    })).toContain("تم الإقرار");
  });
});
