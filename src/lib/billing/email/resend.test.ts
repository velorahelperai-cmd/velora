import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readEmailConfig, sendReceiptEmail } from "./resend";
const env = { BILLING_EMAIL_WORKER_ENABLED: "true", RESEND_API_KEY: "re_synthetic", BILLING_EMAIL_FROM: "founder@velorahelper.com", BILLING_EMAIL_VERIFIED_DOMAIN: "velorahelper.com", BILLING_EMAIL_DOMAIN_VERIFIED: "true", NEXT_PUBLIC_SITE_URL: "https://velorahelper.com" };
const receipt = { id: "11111111-1111-4111-8111-111111111111", claimToken: "22222222-2222-4222-8222-222222222222", idempotencyKey: "velora-subscription-receipt/11111111-1111-4111-8111-111111111111/v1", recipient: "owner@example.test", companyName: "Synthetic Company", orderId: "33333333-3333-4333-8333-333333333333", amountBaisa: 45000, paidThrough: "2027-01-01T00:00:00Z" };
describe("Resend receipt email", () => {
  it.each([{}, { ...env, BILLING_EMAIL_WORKER_ENABLED: "false" }, { ...env, BILLING_EMAIL_DOMAIN_VERIFIED: "false" }, { ...env, BILLING_EMAIL_FROM: "founder@another.test" }, { ...env, BILLING_EMAIL_FROM: "founder@velorahelper.com\r\nBcc: other@test.com" }])("fails closed before provider work for invalid settings", settings => { expect(readEmailConfig(settings).ok).toBe(false); });
  it("pins Resend endpoint, disables redirects, passes immutable dedupe, and reports accepted only", async () => {
    const config = readEmailConfig(env); if (!config.ok) throw Error("fixture config");
    const http = vi.fn().mockResolvedValue(Response.json({ id: "provider-email-id" }));
    expect(await sendReceiptEmail(config.config, receipt, http)).toEqual({ kind: "accepted", providerId: "provider-email-id", code: "RESEND_ACCEPTED" });
    expect(http).toHaveBeenCalledOnce();
    const [url, options] = http.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails"); expect(options.redirect).toBe("error");
    expect(options.headers["Idempotency-Key"]).toBe(receipt.idempotencyKey);
    const body = JSON.parse(options.body); expect(body.from).toBe(env.BILLING_EMAIL_FROM); expect(body.to).toEqual([receipt.recipient]);
    expect(body.text).toContain("45.000 OMR"); expect(body.text).toContain("separate"); expect(JSON.stringify(body)).not.toContain(env.RESEND_API_KEY);
  });
  it.each([500, 429, 409, 302])("never retries an ambiguous HTTP %s response", async status => {
    const config = readEmailConfig(env); if (!config.ok) throw Error("fixture config");
    const http = vi.fn().mockResolvedValue(new Response("private diagnostics", { status }));
    expect((await sendReceiptEmail(config.config, receipt, http)).kind).toBe("reconciliation_required"); expect(http).toHaveBeenCalledOnce();
  });
  it("records explicit sender rejection without leaking diagnostics", async () => {
    const config = readEmailConfig(env); if (!config.ok) throw Error("fixture config");
    const http = vi.fn().mockResolvedValue(new Response("private credentials", { status: 403 }));
    expect(await sendReceiptEmail(config.config, receipt, http)).toEqual({ kind: "rejected", code: "RESEND_REJECTED" });
  });
  it("keeps timeouts and malformed successful responses unresolved with no retry", async () => {
    const config = readEmailConfig(env); if (!config.ok) throw Error("fixture config");
    for (const http of [vi.fn().mockRejectedValue(Error("secret transport")), vi.fn().mockResolvedValue(Response.json({}))]) {
      expect((await sendReceiptEmail(config.config, receipt, http)).kind).toBe("reconciliation_required"); expect(http).toHaveBeenCalledOnce();
    }
  });
  it("accepts a company name with 120 Unicode characters and bounds provider responses", async () => {
    const config = readEmailConfig(env); if (!config.ok) throw Error("fixture config");
    const unicode = { ...receipt, companyName: "🌟".repeat(120) };
    const http = vi.fn().mockResolvedValue(Response.json({ id: "provider-id" }));
    expect((await sendReceiptEmail(config.config, unicode, http)).kind).toBe("accepted");
    const oversized = vi.fn().mockResolvedValue(Response.json({ id: "provider-id", extra: "x".repeat(20000) }));
    expect((await sendReceiptEmail(config.config, receipt, oversized)).kind).toBe("reconciliation_required");
    expect(oversized).toHaveBeenCalledOnce();
  });
});
