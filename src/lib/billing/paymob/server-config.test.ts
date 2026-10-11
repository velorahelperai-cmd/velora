import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const settings = {
 PAYMOB_SECRET_KEY_LIVE: "om_sk_live_SYNTHETIC", PAYMOB_PUBLIC_KEY_LIVE: "om_pk_live_SYNTHETIC",
 PAYMOB_SECRET_KEY_TEST: "om_sk_test_SYNTHETIC", PAYMOB_PUBLIC_KEY_TEST: "om_pk_test_SYNTHETIC",
 PAYMOB_INTEGRATION_ID_LIVE: "98765", PAYMOB_INTEGRATION_ID_TEST: "71610",
 PAYMOB_MERCHANT_OWNER_ID: "1001", PAYMOB_HMAC_SECRET: "synthetic-hmac", PAYMOB_API_KEY: "synthetic-shared",
 PAYMOB_LIVE_ENABLED: "true", PAYMOB_LIVE_CONFIGURATION_VERIFIED: "true",
 PAYMOB_OMR_CONVERSION_VERIFIED: "true", PAYMOB_OMR_UNITS_PER_OMR: "1000",
};
async function reader() {
 const path = "./server-config" as const;
 try { return (await import(path)).readPaymobServerConfig; } catch { return undefined; }
}
describe("trusted server configuration has no Live defaults", () => {
 it("selects the verified Live keys and integration explicitly", async () => {
  const read = await reader(); expect(read).toBeTypeOf("function");
  expect(read?.("live", settings)).toMatchObject({ok:true, config:{environment:"live", integrationId:98765, secretKey:"om_sk_live_SYNTHETIC", verifiedOmrUnitsPerOmr:1000}});
 });
 it.each(["PAYMOB_LIVE_ENABLED", "PAYMOB_LIVE_CONFIGURATION_VERIFIED", "PAYMOB_SECRET_KEY_LIVE", "PAYMOB_PUBLIC_KEY_LIVE", "PAYMOB_INTEGRATION_ID_LIVE", "PAYMOB_MERCHANT_OWNER_ID", "PAYMOB_HMAC_SECRET", "PAYMOB_OMR_CONVERSION_VERIFIED", "PAYMOB_OMR_UNITS_PER_OMR"])("fails closed without %s even when Test settings exist", async key => {
  const read = await reader(); expect(read).toBeTypeOf("function"); expect(read?.("live", {...settings, [key]:undefined})).toMatchObject({ok:false});
 });
 it("keeps Test isolated when the separate Live switch is present", async () => {
  const read = await reader(); expect(read).toBeTypeOf("function"); expect(read?.("test", settings)).toMatchObject({ok:true, config:{environment:"test", liveEnabled:false, integrationId:71610, secretKey:"om_sk_test_SYNTHETIC"}});
 });
 it("rejects a malicious API URL without returning secrets", async () => {
  const read = await reader(); expect(read).toBeTypeOf("function"); const result=read?.("live", {...settings, PAYMOB_API_BASE_URL:"https://evil.example"});
  expect(result).toMatchObject({ok:false}); expect(JSON.stringify(result)).not.toContain("SYNTHETIC");
 });
 it.each(["1.5", "0", "1000001", "NaN"])("rejects unverified factor %s", async factor => {
  const read = await reader(); expect(read).toBeTypeOf("function"); expect(read?.("live", {...settings, PAYMOB_OMR_UNITS_PER_OMR:factor})).toMatchObject({ok:false});
 });
});
