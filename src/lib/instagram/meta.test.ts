import { afterEach, describe, expect, it, vi } from "vitest";
import * as config from "./config";
import { sendInstagramText } from "./meta";

const input = { professionalAccountId: "17841400000000001", recipientId: "12345678901234567", text: "  مرحبا 👋  ", accessToken: "synthetic-private-token" };
function enable() { vi.spyOn(config, "instagramConfig").mockReturnValue({ graphVersion: "v26.0", connectEnabled: false, receiveEnabled: false, sendEnabled: true }); }
function transport(status = 200, body: unknown = { recipient_id: input.recipientId, message_id: "mid.synthetic" }) { return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status })); }
afterEach(() => vi.restoreAllMocks());

describe("Instagram one-attempt text adapter", () => {
  it("blocks real runtime dispatch even with activation environment flags", async () => {
    const fetch = transport();
    expect(await sendInstagramText(input, { fetch })).toEqual({ status: "blocked", code: "SEND_DISABLED" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("posts the exact bound account, recipient and text, and reports acceptance without delivery", async () => {
    enable(); const fetch = transport();
    expect(await sendInstagramText(input, { fetch })).toEqual({ status: "accepted", recipientId: input.recipientId, messageId: "mid.synthetic", delivery: "unconfirmed" });
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe(`https://graph.instagram.com/v26.0/${input.professionalAccountId}/messages`);
    expect(request?.method).toBe("POST");
    expect(request?.redirect).toBe("error");
    expect(request?.headers).toEqual({ Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" });
    expect(JSON.parse(String(request?.body))).toEqual({ recipient: { id: input.recipientId }, message: { text: input.text } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not accept another recipient if caller mutates input during dispatch", async () => {
    enable(); const mutable = { ...input };
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => {
      mutable.recipientId = "999";
      return new Response(JSON.stringify({ recipient_id: "999", message_id: "mid.unrelated" }));
    });
    expect(await sendInstagramText(mutable, { fetch })).toEqual({ status: "unknown", code: "AMBIGUOUS" });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).recipient.id).toBe(input.recipientId);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["a".repeat(1000), "م".repeat(500), "😀".repeat(250)])("accepts exactly 1000 UTF-8 bytes", async text => {
    enable(); const fetch = transport();
    expect((await sendInstagramText({ ...input, text }, { fetch })).status).toBe("accepted");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).message.text).toBe(text);
  });
  it.each(["a".repeat(1001), "م".repeat(500) + "a", "😀".repeat(250) + "a"])("blocks 1001 UTF-8 bytes before transport", async text => {
    enable(); const fetch = transport();
    expect(await sendInstagramText({ ...input, text }, { fetch })).toEqual({ status: "blocked", code: "INVALID_INPUT" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ professionalAccountId: "../other" }, { professionalAccountId: "" }, { recipientId: "other?token=x" }, { recipientId: "" }, { text: "" }, { accessToken: "" }, { accessToken: "token\nheader" }])("rejects invalid dispatch identity or payload", async changed => {
    enable(); const fetch = transport();
    expect((await sendInstagramText({ ...input, ...changed }, { fetch })).status).toBe("blocked");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([null, "v25.0", "v26.0/other"])("never falls back from unsupported or missing version", async graphVersion => {
    vi.spyOn(config, "instagramConfig").mockReturnValue({ graphVersion: graphVersion as "v26.0" | null, connectEnabled: false, receiveEnabled: false, sendEnabled: true });
    const fetch = transport();
    expect(await sendInstagramText(input, { fetch })).toEqual({ status: "blocked", code: "NEEDS_SETUP" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ recipient_id: input.recipientId }, { message_id: "mid.synthetic" }, { recipient_id: "999", message_id: "mid.synthetic" }, { recipient_id: input.recipientId, message_id: "" }, { recipient_id: input.recipientId, message_id: " mid.synthetic " }, null])("treats missing or mismatched success identity as unknown", async body => {
    enable(); const fetch = transport(200, body);
    expect(await sendInstagramText(input, { fetch })).toEqual({ status: "unknown", code: "AMBIGUOUS" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403, 429])("sanitizes proven Graph rejection", async status => {
    enable(); const fetch = transport(status, { error: { code: 190, message: input.accessToken + input.text } });
    expect(await sendInstagramText(input, { fetch })).toEqual({ status: "rejected", code: "GRAPH_REJECTED", detail: "graph_190" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([500, 502, 503])("never retries an uncertain server result", async status => {
    enable(); const fetch = transport(status, { error: { code: 190, message: input.accessToken } });
    expect(await sendInstagramText(input, { fetch })).toEqual({ status: "unknown", code: "AMBIGUOUS" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not echo arbitrary provider error codes", async () => {
    enable(); const fetch = transport(400, { error: { code: input.accessToken, message: input.text } });
    expect(await sendInstagramText(input, { fetch })).toEqual({ status: "rejected", code: "GRAPH_REJECTED", detail: "graph_rejected" });
  });
  it("keeps transport exceptions unknown without leaking secrets or retrying", async () => {
    enable(); const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error(input.accessToken + input.text));
    const result = await sendInstagramText(input, { fetch });
    expect(result).toEqual({ status: "unknown", code: "AMBIGUOUS" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([200, 400])("keeps unreadable responses unknown", async status => {
    enable(); const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response("not JSON", { status }));
    expect(await sendInstagramText(input, { fetch })).toEqual({ status: "unknown", code: "AMBIGUOUS" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([{ message: "" }, { message: " " }, { code: "" }, { code: " " }, { code: input.accessToken }])("keeps malformed rejection proof unknown", async error => {
    enable(); const fetch = transport(400, { error });
    expect(await sendInstagramText(input, { fetch })).toEqual({ status: "unknown", code: "AMBIGUOUS" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps an unproven 4xx response unknown", async () => {
    enable(); expect(await sendInstagramText(input, { fetch: transport(400, {}) })).toEqual({ status: "unknown", code: "AMBIGUOUS" });
  });
});
