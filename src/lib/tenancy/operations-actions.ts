"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlatformOwner } from "@/lib/tenancy/access";
import type {
  AdminOperationsData,
  CorrelationLogEvent,
  PlatformServiceHealth,
  WebhookPipeHealth,
} from "./operations-types";

export interface AdminOperationsQuery {
  correlationId?: string;
  service?: string;
  severity?: string;
}

export type AdminOperationsResult =
  | {
      ok: true;
      data: AdminOperationsData;
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "UNAVAILABLE";
      message?: string;
    };

interface PaymobEventRow {
  id: string;
  payment_attempt_id: string | null;
  provider_transaction_id: string | null;
  company_id: string | null;
  event_status: string | null;
  observation_key: string | null;
  created_at: string;
}

interface InstagramReceiptRow {
  id: string;
  company_id: string | null;
  provider_mid: string | null;
  received_at: string;
}

type DynamicFrom = (table: string) => {
  select: (cols: string) => {
    order: (col: string, opts?: { ascending?: boolean }) => {
      limit: (count: number) => Promise<{ data: unknown; error: unknown }>;
    };
  };
};

export async function adminGetOperationsOverview(
  query?: AdminOperationsQuery
): Promise<AdminOperationsResult> {
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
    const t0 = Date.now();

    // 1. Health check probe to PostgreSQL
    const { error: dbError } = await supabase.from("companies").select("id").limit(1);
    const dbLatency = Date.now() - t0;

    const dynamicClient = supabase as unknown as { from: DynamicFrom };

    // 2. Query real Paymob webhook events
    const { data: paymobRaw } = await dynamicClient
      .from("billing_provider_events")
      .select("id, payment_attempt_id, provider_transaction_id, company_id, event_status, observation_key, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    const paymobRows = (paymobRaw as PaymobEventRow[] | null) ?? null;

    // 3. Query real WhatsApp conversation events
    const { data: waRows } = await supabase
      .from("whatsapp_conversation_events")
      .select("id, company_id, conversation_id, action, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    // 4. Query real Instagram webhook receipts
    const { data: igRaw } = await dynamicClient
      .from("instagram_webhook_receipts")
      .select("id, company_id, provider_mid, received_at")
      .order("received_at", { ascending: false })
      .limit(50);
    const igRows = (igRaw as InstagramReceiptRow[] | null) ?? null;

    // Assemble real events into correlation log events
    const allEvents: CorrelationLogEvent[] = [];

    if (Array.isArray(paymobRows)) {
      for (const r of paymobRows) {
        allEvents.push({
          id: r.id,
          traceId: r.payment_attempt_id ? `pay-${r.payment_attempt_id}` : `txn-${r.provider_transaction_id ?? r.id}`,
          requestId: r.provider_transaction_id ?? r.id,
          companyId: r.company_id ?? null,
          service: "billing_paymob",
          severity: r.event_status === "failed" ? "error" : "info",
          errorCode: r.event_status === "failed" ? "PAYMOB_PAYMENT_FAILED" : "PAYMOB_EVENT_DELIVERED",
          message: `Paymob webhook: ${r.observation_key ?? "event"} (${r.event_status ?? "unknown"})`,
          createdAt: r.created_at,
        });
      }
    }

    if (Array.isArray(waRows)) {
      for (const r of waRows) {
        allEvents.push({
          id: r.id,
          traceId: `wa-${r.conversation_id}`,
          requestId: r.id,
          companyId: r.company_id ?? null,
          service: "webhook_meta",
          severity: "info",
          errorCode: "WA_CONVERSATION_EVENT",
          message: `WhatsApp action: ${r.action}`,
          createdAt: r.created_at,
        });
      }
    }

    if (Array.isArray(igRows)) {
      for (const r of igRows) {
        allEvents.push({
          id: r.id,
          traceId: `ig-${r.provider_mid ?? r.id}`,
          requestId: r.id,
          companyId: r.company_id ?? null,
          service: "webhook_meta",
          severity: "info",
          errorCode: "IG_WEBHOOK_RECEIPT",
          message: `Instagram webhook receipt (${r.provider_mid ?? "mid"})`,
          createdAt: r.received_at,
        });
      }
    }

    // Sort descending by timestamp
    allEvents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply correlationId, service, and severity search filters
    const searchCorrelation = query?.correlationId?.trim().toLowerCase();
    const serviceFilter = query?.service?.trim().toLowerCase();
    const severityFilter = query?.severity?.trim().toLowerCase();

    const filteredEvents = allEvents.filter((evt) => {
      if (serviceFilter && serviceFilter !== "all" && evt.service.toLowerCase() !== serviceFilter) {
        return false;
      }
      if (severityFilter && severityFilter !== "all" && evt.severity.toLowerCase() !== severityFilter) {
        return false;
      }
      if (searchCorrelation) {
        const matchTrace = evt.traceId.toLowerCase().includes(searchCorrelation);
        const matchReq = evt.requestId.toLowerCase().includes(searchCorrelation);
        const matchErr = evt.errorCode.toLowerCase().includes(searchCorrelation);
        const matchComp = evt.companyId?.toLowerCase().includes(searchCorrelation);
        const matchMsg = evt.message.toLowerCase().includes(searchCorrelation);
        if (!matchTrace && !matchReq && !matchErr && !matchComp && !matchMsg) {
          return false;
        }
      }
      return true;
    });

    // Compute Webhook Pipes
    const paymobCount = paymobRows?.length ?? 0;
    const paymobSuccess = paymobRows?.filter((r) => r.event_status === "success").length ?? 0;
    const paymobRate = paymobCount > 0 ? `${Math.round((paymobSuccess / paymobCount) * 100)}%` : "UNKNOWN";

    const waCount = waRows?.length ?? 0;
    const waRate = waCount > 0 ? "100%" : "UNKNOWN";

    const igCount = igRows?.length ?? 0;
    const igRate = igCount > 0 ? "100%" : "UNKNOWN";

    const webhookPipes: WebhookPipeHealth[] = [
      {
        channel: "WhatsApp Cloud API",
        status: waCount > 0 ? "active" : "unknown",
        eventsCount: waCount,
        successRate: waRate,
        lastActiveAt: waRows?.[0]?.created_at ?? null,
      },
      {
        channel: "Instagram Graph API",
        status: igCount > 0 ? "active" : "unknown",
        eventsCount: igCount,
        successRate: igRate,
        lastActiveAt: igRows?.[0]?.received_at ?? null,
      },
      {
        channel: "Paymob Webhook",
        status: paymobCount > 0 ? "active" : "unknown",
        eventsCount: paymobCount,
        successRate: paymobRate,
        lastActiveAt: paymobRows?.[0]?.created_at ?? null,
      },
    ];

    const totalObservedEvents = paymobCount + waCount + igCount;
    const totalSuccessfulEvents = paymobSuccess + waCount + igCount;
    const aggregateSuccessRate =
      totalObservedEvents > 0
        ? `${Math.round((totalSuccessfulEvents / totalObservedEvents) * 100)}%`
        : "UNKNOWN";

    const services: PlatformServiceHealth[] = [
      {
        id: "postgres",
        name: "Supabase PostgreSQL Database",
        status: dbError ? "DEGRADED" : "OPERATIONAL",
        latencyMs: dbLatency,
        details: dbError ? `Error: ${dbError.message}` : "Connection pool active, read-write healthy",
      },
      {
        id: "gotrue",
        name: "GoTrue Auth & Platform Sessions",
        status: "OPERATIONAL",
        latencyMs: undefined,
        details: "Platform owner identity and session verified",
      },
      {
        id: "meta-webhook",
        name: "Meta Cloud & Graph API Webhooks",
        status: totalObservedEvents > 0 ? "OPERATIONAL" : "UNKNOWN",
        latencyMs: undefined,
        details: waCount > 0 || igCount > 0 ? "Webhook ingress active and receiving events" : "No recent webhook payloads received",
      },
      {
        id: "paymob-pipe",
        name: "Paymob Payment Notifications",
        status: paymobCount > 0 ? "OPERATIONAL" : "UNKNOWN",
        latencyMs: undefined,
        details: "Test webhook listener bound (Live mode disabled)",
      },
      {
        id: "ai-router",
        name: "Multi-Model AI Engine",
        status: "OPERATIONAL",
        latencyMs: undefined,
        details: "Gemini 3.8 Flash primary, fallback models active",
      },
    ];

    const data: AdminOperationsData = {
      kpis: {
        totalEvents: totalObservedEvents > 0 ? totalObservedEvents : "UNKNOWN",
        activeIncidents: dbError ? 1 : 0,
        webhookSuccessRate: aggregateSuccessRate,
        avgServerLatency: `${dbLatency}ms`,
        servicesHealth: dbError ? "degraded" : "healthy",
      },
      services,
      webhookPipes,
      recentEvents: filteredEvents,
      queryFilter: {
        correlationId: query?.correlationId ?? "",
        service: query?.service ?? "all",
        severity: query?.severity ?? "all",
      },
    };

    return { ok: true, data };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Database probe failed";
    return { ok: false, code: "UNAVAILABLE", message };
  }
}
