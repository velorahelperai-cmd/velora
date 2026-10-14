import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import { resolveWhatsappCompanyByProviderPhone } from "./tenant-resolve";

const valid = {
  ok: true, eligible: true, company_id: "synthetic-company", link_id: "synthetic-link",
  provider_phone_number_id: "synthetic-phone", status: "verified", generation: 2, link_generation: 2,
};

function admin(data: unknown, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("P4 tenant resolver verifies the complete persisted link contract", () => {
  it("returns only the requested verified provider phone and its actual generation", async () => {
    const mock = admin(valid);
    expect(await resolveWhatsappCompanyByProviderPhone(mock.client, "synthetic-phone")).toEqual({
      ok: true, eligible: true, companyId: valid.company_id, linkId: valid.link_id,
      providerPhoneNumberId: "synthetic-phone", status: "verified", linkGeneration: 2, connectionMode: "cloud_api",
    });
    expect(mock.rpc).toHaveBeenCalledWith("resolve_whatsapp_company_by_provider_phone", { p_provider_phone_number_id: "synthetic-phone" });
  });

  it.each([
    { ...valid, provider_phone_number_id: undefined },
    { ...valid, provider_phone_number_id: "another-tenant-phone" },
    { ...valid, status: undefined },
    { ...valid, status: "disconnected" },
    { ...valid, eligible: false },
    { ...valid, company_id: " " },
    { ...valid, link_id: " " },
    { ...valid, generation: undefined, link_generation: undefined },
    { ...valid, generation: 1.5, link_generation: 1.5 },
    { ...valid, generation: 0, link_generation: 0 },
    { ...valid, generation: "bogus", link_generation: "bogus" },
    { ...valid, generation: Number.MAX_SAFE_INTEGER + 1, link_generation: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, generation: 2, link_generation: 3 },
    { ...valid, generation: 2, link_generation: "2.0" },
  ])("fails closed for a malformed or conflicting successful RPC row %j", async (data) => {
    expect((await resolveWhatsappCompanyByProviderPhone(admin(data).client, "synthetic-phone")).ok).toBe(false);
  });

  it("requests retry on RPC transport/read failure without selecting an environment company", async () => {
    expect(await resolveWhatsappCompanyByProviderPhone(admin(null, { code: "transport_error" }).client, "synthetic-phone"))
      .toEqual({ ok: false, eligible: false, code: "unavailable" });
  });

  it.each([
    {},
    { ok: "false", code: "unknown_or_inactive" },
    { ok: false },
    { ok: false, code: "unavailable" },
    { ok: false, code: "unexpected_error" },
  ])("keeps malformed or unavailable RPC failures retryable instead of acknowledging a lost message %j", async (data) => {
    expect(await resolveWhatsappCompanyByProviderPhone(admin(data).client, "synthetic-phone"))
      .toEqual({ ok: false, eligible: false, code: "unavailable" });
  });
});
