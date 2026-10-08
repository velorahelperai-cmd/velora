import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWhatsappText } from "./send";

const input = { toWaId: "96890000000", phoneNumberId: "phone-a", body: "hi", accessToken: "synthetic-secret" };
beforeEach(() => {
  vi.stubEnv("WHATSAPP_ROUTING_MODE", "tenant_registry");
  vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
  vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION", "v25.0");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("tenant freeform send policy", () => {
  it.each(["", "v25.0/private", "v25.1", "v999999999.0"])("requires an explicit bounded server Graph version %s", async (version) => {
    vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP_GRAPH_VERSION", version);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("forbidden"));
    expect(await sendWhatsappText({ ...input, serviceWindowExpiresAt: "2026-10-08T13:00:00.000Z" }))
      .toEqual({ ok: false, code: "NEEDS_SETUP" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it.each([undefined, "invalid", "2026-10-08T12:00:00.000Z", "2026-10-08T11:59:59.000Z", "2026-10-09T12:00:01.000Z"])(
    "blocks absent, expired, or impossible window %s before contacting Meta", async (serviceWindowExpiresAt) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("forbidden"));
      expect(await sendWhatsappText({ ...input, serviceWindowExpiresAt })).toEqual({ ok: false, code: "SERVICE_WINDOW_CLOSED" });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
  it("sends within a proven window and strips provider error messages", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: {
      code: 190, message: "access_token=synthetic-secret customer private detail",
    } }), { status: 400 }));
    expect(await sendWhatsappText({ ...input, serviceWindowExpiresAt: "2026-10-08T13:00:00.000Z" }))
      .toEqual({ ok: false, code: "GRAPH_REJECTED", detail: "graph_190" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://graph.facebook.com/v25.0/phone-a/messages");
  });
});
