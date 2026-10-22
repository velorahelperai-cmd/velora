import type { CorrelationLogEvent } from "@/lib/tenancy/operations-types";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
/** HTTP observation only; never confirms business success. */
export function projectIngressAttempts(raw: unknown, now = Date.now()): CorrelationLogEvent[] | null {
  const data = record(raw);
  if (!data || data.version !== 1 || data.coverage !== "PARTIAL" || data.successRate !== "UNKNOWN" || !Array.isArray(data.attempts) || data.attempts.length > 100) return null;
  const start = Date.parse(String(data.windowStart)), end = Date.parse(String(data.windowEnd));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 86400000 || end > now + 1000) return null;
  const events: CorrelationLogEvent[] = [], seen = new Set<string>();
  for (const item of data.attempts) {
    const row = record(item);
    if (!row || !uuid.test(String(row.request_id)) || row.trace_id !== row.request_id || !["whatsapp", "instagram", "paymob"].includes(String(row.source)) || !["started", "finished", "exception"].includes(String(row.stage))) return null;
    if (row.stage === "started" ? row.http_status !== null || row.duration_ms !== null
      : !Number.isSafeInteger(row.duration_ms) || Number(row.duration_ms) < 0 || Number(row.duration_ms) > 2147483647 || (row.stage === "exception" ? row.http_status !== null : !Number.isInteger(row.http_status) || Number(row.http_status) < 100 || Number(row.http_status) > 599)) return null;
    const at = Date.parse(String(row.recorded_at)), key = `${row.request_id}:${row.stage}`;
    if (!Number.isFinite(at) || at < start || at > end || seen.has(key)) return null;
    seen.add(key);
    const code = `INGRESS_${String(row.source).toUpperCase()}_${String(row.stage).toUpperCase()}`;
    events.push({ id: `ingress:${key}`, requestId: String(row.request_id), traceId: String(row.trace_id), companyId: null,
      service: row.source === "paymob" ? "billing_paymob" : "webhook_meta", severity: row.stage === "exception" || Number(row.http_status) >= 400 ? "warning" : "info",
      errorCode: code, message: code, createdAt: String(row.recorded_at) });
  }
  return events;
}
