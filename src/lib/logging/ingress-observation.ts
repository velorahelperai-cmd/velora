import { randomUUID } from "node:crypto";

export type IngressSource = "whatsapp" | "instagram" | "paymob";
export type IngressObservation = Readonly<{
  requestId: string;
  traceId: string;
  source: IngressSource;
  stage: "started" | "finished" | "exception";
  httpStatus: number | null;
  durationMs: number | null;
}>;
export interface IngressObservationPorts {
  record: (event: IngressObservation) => Promise<boolean>;
  diagnostic: (event: IngressObservation, persisted: boolean) => void;
  context: <T>(ids: { request_id: string; trace_id: string }, run: () => Promise<T>) => Promise<T>;
}

/** HTTP attempt context only. Never accepts headers, bodies, tenant IDs or provider IDs.
 * A successful HTTP response is not proof of payment, send, or business completion.
 * Observer failures never change acknowledgement/retry behavior of the signed handler.
 */
export async function observeIngress(
  source: IngressSource,
  handler: () => Promise<Response>,
  ports: IngressObservationPorts,
): Promise<Response> {
  const requestId = randomUUID();
  const traceId = requestId; // Root span for this attempt; durable business binding is separate.
  return ports.context({ request_id: requestId, trace_id: traceId }, async () => {
    const record = async (stage: IngressObservation["stage"], httpStatus: number | null, durationMs: number | null) => {
      const event: IngressObservation = { requestId, traceId, source, stage, httpStatus, durationMs };
      let persisted = false;
      try { persisted = await ports.record(event); } catch { /* Diagnostic failure is not a provider retry instruction. */ }
      try { ports.diagnostic(event, persisted); } catch { /* Preserve original handler result. */ }
    };
    await record("started", null, null);
    const started = performance.now();
    try {
      const response = await handler();
      await record("finished", response.status, Math.min(2147483647, Math.max(0, Math.round(performance.now() - started))));
      return response;
    } catch (error) {
      await record("exception", null, Math.min(2147483647, Math.max(0, Math.round(performance.now() - started))));
      throw error;
    }
  });
}
