import { describe, expect, it } from "vitest";
import { setupPathForReturn, setupReturnContext, setupSubscriptionReturn, setupBranchFromReturn, whatsappSetupPath, setupBranchPath } from "./setup-return";
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

const branch = "11111111-1111-4111-8111-111111111111";
const whatsapp = `/setup/branches/${branch}/whatsapp`;
describe("paid WhatsApp route return boundary", () => {
  it("preserves the exact dedicated route through login/setup return", () => {
    expect(whatsappSetupPath(branch)).toBe(whatsapp);
    expect(setupPathForReturn(whatsapp)).toBe(whatsapp);
    expect(setupReturnContext(whatsapp)).toEqual({returnTo:whatsapp,preferredNext:""});
    expect(setupBranchPath(branch)).toBe(`/setup?branch=${branch}`);
    expect(setupReturnContext(setupBranchPath(branch)).returnTo).toBe(setupBranchPath(branch));
    expect(setupBranchFromReturn(setupBranchPath(branch))).toBe(branch);
  });
  it.each(["bad", "../admin", "//evil.test", "%2fadmin", "", branch+"/other",branch+"\n"])("rejects invalid branch %s", value => {
    expect(whatsappSetupPath(value)).toBeNull();
    expect(setupBranchPath(value)).toBe("/setup");
  });
  it.each([
    whatsapp+"/extra",whatsapp+"/",whatsapp+"?next=//evil.test",whatsapp+"#fragment",
    "/setup/branches/%2e%2e/whatsapp","/setup/branches/"+branch+"/../whatsapp",
    "//evil.test"+whatsapp,"https://evil.test"+whatsapp,whatsapp.replace("whatsapp","instagram"),
    "/setup?branch="+branch+"&branch="+branch,"/setup?branch=bad",
  ])("does not restore malformed or broadened route %s", path => {
    expect(setupReturnContext(path).returnTo).toBe("/setup");
    expect(setupBranchFromReturn(path)).toBe("");
  });
});
