import { describe, expect, it, vi } from "vitest";
import { applyClaimedPreGraphOutcome, decideClaimedTenantSend } from "./send-attempt";
import { classifyPreGraphSettlement } from "./send-failure";

const conversation = { companyId: "co-a", phoneNumberId: "phone-a", customerWaId: "96890000000" };
const clientOpId = "op-old-0001";

function rejectedDecision() {
  return decideClaimedTenantSend({
    companyId: "co-a",
    phoneNumberId: "phone-a",
    recipientWaId: conversation.customerWaId,
    conversation,
    resolved: { ok: false, eligible: false, code: "unavailable" },
    intentLinkId: "link-1",
    intentLinkGeneration: 1,
  });
}

describe("claimed send settlement via finalizer", () => {
  it("keeps the original operation locked if rejected finalization throws", async () => {
    const decision = rejectedDecision();
    if (decision.action === "graph") throw new Error("must not Graph");
    const result = await applyClaimedPreGraphOutcome({
      decision, clientOpId,
      finalize: async () => { throw new Error("Offline RPC network failure"); },
    });
    expect(result).toMatchObject({ ok: false, code: "SAVE_FAILED", clientOpId, outcome: "attempting" });
    expect(result.notAttempted).toBeUndefined();
  });

  it("resolver unavailable before Graph: zero Graph calls and confirmed rejected", async () => {
    const graph = vi.fn();
    const decision = rejectedDecision();
    expect(decision.action).toBe("rejected");
    const finalize = vi.fn(async (args: { result: "rejected" | "unknown"; errorCode: string }) => {
      expect(args.result).toBe("rejected");
      return {
        error: null,
        data: { ok: true, intent: { outcome: "rejected", client_op_id: clientOpId } },
      };
    });
    if (decision.action === "graph") throw new Error("must not Graph");
    const result = await applyClaimedPreGraphOutcome({ decision, clientOpId, finalize });
    expect(graph).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: false,
      code: "REJECTED",
      clientOpId,
      outcome: "rejected",
      notAttempted: true,
    });
  });

  it("failed rejected persist keeps the lock and the same client_op_id", async () => {
    const decision = rejectedDecision();
    if (decision.action === "graph") throw new Error("must not Graph");
    const result = await applyClaimedPreGraphOutcome({
      decision,
      clientOpId,
      finalize: async () => ({ error: { message: "rpc_failed" }, data: null }),
    });
    expect(result.ok).toBe(false);
    expect(result.code).not.toBe("REJECTED");
    expect(result.clientOpId).toBe(clientOpId);
    expect(result.notAttempted).toBeUndefined();
    expect(result.outcome).toBe("attempting");
  });

  it("stale claim token does not fake rejected or unlock", async () => {
    const decision = rejectedDecision();
    if (decision.action === "graph") throw new Error("must not Graph");
    const result = await applyClaimedPreGraphOutcome({
      decision,
      clientOpId,
      finalize: async () => ({
        error: null,
        data: {
          ok: false,
          code: "claim_rejected",
          intent: { outcome: "attempting", client_op_id: clientOpId },
        },
      }),
    });
    expect(result).toMatchObject({
      ok: false,
      code: "IN_PROGRESS",
      clientOpId,
      outcome: "attempting",
    });
    expect(result.notAttempted).toBeUndefined();
    expect(classifyPreGraphSettlement({
      error: null,
      data: { ok: false, code: "claim_rejected", intent: { outcome: "attempting" } },
    }).mintNewClientOp).toBe(false);
  });

  it("keeps a prior accepted or unknown outcome and does not send again", async () => {
    const decision = rejectedDecision();
    if (decision.action === "graph") throw new Error("must not Graph");
    const graph = vi.fn();
    const accepted = await applyClaimedPreGraphOutcome({
      decision,
      clientOpId,
      finalize: async () => ({
        error: null,
        data: {
          ok: true,
          already_final: true,
          intent: { outcome: "accepted", wa_message_id: "wamid.1", client_op_id: clientOpId },
        },
      }),
    });
    expect(graph).not.toHaveBeenCalled();
    expect(accepted).toMatchObject({
      ok: false,
      code: "PERSIST_PENDING",
      outcome: "accepted",
      clientOpId,
    });
    expect(accepted.code).not.toBe("REJECTED");

    const unknown = await applyClaimedPreGraphOutcome({
      decision,
      clientOpId,
      finalize: async () => ({
        error: null,
        data: {
          ok: true,
          already_final: true,
          intent: { outcome: "unknown", client_op_id: clientOpId },
        },
      }),
    });
    expect(unknown).toMatchObject({
      ok: false,
      code: "UNKNOWN_OUTCOME",
      outcome: "unknown",
      clientOpId,
    });
  });

  it("after a confirmed pre-Graph reject, a new user attempt needs a new client_op_id", async () => {
    const first = classifyPreGraphSettlement({
      error: null,
      data: { ok: true, intent: { outcome: "rejected", client_op_id: clientOpId } },
    });
    expect(first).toMatchObject({
      status: "rejected_not_attempted",
      mintNewClientOp: true,
      notAttempted: true,
    });
    const retrySameOp = classifyPreGraphSettlement({
      error: null,
      data: {
        ok: true,
        already_final: true,
        intent: { outcome: "rejected", client_op_id: clientOpId },
      },
    });
    expect(retrySameOp.replyCode).toBe("REJECTED");
    expect(retrySameOp.mintNewClientOp).toBe(true);
    const newOpId = "op-new-0002";
    expect(newOpId).not.toBe(clientOpId);
  });
});
