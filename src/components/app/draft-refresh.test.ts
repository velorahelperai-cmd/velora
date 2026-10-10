import { describe, expect, it } from "vitest";
import { emptyBusiness } from "@/lib/demo-state";
import { buildSetupTestKnowledgeKey, emptyCompanyDraft, isSetupTestStillValid, markSetupTestPassed } from "@/lib/company-draft";
import { reconcileDraftFields } from "./draft-refresh";
import { hydrateOnboardingDraft, companyBusiness } from "./onboarding-contracts";
import type { CompanyRecord } from "@/lib/tenancy/types";
const baseline={...emptyBusiness,name:"Original",city:"Muscat",hours:"9-18",replyLanguage:"en" as const};
describe("same-company server refresh",()=>{
 it("updates pristine fields and baseline from the server",()=>{
  const server={...baseline,name:"New name",hours:"10-17"};
  expect(reconcileDraftFields(baseline,baseline,server)).toEqual({values:server,baseline:server,conflicts:[]});
 });
 it("keeps a dirty field while adopting unrelated server changes",()=>{
  const local={...baseline,name:"Owner edit"},server={...baseline,city:"Salalah",hours:"10-17"};
  const r=reconcileDraftFields(local,baseline,server);
  expect(r.values).toEqual({...server,name:"Owner edit"});expect(r.baseline).toEqual(server);expect(r.conflicts).toEqual([]);
 });
 it("blocks a concurrently changed dirty field without losing the edit",()=>{
  const local={...baseline,name:"Owner edit"},server={...baseline,name:"Another save",city:"Salalah"};
  const r=reconcileDraftFields(local,baseline,server);
  expect(r.values.name).toBe("Owner edit");expect(r.values.city).toBe("Salalah");expect(r.conflicts).toEqual(["name"]);
 });
 it("retains unresolved conflict on repeated refresh",()=>{
  const local={...baseline,name:"Owner edit"},server={...baseline,name:"Another save"};
  expect(reconcileDraftFields(local,server,{...server},["name"]).conflicts).toEqual(["name"]);
 });
 it("clears conflict when the edit equals current server facts",()=>{
  const server={...baseline,name:"Another save"};expect(reconcileDraftFields(server,baseline,server,["name"]).conflicts).toEqual([]);
 });
 it("reconciles pristine and dirty hours/language using the same contract",()=>{
  expect(reconcileDraftFields({hours:"9-18"},{hours:"9-18"},{hours:"10-17"}).values.hours).toBe("10-17");
  expect(reconcileDraftFields({lang:"both"},{lang:"en"},{lang:"ar"}).conflicts).toEqual(["lang"]);
 });
 it("confirmed save becomes pristine and reload keeps navigation and server facts",()=>{
  const company={id:"company",display_name:"Owner edit",business_type:baseline.type,reply_language:"en",country:baseline.country,city:"Salalah",hours:"10-17",contact_phone:"",contact_email:""} as CompanyRecord;
  const saved=companyBusiness(company),r=reconcileDraftFields(saved,baseline,saved);
  expect(r.values).toEqual(r.baseline);expect(r.conflicts).toEqual([]);
  const draft={...emptyCompanyDraft("owner"),companyId:company.id,setupStep:3,business:saved};
  expect(hydrateOnboardingDraft(draft,"owner",company)).toMatchObject({setupStep:3,business:saved});
 });
 it("refresh preserves navigation and cannot bless changed knowledge evidence",()=>{
  const key=buildSetupTestKnowledgeKey("company","ready",[]);
  const draft=markSetupTestPassed({...emptyCompanyDraft("owner"),companyId:"company",setupStep:7,business:baseline},"company",key);
  const next={...draft,business:reconcileDraftFields(draft.business,baseline,{...baseline,city:"Salalah"}).values};
  expect(next.setupStep).toBe(7);expect(isSetupTestStillValid(next,"company",key)).toBe(true);
  const changed=buildSetupTestKnowledgeKey("company","ready",[{id:"source",status:"ready",content_version:2,approved_version:1,approved_for_answers:false}]);
  expect(isSetupTestStillValid(next,"company",changed)).toBe(false);
 });
});
