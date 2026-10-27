import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/auth/site-url";
import { parseBusinessPhoneInput } from "@/lib/business-phone-input";
import { normalizeOptionalBranchContactPhone, validatePreparation, type Preparation } from "@/lib/tenancy/prepayment-preparation";
import { es02Uuid, type Es02Result } from "./contracts";
import { parseAccountOrderRow } from "./account-order";
import { offersEqual, resolveEs02Offer } from "./commercial-offer";
import { classifyCreateOrderWriteAck } from "./write-ack";
import type { AccountCheckoutInput, AccountCheckoutData } from "./account-checkout";
import { createThawaniTestSession, readThawaniTestConfig, readThawaniTestSession, thawaniTestCheckoutUrl } from "./thawani-test";

export async function beginThawaniTestCheckout(input: AccountCheckoutInput): Promise<Es02Result<AccountCheckoutData>> {
  const config = readThawaniTestConfig(process.env);
  if (!config) return { ok: false, code: "UNCONFIGURED" };
  if (config.accountId !== input.accountId) return { ok: false, code: "FORBIDDEN" };
  const admin = createAdminClient();
  if (!admin || siteUrl() !== "https://www.velorahelper.com") return { ok: false, code: "UNCONFIGURED" };
  const resolved = resolveEs02Offer(input.selection);
  if (!resolved.ok) return resolved;
  try {
    if (!input.preparation || validatePreparation(input.preparation).length || input.preparation.branches.length !== resolved.offer.branchSlots) return { ok: false, code: "INVALID_INPUT" };
    const phone = parseBusinessPhoneInput(input.preparation.phone, input.preparation.country);
    if (!phone.ok || !phone.value) return { ok: false, code: "INVALID_INPUT" };
    const preparation: Preparation = {
      name: input.preparation.name.trim(), type: input.preparation.type.trim(), country: input.preparation.country,
      city: input.preparation.city.trim(), phone: phone.value,
      branches: input.preparation.branches.map(branch => {
        const contact = normalizeOptionalBranchContactPhone(branch.contactPhone);
        return { name: branch.name.trim(), city: branch.city.trim(), ...(contact.ok && contact.value ? { contactPhone: contact.value } : {}) };
      }), ...(input.preparation.answers ? { answers: input.preparation.answers } : {}),
    };
    const client = await createClient();
    const created = await client.rpc("es02_begin_thawani_test_checkout" as never, {
      p_expected_account_id: input.accountId, p_client_op_id: input.clientOpId, p_term: input.selection.term,
      p_slots: input.selection.slots, p_preparation: preparation, p_consent_accepted: true,
    } as never);
    if (created.error) return { ok: false, code: "UNKNOWN" };
    const ack = classifyCreateOrderWriteAck(created.data);
    if (ack.status === "unknown") return { ok: false, code: "UNKNOWN" };
    if (ack.status === "denied") return { ok: false, code: ack.code };
    const order = parseAccountOrderRow(ack.data, input.accountId);
    if (!order || order.environment !== "test" || !offersEqual(order.offer, resolved.offer)) return { ok: false, code: "UNKNOWN" };
    const claimed = await admin.rpc("es02_claim_thawani_test_checkout" as never, { p_account_id: input.accountId, p_order_id: order.orderId, p_auth_session_id: input.sessionId } as never);
    const claim = claimed.data as { kind?: string; token?: string; sessionId?: string } | null;
    if (claimed.error || !claim) return { ok: false, code: "UNKNOWN" };
    if (claim.kind === "ready" && claim.sessionId) return { ok: true, data: { order, action: ack.action, checkoutUrl: thawaniTestCheckoutUrl(config, claim.sessionId) } };
    if (claim.kind !== "claimed" || !es02Uuid(claim.token)) return { ok: false, code: "UNKNOWN" };
    const session = await createThawaniTestSession(config, { reference: order.specialReference, amountBaisa: order.offer.amountBaisa, token: claim.token }, "https://www.velorahelper.com/account/payment/" + order.orderId + "/popup");
    const saved = await admin.rpc("es02_complete_thawani_test_checkout" as never, { p_account_id: input.accountId, p_order_id: order.orderId, p_claim_token: claim.token, p_session_id: session.sessionId, p_invoice: session.invoice } as never);
    if (saved.error || saved.data !== true) return { ok: false, code: "UNKNOWN" };
    return { ok: true, data: { order, action: ack.action, checkoutUrl: thawaniTestCheckoutUrl(config, session.sessionId) } };
  } catch {
    // A failed response can follow provider creation. Never release/reissue the claim.
    return { ok: false, code: "UNKNOWN" };
  }
}

/** Caller authenticates the active session. The user RPC independently enforces ownership. */
export async function verifyOwnedThawaniTestPayment(accountId: string, orderId: string): Promise<{ ok: true; paid: boolean } | { ok: false }> {
  const config = readThawaniTestConfig(process.env);
  if (!config || accountId !== config.accountId || !es02Uuid(orderId)) return { ok: false };
  try {
    const client = await createClient();
    const result = await client.rpc("es02_read_thawani_test_payment" as never, { p_expected_account_id: accountId, p_order_id: orderId } as never);
    const value = result.data as { ok?: boolean; data?: { order?: unknown; state?: string; paidAt?: string; sessionId?: string; claimToken?: string } } | null;
    const order = parseAccountOrderRow(value?.data?.order, accountId);
    if (result.error || value?.ok !== true || !order || order.orderId !== orderId || order.environment !== "test") return { ok: false };
    if (value.data?.state === "paid" && value.data.paidAt) return { ok: true, paid: true };
    if (value.data?.state !== "ready" || !value.data.sessionId || !es02Uuid(value.data.claimToken)) return { ok: false };
    const session = await readThawaniTestSession(config, value.data.sessionId, { reference: order.specialReference, amountBaisa: order.offer.amountBaisa, token: value.data.claimToken });
    if (session.status !== "paid") return { ok: true, paid: false };
    const admin = createAdminClient();
    if (!admin) return { ok: false };
    const saved = await admin.rpc("es02_record_thawani_test_payment" as never, { p_account_id: accountId, p_order_id: orderId, p_session_id: session.sessionId, p_claim_token: value.data.claimToken, p_invoice: session.invoice, p_amount_baisa: order.offer.amountBaisa } as never);
    if (saved.error || (saved.data as { ok?: boolean } | null)?.ok !== true) return { ok: false };
    return { ok: true, paid: true };
  } catch { return { ok: false }; }
}
