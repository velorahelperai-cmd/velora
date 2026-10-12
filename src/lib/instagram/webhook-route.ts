import { createHash, timingSafeEqual } from "node:crypto";
import { verifyAndParseInstagramWebhook } from "./webhook-parse";
import type { ParentWebhookSecret, InstagramWebhookEvent } from "./webhook-contracts";
export const MAX_INSTAGRAM_WEBHOOK_BODY_BYTES = 1_048_576;
export type InstagramWebhookReadiness = Readonly<{ receiveEnabled: boolean; providerFixtureVerified: boolean; parentWebhookSecret?: ParentWebhookSecret; verifyToken?: string }>;
/** Coordinator boundary ONLY; no DB implementation. A real adapter must atomically
 * commit every supported event, dedup retries and enforce historical account authority. */
export type InstagramWebhookPersistenceBatch = Readonly<{ events: readonly InstagramWebhookEvent[]; rawBodySha256: string; localReceivedAt: string }>;
export type InstagramWebhookRoutePorts = Readonly<{ readReadiness(): InstagramWebhookReadiness | Promise<InstagramWebhookReadiness>; persist?: (batch: InstagramWebhookPersistenceBatch) => Promise<Readonly<{ status: "committed" | "retryable" }>> }>;

const BODY_READ_TIMEOUT_MS = 5_000;
function response(code: string, status: number): Response {
  return Response.json({ ok: false, code }, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...(status === 503 ? { "retry-after": "5" } : {}) } });
}
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function readBody(request: Request): Promise<{ raw: Uint8Array } | { failure: Response }> {
  if (request.signal.aborted) return { failure: response("BODY_UNAVAILABLE", 503) };
  if (!request.body) return { raw: new Uint8Array() };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  let stop: () => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => { stop = () => reject(Error("body unavailable")); });
  const timer = setTimeout(stop, BODY_READ_TIMEOUT_MS);
  request.signal.addEventListener("abort", stop, { once: true });
  const cancel = () => { try { void reader.cancel().catch(() => {}); } catch {} };
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interrupted]);
      if (done) break;
      if (!(value instanceof Uint8Array)) { cancel(); return { failure: response("INVALID_BODY", 400) }; }
      total += value.byteLength;
      if (total > MAX_INSTAGRAM_WEBHOOK_BODY_BYTES) { cancel(); return { failure: response("BODY_TOO_LARGE", 413) }; }
      // A streaming producer may reuse its buffer; retain the actual bytes read.
      chunks.push(new Uint8Array(value));
    }
    const raw = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
    return { raw };
  } catch { cancel(); return { failure: response("BODY_UNAVAILABLE", 503) }; }
  finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", stop);
    try { reader.releaseLock(); } catch {}
  }
}

/** Request orchestration only. No database, queue, provider calls or live proof. */
export function createInstagramWebhookHandlers(ports: InstagramWebhookRoutePorts) {
  async function ready(): Promise<{ secret: ParentWebhookSecret; verifyToken?: string } | { failure: Response }> {
    try {
      const state = await ports.readReadiness();
      if (state.receiveEnabled !== true) return { failure: response("RECEIVE_DISABLED", 503) };
      const secret = state.parentWebhookSecret;
      if (state.providerFixtureVerified !== true || secret?.source !== "parent_webhook_app"
        || typeof secret.value !== "string" || !secret.value || secret.value !== secret.value.trim()) {
        return { failure: response("NEEDS_SETUP", 503) };
      }
      return { secret: Object.freeze({ source: "parent_webhook_app", value: secret.value }), verifyToken: state.verifyToken };
    } catch { return { failure: response("NEEDS_SETUP", 503) }; }
  }
  return {
    async GET(request: Request): Promise<Response> {
      const state = await ready(); if ("failure" in state) return state.failure;
      try {
        if (request.method !== "GET") return response("INVALID_REQUEST", 405);
        if (typeof state.verifyToken !== "string" || !state.verifyToken || state.verifyToken !== state.verifyToken.trim()) return response("NEEDS_SETUP", 503);
        const params = new URL(request.url).searchParams;
        for (const name of ["hub.mode", "hub.verify_token", "hub.challenge"]) if (params.getAll(name).length !== 1) return response("FORBIDDEN", 403);
        const token = params.get("hub.verify_token")!, challenge = params.get("hub.challenge")!;
        if (params.get("hub.mode") !== "subscribe" || !challenge || new TextEncoder().encode(challenge).length > 4096 || !equal(token, state.verifyToken)) return response("FORBIDDEN", 403);
        return new Response(challenge, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" } });
      } catch { return response("FORBIDDEN", 403); }
    },
    async POST(request: Request): Promise<Response> {
      const state = await ready(); if ("failure" in state) return state.failure;
      try {
        if (request.method !== "POST") return response("INVALID_REQUEST", 405);
        const contentType = request.headers.get("content-type") ?? "";
        const encoding = request.headers.get("content-encoding");
        if (!/^application\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?$/i.test(contentType)
          || (encoding !== null && encoding.toLowerCase() !== "identity")) return response("INVALID_REQUEST", 415);
        const signature = request.headers.get("x-hub-signature-256") ?? "";
        if (!/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return response("INVALID_SIGNATURE", 401);
        const length = request.headers.get("content-length"); let declared: number | undefined;
        if (length !== null) {
          if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) return response("INVALID_REQUEST", 400);
          declared = Number(length); if (declared > MAX_INSTAGRAM_WEBHOOK_BODY_BYTES) return response("BODY_TOO_LARGE", 413);
        }
        const read = await readBody(request); if ("failure" in read) return read.failure;
        if (declared !== undefined && read.raw.byteLength !== declared) return response("INVALID_BODY", 400);
        const parsed = verifyAndParseInstagramWebhook(read.raw, [signature], state.secret);
        if (!parsed.ok) return response(parsed.code, parsed.code === "INVALID_SIGNATURE" ? 401 : 400);
        // Closure/readiness revocation or secret rotation must not authorize a write.
        const current = await ready(); if ("failure" in current) return current.failure;
        if (current.secret.value !== state.secret.value || request.signal.aborted) return response("NEEDS_SETUP", 503);
        const ignored: Record<string, number> = {};
        for (const item of parsed.ignored) ignored[item.reason] = (ignored[item.reason] ?? 0) + 1;
        if (parsed.events.length === 0) return Response.json({ ok: true, disposition: "ignored", ignored }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
        if (typeof ports.persist !== "function") return response("PERSISTENCE_UNAVAILABLE", 503);
        const eventCount = parsed.events.length;
        const events = Object.freeze(parsed.events.map(event => Object.freeze(event.kind === "message" ? { ...event, content: Object.freeze({ ...event.content }) } : { ...event })));
        const batch: InstagramWebhookPersistenceBatch = Object.freeze({ events, rawBodySha256: createHash("sha256").update(read.raw).digest("hex"), localReceivedAt: new Date().toISOString() });
        try {
          const result = await ports.persist(batch);
          if (!result || typeof result !== "object") return response("PERSISTENCE_UNAVAILABLE", 503);
          const prototype = Object.getPrototypeOf(result);
          const keys = Reflect.ownKeys(result);
          const status = Object.getOwnPropertyDescriptor(result, "status");
          if ((prototype !== Object.prototype && prototype !== null)
            || keys.length !== 1 || keys[0] !== "status"
            || !status || !("value" in status) || status.value !== "committed") return response("PERSISTENCE_UNAVAILABLE", 503);
        } catch { return response("PERSISTENCE_UNAVAILABLE", 503); }
        return Response.json({ ok: true, disposition: "persisted", eventCount, ignored }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
      } catch { return response("PERSISTENCE_UNAVAILABLE", 503); }
    },
  };
}
