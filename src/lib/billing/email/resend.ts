import "server-only";
import { emailAddress, emailUuid, type EmailClaim, type EmailOutcome } from "./contracts";
export type EmailConfig = { apiKey: string; from: string; verifiedDomain: string; siteOrigin: string };
export function readEmailConfig(env: Record<string, string | undefined>): { ok: true; config: EmailConfig } | { ok: false; code: "EMAIL_DISABLED" | "EMAIL_NOT_CONFIGURED" } {
  if (env.BILLING_EMAIL_WORKER_ENABLED !== "true") return { ok: false, code: "EMAIL_DISABLED" };
  const apiKey = env.RESEND_API_KEY?.trim() ?? "", from = env.BILLING_EMAIL_FROM?.trim() ?? "", domain = env.BILLING_EMAIL_VERIFIED_DOMAIN?.trim().toLowerCase() ?? "";
  // Domain verification is an explicit deployment attestation, never inferred from a mailbox or a key.
  if (env.BILLING_EMAIL_DOMAIN_VERIFIED !== "true" || !/^re_[A-Za-z0-9_-]+$/.test(apiKey) || !emailAddress(from)
    || domain === "resend.dev" || from.split("@")[1] !== domain || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(domain)) return { ok: false, code: "EMAIL_NOT_CONFIGURED" };
  try {
    const site = new URL(env.NEXT_PUBLIC_SITE_URL ?? "");
    if (site.protocol !== "https:" || site.username || site.password || site.port || ["localhost", "127.0.0.1", "[::1]"].includes(site.hostname)) return { ok: false, code: "EMAIL_NOT_CONFIGURED" };
    return { ok: true, config: { apiKey, from, verifiedDomain: domain, siteOrigin: site.origin } };
  } catch { return { ok: false, code: "EMAIL_NOT_CONFIGURED" }; }
}
export function validEmailClaim(value: unknown): value is EmailClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as EmailClaim;
  return emailUuid(row.id) && emailUuid(row.claimToken) && emailUuid(row.orderId) && emailAddress(row.recipient)
    && row.idempotencyKey === `velora-subscription-receipt/${row.id}/v1` && typeof row.companyName === "string" && row.companyName.length <= 240 && [...row.companyName].length <= 120
    && Number.isSafeInteger(row.amountBaisa) && row.amountBaisa > 0 && typeof row.paidThrough === "string" && Number.isFinite(Date.parse(row.paidThrough));
}
export async function sendReceiptEmail(config: EmailConfig, receipt: EmailClaim, http: typeof fetch = fetch): Promise<EmailOutcome> {
  const unknown: EmailOutcome = { kind: "reconciliation_required", code: "RESEND_OUTCOME_UNKNOWN" };
  if (!validEmailClaim(receipt) || !emailAddress(config.from) || config.from.split("@")[1] !== config.verifiedDomain) return { kind: "rejected", code: "RESEND_REJECTED" };
  const amount = BigInt(receipt.amountBaisa), thousand = BigInt(1000), money = `${amount / thousand}.${String(amount % thousand).padStart(3, "0")} OMR`;
  const text = `Velora subscription payment confirmed\n\nBusiness: ${receipt.companyName}\nPayment: ${money}\nPaid through: ${new Date(receipt.paidThrough).toISOString()}\nOrder: ${receipt.orderId}\nView your order: ${config.siteOrigin}/app/subscription/orders/${receipt.orderId}\n\nYour Live payment has been verified. Service eligibility and WhatsApp/AI activation remain separate.\n\nتم تأكيد دفعة الاشتراك. تفعيل الخدمات وواتساب والذكاء الاصطناعي يخضع لفحوصات منفصلة.`;
  try {
    const response = await http("https://api.resend.com/emails", { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": receipt.idempotencyKey },
      body: JSON.stringify({ from: config.from, to: [receipt.recipient], subject: "Velora subscription payment confirmed", text }) });
    if (!response.ok) return response.status >= 400 && response.status < 500 && ![408, 409, 425, 429].includes(response.status) ? { kind: "rejected", code: "RESEND_REJECTED" } : unknown;
    const reader = response.body?.getReader(); if (!reader) return unknown;
    const decoder = new TextDecoder(), chunks: string[] = []; let size = 0;
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8192) { await reader.cancel(); return unknown; }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    const data: unknown = JSON.parse(chunks.join(""));
    if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id)) return unknown;
    return { kind: "accepted", providerId: data.id, code: "RESEND_ACCEPTED" };
  } catch { return unknown; }
}
