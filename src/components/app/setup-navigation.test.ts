import { describe, expect, it } from "vitest";
import { emptyCompanyDraft } from "@/lib/company-draft";
import type { CompanyRecord } from "@/lib/tenancy/types";
import { hydrateOnboardingDraft, resolveSetupResumeStep } from "./onboarding-contracts";
const company = { id: "company", display_name: "Server name", business_type: "retail", hours: "9-18", reply_language: "en" } as CompanyRecord;
const done = [true,false,true,true,true,false,false,false];
function stored(step: number) { return {...emptyCompanyDraft("owner"),companyId:company.id,setupStep:step,setupDone:Array(8).fill(true)}; }
describe("scope-bound setup navigation", () => {
  it("resumes knowledge navigation despite an incomplete subscription milestone", () => expect(resolveSetupResumeStep(stored(3),"owner",company,done)).toBe(3));
  it.each([2,4,5,6,7])("retains deliberately selected step %i across reload", step => expect(resolveSetupResumeStep(stored(step),"owner",company,done)).toBe(step));
  it("never promotes navigation or local complete flags to saved company evidence", () => {
    const draft=stored(7);draft.business.name="Invented";
    expect(hydrateOnboardingDraft(draft,"owner",company).business.name).toBe("Server name");
    expect(done[1]).toBe(false);expect(done[6]).toBe(false);
  });
  it.each([NaN,Infinity,-1,8,2.2])("rejects corrupt navigation %s", step => expect(resolveSetupResumeStep(stored(step),"owner",company,done)).toBe(1));
  it("does not carry navigation across actors or tenants", () => {
    expect(resolveSetupResumeStep(stored(5),"another-owner",company,done)).toBe(1);
    expect(resolveSetupResumeStep(stored(5),"owner",{...company,id:"other-company"},done)).toBe(1);
  });
  it("starts an uncreated company at its profile", () => expect(resolveSetupResumeStep({...stored(4),companyId:null},"owner",null,done)).toBe(0));
});
