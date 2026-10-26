import { describe, expect, it, vi } from "vitest";
const begin = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("./thawani-account-checkout", () => ({ beginThawaniTestCheckout: begin }));
import { beginAccountTestCheckout, type AccountCheckoutInput } from "./account-checkout";
const input: AccountCheckoutInput = { accountId: "account", sessionId: "session", clientOpId: "operation", selection: { term: "monthly", slots: [{ persona: "level_1", package: "basic" }] } };
describe("account checkout provider dispatch", () => {
  it("passes the complete request to Thawani", async () => {
    const result = { ok: true, data: { checkoutUrl: "https://uatcheckout.thawani.om/pay/session" } };
    begin.mockResolvedValueOnce(result);
    expect(await beginAccountTestCheckout(input)).toBe(result);
    expect(begin).toHaveBeenLastCalledWith(input);
  });
  it("preserves provider failure without a fallback", async () => {
    const result = { ok: false, code: "UNKNOWN" };
    begin.mockResolvedValueOnce(result);
    expect(await beginAccountTestCheckout(input)).toBe(result);
  });
});
