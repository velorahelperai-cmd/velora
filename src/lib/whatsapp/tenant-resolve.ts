import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

export type WhatsappTenantResolveOk = {
  ok: true;
  eligible: true;
  companyId: string;
  linkId: string;
  providerPhoneNumberId: string;
  status: string;
};

export type WhatsappTenantResolveFail = {
  ok: false;
  eligible: false;
  code: "invalid_input" | "unknown_or_inactive" | "company_suspended" | "conflict" | "unavailable";
  companyId?: string;
};

/**
 * Server-only resolver: company from a verified provider phone_number_id.
 * Not wired to webhook/send in this package — env single-tenant path stays live.
 * Never accepts company_id from the browser; never picks “first company”.
 */
export async function resolveWhatsappCompanyByProviderPhone(
  admin: SupabaseClient<Database>,
  providerPhoneNumberId: string,
): Promise<WhatsappTenantResolveOk | WhatsappTenantResolveFail> {
  const phone = providerPhoneNumberId.trim();
  if (!phone) return { ok: false, eligible: false, code: "invalid_input" };

  try {
    const { data, error } = await admin.rpc("resolve_whatsapp_company_by_provider_phone", {
      p_provider_phone_number_id: phone,
    });
    if (error) return { ok: false, eligible: false, code: "unavailable" };

    const row = data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, Json>)
      : null;
    if (!row) return { ok: false, eligible: false, code: "unavailable" };

    if (row.ok !== true) {
      const code = String(row.code ?? "unknown_or_inactive");
      if (code === "company_suspended") {
        return {
          ok: false,
          eligible: false,
          code: "company_suspended",
          companyId: typeof row.company_id === "string" ? row.company_id : undefined,
        };
      }
      if (code === "invalid_input") return { ok: false, eligible: false, code: "invalid_input" };
      return { ok: false, eligible: false, code: "unknown_or_inactive" };
    }

    const companyId = typeof row.company_id === "string" ? row.company_id : "";
    const linkId = typeof row.link_id === "string" ? row.link_id : "";
    const providerId = typeof row.provider_phone_number_id === "string" ? row.provider_phone_number_id : phone;
    if (!companyId || !linkId) return { ok: false, eligible: false, code: "unavailable" };

    return {
      ok: true,
      eligible: true,
      companyId,
      linkId,
      providerPhoneNumberId: providerId,
      status: String(row.status ?? "verified"),
    };
  } catch {
    return { ok: false, eligible: false, code: "unavailable" };
  }
}
