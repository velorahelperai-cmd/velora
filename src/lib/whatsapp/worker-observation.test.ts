import { describe, expect, it } from "vitest";
import { summarizeWorkerOutcomes } from "./worker-observation";
import type { IntegrationOutcome } from "./integration-worker";
const result = (code: string, sendAccepted = false, jobCompleted = false): IntegrationOutcome => ({ ok: false, code, sendAccepted, jobCompleted, delivered: false });
const repair = { repaired: 0, pending: 0 };
describe("worker monitoring without changing execution", () => {
  it("distinguishes accepted sends from pending accounting", () => { const observed = summarizeWorkerOutcomes([result("ACCEPTANCE_ACCOUNTING_PENDING", true)], repair); expect(observed.httpStatus).toBe(202); expect(observed.body).toMatchObject({ accepted: 1, completed: 0, accountingPending: 1, delivered: 0, code: "RECONCILIATION_REQUIRED", automaticRetry: false }); });
  it("exposes persistence pending separately from completed accounting", () => { const observed = summarizeWorkerOutcomes([result("ACCEPTANCE_PERSIST_PENDING", true, true)], repair); expect(observed.body).toMatchObject({ accepted: 1, completed: 1, persistencePending: 1, accountingPending: 0 }); expect(observed.httpStatus).toBe(202); });
  it("keeps an ambiguous send unknown rather than failed", () => { const observed = summarizeWorkerOutcomes([result("SEND_REQUIRES_RECONCILIATION")], repair); expect(observed.body).toMatchObject({ unknown: 1, failed: 0, accepted: 0, automaticRetry: false }); });
  it("does not expose arbitrary future provider text as a code", () => { const observed = summarizeWorkerOutcomes([result("synthetic-sensitive-provider-text")], repair); expect(observed.body.outcomes).toEqual({ WORKER_OUTCOME_UNCLASSIFIED: 1 }); expect(JSON.stringify(observed)).not.toContain("synthetic-sensitive"); });
  it("reports confirmed rejection with a failure status", () => { const observed = summarizeWorkerOutcomes([result("SEND_REJECTED")], repair); expect(observed.httpStatus).toBe(503); expect(observed.body.failed).toBe(1); expect(observed.body.unknown).toBe(0); });
  it("exposes repair backlog even when the claim batch is empty", () => { const observed = summarizeWorkerOutcomes([], { repaired: 2, pending: 3 }); expect(observed.httpStatus).toBe(202); expect(observed.body.repair).toEqual({ repaired: 2, pending: 3 }); });
  it("reports a completed accepted job without claiming delivery", () => { const observed = summarizeWorkerOutcomes([{ ok: true, code: "ACCEPTED", jobCompleted: true, sendAccepted: true, delivered: false }], repair); expect(observed.httpStatus).toBe(200); expect(observed.body).toMatchObject({ accepted: 1, completed: 1, delivered: 0, code: "COMPLETE" }); });
});
