import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { runEmailWorker } from "./worker";
import type { EmailClaim } from "./contracts";
const claim: EmailClaim = { id: "11111111-1111-4111-8111-111111111111", claimToken: "22222222-2222-4222-8222-222222222222", idempotencyKey: "velora-subscription-receipt/11111111-1111-4111-8111-111111111111/v1", recipient: "owner@example.test", companyName: "Synthetic", orderId: "33333333-3333-4333-8333-333333333333", amountBaisa: 45000, paidThrough: "2027-01-01T00:00:00Z" };
it("does no claim or provider work when disabled", async () => {
  const ports = { claim: vi.fn(), finish: vi.fn(), send: vi.fn() };
  expect(await runEmailWorker(false, ports)).toMatchObject({ ok: false, code: "EMAIL_DISABLED" }); expect(ports.claim).not.toHaveBeenCalled(); expect(ports.send).not.toHaveBeenCalled();
});
it("claims one receipt and durably finalizes accepted without claiming delivery", async () => {
  const ports = { claim: vi.fn().mockResolvedValue({ ok: true, claim }), finish: vi.fn().mockResolvedValue(true), send: vi.fn().mockResolvedValue({ kind: "accepted", code: "RESEND_ACCEPTED", providerId: "accepted-id" }) };
  expect(await runEmailWorker(true, ports)).toEqual({ ok: true, processed: 1, accepted: 1, delivered: 0, reconciliationRequired: false });
  expect(ports.claim).toHaveBeenCalledOnce(); expect(ports.finish).toHaveBeenCalledWith(claim, { kind: "accepted", code: "RESEND_ACCEPTED", providerId: "accepted-id" });
});
it("does not resend after uncertain provider acceptance or failed persistence", async () => {
  const ports = { claim: vi.fn().mockResolvedValue({ ok: true, claim }), finish: vi.fn().mockResolvedValue(false), send: vi.fn().mockResolvedValue({ kind: "accepted", code: "RESEND_ACCEPTED", providerId: "accepted-id" }) };
  expect(await runEmailWorker(true, ports)).toMatchObject({ ok: false, code: "EMAIL_RECONCILIATION_REQUIRED" }); expect(ports.send).toHaveBeenCalledOnce(); expect(ports.claim).toHaveBeenCalledOnce();
});
it("persists a thrown send as reconciliation required without exposing its error", async () => {
  const ports = { claim: vi.fn().mockResolvedValue({ ok: true, claim }), finish: vi.fn().mockResolvedValue(true), send: vi.fn().mockRejectedValue(Error("provider secret")) };
  expect(await runEmailWorker(true, ports)).toMatchObject({ ok: true, reconciliationRequired: true, accepted: 0 });
  expect(ports.finish).toHaveBeenCalledWith(claim, { kind: "reconciliation_required", code: "RESEND_OUTCOME_UNKNOWN" }); expect(ports.send).toHaveBeenCalledOnce();
});
