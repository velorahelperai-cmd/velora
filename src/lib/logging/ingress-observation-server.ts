import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent, withLogContext } from "./logger.mjs";
import { observeIngress, type IngressSource } from "./ingress-observation";

/** Explicit rollout only after the reviewed SQL is installed. No secrets or payload logging. */
export async function observeWebhookIngress(source: IngressSource, handler: () => Promise<Response>) {
  return observeIngress(source, handler, {
    context: (ids, run) => withLogContext(ids, run),
    record: async event => {
      if (process.env.OPS_INGRESS_OBSERVATION_ENABLED !== "true") return false;
      const client = createAdminClient();
      if (!client) return false;
      // PostgREST abort bounds observer delay; never retry an ambiguous recorder result.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 500);
      try {
        const result = await client.rpc("ops_record_ingress_attempt" as never, {
          p_request_id: event.requestId, p_trace_id: event.traceId, p_source: event.source,
          p_stage: event.stage, p_http_status: event.httpStatus, p_duration_ms: event.durationMs,
        } as never).abortSignal(controller.signal);
        return !result.error && result.data === true;
      } finally { clearTimeout(timeout); }
    },
    diagnostic: (event, persisted) => logEvent(persisted || process.env.OPS_INGRESS_OBSERVATION_ENABLED !== "true" ? "info" : "warn", "operations.ingress.observed", {
      stage: event.stage, source: event.source, http_status: event.httpStatus,
      duration_ms: event.durationMs, error_code: persisted ? "INGRESS_OBSERVED" : "INGRESS_OBSERVATION_NOT_PERSISTED",
      coverage: "PARTIAL", // Does not measure upstream loss or uninstrumented paths.
    }),
  });
}
