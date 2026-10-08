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
    vi.stubEnv("BILLING_PAYMOB_WEBHOOK_ENABLED", "true"); vi.stubEnv("BILLING_PAYMOB_SETTLE_ENABLED", "true");
    vi.stubEnv("BILLING_PAYMOB_LIVE_ENABLED", environment === "live" ? "true" : "false");
    vi.stubEnv("PAYMOB_HMAC_SECRET", f.hmacSecret); vi.stubEnv("PAYMOB_MERCHANT_OWNER_ID", "84001");
    vi.stubEnv("PAYMOB_INTEGRATION_ID_TEST", "74001"); vi.stubEnv("PAYMOB_INTEGRATION_ID_LIVE", "74002");
  }
  const fallback = { state: "empty" as const, currentTier: null, cycle: null, paidThrough: null };
  it("Test HTTP webhook commits once but cannot activate Live service", async () => {
    await verifyLocalContainer(); configure("test");
    const data = await fixture({ providerOrderId, account: "74001" }); state.companyId = data.companyId; state.userId = data.userId;
    expect((await receipt(data, transactionBase)).status).toBe(200);
    expect((await receipt(data, transactionBase)).status).toBe(200);
    const grants = await rows(`SELECT id FROM billing_entitlement_applications WHERE company_id='${data.companyId}'`);
    expect(grants).toHaveLength(1);
    expect(await loadOwnerBillingSubscription(fallback)).toMatchObject({ state: "empty", paidThrough: null });
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
