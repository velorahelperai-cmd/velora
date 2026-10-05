import { describe, expect, it } from "vitest";
import { whatsappLinkAllowsRouting } from "./connection";
import {
  decideOutboundGraphAttempt,
  evaluateOutboundBinding,
  resolveWhatsappOutboundSecret,
  type WhatsappTenantResolveFail,
  type WhatsappTenantResolveOk,
} from "./tenant-resolve";
import {
  routeWebhookEvents,
  splitWebhook,
  webhookHttpStatus,
  WEBHOOK_HTTP,
  type InboundMessage,
  type DeliveryStatus,
} from "./webhook";

const customer = "96890000000";

function verified(companyId: string, phone: string, linkId: string, linkGeneration = 1): WhatsappTenantResolveOk {
  return {
    ok: true,
    eligible: true,
    companyId,
    linkId,
    linkGeneration,
    providerPhoneNumberId: phone,
    status: "verified",
  };
}

function fail(code: WhatsappTenantResolveFail["code"], companyId?: string): WhatsappTenantResolveFail {
  return { ok: false, eligible: false, code, companyId };
}

function msg(phone: string, waMessageId: string, from = customer): InboundMessage {
  return {
    phoneNumberId: phone,
    customerWaId: from,
    customerName: "Sara",
    waMessageId,
    body: "hi",
    messageType: "text",
    receivedAt: "2026-10-05T00:00:00.000Z",
  };
}

function st(phone: string, waMessageId: string): DeliveryStatus {
  return {
    phoneNumberId: phone,
    waMessageId,
    status: "delivered",
    recipientWaId: customer,
    occurredAt: "2026-10-05T00:00:01.000Z",
  };
}

describe("tenant registry routing", () => {
  it("routes two numbers to their companies when the customer wa_id is the same", async () => {
    const saved: Array<{ companyId: string; phone: string; id: string }> = [];
    const result = await routeWebhookEvents({
      messages: [msg("phone-a", "wamid.a"), msg("phone-b", "wamid.b")],
      statuses: [st("phone-a", "wamid.a"), st("phone-b", "wamid.b")],
      mode: "tenant_registry",
      envCompanyId: "env-default",
      envPhoneNumberId: "env-phone",
      resolve: async (phone) => {
        if (phone === "phone-a") return { ok: true, companyId: "co-a" };
        if (phone === "phone-b") return { ok: true, companyId: "co-b" };
        return { ok: false, code: "unknown_or_inactive" };
      },
      saveInbound: async (companyId, message) => {
        saved.push({ companyId, phone: message.phoneNumberId, id: message.waMessageId });
      },
      saveStatus: async (companyId, status) => {
        saved.push({ companyId, phone: status.phoneNumberId, id: status.waMessageId });
      },
    });

    expect(result.retry).toBe(false);
    expect(webhookHttpStatus(result)).toBe(WEBHOOK_HTTP.completed);
    expect(saved).toEqual([
      { companyId: "co-a", phone: "phone-a", id: "wamid.a" },
      { companyId: "co-b", phone: "phone-b", id: "wamid.b" },
      { companyId: "co-a", phone: "phone-a", id: "wamid.a" },
      { companyId: "co-b", phone: "phone-b", id: "wamid.b" },
    ]);
    expect(saved.some((row) => row.companyId === "env-default")).toBe(false);
  });

  it("rejects an unknown number instead of the env default company", async () => {
    const saved: string[] = [];
    const result = await routeWebhookEvents({
      messages: [msg("phone-unknown", "wamid.x")],
      statuses: [],
      mode: "tenant_registry",
      envCompanyId: "env-default",
      envPhoneNumberId: "env-phone",
      resolve: async () => ({ ok: false, code: "unknown_or_inactive" }),
      saveInbound: async (companyId) => {
        saved.push(companyId);
      },
      saveStatus: async () => undefined,
    });
    expect(result.retry).toBe(false);
    expect(result.dispositions[0]).toMatchObject({ result: "rejected", code: "unknown_or_inactive" });
    expect(saved).toEqual([]);
  });

  it("rejects request_saved / error / disconnected as inactive", async () => {
    expect(whatsappLinkAllowsRouting("request_saved")).toBe(false);
    expect(whatsappLinkAllowsRouting("error")).toBe(false);
    expect(whatsappLinkAllowsRouting("disconnected")).toBe(false);
    expect(whatsappLinkAllowsRouting("verified")).toBe(true);

    const result = await routeWebhookEvents({
      messages: [msg("phone-a", "wamid.1")],
      statuses: [],
      mode: "tenant_registry",
      envCompanyId: "env-default",
      envPhoneNumberId: "env-phone",
      resolve: async () => ({ ok: false, code: "unknown_or_inactive" }),
      saveInbound: async () => {
        throw new Error("must not persist");
      },
      saveStatus: async () => undefined,
    });
    expect(result.dispositions[0]?.result).toBe("rejected");
  });

  it("rejects a suspended company without persisting", async () => {
    const result = await routeWebhookEvents({
      messages: [msg("phone-a", "wamid.1")],
      statuses: [],
      mode: "tenant_registry",
      envCompanyId: "env-default",
      envPhoneNumberId: "env-phone",
      resolve: async () => ({ ok: false, code: "company_suspended" }),
      saveInbound: async () => {
        throw new Error("must not persist");
      },
      saveStatus: async () => undefined,
    });
    expect(result.retry).toBe(false);
    expect(result.dispositions[0]).toMatchObject({ result: "rejected", code: "company_suspended" });
  });

  it("marks resolver read failure as retryable HTTP 500", async () => {
    const result = await routeWebhookEvents({
      messages: [msg("phone-a", "wamid.1")],
      statuses: [],
      mode: "tenant_registry",
      envCompanyId: "env-default",
      envPhoneNumberId: "env-phone",
      resolve: async () => ({ ok: false, code: "unavailable" }),
      saveInbound: async () => undefined,
      saveStatus: async () => undefined,
    });
    expect(result.retry).toBe(true);
    expect(result.dispositions[0]?.result).toBe("retry");
    expect(webhookHttpStatus(result)).toBe(WEBHOOK_HTTP.retryable);
  });

  it("does not use payload company_id — splitWebhook only exposes provider phones", () => {
    const split = splitWebhook({
      company_id: "forged-company",
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: "phone-a" },
            messages: [{ id: "wamid.1", from: customer, timestamp: "1710000000", type: "text", text: { body: "hi" } }],
          },
        }],
      }],
    });
    expect(split.messages[0]?.phoneNumberId).toBe("phone-a");
    expect(JSON.stringify(split)).not.toContain("forged-company");
  });

  it("single_tenant rejects a foreign phone instead of storing it on the env company", async () => {
    const saved: string[] = [];
    const result = await routeWebhookEvents({
      messages: [msg("other-phone", "wamid.x")],
      statuses: [],
      mode: "single_tenant",
      envCompanyId: "env-default",
      envPhoneNumberId: "env-phone",
      resolve: async () => {
        throw new Error("resolver must not run in single_tenant");
      },
      saveInbound: async (companyId) => {
        saved.push(companyId);
      },
      saveStatus: async () => undefined,
    });
    expect(result.retry).toBe(false);
    expect(result.dispositions[0]).toMatchObject({ result: "rejected", code: "unknown_or_inactive" });
    expect(saved).toEqual([]);
  });
});

describe("outbound binding", () => {
  const conversation = { companyId: "co-a", phoneNumberId: "phone-a", customerWaId: customer };

  it("blocks send when the verified link generation changes after the intent", () => {
    const bound = evaluateOutboundBinding({
      companyId: "co-a",
      phoneNumberId: "phone-a",
      recipientWaId: customer,
      conversation,
      resolved: verified("co-a", "phone-a", "link-1", 2),
      intentLinkId: "link-1",
      intentLinkGeneration: 1,
    });
    expect(bound).toEqual({ ok: false, code: "link_changed" });
  });

  it("blocks send when the verified link id changes after the intent", () => {
    const bound = evaluateOutboundBinding({
      companyId: "co-a",
      phoneNumberId: "phone-a",
      recipientWaId: customer,
      conversation,
      resolved: verified("co-a", "phone-a", "link-2"),
      intentLinkId: "link-1",
    });
    expect(bound).toEqual({ ok: false, code: "link_changed" });
    expect(decideOutboundGraphAttempt({
      binding: bound,
      secret: { ok: true, accessToken: "other-company-token" },
    }).ok).toBe(false);
  });

  it("blocks disconnected / inactive links and does not swap numbers", () => {
    const bound = evaluateOutboundBinding({
      companyId: "co-a",
      phoneNumberId: "phone-a",
      recipientWaId: customer,
      conversation,
      resolved: fail("unknown_or_inactive"),
      intentLinkId: "link-1",
    });
    expect(bound).toEqual({ ok: false, code: "unknown_or_inactive" });
  });

  it("blocks a suspended company", () => {
    expect(evaluateOutboundBinding({
      companyId: "co-a",
      phoneNumberId: "phone-a",
      recipientWaId: customer,
      conversation,
      resolved: fail("company_suspended", "co-a"),
    })).toEqual({ ok: false, code: "company_suspended" });
  });

  it("returns NEEDS_SETUP for secrets and never invents a token", () => {
    const secret = resolveWhatsappOutboundSecret("phone-a");
    expect(secret).toEqual({ ok: false, code: "NEEDS_SETUP" });
    const attempt = decideOutboundGraphAttempt({
      binding: evaluateOutboundBinding({
        companyId: "co-a",
        phoneNumberId: "phone-a",
        recipientWaId: customer,
        conversation,
        resolved: verified("co-a", "phone-a", "link-1"),
      }),
      secret,
    });
    expect(attempt).toEqual({ ok: false, code: "NEEDS_SETUP" });
  });
});
