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
    const result = await sendWhatsappText({
      toWaId: "96890000000",
      body: "hi",
      phoneNumberId: "1279881708549662",
    });
    expect(result).toEqual({ ok: false, code: "SEND_DISABLED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports missing configuration when send is allowed but token is absent", async () => {
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1279881708549662");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { sendWhatsappText } = await import("./send");
    const result = await sendWhatsappText({
      toWaId: "96890000000",
      body: "hi",
      phoneNumberId: "1279881708549662",
    });
    expect(result).toEqual({ ok: false, code: "NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses mismatched phone number id without calling Graph", async () => {
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1279881708549662");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { sendWhatsappText } = await import("./send");
    const result = await sendWhatsappText({
      toWaId: "96890000000",
      body: "hi",
      phoneNumberId: "other-phone",
    });
    expect(result).toEqual({ ok: false, code: "PHONE_MISMATCH" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats 5xx without Graph error as AMBIGUOUS not GRAPH_REJECTED", async () => {
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1279881708549662");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 503, headers: { "content-type": "application/json" } }),
    );
    const { sendWhatsappText } = await import("./send");
    const result = await sendWhatsappText({
      toWaId: "96890000000",
      body: "hi",
      phoneNumberId: "1279881708549662",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("AMBIGUOUS");
  });

  it("treats 4xx with Graph error object as GRAPH_REJECTED", async () => {
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1279881708549662");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ error: { message: "Invalid parameter", code: 100 } }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    const { sendWhatsappText } = await import("./send");
    const result = await sendWhatsappText({
      toWaId: "96890000000",
      body: "hi",
      phoneNumberId: "1279881708549662",
    });
    expect(result).toEqual({
      ok: false,
      code: "GRAPH_REJECTED",
      detail: "Invalid parameter",
    });
  });

  it("does not use the env token for another number in tenant_registry", async () => {
    vi.stubEnv("WHATSAPP_ROUTING_MODE", "tenant_registry");
    vi.stubEnv("WHATSAPP_ALLOW_EXTERNAL_SEND", "true");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "env-company-token");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1279881708549662");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { sendWhatsappText } = await import("./send");
    const result = await sendWhatsappText({
      toWaId: "96890000000",
      body: "hi",
      phoneNumberId: "phone-other-company",
    });
    expect(result).toEqual({ ok: false, code: "NEEDS_SETUP" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
