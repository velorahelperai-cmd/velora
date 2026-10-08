import { describe, expect, it } from "vitest";
import { setupPathForReturn, setupReturnContext, setupSubscriptionReturn } from "./setup-return";
const selected = "/app/settings?tab=plan&term=yearly&persona=level_1&package=basic";
describe("setup navigation preserves subscription intent without redirect privileges", () => {
  it("retains a plan selection across setup and does not nest setup redirects", () => {
    const setup = `/setup?next=${encodeURIComponent(selected)}`;
    expect(setupPathForReturn(selected)).toBe(setup);
    expect(setupPathForReturn(setup)).toBe(setup);
    expect(setupReturnContext(setup)).toEqual({ returnTo: setup, preferredNext: selected });
    expect(setupSubscriptionReturn(selected)).toBe(selected);
  });
  it("does not carry external, duplicate, or oversized next values", () => {
    for (const raw of ["/setup?next=https%3A%2F%2Fexample.test", "/setup?next=%2Fapp&next=%2Fadmin", `/setup?next=${encodeURIComponent('/app?' + 'a'.repeat(2049))}`, "//example.test/setup", "/app/settings?tab=plan"]) {
      expect(setupReturnContext(raw)).toEqual({ returnTo: "/setup", preferredNext: "" });
    }
  });
  it("only forwards the plan tab and does not forward a privileged or ambiguous target", () => {
    for (const target of ["/admin", "/app/conversations", "/app/settings?tab=team", "/app/settings?tab=plan&tab=team", "/app/settings?tab=plan#team", "/app/settings/other?tab=plan", "https://example.test"]) {
      expect(setupSubscriptionReturn(target)).toBe("/app/settings?tab=plan");
    }
  });
});
