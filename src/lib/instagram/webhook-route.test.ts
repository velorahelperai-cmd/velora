import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstagramWebhookHandlers, MAX_INSTAGRAM_WEBHOOK_BODY_BYTES as LIMIT, type InstagramWebhookReadiness, type InstagramWebhookRoutePorts } from "./webhook-route";
const account = "17841400000000001", customer = "12345678901234567", secret = "synthetic-parent-secret";
const readiness: InstagramWebhookReadiness = { receiveEnabled: true, providerFixtureVerified: true, parentWebhookSecret: { source: "parent_webhook_app", value: secret }, verifyToken: "synthetic-verify-token" };
const envelope = () => ({ object: "instagram", company_id: "forged-company", entry: [{ id: account, time: "unknown-unit", messaging: [{ sender: { id: customer }, recipient: { id: account }, timestamp: 1700000000123, message: { mid: "mid.synthetic", text: "  مرحبا 👋  " } }] }] });
const sign = (raw: Uint8Array) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
function signed(raw: string | Uint8Array = JSON.stringify(envelope()), headers: Record<string, string | undefined> = {}) {
  const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
  const supplied: Record<string, string> = {}; for (const [key, value] of Object.entries(headers)) if (value !== undefined) supplied[key] = value;
  return new Request("http://localhost/api/instagram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sign(bytes), ...supplied }, body: new Uint8Array(bytes).buffer });
}
function fixture(change: Partial<InstagramWebhookReadiness> = {}) {
  let current = { ...readiness, ...change };
  const persist = vi.fn<NonNullable<InstagramWebhookRoutePorts["persist"]>>().mockResolvedValue({ status: "committed" });
  const handlers = createInstagramWebhookHandlers({ readReadiness: () => current, persist });
  return { ...handlers, persist, set: (change: Partial<InstagramWebhookReadiness>) => { current = { ...current, ...change }; } };
}
afterEach(() => vi.restoreAllMocks());

describe("closed gate and challenge", () => {
  it.each([{ receiveEnabled: false }, { providerFixtureVerified: false }, { parentWebhookSecret: undefined }, { parentWebhookSecret: { source: "instagram_oauth_app", value: secret } as never }])("requires actual receive/fixture/parent-key readiness before reading or persistence", async change => {
    const f = fixture(change), request = signed(), reader = vi.spyOn(request.body!, "getReader");
    expect((await f.POST(request)).status).toBe(503); expect(reader).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
  });
  it("returns exact challenge as plaintext with nosniff and no-store", async () => {
    const f = fixture(), challenge = "<script>not HTML</script>";
    const response = await f.GET(new Request(`http://localhost/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=${encodeURIComponent(challenge)}`));
    expect(response.status).toBe(200); expect(await response.text()).toBe(challenge);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8"); expect(response.headers.get("x-content-type-options")).toBe("nosniff"); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(f.persist).not.toHaveBeenCalled();
  });
  it.each(["", "?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x", "?hub.mode=wrong&hub.verify_token=synthetic-verify-token&hub.challenge=x", "?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=", "?hub.mode=subscribe&hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=x", "?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.verify_token=synthetic-verify-token&hub.challenge=x", "?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=x&hub.challenge=x"])("rejects missing/invalid/duplicated challenge parameters", async query => {
    const f = fixture(); expect((await f.GET(new Request("http://localhost/api/instagram/webhook" + query))).status).toBe(403); expect(f.persist).not.toHaveBeenCalled();
  });
  it("does not issue a challenge with missing verification token", async () => {
    expect((await fixture({ verifyToken: undefined }).GET(new Request("http://localhost/api/instagram/webhook"))).status).toBe(503);
  });
  it("sanitizes readiness getter failures", async () => {
    const handlers = createInstagramWebhookHandlers({ readReadiness: () => { throw Error(secret); } });
    const response = await handlers.POST(signed()); expect(response.status).toBe(503); expect(await response.text()).not.toContain(secret);
  });
});
describe("headers and bounded raw ingress before parsing/storage", () => {
  it.each([{ "content-type": "text/plain" }, { "content-type": "application/json, application/json" }, { "content-encoding": "gzip" }])("rejects unsupported representation without reading", async headers => {
    const f = fixture(), request = signed(undefined, headers), reader = vi.spyOn(request.body!, "getReader");
    expect((await f.POST(request)).status).toBe(415); expect(reader).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
  });
  it.each(["", "sha1=" + "a".repeat(40), "sha256=" + "a".repeat(63), "sha256=" + "z".repeat(64), "sha256=" + "a".repeat(64) + ", sha256=" + "a".repeat(64)])("rejects missing/malformed/multiple signature before reading", async header => {
    const f = fixture(), request = signed(undefined, { "x-hub-signature-256": header }), reader = vi.spyOn(request.body!, "getReader");
    expect((await f.POST(request)).status).toBe(401); expect(reader).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
  });
  it.each(["-1", "1.5", "NaN", "10, 10"])("rejects invalid content length before reading", async length => {
    const f = fixture(), request = signed(undefined, { "content-length": length }), reader = vi.spyOn(request.body!, "getReader");
    expect((await f.POST(request)).status).toBe(400); expect(reader).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
  });
  it("rejects declared oversize without reading", async () => {
    const f = fixture(), request = signed(undefined, { "content-length": String(LIMIT + 1) }), reader = vi.spyOn(request.body!, "getReader");
    expect((await f.POST(request)).status).toBe(413); expect(reader).not.toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
  });
  it("bounds an undeclared streaming body and cancels after overflow", async () => {
    const cancel = vi.fn(); const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(LIMIT)); controller.enqueue(new Uint8Array(1)); }, cancel });
    const request = new Request("http://localhost/api/instagram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "a".repeat(64) }, body: stream, duplex: "half" } as RequestInit);
    const f = fixture(); expect((await f.POST(request)).status).toBe(413); expect(cancel).toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
  });
  it("accepts a verified envelope exactly at the byte budget", async () => {
    const base = JSON.stringify({ object: "instagram", entry: [], padding: "" });
    const raw = JSON.stringify({ object: "instagram", entry: [], padding: "a".repeat(LIMIT - new TextEncoder().encode(base).length) });
    expect(new TextEncoder().encode(raw).length).toBe(LIMIT); const f = fixture(); expect((await f.POST(signed(raw))).status).toBe(200); expect(f.persist).not.toHaveBeenCalled();
  });
  it("rejects actual/declaration mismatch", async () => {
    const f = fixture(); expect((await f.POST(signed(undefined, { "content-length": "10" }))).status).toBe(400); expect(f.persist).not.toHaveBeenCalled();
  });
  it("rejects unreadable body retryably", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.error(Error(secret)); } });
    const request = new Request("http://localhost/api/instagram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "a".repeat(64) }, body: stream, duplex: "half" } as RequestInit);
    const f = fixture(); const response = await f.POST(request); expect(response.status).toBe(503); expect(await response.text()).not.toContain(secret); expect(f.persist).not.toHaveBeenCalled();
  });
  it("bounds a stalled stream and cancels without storage", async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn(), stream = new ReadableStream<Uint8Array>({ cancel });
      const request = new Request("http://localhost/api/instagram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "a".repeat(64) }, body: stream, duplex: "half" } as RequestInit);
      const f = fixture(), pending = f.POST(request);
      await vi.advanceTimersByTimeAsync(5000);
      expect((await pending).status).toBe(503); expect(cancel).toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it("aborts a pending body read without storage", async () => {
    const controller = new AbortController(), cancel = vi.fn(), stream = new ReadableStream<Uint8Array>({ cancel });
    const request = new Request("http://localhost/api/instagram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=" + "a".repeat(64) }, body: stream, duplex: "half", signal: controller.signal } as RequestInit);
    let opened!:()=>void;const started=new Promise<void>(resolve=>{opened=resolve;});
    const getReader=request.body!.getReader.bind(request.body);
    vi.spyOn(request.body!,"getReader").mockImplementation((...args:[])=>{opened();return getReader(...args);});
    const f = fixture(), pending = f.POST(request); await started;controller.abort();
    expect((await pending).status).toBe(503); expect(cancel).toHaveBeenCalled(); expect(f.persist).not.toHaveBeenCalled();
  });
  it("accepts exact declared size with explicit UTF8 JSON representation", async () => {
    const raw = JSON.stringify(envelope()); const f = fixture();
    expect((await f.POST(signed(raw, { "content-length": String(new TextEncoder().encode(raw).length), "content-type": "application/json; charset=utf-8", "content-encoding": "identity" }))).status).toBe(200);
  });
  it("verifies exact body bytes before JSON and DB", async () => {
    const f = fixture(); expect((await f.POST(signed("not JSON", { "x-hub-signature-256": sign(new TextEncoder().encode("other")) }))).status).toBe(401); expect(f.persist).not.toHaveBeenCalled();
  });
  it.each([new TextEncoder().encode("not JSON"), new Uint8Array([0xc3, 0x28])])("rejects signed malformed JSON/UTF8 before DB", async raw => {
    const f = fixture(); expect((await f.POST(signed(raw))).status).toBe(400); expect(f.persist).not.toHaveBeenCalled();
  });
});
describe("verified dispositions and actual persistence boundary", () => {
  it("explicitly acknowledges unsupported verified events without storage dependency", async () => {
    const handlers = createInstagramWebhookHandlers({ readReadiness: () => readiness });
    const response = await handlers.POST(signed(JSON.stringify({ object: "instagram", entry: [{ id: account, messaging: [{ delivery: { mids: ["mid.synthetic"] } }] }] })));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, disposition: "ignored", ignored: { UNSUPPORTED_EVENT: 1 } });
  });
  it("never acknowledges supported evidence as persisted without a port", async () => {
    const handlers = createInstagramWebhookHandlers({ readReadiness: () => readiness });
    const response = await handlers.POST(signed()); expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, code: "PERSISTENCE_UNAVAILABLE" }); expect(response.headers.get("retry-after")).toBe("5");
  });
  it("passes exact normalized historical-account evidence once and no forged company", async () => {
    const f = fixture(), response = await f.POST(signed()); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, disposition: "persisted", eventCount: 1, ignored: {} });
    const batch = f.persist.mock.calls[0][0]; expect(batch.events[0]).toMatchObject({ professionalAccountId: account, messageId: "mid.synthetic", rawTimestamp: 1700000000123, rawEntryTimestamp: "unknown-unit", content: { kind: "text", text: "  مرحبا 👋  " } });
    expect(batch.rawBodySha256).toMatch(/^[a-f0-9]{64}$/); expect(batch.localReceivedAt).toMatch(/^\d{4}-/); expect(JSON.stringify(batch)).not.toContain("forged-company"); expect(batch.events[0]).not.toHaveProperty("windowExpiresAt"); expect(f.persist).toHaveBeenCalledTimes(1);
  });
  it.each([{ status: "retryable" }, undefined, { status: "queued" }, { status: "committed", partial: true }])("never treats unavailable/unknown/partial persistence as a commit", async result => {
    const f = fixture(); f.persist.mockResolvedValue(result as never); const response = await f.POST(signed()); expect(response.status).toBe(503); expect(f.persist).toHaveBeenCalledTimes(1);
  });
  it.each([
    { result: Object.assign([], { status: "committed" }) },
    { result: Object.assign(() => {}, { status: "committed" }) },
    { result: Object.defineProperty({ status: "committed" }, "partial", { value: true }) },
    { result: Object.assign(Object.create({ status: "committed" }), { partial: true }) },
    { result: { get status() { return "committed"; } } },
  ])("requires an exact plain own data commit receipt", async ({ result }) => {
    const f = fixture(); f.persist.mockResolvedValue(result as never);
    expect((await f.POST(signed())).status).toBe(503); expect(f.persist).toHaveBeenCalledTimes(1);
  });
  it("sanitizes uncertain port exceptions without retrying internally", async () => {
    const f = fixture(); f.persist.mockRejectedValue(Error(secret + "private message")); const response = await f.POST(signed()); expect(response.status).toBe(503); expect(await response.text()).not.toContain(secret); expect(f.persist).toHaveBeenCalledTimes(1);
  });
  it("persists supported neighbors while explicitly reporting ignored verified types", async () => {
    const payload = envelope(); (payload.entry[0].messaging as unknown[]).push({ delivery: { mids: ["mid.ignored"] } });
    const f = fixture(), response = await f.POST(signed(JSON.stringify(payload)));
    expect(await response.json()).toEqual({ ok: true, disposition: "persisted", eventCount: 1, ignored: { UNSUPPORTED_EVENT: 1 } });
    expect(f.persist.mock.calls[0][0].events).toHaveLength(1);
  });
  it("preserves duplicate evidence and lets real persistence dedup provider redelivery", async () => {
    const f = fixture(), payload = envelope(); payload.entry[0].messaging.push(payload.entry[0].messaging[0]); const raw = JSON.stringify(payload);
    expect((await f.POST(signed(raw))).status).toBe(200); expect((await f.POST(signed(raw))).status).toBe(200); expect(f.persist).toHaveBeenCalledTimes(2); expect(f.persist.mock.calls[0][0].events).toHaveLength(2); expect(f.persist.mock.calls[0][0].rawBodySha256).toBe(f.persist.mock.calls[1][0].rawBodySha256);
  });
  it("rechecks activation after awaited body read before persistence", async () => {
    const f = fixture(), request = signed(); const original = request.body!.getReader.bind(request.body);
    vi.spyOn(request.body!, "getReader").mockImplementation((...args: []) => { f.set({ receiveEnabled: false }); return original(...args); });
    expect((await f.POST(request)).status).toBe(503); expect(f.persist).not.toHaveBeenCalled();
  });
  it("does not use a rotated key as a fallback after body read", async () => {
    const f = fixture(), request = signed(); const original = request.body!.getReader.bind(request.body);
    vi.spyOn(request.body!, "getReader").mockImplementation((...args: []) => { f.set({ parentWebhookSecret: { source: "parent_webhook_app", value: "rotated-key" } }); return original(...args); });
    expect((await f.POST(request)).status).toBe(503); expect(f.persist).not.toHaveBeenCalled();
  });
});
it('awaits actual installed readiness before challenge and fails closed on reader rejection',async()=>{
 const h=createInstagramWebhookHandlers({readReadiness:async()=>readiness});
 expect((await h.GET(new Request('http://localhost/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=synthetic-verify-token&hub.challenge=123'))).status).toBe(200);
 const unavailable=createInstagramWebhookHandlers({readReadiness:async()=>{throw Error('installation unavailable');}});expect((await unavailable.GET(new Request('http://localhost/api/instagram/webhook'))).status).toBe(503);
});
it('awaits installed authority again after body read and refuses revoked persistence',async()=>{
 const persist=vi.fn().mockResolvedValue({status:'committed'});
 const readReadiness=vi.fn().mockResolvedValueOnce(readiness).mockResolvedValueOnce({receiveEnabled:false});
 const h=createInstagramWebhookHandlers({readReadiness,persist});
 expect((await h.POST(signed())).status).toBe(503);
 expect(readReadiness).toHaveBeenCalledTimes(2);expect(persist).not.toHaveBeenCalled();
});
