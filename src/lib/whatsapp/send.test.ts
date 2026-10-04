import { afterEach, describe, expect, it, vi } from "vitest";

describe("sendWhatsappText guards", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("refuses Graph calls when external send is disabled", async () => {
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1279881708549662");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { sendWhatsappText } = await import("./send");
    const result = await sendWhatsappText({ toWaId: "96890000000", body: "hi" });
    expect(result).toEqual({ ok: false, code: "SEND_DISABLED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports missing configuration when send is allowed but token is absent", async () => {
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1279881708549662");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { sendWhatsappText } = await import("./send");
    const result = await sendWhatsappText({ toWaId: "96890000000", body: "hi" });
    expect(result).toEqual({ ok: false, code: "NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
