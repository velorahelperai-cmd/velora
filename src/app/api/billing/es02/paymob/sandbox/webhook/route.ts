import { createAdminClient } from "@/lib/supabase/admin";
import { readTestCheckoutConfig } from "@/lib/billing/wiring/test-checkout";
import { receiveAccountSandboxPayment } from "@/lib/billing/es02/sandbox-checkout";
import { parseAccountOrderRow } from "@/lib/billing/es02/account-order";
import { observeWebhookIngress } from "@/lib/logging/ingress-observation-server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return observeWebhookIngress("paymob", async () => {
    const settings = readTestCheckoutConfig(process.env);
    const admin = createAdminClient();
    const account = process.env.PAYMOB_HOSTED_TEST_ACCOUNT_ID?.trim();
    if (process.env.BILLING_ES02_PAYMOB_TEST_ENABLED !== "true" || !settings.ok || !admin || !account) return new Response("unavailable", { status: 503 });
    const reader = request.body?.getReader();
    if (!reader) return new Response("invalid", { status: 400 });
    let raw = "";
    let size = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 65536) { await reader.cancel(); return new Response("too_large", { status: 413 }); }
        raw += decoder.decode(part.value, { stream: true });
      }
      raw += decoder.decode();
      const body: unknown = JSON.parse(raw);
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await admin.rpc(name as never, args as never);
        if (result.error) throw new Error("payment_store_unavailable");
        return result.data;
      };
      const result = await receiveAccountSandboxPayment({ body, hmacQueryParam: new URL(request.url).searchParams.get("hmac"), config: settings.config, deps: {
        loadByProviderOrderId: async (providerOrderId, integrationId) => {
          const value = await call("es02_find_test_checkout", { p_provider_order_id: providerOrderId, p_integration_id: integrationId }) as { order?: unknown } | null;
          const order = parseAccountOrderRow(value?.order, account);
          return order && value ? { ...value, order } : null;
        },
        recordVerifiedPayment: async evidence => {
          if (evidence.accountId !== account) return { ok: false, code: "FORBIDDEN" };
          const value = await call("es02_record_test_payment", { p_evidence: evidence }) as { ok?: boolean; outcome?: string } | null;
          if (value?.ok === true && (value.outcome === "settled" || value.outcome === "duplicate")) return { ok: true, outcome: value.outcome };
          return { ok: false, code: "payment_pending" };
        },
      } });
      return new Response(result.ok ? result.outcome : "not_confirmed", { status: result.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
    } catch { return new Response("not_confirmed", { status: 503 }); }
    finally { reader.releaseLock(); }
  });
}
