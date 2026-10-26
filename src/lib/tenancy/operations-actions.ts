"use server";

import { randomUUID } from "node:crypto";
import { projectIngressAttempts } from "@/lib/logging/ingress-projection";
import { logEvent, withLogContext } from "@/lib/logging/logger.mjs";
import { createClient } from "@/lib/supabase/server";
import { requirePlatformOwner } from "@/lib/tenancy/access";
import type { AdminOperationsData, CorrelationLogEvent, PlatformServiceHealth, WebhookPipeHealth } from "./operations-types";
export interface AdminOperationsQuery { correlationId?: string; service?: string; severity?: string }
export type AdminOperationsResult = { ok: true; data: AdminOperationsData } | { ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" | "UNAVAILABLE"; message?: string };
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const eventCodes = new Set(["PAYMOB_PROVIDER_REPORTED_FAILURE", "PAYMOB_EVENT_RECORDED", "WHATSAPP_INBOUND_JOB_RECORDED", "INSTAGRAM_RECEIPT_RECORDED"]);
function unavailable(errorCode: string): AdminOperationsResult {
  const reference = randomUUID();
  withLogContext({ request_id: reference, trace_id: reference }, () => logEvent("error", "admin.operations.read_failed", { stage: "operations_read", error_code: errorCode }));
  return { ok: false, code: "UNAVAILABLE", message: errorCode + " [" + reference + "]" };
}
export async function adminGetOperationsOverview(query?: AdminOperationsQuery): Promise<AdminOperationsResult> {
  const admin = await requirePlatformOwner();
  if (!admin.ok) return { ok: false, code: admin.code === "UNAUTHENTICATED" || admin.code === "UNVERIFIED" ? "UNAUTHENTICATED" : admin.code === "UNAVAILABLE" ? "UNAVAILABLE" : "FORBIDDEN" };
  if ((query?.correlationId?.length ?? 0) > 120 || query?.service && !["all", "billing_paymob", "webhook_meta"].includes(query.service)
    || query?.severity && !["all", "info", "warning", "error", "critical"].includes(query.severity)) return unavailable("OPERATIONS_INVALID_FILTER");
  try {
    const supabase = await createClient();
    const started = Date.now();
    const { error: dbError } = await supabase.from("companies").select("id").limit(1);
    const dbLatency = Date.now() - started;
    const rpc = supabase as unknown as { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }> };
    const { data: raw, error } = await rpc.rpc("admin_read_operations_snapshot", {
      p_correlation_id: query?.correlationId?.trim() || null, p_service: query?.service || null, p_severity: query?.severity || null,
    });
    if (error) return error.code === "42501" ? { ok: false, code: "FORBIDDEN" }
      : unavailable(["PGRST202", "42883"].includes(error.code ?? "") ? "OPERATIONS_CONTRACT_NOT_INSTALLED" : "OPERATIONS_READ_UNAVAILABLE");
    const snapshot = record(raw);
    if (snapshot?.ok !== true || snapshot.traceCoverage !== "NOT_RECORDED" || snapshot.ingressRatesMeasured !== false
      || !Array.isArray(snapshot.sources) || snapshot.sources.length !== 3 || !Array.isArray(snapshot.events) || snapshot.events.length > 100) return unavailable("OPERATIONS_RESULT_INVALID");
    const start = Date.parse(String(snapshot.windowStart)), end = Date.parse(String(snapshot.windowEnd));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 86400000 || end > Date.now() + 1000) return unavailable("OPERATIONS_WINDOW_INVALID");
    const sources = new Map<string, { count: number; lastActiveAt: string | null }>();
    for (const value of snapshot.sources) {
      const row = record(value), key = String(row?.source);
      if (!row || !["paymob", "whatsapp", "instagram"].includes(key) || sources.has(key) || !Number.isSafeInteger(row.count) || Number(row.count) < 0) return unavailable("OPERATIONS_SOURCE_INVALID");
      const lastActiveAt = row.lastActiveAt === null ? null : typeof row.lastActiveAt === "string" ? row.lastActiveAt : "";
      if (lastActiveAt !== null && (!Number.isFinite(Date.parse(lastActiveAt)) || Date.parse(lastActiveAt) < start || Date.parse(lastActiveAt) > end)
        || Number(row.count) === 0 && lastActiveAt !== null || Number(row.count) > 0 && lastActiveAt === null) return unavailable("OPERATIONS_SOURCE_INVALID");
      sources.set(key, { count: Number(row.count), lastActiveAt });
    }
    const events: CorrelationLogEvent[] = [];
    for (const value of snapshot.events) {
      const row = record(value);
      if (!row || !uuid.test(String(row.id)) || row.companyId !== null && !uuid.test(String(row.companyId))
        || !["billing_paymob", "webhook_meta"].includes(String(row.service)) || !["info", "warning"].includes(String(row.severity))
        || !eventCodes.has(String(row.errorCode)) || row.message !== row.errorCode || row.traceId !== "UNKNOWN" || row.requestId !== "UNKNOWN"
        || !Number.isFinite(Date.parse(String(row.createdAt))) || Date.parse(String(row.createdAt)) < start || Date.parse(String(row.createdAt)) > end) return unavailable("OPERATIONS_EVENT_INVALID");
      // Source tables have no durable native request/trace context. UNKNOWN is
      // deliberate; never substitute provider transaction, receipt or conversation IDs.
      events.push({ id: String(row.id), traceId: "UNKNOWN", requestId: "UNKNOWN", companyId: row.companyId as string | null,
        service: String(row.service), severity: row.severity as "info" | "warning", errorCode: String(row.errorCode), message: String(row.message), createdAt: String(row.createdAt) });
    }
    const webhookPipes: WebhookPipeHealth[] = [["whatsapp", "WhatsApp Cloud API"], ["instagram", "Instagram Graph API"], ["paymob", "Historical payment events"]].map(([key, channel]) => ({
      channel, status: "unknown", eventsCount: sources.get(key)!.count, successRate: "UNKNOWN", lastActiveAt: sources.get(key)!.lastActiveAt,
    }));
    const services: PlatformServiceHealth[] = [
      { id: "postgres", name: "Supabase PostgreSQL Database", status: dbError ? "DEGRADED" : "OPERATIONAL", latencyMs: dbLatency, details: dbError ? "Read probe failed" : "Read probe succeeded; writes were not tested" },
      { id: "gotrue", name: "GoTrue Auth & Platform Sessions", status: "OPERATIONAL", details: "Current native owner request authorized; not a global auth health measurement" },
      { id: "meta-webhook", name: "Meta Cloud & Graph API Webhooks", status: "UNKNOWN", details: "24h per-channel stored activity; failed ingress and durable request/trace context are not measured" },
      { id: "paymob-pipe", name: "Historical payment notifications", status: "UNKNOWN", details: "24h recorded provider events do not measure ingress success or prove payment acceptance" },
      { id: "ai-router", name: "Multi-Model AI Engine", status: "UNKNOWN", details: "No provider execution probe; credential presence is not operational evidence" },
    ];
    if (process.env.OPS_INGRESS_OBSERVATION_ENABLED === "true" && (!query?.correlationId?.trim() || uuid.test(query.correlationId.trim()))) {
      const attempts = await rpc.rpc("admin_read_ingress_attempts", {
        p_request_id: query?.correlationId?.trim() || null, p_service: query?.service || null, p_severity: query?.severity || null,
      });
      if (attempts.error) return unavailable("INGRESS_OBSERVATION_READ_UNAVAILABLE");
      const projected = projectIngressAttempts(attempts.data);
      if (!projected) return unavailable("INGRESS_OBSERVATION_RESULT_INVALID");
      events.push(...projected);
      events.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      events.splice(100);
    }
    const totalEvents = [...sources.values()].reduce((total, source) => total + source.count, 0);
    if (!Number.isSafeInteger(totalEvents)) return unavailable("OPERATIONS_TOTAL_INVALID");
    return { ok: true, data: { kpis: { totalEvents, activeIncidents: dbError ? 1 : 0, webhookSuccessRate: "UNKNOWN", avgServerLatency: dbLatency + "ms", servicesHealth: dbError ? "degraded" : "unknown" },
      services, webhookPipes, recentEvents: events, queryFilter: { correlationId: query?.correlationId ?? "", service: query?.service ?? "all", severity: query?.severity ?? "all" } } };
  } catch { return unavailable("OPERATIONS_READ_UNAVAILABLE"); }
}
