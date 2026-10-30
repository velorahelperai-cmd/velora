"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlatformOwner } from "@/lib/tenancy/access";
import type { AdminChannelItem, AdminChannelsHubStats } from "@/components/admin/admin-channels-hub";

export type AdminChannelsResult = {
  ok: true;
  data: {
    channels: AdminChannelItem[];
    stats: AdminChannelsHubStats;
  };
} | {
  ok: false;
  code: "UNAUTHENTICATED" | "FORBIDDEN" | "UNAVAILABLE";
  message?: string;
};

export async function adminListChannels(): Promise<AdminChannelsResult> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    if (admin.code === "UNVERIFIED" || admin.code === "UNAUTHENTICATED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (admin.code === "UNAVAILABLE") return { ok: false, code: "UNAVAILABLE" };
    return { ok: false, code: "FORBIDDEN" };
  }

  try {
    const supabase = await createClient();

    // 1. Fetch companies map
    const { data: companies, error: companiesError } = await supabase
      .from("companies")
      .select("id, display_name, status");

    if (companiesError) {
      return { ok: false, code: "UNAVAILABLE", message: companiesError.message };
    }

    const companyMap = new Map<string, string>();
    for (const c of companies ?? []) {
      companyMap.set(c.id, c.display_name);
    }

    const channels: AdminChannelItem[] = [];

    // 2. Fetch WhatsApp links
    const { data: waLinks, error: waError } = await supabase
      .from("whatsapp_company_links")
      .select("id, company_id, requested_display_number, keep_on_phone, status, provider_phone_number_id, verified_display_number, last_error_code, updated_at");

    if (!waError && Array.isArray(waLinks)) {
      for (const link of waLinks) {
        const companyName = companyMap.get(link.company_id) || "منشأة غير معروفة";
        const identifier = link.verified_display_number || link.requested_display_number || "رقم غير محدد";
        const status = (link.status === "verified" || link.status === "needs_external_action" || link.status === "error" || link.status === "request_saved")
          ? link.status
          : "request_saved";

        channels.push({
          id: `wa-${link.id || link.company_id}`,
          companyId: link.company_id,
          companyName,
          channelType: "whatsapp",
          status,
          identifier,
          wabaId: link.provider_phone_number_id,
          coexistence: Boolean(link.keep_on_phone),
          lastActiveAt: link.updated_at,
        });
      }
    }

    // 3. Check Instagram connections for companies (via instagram_admin_connection RPC)
    const genericRpc = supabase.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    for (let offset = 0; offset < (companies?.length ?? 0); offset += 4) {
      const batch = await Promise.all((companies ?? []).slice(offset, offset + 4).map(async comp => {
        try {
          const { data: igData, error: igError } = await genericRpc("instagram_admin_connection", {
            p_company_id: comp.id,
          });
          if (!igError && igData && typeof igData === "object" && (igData as Record<string, unknown>).ok === true) {
            const link = (igData as Record<string, unknown>).link as Record<string, unknown> | null;
            if (link && typeof link.accountId === "string") {
              return {
                id: `ig-${link.linkId || comp.id}`,
                companyId: comp.id,
                companyName: comp.display_name,
                channelType: "instagram" as const,
                status: "bound" as const,
                identifier: `@${link.accountId}`,
                coexistence: false,
                lastActiveAt: null,
              };
            }
          }
        } catch {
          // Continue processing other companies if single RPC fails
        }
        return null;
      }));
      for (const channel of batch) if (channel) channels.push(channel);
    }

    // 4. Compute Aggregate Stats
    let totalWhatsapp = 0;
    let totalInstagram = 0;
    let activeConnected = 0;
    let needsAction = 0;
    let coexistenceCount = 0;

    for (const ch of channels) {
      if (ch.channelType === "whatsapp") totalWhatsapp++;
      if (ch.channelType === "instagram") totalInstagram++;
      if (ch.status === "verified" || ch.status === "bound") activeConnected++;
      if (ch.status === "needs_external_action" || ch.status === "error") needsAction++;
      if (ch.coexistence) coexistenceCount++;
    }

    const stats: AdminChannelsHubStats = {
      totalChannels: channels.length,
      totalWhatsapp,
      totalInstagram,
      activeConnected,
      needsAction,
      coexistenceCount,
    };

    return {
      ok: true,
      data: {
        channels,
        stats,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "UNAVAILABLE";
    return { ok: false, code: "UNAVAILABLE", message: msg };
  }
}
