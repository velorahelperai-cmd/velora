import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Graph acceptance evidence", () => {
  beforeEach(() => {
    vi.stubEnv("WHATSAPP_ROUTING_MODE", "single_tenant");
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "offline-fixture-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "100000000000001");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const input = { toWaId: "10000000001", body: "Offline fixture", phoneNumberId: "100000000000001" };

  it.each(["recipient-10000000001", "+10000000001", "100 00000001"])("does not reinterpret stored recipient %s", async (toWaId) => {
    const graph = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.offline" }] })));
    const { sendWhatsappText } = await import("./send");
    expect(await sendWhatsappText({ ...input, toWaId }))
      .toEqual({ ok: false, code: "GRAPH_REJECTED", detail: "invalid_recipient" });
    expect(graph).not.toHaveBeenCalled();
  });

  it.each([42, {}, "   "])("does not accept malformed provider id %j", async (id) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messages: [{ id }] })));
    const { sendWhatsappText } = await import("./send");
    expect(await sendWhatsappText(input)).toEqual({ ok: false, code: "AMBIGUOUS", detail: "missing_provider_id" });
  });

  it("does not accept contradictory Graph success and error evidence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      messages: [{ id: "wamid.offline" }], error: { message: "Invalid recipient", code: 100 },
    })));
    const { sendWhatsappText } = await import("./send");
    expect(await sendWhatsappText(input)).toMatchObject({ ok: false, code: "AMBIGUOUS" });
  });

  it("treats HTTP success without a provider id as uncertain and never retries", async () => {
    const graph = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const { sendWhatsappText } = await import("./send");
    expect(await sendWhatsappText(input)).toEqual({ ok: false, code: "AMBIGUOUS", detail: "missing_provider_id" });
    expect(graph).toHaveBeenCalledTimes(1);
  });

  it.each(["TimeoutError", "AbortError", "TypeError"])("never resends after provider uncertainty: %s", async (name) => {
    const error = new Error("Offline transport failure");
    error.name = name;
    const graph = vi.spyOn(globalThis, "fetch").mockRejectedValue(error);
    const { sendWhatsappText } = await import("./send");
    expect(await sendWhatsappText(input)).toEqual({ ok: false, code: "AMBIGUOUS", detail: name === "TypeError" ? "network" : "timeout" });
    expect(graph).toHaveBeenCalledTimes(1);
  });

  it("returns provider acceptance without claiming delivery", async () => {
    const graph = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.offline" }] })));
    const { sendWhatsappText } = await import("./send");
    expect(await sendWhatsappText(input)).toEqual({ ok: true, waMessageId: "wamid.offline" });
    expect(graph).toHaveBeenCalledTimes(1);
  });
});
