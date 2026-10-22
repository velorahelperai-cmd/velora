"use server";

import { requirePlatformOwner } from "@/lib/tenancy/access";
import { adminListPendingReviewsPage, adminSearchAccounts } from "@/lib/tenancy/actions";
import type { AdminSupportOverviewData } from "./support-types";
import type { AdminAccountSearchItem } from "./types";

export type AdminSupportResult =
  | {
      ok: true;
      data: AdminSupportOverviewData;
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "UNAVAILABLE";
      message?: string;
    };

export async function adminGetSupportOverview(): Promise<AdminSupportResult> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    if (admin.code === "UNVERIFIED" || admin.code === "UNAUTHENTICATED") {
      return { ok: false, code: "UNAUTHENTICATED" };
    }
    if (admin.code === "UNAVAILABLE") return { ok: false, code: "UNAVAILABLE" };
    return { ok: false, code: "FORBIDDEN" };
  }

  try {
    const reviewsRes = await adminListPendingReviewsPage({ limit: 50, offset: 0 });
    const pendingReviews = reviewsRes.ok ? reviewsRes.data.rows : [];
    const pendingCount = reviewsRes.ok ? reviewsRes.data.totalCount : 0;

    const data: AdminSupportOverviewData = {
      kpis: {
        pendingReviewsCount: pendingCount,
        supportSlaHours: 4,
        reviewGateStatus: "ACTIVE",
        officialSupportChannel: "WhatsApp & Email",
      },
      pendingReviews,
      supportChannels: [
        {
          id: "wa-support",
          channel: "WhatsApp Official Support",
          target: "+968 (Official WhatsApp Ingress)",
          status: "OPERATIONAL",
          description: "Direct customer escalations & support code lookups",
        },
        {
          id: "email-support",
          channel: "Support Desk Email",
          target: "support@velora.ai",
          status: "OPERATIONAL",
          description: "Tier-2 business onboarding inquiries and review responses",
        },
        {
          id: "platform-owner",
          channel: "Platform Escalation",
          target: "velorahelperai@gmail.com",
          status: "OPERATIONAL",
          description: "Platform owner executive override and final dispute resolution",
        },
      ],
    };

    return { ok: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Support data unavailable";
    return { ok: false, code: "UNAVAILABLE", message };
  }
}

export async function adminLookupCustomerByCodeOrEmail(
  query: string
): Promise<{ ok: boolean; rows: AdminAccountSearchItem[]; message?: string }> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) {
    return { ok: false, rows: [], message: admin.code };
  }
  const clean = query.trim();
  if (!clean) return { ok: true, rows: [] };
  const res = await adminSearchAccounts({ query: clean, limit: 20 });
  if (!res.ok) {
    return { ok: false, rows: [], message: res.message ?? res.code };
  }
  return { ok: true, rows: res.data.rows };
}
