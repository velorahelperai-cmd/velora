import { describe, expect, it } from "vitest";
import { routeWebhookEvents, splitWebhook, splitMetaAuthorizationRevocations, type InboundMessage } from "./webhook";
import { resolveWhatsappCompanyByMetaAsset } from "./tenant-resolve";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const message = (wabaId?: string): InboundMessage => ({
  wabaId, phoneNumberId: "phone-a", customerWaId: "96890000000", customerName: "",
  waMessageId: "wamid.a", body: "hi", messageType: "text", receivedAt: "2026-10-08T00:00:00.000Z",
});

describe("signed Meta asset routing", () => {
  it("revokes only exact signed WABA partner removal events and dedupes the WABA", () => {
    const entry = (id: string, event: string, target: string, time: unknown = 1710000000) => ({ id, time, changes: [{ field: "account_update", value: { event, waba_info: { waba_id: target } } }] });
    expect(splitMetaAuthorizationRevocations({ object: "whatsapp_business_account", entry: [
      entry("waba-a", "PARTNER_REMOVED", "waba-a"), entry("waba-a", "PARTNER_REMOVED", "waba-a"),
      entry("waba-a", "PARTNER_REMOVED", "waba-other"), entry("waba-b", "PARTNER_ADDED", "waba-b"),
      entry("waba-c", "PARTNER_REMOVED", "waba-c", null), entry("waba-d", "PARTNER_REMOVED", "waba-d", Math.floor(Date.now()/1000)+60),
    ] })).toEqual([{ wabaId: "waba-a", reason: "PARTNER_REMOVED", occurredAt: "2024-03-09T16:00:00.000Z" }]);
    expect(splitMetaAuthorizationRevocations({ object: "page", entry: [entry("waba-a", "PARTNER_REMOVED", "waba-a")] })).toEqual([]);
  });
  it("retains entry WABA on messages and statuses and dedupes within the asset pair", () => {
    const entry = (id: string) => ({ id, changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { phone_number_id: "phone-a" },
      messages: [{ id: "wamid.a", from: "96890000000", timestamp: "1710000000", type: "text", text: { body: "hi" } }],
      statuses: [{ id: "wamid.a", status: "read", timestamp: "1710000001", recipient_id: "96890000000" }],
    } }] });
    const parsed = splitWebhook({ object: "whatsapp_business_account", entry: [entry("waba-a"), entry("waba-a"), entry("waba-b")] });
    expect(parsed.messages.map((m) => m.wabaId)).toEqual(["waba-a", "waba-b"]);
    expect(parsed.statuses.map((s) => s.wabaId)).toEqual(["waba-a", "waba-a", "waba-b"]);
  });

  it("rejects absent WABA before resolution and never caches another WABA by phone", async () => {
    const resolved: string[] = [];
    const stored: string[] = [];
    const result = await routeWebhookEvents({
      messages: [message(), message("waba-wrong"), message("waba-a"), { ...message("waba-a"), waMessageId: "wamid.b" }],
      statuses: [], mode: "tenant_registry", envCompanyId: "env-company", envPhoneNumberId: "phone-a",
      resolve: async (phone, waba) => {
        resolved.push(`${phone}:${waba}`);
        return waba === "waba-a" ? { ok: true, companyId: "company-a" } : { ok: false, code: "unknown_or_inactive" };
      },
      saveInbound: async (company, m) => { stored.push(`${company}:${m.waMessageId}`); }, saveStatus: async () => undefined,
    });
    expect(result.retry).toBe(false);
    expect(result.dispositions.map((d) => d.result)).toEqual(["rejected", "rejected", "persisted", "persisted"]);
    expect(result.dispositions[0]?.code).toBe("invalid_input");
    expect(resolved).toEqual(["phone-a:waba-wrong", "phone-a:waba-a"]);
    expect(stored).toEqual(["company-a:wamid.a", "company-a:wamid.b"]);
  });

  it("preserves the explicitly configured single tenant contract without a WABA", async () => {
    const stored: string[] = [];
    const result = await routeWebhookEvents({ messages: [message()], statuses: [], mode: "single_tenant",
      envCompanyId: "legacy-company", envPhoneNumberId: "phone-a", resolve: async () => { throw Error("must not resolve"); },
      saveInbound: async (company) => { stored.push(company); }, saveStatus: async () => undefined });
    expect(result.retry).toBe(false);
    expect(stored).toEqual(["legacy-company"]);
  });

  it("requires returned WABA and phone to match the exact lookup", async () => {
    const calls: unknown[] = [];
    const admin = { rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return { error: null, data: { ok: true, eligible: true, status: "verified", company_id: "company-a", link_id: "link-a",
        provider_waba_id: "waba-other", provider_phone_number_id: "phone-a", generation: 2 } };
    } } as unknown as SupabaseClient<Database>;
    expect(await resolveWhatsappCompanyByMetaAsset(admin, "waba-a", "phone-a")).toEqual({ ok: false, eligible: false, code: "conflict" });
    expect(calls).toEqual([["resolve_whatsapp_company_by_meta_asset", { p_waba_id: "waba-a", p_provider_phone_number_id: "phone-a" }]]);
  });
});
