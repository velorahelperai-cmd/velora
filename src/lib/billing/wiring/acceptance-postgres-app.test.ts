import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ client: null as unknown, companyId: "", userId: "" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }));
vi.mock("@/lib/tenancy/access", () => ({ getCompanyAccess: async () => ({ ok: true, context: { userId: state.userId, company: { id: state.companyId, status: "active" }, membership: { role: "owner" } } }) }));
// @ts-expect-error Local PostgreSQL harness is intentionally dependency-free JavaScript.
import { appDatabaseAdapter } from "../../../../scripts/billing-acceptance/app-database-adapter.mjs";
// @ts-expect-error Local PostgreSQL harness is intentionally dependency-free JavaScript.
import { fixture } from "../../../../scripts/billing-acceptance/fixtures.mjs";
// @ts-expect-error Local PostgreSQL harness is intentionally dependency-free JavaScript.
import { rows, verifyLocalContainer } from "../../../../scripts/billing-acceptance/postgres.mjs";
import { POST } from "@/app/api/billing/paymob/webhook/route";
import { buildProcessedCallbackBody, paymobAdapterFixtures as f } from "../paymob/fixtures";
import { loadOwnerBillingSubscription } from "./subscription-read";
import { processOwnerOrderEvents } from "./order-event-processing";
import { reconcileStoredBillingEvent } from "../operations/reconciliation";

const enabled = process.env.BILLING_ACCEPTANCE_POSTGRES_TESTS === "1";
const providerOrderId=String(9_000_000+Math.floor(Math.random()*90_000_000));
const transactionBase=Number(providerOrderId)+100_000_000;
afterEach(() => vi.unstubAllEnvs());
describe.skipIf(!enabled)("actual PostgreSQL-backed application payment acceptance", () => {
  async function receipt(data: { providerOrderId: string; account: string }, id: number, isRefunded = false) {
    const signed = buildProcessedCallbackBody({ id, integration_id: Number(data.account), owner: 84001, order: { id: Number(data.providerOrderId) }, is_refunded: isRefunded });
    return POST(new Request(`http://localhost.invalid/api/billing/paymob/webhook?hmac=${signed.hmac}`, { method: "POST", body: JSON.stringify(signed.body) }));
  }
  function configure(environment: "test" | "live") {
    state.client = appDatabaseAdapter();
    // Synthetic fixture arithmetic only; not proof of provider OMR scaling.
    vi.stubEnv("PAYMOB_OMR_CONVERSION_VERIFIED","true");vi.stubEnv("PAYMOB_OMR_UNITS_PER_OMR","1000");
    vi.stubEnv("BILLING_PAYMOB_WEBHOOK_ENABLED", "true"); vi.stubEnv("BILLING_PAYMOB_SETTLE_ENABLED", "true");
    vi.stubEnv("BILLING_PAYMOB_LIVE_ENABLED", environment === "live" ? "true" : "false");
    vi.stubEnv("PAYMOB_HMAC_SECRET", f.hmacSecret); vi.stubEnv("PAYMOB_MERCHANT_OWNER_ID", "84001");
    vi.stubEnv("PAYMOB_INTEGRATION_ID_TEST", "74001"); vi.stubEnv("PAYMOB_INTEGRATION_ID_LIVE", "74002");
  }
  const fallback = { state: "empty" as const, currentTier: null, cycle: null, paidThrough: null };
  it("Test HTTP webhook saves one verified receipt and zero grants after replay and worker", async () => {
    await verifyLocalContainer(); configure("test");
    const data = await fixture({ providerOrderId, account: "74001" }); state.companyId = data.companyId; state.userId = data.userId;
    vi.stubEnv("BILLING_PAYMOB_HOSTED_TEST_ENABLED","true");
    vi.stubEnv("PAYMOB_HOSTED_TEST_ACCOUNT_ID",data.userId);
    vi.stubEnv("PAYMOB_HOSTED_TEST_COMPANY_ID",data.companyId);
    const grants = () => rows(`SELECT id FROM billing_entitlement_applications WHERE company_id='${data.companyId}'`);
    expect(await grants()).toHaveLength(0);
    for (const [index, difference] of [{owner:84002},{amount_cents:5001},{currency:"EGP"}].entries()) {
      const invalid=buildProcessedCallbackBody({id:transactionBase+10+index,integration_id:Number(data.account),owner:84001,order:{id:Number(data.providerOrderId)},...difference});
      const denied=await POST(new Request(`http://localhost.invalid/api/billing/paymob/webhook?hmac=${invalid.hmac}`,{method:"POST",body:JSON.stringify(invalid.body)}));
      expect(denied.status).toBe(409);
    }
    const invalidHmac=buildProcessedCallbackBody({id:transactionBase+20,integration_id:Number(data.account),owner:84001,order:{id:Number(data.providerOrderId)}});
    expect((await POST(new Request("http://localhost.invalid/api/billing/paymob/webhook?hmac=invalid",{method:"POST",body:JSON.stringify(invalidHmac.body)}))).status).not.toBe(200);
    expect(await rows(`SELECT id FROM billing_provider_events WHERE company_id='${data.companyId}'`)).toHaveLength(0);
    const success=await receipt(data,transactionBase);expect(success.status).toBe(200);expect(await success.text()).toBe("stored_test_no_entitlement");expect(await grants()).toHaveLength(0);
    const replay=await receipt(data,transactionBase);expect(replay.status).toBe(200);expect(await replay.text()).toBe("duplicate_test_no_entitlement");expect(await grants()).toHaveLength(0);
    const events=await rows(`SELECT id,raw_summary FROM billing_provider_events WHERE company_id='${data.companyId}'`);
    expect(events).toHaveLength(1);expect(events[0].raw_summary.hmac_verified).toBe(true);
    await processOwnerOrderEvents(data.companyId,data.orderId);
    expect(await reconcileStoredBillingEvent(events[0].id)).toEqual({kind:"blocked",code:"hosted_test_no_entitlement"});
    expect(await grants()).toHaveLength(0);
    // Assert actual database effect, not a fallback from the newer operational reader.
    expect(await rows(`SELECT id FROM billing_subscriptions WHERE company_id='${data.companyId}'`)).toHaveLength(0);

  }, 30_000);
  it("Live synthetic approved policy flows through scoped receipt, RPC and read; refund replay preserves paid evidence", async () => {
    await verifyLocalContainer(); configure("live");
    const data = await fixture({ environment: "live", account: "74002", providerOrderId, deadlinePolicyApproved: true }); state.companyId = data.companyId; state.userId = data.userId;
    const success = await receipt(data, transactionBase+1);
    expect(success.status).toBe(200); expect(await success.text()).toBe("stored");
    const before = await loadOwnerBillingSubscription(fallback);
    expect(before.state).toBe("active"); expect(before.paidThrough).not.toBeNull();
    expect((await receipt(data, transactionBase+1, true)).status).toBe(200);
    expect((await receipt(data, transactionBase+1, true)).status).toBe(200);
    expect((await receipt(data, transactionBase+1)).status).toBe(200);
    expect(await loadOwnerBillingSubscription(fallback)).toMatchObject({ state: "active", paidThrough: before.paidThrough });
    expect(await rows(`SELECT id FROM billing_entitlement_applications WHERE company_id='${data.companyId}'`)).toHaveLength(1);
    expect(await rows(`SELECT id FROM private.billing_lifecycle_reviews WHERE company_id='${data.companyId}' AND reason='refund_extent_or_parent_unconfirmed'`)).toHaveLength(1);
    // Policy approval is synthetic fixture data; no real owner decision or external payment occurred.
  }, 30_000);
});
