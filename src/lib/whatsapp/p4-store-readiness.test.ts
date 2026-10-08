import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { claimInboundJob, completeInboundJob, saveInbound, saveStatus } from "./store";

const message = { phoneNumberId: "phone-fixture", customerWaId: "customer-fixture", customerName: "Fixture", waMessageId: "wamid.fixture", body: "Question", messageType: "text", receivedAt: "2026-10-08T00:00:00.000Z" };
const saved = { ok: true, inserted: true, message_id: "message-fixture", conversation_id: "conversation-fixture", job_id: "job-fixture", job_status: "pending" };
const claimed = { ok: true, job_id: "job-fixture", message_id: "message-fixture", company_id: "company-fixture", wa_message_id: "wamid.fixture", claim_token: "claim-fixture", claim_expires_at: "2099-10-08T00:00:00.000Z", attempt_count: 1 };
function admin(data: unknown) { return { rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient<Database>; }

describe("P4 durable WhatsApp RPC boundaries", () => {
  it("preserves a real duplicate response without inventing a new job", async () => {
    expect(await saveInbound(admin({ ...saved, inserted: false }), "company-fixture", message)).toEqual({ inserted: false, messageId: "message-fixture", conversationId: "conversation-fixture", jobId: "job-fixture", jobStatus: "pending" });
  });
  it.each(["false", null, 1])("rejects nonboolean inserted evidence %s", async inserted => {
    await expect(saveInbound(admin({ ...saved, inserted }), "company-fixture", message)).rejects.toThrow();
  });
  it("does not default a missing durable job state to pending", async () => {
    await expect(saveInbound(admin({ ...saved, job_status: undefined }), "company-fixture", message)).rejects.toThrow();
  });
  it("rejects whitespace durable identity", async () => {
    await expect(saveInbound(admin({ ...saved, job_id: " " }), "company-fixture", message)).rejects.toThrow();
  });
  it("does not coerce status duplicate flags", async () => {
    await expect(saveStatus(admin({ ok: true, inserted: false, duplicate: "false" }), "company-fixture", { phoneNumberId: message.phoneNumberId, waMessageId: message.waMessageId, status: "delivered", recipientWaId: message.customerWaId, occurredAt: message.receivedAt })).rejects.toThrow();
  });
  it("accepts exact new-status RPC shape without a duplicate field", async () => {
    expect(await saveStatus(admin({ ok: true, inserted: true, id: "status-fixture" }), "company-fixture", { phoneNumberId: message.phoneNumberId, waMessageId: message.waMessageId, status: "delivered", recipientWaId: message.customerWaId, occurredAt: message.receivedAt })).toEqual({ inserted: true, duplicate: false });
  });
  it("rejects contradictory status insertion and duplicate evidence", async () => {
    await expect(saveStatus(admin({ ok: true, inserted: true, duplicate: true }), "company-fixture", { phoneNumberId: message.phoneNumberId, waMessageId: message.waMessageId, status: "delivered", recipientWaId: message.customerWaId, occurredAt: message.receivedAt })).rejects.toThrow();
  });
  it("retains a complete claimed job", async () => {
    expect(await claimInboundJob(admin(claimed), "job-fixture")).toMatchObject({ ok: true, jobId: "job-fixture", companyId: "company-fixture", claimToken: "claim-fixture", attemptCount: 1 });
  });
  it.each([
    { job_id: "other-job" }, { claim_expires_at: "invalid" }, { attempt_count: -1 }, { attempt_count: 0.5 },
  ])("rejects malformed claim or wrong job %j", async patch => {
    await expect(claimInboundJob(admin({ ...claimed, ...patch }), "job-fixture")).rejects.toThrow();
  });
  it.each([{ job_id: "other-job", status: "completed" }, { job_id: "job-fixture", status: "claimed" }, { job_id: "job-fixture", status: "failed" }])("does not report completion from conflicting result %j", async patch => {
    await expect(completeInboundJob(admin({ ok: true, result_code: null, ...patch }), { jobId: "job-fixture", claimToken: "claim-fixture", ok: true })).rejects.toThrow();
  });
  it("retains confirmed failure completion as failure", async () => {
    expect(await completeInboundJob(admin({ ok: true, job_id: "job-fixture", status: "failed", result_code: "human_review" }), { jobId: "job-fixture", claimToken: "claim-fixture", ok: false })).toEqual({ ok: true, jobId: "job-fixture", status: "failed", resultCode: "human_review" });
  });
});
