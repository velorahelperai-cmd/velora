import { externalSendAllowed, metaGraphVersion, sendReady, whatsappConfig, whatsappConfigurationMode, whatsappRoutingMode } from "./config";
import { consumeManualReviewPermit, type ManualReviewPermit } from './manual-review-permit';
import { createHash } from 'node:crypto';
import { validInboxAttachment } from '@/lib/customer/inbox-attachment-validation';

/** Shared server-side file admission for conversation attachments.
 * Re-exported from canonical module. The database still performs independent size and signature checks.
 */
export { validInboxAttachment };

export type SendTextResult =
  | { ok: true; waMessageId: string }
  | {
      ok: false;
      code:
        | "NOT_CONFIGURED"
        | "NEEDS_SETUP"
        | "SEND_DISABLED"
        | "PHONE_MISMATCH"
        | "RECIPIENT_NOT_ALLOWED"
        | "SERVICE_WINDOW_CLOSED"
        | "GRAPH_REJECTED"
        | "AMBIGUOUS";
      detail?: string;
    };

const SEND_TIMEOUT_MS = 25_000;

type GraphErrorPayload = {
  id?: unknown;
  messages?: Array<{ id?: string }>;
  error?: { message?: string; type?: string; code?: number | string };
};

/**
 * Confirmed provider rejection requires a readable Graph error object.
 * Unreadable bodies, 5xx, and other non-OK responses without clear reject evidence → AMBIGUOUS.
 */
function classifyHttpFailure(
  response: Response,
  payload: GraphErrorPayload | null,
): Extract<SendTextResult, { ok: false }> {
  const graphError = payload?.error;
  const hasClearReject =
    graphError != null
    && typeof graphError === "object"
    && (typeof graphError.message === "string" || graphError.code != null)
    && response.status >= 400
    && response.status < 500;

  if (hasClearReject) {
    return {
      ok: false,
      code: "GRAPH_REJECTED",
      // Graph messages can echo tokens, request bodies and recipient details.
      detail: /^\d{1,8}$/.test(String(graphError.code ?? ""))
        ? `graph_${String(graphError.code)}` : "graph_rejected",
    };
  }

  return {
    ok: false,
    code: "AMBIGUOUS",
    detail: payload == null
      ? `unreadable_${response.status}`
      : response.status >= 500
        ? `server_${response.status}`
        : `unclear_${response.status}`,
  };
}

type TransportInput = { toWaId: string; phoneNumberId: string; accessToken?: string; serviceWindowExpiresAt?: string };
type TransportAdmission = { ok: true; to: string; phone: string; token: string; version: string }
  | Extract<SendTextResult, { ok: false }>;
type AdmittedTransport = Extract<TransportAdmission, { ok: true }>;

// One admission path for provider operations. A caller must still hold the
// native, session-bound dispatch authority before invoking a send transport.
function admitWhatsappTransport(input: TransportInput, boundedManual: boolean): TransportAdmission {
  if (!externalSendAllowed() && !boundedManual) return { ok: false, code: 'SEND_DISABLED' };
  const phone = input.phoneNumberId.trim();
  if (!phone) return { ok: false, code: 'PHONE_MISMATCH' };
  const mode = whatsappRoutingMode();
  const config = whatsappConfig();
  let token = '';
  let version = 'v22.0';
  if (whatsappConfigurationMode() === 'meta_test') {
    const recipients = (process.env.WHATSAPP_TEST_RECIPIENTS ?? '').split(',').map(value => value.trim());
    if (!/^[1-9]\d{6,14}$/.test(input.toWaId) || recipients.length > 5 ||
        recipients.some(value => !/^[1-9]\d{6,14}$/.test(value)) || !recipients.includes(input.toWaId)) {
      return { ok: false, code: 'RECIPIENT_NOT_ALLOWED' };
    }
    const configuredVersion = metaGraphVersion();
    if (!configuredVersion) return { ok: false, code: 'NEEDS_SETUP' };
    version = configuredVersion;
  }
  if (mode === 'tenant_registry') {
    token = input.accessToken?.trim() ?? '';
    if (!token) return { ok: false, code: 'NEEDS_SETUP' };
    const configuredVersion = metaGraphVersion();
    if (!configuredVersion) return { ok: false, code: 'NEEDS_SETUP' };
    version = configuredVersion;
    const now = Date.now();
    const expires = input.serviceWindowExpiresAt ? Date.parse(input.serviceWindowExpiresAt) : NaN;
    if (!Number.isFinite(expires) || expires <= now || expires > now + 24 * 60 * 60 * 1000) {
      return { ok: false, code: 'SERVICE_WINDOW_CLOSED' };
    }
  } else {
    if (!sendReady(config)) return { ok: false, code: 'NOT_CONFIGURED' };
    if (phone !== config.phoneNumberId) return { ok: false, code: 'PHONE_MISMATCH' };
    token = config.accessToken;
  }
  if (!/^\d+$/.test(input.toWaId)) return { ok: false, code: 'GRAPH_REJECTED', detail: 'invalid_recipient' };
  return { ok: true, to: input.toWaId, phone, token, version };
}

type GraphMessage = { type: 'text'; text: { body: string } }
  | { type: 'image'; image: { id: string; caption?: string } }
  | { type: 'document'; document: { id: string; filename: string; caption?: string } };

async function dispatchGraphMessage(admission: AdmittedTransport, message: GraphMessage,
  input: { signal?: AbortSignal; onTransportStart?: () => void }): Promise<SendTextResult> {
  const timeout = AbortSignal.timeout(SEND_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  let response: Response;
  let payload: GraphErrorPayload | null;
  try {
    try { input.onTransportStart?.(); } catch { /* Diagnostic failures cannot prevent delivery. */ }
    response = await fetch(`https://graph.facebook.com/${admission.version}/${admission.phone}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${admission.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...message, messaging_product: 'whatsapp', to: admission.to }),
      redirect: 'error',
      cache: 'no-store',
      signal,
    });
    payload = (await response.json().catch(() => null)) as GraphErrorPayload | null;
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { ok: false, code: 'AMBIGUOUS', detail: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
  }
  const providerId = Array.isArray(payload?.messages) && payload.messages.length === 1 ? payload.messages[0]?.id : null;
  const waMessageId = typeof providerId === "string" && providerId.trim() === providerId && providerId.length > 0 ? providerId : null;
  if (response.ok && payload?.error != null) return { ok: false, code: 'AMBIGUOUS', detail: 'contradictory_provider_response' };
  if (response.ok && waMessageId) return { ok: true, waMessageId };
  if (response.ok) return { ok: false, code: 'AMBIGUOUS', detail: 'missing_provider_id' };
  return classifyHttpFailure(response, payload);
}

/**
 * Sends a text message through WhatsApp Cloud API.
 * Requires WHATSAPP_ALLOW_EXTERNAL_SEND=true. Do not invoke from automatic AI paths.
 * single_tenant: phoneNumberId must match env — never silently fall back to another number.
 * tenant_registry: caller must pass the per-number token; env token is never used.
 */
export async function sendWhatsappText(input: {
  toWaId: string;
  body: string;
  /** Bound conversation / intent phone number id. */
  phoneNumberId: string;
  /** Required in tenant_registry. Ignored in single_tenant (env token only). */
  accessToken?: string;
  /** Server evidence from whatsapp_check_service_window; required for tenant freeform sends. */
  serviceWindowExpiresAt?: string;
  signal?: AbortSignal;
  manualReviewPermit?: ManualReviewPermit;
  /** Server-only diagnostics callback, invoked immediately before transport. */
  onTransportStart?: () => void;
}): Promise<SendTextResult> {
  const boundedManual = consumeManualReviewPermit(input.manualReviewPermit, input);
  const admission = admitWhatsappTransport(input, boundedManual);
  if (!admission.ok) return admission;
  const text = input.body.trim().slice(0, 4096);
  if (!admission.to || !text) return { ok: false, code: "GRAPH_REJECTED", detail: "empty" };

  return dispatchGraphMessage(admission, { type: 'text', text: { body: text } }, input);
}

/** Process-local proof that this exact media was uploaded under this binding.
 * Native durable intent/claim/final authorization remain the caller's responsibility.
 * It is intentionally not serializable and never carries the provider id to clients.
 */
export type WhatsappUploadedMedia = Readonly<{ kind: 'whatsapp-uploaded-media' }>;
type MediaAttempt = TransportInput & { companyId: string; conversationId: string; actorId: string; linkId: string | null; linkGeneration: number | null; intentId: string; attemptToken: string; attachmentId: string; caption?: string };
type UploadedBinding = { id: string; scopeHash: string; captionHash: string; phone: string; to: string; version: string; tokenHash: string; mime: string; filename: string; expires: number };
const uploadedMedia = new WeakMap<WhatsappUploadedMedia, UploadedBinding>();
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function mediaScope(input: MediaAttempt): string | null {
  const ids = [input.companyId, input.conversationId, input.actorId, input.intentId, input.attemptToken, input.attachmentId];
  if (!ids.every(uuid)) return null;
  const noLink = input.linkId === null && input.linkGeneration === null;
  const linked = uuid(input.linkId) && Number.isSafeInteger(input.linkGeneration) && input.linkGeneration! >= 1;
  if ((!noLink && !linked) || (whatsappRoutingMode() === 'tenant_registry' && !linked)) return null;
  return tokenHash(JSON.stringify([...ids.map(id => id.toLowerCase()), input.linkId?.toLowerCase() ?? null, input.linkGeneration]));
}

/** Upload does not send a customer message. Call only after native claim and entitlement checks. */
export async function uploadWhatsappMedia(input: MediaAttempt & { filename: string; mime: string; base64: string; signal?: AbortSignal }): Promise<
  { ok: true; media: WhatsappUploadedMedia } | Extract<SendTextResult, { ok: false }>
> {
  // Review grants in the current product bind exact text, not media.
  if (whatsappConfigurationMode() === 'meta_test') return { ok: false, code: 'SEND_DISABLED' };
  const admission = admitWhatsappTransport(input, false);
  if (!admission.ok) return admission;
  const scopeHash = mediaScope(input);
  if (!scopeHash) return { ok: false, code: 'GRAPH_REJECTED', detail: 'media_binding_unconfirmed' };
  if (input.caption !== undefined && (typeof input.caption !== 'string' || input.caption.length > 1024)) return { ok: false, code: 'GRAPH_REJECTED', detail: 'invalid_caption' };
  const captionHash = tokenHash(input.caption?.trim() ?? '');
  const { filename, mime, base64 } = input;
  if (!validInboxAttachment(filename, mime, base64)) return { ok: false, code: 'GRAPH_REJECTED', detail: 'invalid_media' };
  const bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
  const form = new FormData();
  form.set('messaging_product', 'whatsapp');
  form.set('type', mime);
  form.set('file', new Blob([bytes], { type: mime }), filename);
  const timeout = AbortSignal.timeout(SEND_TIMEOUT_MS);
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
  let response: Response;
  let payload: GraphErrorPayload | null;
  try {
    response = await fetch(`https://graph.facebook.com/${admission.version}/${admission.phone}/media`, {
      method: 'POST', headers: { authorization: `Bearer ${admission.token}` }, body: form, redirect: 'error', cache: 'no-store', signal,
    });
    payload = (await response.json().catch(() => null)) as GraphErrorPayload | null;
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { ok: false, code: 'AMBIGUOUS', detail: name === 'TimeoutError' || name === 'AbortError' ? 'upload_timeout' : 'upload_network' };
  }
  if (!response.ok) return classifyHttpFailure(response, payload);
  if (payload?.error != null || typeof payload?.id !== 'string' || !/^\d{1,128}$/.test(payload.id)) {
    return { ok: false, code: 'AMBIGUOUS', detail: 'upload_evidence_unconfirmed' };
  }
  const media: WhatsappUploadedMedia = Object.freeze({ kind: 'whatsapp-uploaded-media' });
  uploadedMedia.set(media, { id: payload.id, scopeHash, captionHash, phone: admission.phone, to: admission.to, version: admission.version,
    tokenHash: tokenHash(admission.token), mime, filename, expires: Date.now() + 60_000 });
  return { ok: true, media };
}

/** Must be called immediately after the native one-use staff dispatch authorization. */
export async function sendWhatsappMedia(input: MediaAttempt & { media: WhatsappUploadedMedia; signal?: AbortSignal; onTransportStart?: () => void }): Promise<SendTextResult> {
  const binding = input.media && typeof input.media === 'object' ? uploadedMedia.get(input.media) : undefined;
  if (input.media && typeof input.media === 'object') uploadedMedia.delete(input.media);
  if (!binding || binding.expires <= Date.now()) return { ok: false, code: 'GRAPH_REJECTED', detail: 'media_binding_unconfirmed' };
  if (whatsappConfigurationMode() === 'meta_test') return { ok: false, code: 'SEND_DISABLED' };
  const admission = admitWhatsappTransport(input, false);
  if (!admission.ok) return admission;
  if (input.caption !== undefined && (typeof input.caption !== 'string' || input.caption.length > 1024)) return { ok: false, code: 'GRAPH_REJECTED', detail: 'invalid_caption' };
  const caption = input.caption?.trim();
  if (binding.scopeHash !== mediaScope(input) ||
      binding.captionHash !== tokenHash(caption ?? '') || binding.phone !== admission.phone || binding.to !== admission.to || binding.version !== admission.version || binding.tokenHash !== tokenHash(admission.token)) {
    return { ok: false, code: 'GRAPH_REJECTED', detail: 'media_binding_unconfirmed' };
  }
  const common = { id: binding.id, ...(caption ? { caption } : {}) };
  const message: GraphMessage = binding.mime === 'application/pdf'
    ? { type: 'document', document: { ...common, filename: binding.filename } }
    : { type: 'image', image: common };
  return dispatchGraphMessage(admission, message, input);
}
