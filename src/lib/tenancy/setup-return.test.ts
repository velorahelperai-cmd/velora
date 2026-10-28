import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { pathForAccess, workspaceHomeHref } from "./access";
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
  it("requires workspace choice before setup and retains the intended destination", () => {
    const multiple = { ...context, company: null, membership: null, needsCompanyContext: true };
    expect(pathForAccess({ ok: true, context: multiple }, selected)).toBe(`/app?next=${encodeURIComponent(selected)}`);
    expect(pathForAccess({ ok: true, context: multiple })).toBe("/app");
    expect(pathForAccess({ ok: true, context: multiple }, "https://example.test")).toBe("/app");
    expect(pathForAccess({ ok: true, context: multiple }, "/admin")).toBe("/app");
    expect(pathForAccess({ ok: true, context: multiple }, "/account")).toBe("/account");
  });
  it("keeps platform admin home while allowing explicit business setup and choice", () => {
    const admin = { ...context, isPlatformAdmin: true };
    expect(pathForAccess({ ok: true, context: admin })).toBe("/admin");
    expect(pathForAccess({ ok: true, context: admin }, "/setup")).toBe("/setup");
    expect(pathForAccess({ ok: true, context: { ...admin, company: null, membership: null, needsCompanyContext: true } }, "/setup")).toBe("/app?next=%2Fsetup");
  });
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

it("routes branch-only membership without creating company authority",()=>{
 const branch={...context,company:null,membership:null,hasBranchMemberships:true};
 expect(pathForAccess({ok:true,context:branch})).toBe('/branch');
 expect(pathForAccess({ok:true,context:branch},'/branch?company=a&branch=b')).toBe('/branch?company=a&branch=b');
 expect(pathForAccess({ok:true,context:branch},'https://example.test')).toBe('/branch');
 expect(pathForAccess({ok:true,context:branch},'/admin')).toBe('/branch');
 expect(workspaceHomeHref(branch)).toBe('/branch');
 expect(pathForAccess({ok:true,context:{...branch,hasBranchMemberships:false}})).toBe('/setup');
 expect(workspaceHomeHref({...branch,hasBranchMemberships:false})).toBeNull();
});
