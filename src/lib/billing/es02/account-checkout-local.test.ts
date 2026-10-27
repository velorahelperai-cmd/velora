import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const testCheckout = vi.hoisted(() => vi.fn());
const liveCheckout = vi.hoisted(() => vi.fn());
vi.mock('./thawani-live-account-checkout',()=>({beginThawaniLocalLiveCheckout:liveCheckout}));
vi.mock("./thawani-account-checkout", () => ({beginThawaniTestCheckout: testCheckout}));
import {beginAccountTestCheckout, type AccountCheckoutInput} from "./account-checkout";
afterEach(() => {vi.unstubAllEnvs();testCheckout.mockReset();liveCheckout.mockReset();});
it("local Live cannot create a Test order or call its provider adapter", async () => {
  vi.stubEnv("VELORA_LOCAL_CUSTOMER_MODE", "live");
  liveCheckout.mockResolvedValue({ok:false,code:'UNCONFIGURED'});
  expect(await beginAccountTestCheckout({} as AccountCheckoutInput)).toEqual({ok:false,code:"UNCONFIGURED"});
  expect(testCheckout).not.toHaveBeenCalled();
  expect(liveCheckout).toHaveBeenCalledOnce();
});
it("retains the existing adapter outside the explicit local Live mode", async () => {
  vi.stubEnv("VELORA_LOCAL_CUSTOMER_MODE", "");
  testCheckout.mockResolvedValue({ok:false,code:"FORBIDDEN"});
  expect(await beginAccountTestCheckout({} as AccountCheckoutInput)).toEqual({ok:false,code:"FORBIDDEN"});
  expect(testCheckout).toHaveBeenCalledOnce();
});
