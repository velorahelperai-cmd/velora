import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readThawaniTestConfig, createThawaniTestSession, readThawaniTestSession, matchThawaniSession } from "./thawani-test";
const config = { secretKey: "test-secret", publicKey: "test-public", accountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" };
const binding = { reference: "ES02-test", amountBaisa: 45000, token: "claim-token" };
const data = { session_id: "checkout_fixture123", client_reference_id: binding.reference, mode: "payment", payment_status: "unpaid", currency: "OMR", total_amount: 45000, invoice: "123456", metadata: { binding: binding.token } };
const response = (value: unknown) => new Response(JSON.stringify({ success: true, data: value }), { status: 200 });
describe("Thawani UAT authority", () => {
 it("accepts the owned popup return path while retaining exact origin and path guards",async()=>{
  const target="https://www.velorahelper.com/account/payment/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/popup";
  const http=vi.fn().mockImplementation(async()=>response(data));
  await expect(createThawaniTestSession(config,binding,target,http)).resolves.toMatchObject({status:"unpaid"});
  expect(JSON.parse(http.mock.calls[0][1].body)).toMatchObject({success_url:target,cancel_url:target});
  for(const invalid of [target.replace('www.velorahelper.com','evil.example'),target+'/extra',target+'?next=https://evil.example',target+'#paid',target.replace('/popup','/other'),target.replace('https://','https://attacker@')]){
   http.mockClear();await expect(createThawaniTestSession(config,binding,invalid,http)).rejects.toThrow();expect(http).not.toHaveBeenCalled();
  }
 });
 it("requires explicit UAT, account and keys; rejects live configuration", () => {
  const env = { BILLING_ES02_THAWANI_TEST_ENABLED: "true", THAWANI_ENVIRONMENT: "uat", THAWANI_TEST_ACCOUNT_ID: config.accountId, THAWANI_SECRET_KEY_TEST: config.secretKey, THAWANI_PUBLIC_KEY_TEST: config.publicKey };
  expect(readThawaniTestConfig(env)).toEqual(config);
  for (const change of [{ THAWANI_ENVIRONMENT: "live" }, { THAWANI_SECRET_KEY_TEST: "" }, { BILLING_ES02_THAWANI_TEST_ENABLED: "false" }, { THAWANI_TEST_ACCOUNT_ID: "wrong" }]) expect(readThawaniTestConfig({ ...env, ...change })).toBeNull();
 });
 it("creates only on the pinned UAT host with opaque binding and exact amount", async () => {
  const http = vi.fn().mockResolvedValue(response(data));
  const result = await createThawaniTestSession(config, binding, "https://www.velorahelper.com/account/payment/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", http);
  expect(result).toMatchObject({ sessionId: data.session_id, status: "unpaid", invoice: "123456" });
  expect(http.mock.calls[0][0]).toBe("https://uatcheckout.thawani.om/api/v1/checkout/session");
  const request = http.mock.calls[0][1];
  expect(request.redirect).toBe("error");
  const body = JSON.parse(request.body);
  expect(body).toMatchObject({ mode: "payment", products: [{ unit_amount: 45000, quantity: 1 }], client_reference_id: binding.reference, metadata: { binding: binding.token }, save_card_on_success: false });
  expect(body).not.toHaveProperty("customer_id");
 });
 it.each([{ total_amount: 1 }, { currency: "USD" }, { client_reference_id: "foreign" }, { metadata: { binding: "other" } }, { mode: "subscription" }, { session_id: "https://other.test" }, { payment_status: "unknown" }, { invoice: "" }])("rejects inconsistent provider evidence %j", patch => {
  expect(matchThawaniSession({ ...data, ...patch }, binding)).toBeNull();
 });
 it("reads only the persisted session and accepts paid status from the server response", async () => {
  const http = vi.fn().mockResolvedValue(response({ ...data, payment_status: "paid" }));
  expect(await readThawaniTestSession(config, data.session_id, binding, http)).toMatchObject({ status: "paid" });
  expect(http.mock.calls[0][0]).toBe("https://uatcheckout.thawani.om/api/v1/checkout/session/checkout_fixture123");
 });
 it("rejects another session even with matching metadata", async () => {
  const http = vi.fn().mockResolvedValue(response({ ...data, session_id: "checkout_other" }));
  await expect(readThawaniTestSession(config, data.session_id, binding, http)).rejects.toThrow();
 });
 it("never retries an uncertain create request", async () => {
  const http = vi.fn().mockRejectedValue(new Error("timeout"));
  await expect(createThawaniTestSession(config, binding, "https://www.velorahelper.com/account/payment/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", http)).rejects.toThrow();
  expect(http).toHaveBeenCalledTimes(1);
 });
});
