import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createInstagramWebhookPersistence } from "./webhook-store";
import type { InstagramRpcClient } from "./connection-store";
import type { InstagramWebhookPersistenceBatch } from "./webhook-route";
const batch: InstagramWebhookPersistenceBatch = { rawBodySha256: "a".repeat(64), localReceivedAt: "2026-10-11T00:00:00.000Z", events: [{ kind: "message", professionalAccountId: "100", senderId: "200", recipientId: "100", messageId: "mid.1", direction: "inbound", isEcho: null, content: { kind: "text", text: "synthetic" }, rawTimestamp: "opaque" }] };
function client(data: unknown, error: unknown = null) { return { rpc: vi.fn<InstagramRpcClient["rpc"]>(async () => ({ data, error })) }; }
it("fits the injected whole-batch port and returns only an exact committed receipt", async () => {
  const c = client({ status: "committed" });
  expect(await createInstagramWebhookPersistence(c)(batch)).toEqual({ status: "committed" });
  expect(c.rpc).toHaveBeenCalledWith("instagram_ingest_webhook", { p_batch: batch });
});
it("captures only allowlisted normalized fields before an awaited RPC", async () => {
  const c = client({ status: "committed" });
  const supplied = { ...batch, companyId: "forged", generation: 99, accessToken: "synthetic-secret", events: [{ ...batch.events[0], companyId: "forged", payload: "discard", content: { kind: "text", text: "synthetic", url: "discard" } }] };
  expect(await createInstagramWebhookPersistence(c)(supplied as never)).toEqual({ status: "committed" });
  expect(c.rpc.mock.calls[0][1]).toEqual({ p_batch: batch });
});
it.each([null, {}, { status: "retryable" }, { status: "queued" }, { status: "committed", partial: true }, Object.create({ status: "committed" }), Object.assign([], { status: "committed" }), Object.defineProperty({ status: "committed" }, "hidden", { value: true }), { get status() { return "committed"; } }])("never claims durability for an uncertain receipt", async data => {
  const c = client(data);
  expect(await createInstagramWebhookPersistence(c)(batch)).toEqual({ status: "retryable" });
  expect(c.rpc).toHaveBeenCalledTimes(1);
});
it("sanitizes errors without logging or internal retry", async () => {
  const c = client({ status: "committed" }, { detail: "synthetic-secret" });
  expect(await createInstagramWebhookPersistence(c)(batch)).toEqual({ status: "retryable" });
  c.rpc.mockRejectedValue(Error("synthetic-secret"));
  expect(await createInstagramWebhookPersistence(c)(batch)).toEqual({ status: "retryable" });
  expect(c.rpc).toHaveBeenCalledTimes(2);
});
it("fails closed before RPC for malformed identity, direction or raw metadata", async () => {
  const c = client({ status: "committed" });
  for (const supplied of [{ ...batch, rawBodySha256: "invalid" }, { ...batch, localReceivedAt: "invalid" }, { ...batch, events: [{ ...batch.events[0], recipientId: "300" }] }, { ...batch, events: [{ ...batch.events[0], direction: "outbound" }] }, { ...batch, events: [{ ...batch.events[0], rawTimestamp: {} }] }, { ...batch, events: [{ ...batch.events[0], isEcho: true }] }]) expect(await createInstagramWebhookPersistence(c)(supplied as never)).toEqual({ status: "retryable" });
  expect(c.rpc).not.toHaveBeenCalled();
});
it("non-text evidence drops attachment data and optional timestamps stay absent", async () => {
  const c = client({ status: "committed" });
  const event = { kind: "message", professionalAccountId: "100", senderId: "200", recipientId: "100", messageId: "mid.media", direction: "inbound", isEcho: false, content: { kind: "non_text", attachments: [{ url: "discard" }] } };
  expect(await createInstagramWebhookPersistence(c)({ ...batch, events: [event] } as never)).toEqual({ status: "committed" });
  expect(c.rpc.mock.calls[0][1]).toEqual({ p_batch: { ...batch, events: [{ ...event, content: { kind: "non_text" } }] } });
});
it("never sends a forged company or generation with historical read evidence", async () => {
  const c = client({ status: "committed" });
  const event = { kind: "read", professionalAccountId: "100", senderId: "200", recipientId: "100", messageId: "mid.old", rawTimestamp: null, rawEntryTimestamp: 0, companyId: "forged" };
  await createInstagramWebhookPersistence(c)({ ...batch, events: [event] } as never);
  const { companyId: _company, ...expected } = event; void _company;
  expect(c.rpc.mock.calls[0][1]).toEqual({ p_batch: { ...batch, events: [expected] } });
});
it("catches throwing getters before dispatch", async () => {
  const c = client({ status: "committed" });
  expect(await createInstagramWebhookPersistence(c)({ ...batch, get events(): never { throw Error("synthetic-secret"); } })).toEqual({ status: "retryable" });
  expect(c.rpc).not.toHaveBeenCalled();
});
