import { describe, expect, it, vi } from "vitest";
import {
  paidBranchCompletionAccepted,
  parseConnectionAttempt,
  parseConnectionStart,
  runPaidBranchConnectionComplete,
  runPaidBranchConnectionRecover,
  type PaidBranchConnectionStorePorts,
} from "./paid-branch-connection-flow";
import type { PaidBranchConnectionRead } from "./paid-branch-connection-contracts";

const scope = {
  expectedAccountId: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  branchId: "33333333-3333-4333-8333-333333333333",
  channel: "whatsapp" as const,
};
const attemptId = "55555555-5555-4555-8555-555555555555";
const asOf = "2026-10-20T00:00:00.000000Z";

function read(): PaidBranchConnectionRead {
  return {
    schemaVersion: 1,
    sourceStatus: "ready",
    ...scope,
    asOf,
    revision: "1",
    connection: {
      state: "pending",
      flow: "wa_coexistence",
      attempt: { id: attemptId, generation: 1, expiresAt: "2026-10-20T00:10:00.000000Z", status: "pending" },
      link: null,
      verified: false,
      reasonCodes: [],
    },
    capabilities: { canStart: false, canRecover: true, canCancel: true, allowedFlows: [] },
  };
}

function ports(exchange: PaidBranchConnectionStorePorts["exchange"]): PaidBranchConnectionStorePorts {
  return {
    read: async () => read(),
    start: async () => ({ ok: true, read: read() }),
    claim: async () => ({ ok: true, fresh: true, read: read() }),
    finalize: async () => ({ ok: true, read: read() }),
    recover: async () => ({ ok: true, read: read() }),
    cancel: async () => ({ ok: true, read: read() }),
    exchange,
  };
}

describe("paid branch connection attempt parsing", () => {
  it("accepts a coexistence follow-up without the start-only phone and confirmation fields", () => {
    const parsed = parseConnectionAttempt({ ...scope, flow: "wa_coexistence", attemptId, generation: 1 }, asOf);
    expect("ok" in parsed).toBe(false);
    expect(parseConnectionStart({ ...scope, flow: "wa_coexistence", clientOpId: attemptId, expectedRevision: "0" }, asOf)).toMatchObject({ ok: false, code: "invalid_input" });
  });

  it("rejects a completion whose nested attempt ids disagree", () => {
    expect(paidBranchCompletionAccepted("wa_coexistence", attemptId, {
      attemptId,
      nested: { attempt_id: "66666666-6666-4666-8666-666666666666" },
      confirmed: true,
      confirmedPhoneNumber: "+96891234567",
      nonce: "a".repeat(64),
      code: "unit-code",
    })).toBe(false);
  });

  it("exchanges a fresh claim once and recovers a provider throw after dispatch", async () => {
    const exchange = vi.fn(async () => ({ ok: true as const }));
    const fresh = ports(exchange);
    await runPaidBranchConnectionComplete({ ...scope, flow: "wa_coexistence", attemptId, generation: 1 }, fresh, asOf);
    expect(exchange).toHaveBeenCalledOnce();
    fresh.claim = async () => ({ ok: true, fresh: false, read: read() });
    exchange.mockClear();
    await runPaidBranchConnectionComplete({ ...scope, flow: "wa_coexistence", attemptId, generation: 1 }, fresh, asOf);
    expect(exchange).not.toHaveBeenCalled();
    const recover = vi.fn(async () => ({ ok: true as const, read: read() }));
    await runPaidBranchConnectionComplete({ ...scope, flow: "wa_coexistence", attemptId, generation: 1 }, {
      ...ports(async () => { throw new Error("provider"); }),
      claim: async () => ({ ok: true, fresh: true, read: read() }),
      recover,
    }, asOf);
    expect(recover).toHaveBeenCalledOnce();
  });

  it("recovers without calling exchange", async () => {
    const exchange = vi.fn(async () => ({ ok: true as const }));
    await runPaidBranchConnectionRecover({ ...scope, flow: "wa_coexistence", attemptId, generation: 1 }, ports(exchange), asOf);
    expect(exchange).not.toHaveBeenCalled();
  });
});
