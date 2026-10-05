import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";

export type WhatsappTenantResolveOk = {
  ok: true;
  eligible: true;
  companyId: string;
  linkId: string;
  linkGeneration: number;
  providerPhoneNumberId: string;
  status: string;
};

export type WhatsappTenantResolveFail = {
  ok: false;
  eligible: false;
  code: "invalid_input" | "unknown_or_inactive" | "company_suspended" | "conflict" | "unavailable";
  companyId?: string;
};

export type OutboundBindingFailCode =
  | "binding_mismatch"
  | "phone_mismatch"
  | "company_suspended"
  | "unknown_or_inactive"
  | "unavailable"
  | "link_changed";

export type OutboundBindingOk = {
  ok: true;
  companyId: string;
  linkId: string;
  linkGeneration: number;
  providerPhoneNumberId: string;
};

export type OutboundBindingResult = OutboundBindingOk | { ok: false; code: OutboundBindingFailCode };

/**
 * Conversation + resolver must agree. Disconnected / inactive / other company → stop.
 * Never switch to another provider number.
 */
export function evaluateOutboundBinding(input: {
  companyId: string;
  phoneNumberId: string;
  recipientWaId: string;
  conversation: { companyId: string; phoneNumberId: string; customerWaId: string };
  resolved: WhatsappTenantResolveOk | WhatsappTenantResolveFail;
  intentLinkId?: string | null;
  intentLinkGeneration?: number | null;
}): OutboundBindingResult {
  const phone = input.phoneNumberId.trim();
  const recipient = input.recipientWaId.trim();
  const companyId = input.companyId.trim();
  if (!phone || !recipient || !companyId) return { ok: false, code: "phone_mismatch" };

  if (
    input.conversation.companyId !== companyId
    || input.conversation.phoneNumberId !== phone
    || input.conversation.customerWaId !== recipient
  ) {
    return { ok: false, code: "binding_mismatch" };
  }

  if (!input.resolved.ok) {
    if (input.resolved.code === "unavailable") return { ok: false, code: "unavailable" };
    if (input.resolved.code === "company_suspended") return { ok: false, code: "company_suspended" };
    return { ok: false, code: "unknown_or_inactive" };
  }

  if (input.resolved.companyId !== companyId) return { ok: false, code: "link_changed" };
  if (input.resolved.providerPhoneNumberId !== phone) return { ok: false, code: "phone_mismatch" };
  if (input.resolved.status !== "verified") return { ok: false, code: "unknown_or_inactive" };
  if (input.intentLinkId && input.intentLinkId !== input.resolved.linkId) {
    return { ok: false, code: "link_changed" };
  }
  if (
    input.intentLinkGeneration != null
    && Number.isFinite(input.intentLinkGeneration)
    && input.intentLinkGeneration !== input.resolved.linkGeneration
  ) {
    return { ok: false, code: "link_changed" };
  }

  return {
    ok: true,
    companyId: input.resolved.companyId,
    linkId: input.resolved.linkId,
    linkGeneration: input.resolved.linkGeneration,
    providerPhoneNumberId: input.resolved.providerPhoneNumberId,
  };
}

/**
 * Per-number Graph token. No server vault in this package — never reuse the
 * env single-tenant token for another company/number. Does not read process.env.
 */
export function resolveWhatsappOutboundSecret(providerPhoneNumberId: string): {
  ok: false;
  code: "NEEDS_SETUP";
} {
  if (!providerPhoneNumberId.trim()) return { ok: false, code: "NEEDS_SETUP" };
  return { ok: false, code: "NEEDS_SETUP" };
}

export function decideOutboundGraphAttempt(input: {
  binding: OutboundBindingResult;
  secret: { ok: true; accessToken: string } | { ok: false; code: "NEEDS_SETUP" | "INVALID_INPUT" };
}): { ok: true; accessToken: string } | { ok: false; code: "NEEDS_SETUP" | OutboundBindingFailCode } {
  if (!input.binding.ok) return input.binding;
  if (!input.secret.ok) return { ok: false, code: "NEEDS_SETUP" };
  const token = input.secret.accessToken.trim();
  if (!token) return { ok: false, code: "NEEDS_SETUP" };
  return { ok: true, accessToken: token };
}

/**
 * Server-only resolver: company from a verified provider phone_number_id.
 * Wired to webhook/send only when WHATSAPP_ROUTING_MODE=tenant_registry.
 * Default remains explicit single_tenant env mapping — not a fallback after resolver failure.
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
    const linkGeneration = Number(row.generation ?? row.link_generation ?? 1);
    if (!companyId || !linkId) return { ok: false, eligible: false, code: "unavailable" };

    return {
      ok: true,
      eligible: true,
      companyId,
      linkId,
      linkGeneration: Number.isFinite(linkGeneration) && linkGeneration >= 1 ? linkGeneration : 1,
      providerPhoneNumberId: providerId,
      status: String(row.status ?? "verified"),
    };
  } catch {
    return { ok: false, eligible: false, code: "unavailable" };
  }
}
