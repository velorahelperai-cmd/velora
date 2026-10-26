import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/auth/site-url";
import { parseBusinessPhoneInput } from "@/lib/business-phone-input";
import { normalizeOptionalBranchContactPhone, validatePreparation, type Preparation } from "@/lib/tenancy/prepayment-preparation";
import { readTestCheckoutConfig, fetchPaymobHttp } from "../wiring/test-checkout";
import { openAccountSandboxCheckout, type AccountSandboxStore } from "./sandbox-checkout";
import { parseAccountOrderRow } from "./account-order";
import { offersEqual, resolveEs02Offer, type Es02OfferSelection } from "./commercial-offer";
import { classifyCreateOrderWriteAck } from "./write-ack";
import type { Es02AccountOrderView, Es02Result } from "./contracts";

export type AccountCheckoutInput = {
  accountId: string;
  sessionId: string;
  clientOpId: string;
  selection: Es02OfferSelection;
  preparation?: Preparation;
};
export type AccountCheckoutData = { order: Es02AccountOrderView; action: "insert" | "reuse"; checkoutUrl: string };

/** Configuration is deliberately checked before creating an unpaid order. */
export async function beginAccountTestCheckout(input: AccountCheckoutInput): Promise<Es02Result<AccountCheckoutData>> {
  if (process.env.BILLING_ES02_PAYMOB_TEST_ENABLED !== "true") return { ok: false, code: "PAYMOB_EXTERNAL_DEFERRED" };
  if (process.env.PAYMOB_HOSTED_TEST_ACCOUNT_ID?.trim() !== input.accountId) return { ok: false, code: "FORBIDDEN" };
  const settings = readTestCheckoutConfig(process.env);
  if (!settings.ok) return { ok: false, code: "UNCONFIGURED" };
  const admin = createAdminClient();
  if (!admin) return { ok: false, code: "UNCONFIGURED" };
  let origin: URL;
  try { origin = new URL(siteUrl()); } catch { return { ok: false, code: "UNCONFIGURED" }; }
  if (origin.origin !== "https://www.velorahelper.com") return { ok: false, code: "UNCONFIGURED" };
  const resolved = resolveEs02Offer(input.selection);
  if (!resolved.ok) return resolved;
  try {
    if (!input.preparation || validatePreparation(input.preparation).length || input.preparation.branches.length !== resolved.offer.branchSlots) return { ok: false, code: "INVALID_INPUT" };
  } catch { return { ok: false, code: "INVALID_INPUT" }; }
  const phone = parseBusinessPhoneInput(input.preparation.phone, input.preparation.country);
  if (!phone.ok || !phone.value) return { ok: false, code: "INVALID_INPUT" };
  const preparation: Preparation = {
    name: input.preparation.name.trim(), type: input.preparation.type.trim(),
    country: input.preparation.country, city: input.preparation.city.trim(), phone: phone.value,
    branches: input.preparation.branches.map(branch => {
      const contact = normalizeOptionalBranchContactPhone(branch.contactPhone);
      return { name: branch.name.trim(), city: branch.city.trim(), ...(contact.ok && contact.value ? { contactPhone: contact.value } : {}) };
    }),
    ...(input.preparation.answers ? { answers: input.preparation.answers } : {}),
  };
  // The preparation is captured atomically with the order; no provider call can
  // precede the acknowledged account/order/offer binding.
  try {
    const client = await createClient();
    const created = await client.rpc("es02_begin_test_checkout" as never, {
      p_expected_account_id: input.accountId,
      p_client_op_id: input.clientOpId,
      p_term: input.selection.term,
      p_slots: input.selection.slots,
      p_preparation: preparation,
      p_consent_accepted: true,
    } as never);
    if (created.error) return { ok: false, code: "UNKNOWN" };
    const ack = classifyCreateOrderWriteAck(created.data);
    if (ack.status === "unknown") return { ok: false, code: "UNKNOWN" };
    if (ack.status === "denied") return { ok: false, code: ack.code };
    const order = parseAccountOrderRow(ack.data, input.accountId);
    if (!order || !offersEqual(order.offer, resolved.offer)) return { ok: false, code: "UNKNOWN" };
    const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
      const result = await admin.rpc(name as never, args as never);
      if (result.error) throw new Error("checkout_store_unavailable");
      return result.data;
    };
    const deps: AccountSandboxStore & { http: typeof fetchPaymobHttp } = {
      http: fetchPaymobHttp,
      loadOwnedOrder: async (accountId, orderId) => accountId === order.accountId && orderId === order.orderId ? order : null,
      claim: async (binding) => {
        const value = await call("es02_claim_test_checkout", { p_binding: binding, p_session_id: input.sessionId });
        if (!value || typeof value !== "object" || !("kind" in value)) throw new Error("checkout_claim_unknown");
        return value as Awaited<ReturnType<AccountSandboxStore["claim"]>>;
      },
      complete: async (saved) => (await call("es02_complete_test_checkout", { p_saved: saved })) === true,
    };
    const checkout = await openAccountSandboxCheckout({ accountId: input.accountId, orderId: order.orderId, config: settings.config, billingPhone: phone.value, callbackOrigin: origin.origin, deps });
    // Any error after claim may follow an external side effect. Retain the same
    // operation until the durable store reconciles it; never unlock a new charge.
    if (!checkout.ok) return { ok: false, code: "UNKNOWN" };
    return { ok: true, data: { order, action: ack.action, checkoutUrl: checkout.url } };
  } catch { return { ok: false, code: "UNKNOWN" }; }
}
