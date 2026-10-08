import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { pathForAccess } from "./access";
import type { CompanyContext, CompanyRecord } from "./types";

const selected = "/app/settings?tab=plan&term=monthly&persona=level_1&package=basic&version=version-1&amount=45000&currency=OMR";
const context: CompanyContext = {
  userId: "owner", email: "owner@example.test", phone: "", fullName: "Owner", supportCode: "",
  needsProfileName: false, emailConfirmed: true, identityVerified: true, isPlatformAdmin: false,
  company: { id: "company", status: "setup" } as CompanyRecord,
  membership: { role: "owner" } as CompanyContext["membership"],
  needsCompanyContext: false, workspaceChoices: [],
};
describe("selected subscription through required company setup", () => {
  it("retains intent while requiring provisioning for an existing setup company", () => {
    expect(pathForAccess({ ok: true, context }, selected)).toBe(`/setup?next=${encodeURIComponent(selected)}`);
  });
  it("does not nest an existing setup destination after authentication", () => {
    const setup = `/setup?next=${encodeURIComponent(selected)}`;
    expect(pathForAccess({ ok: true, context }, setup)).toBe(setup);
    expect(pathForAccess({ ok: true, context: { ...context, company: null, membership: null } }, setup)).toBe(setup);
  });
  it("retains account access without bypassing setup for operating routes", () => {
    expect(pathForAccess({ ok: true, context }, "/account")).toBe("/account");
    expect(pathForAccess({ ok: true, context }, "/app/conversations")).toBe(`/setup?next=${encodeURIComponent("/app/conversations")}`);
  });
  it("does not forward an external destination or forbidden role destination", () => {
    expect(pathForAccess({ ok: true, context }, "https://example.test")).toBe("/setup");
    expect(pathForAccess({ ok: true, context }, "/admin")).toBe("/setup");
  });
});
