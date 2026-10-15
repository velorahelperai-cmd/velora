import {describe,expect,it} from "vitest";
import {parseAdminCycleCosts,parseCostCompanyPage,parseCostCyclePage} from "./cycle-costs";
const id=(n:number)=>`b5000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const report={companyId:id(1),cycleId:id(2),startsAt:"2026-10-01T00:00:00Z",expiresAt:"2026-10-31T00:00:00Z",basis:"native_usage_tariff_estimate",providerFinalCost:null,unsettledAttempts:1,groups:[{model:"gpt-6-luna",channel:"whatsapp",category:"base",attempts:2,estimated_baisa:0.125},{model:"gpt-6.1-sol",channel:null,category:null,attempts:1,estimated_baisa:0}]};
describe("native administrative cycle cost DTO",()=>{
 it("retains separate categories, unknown attribution and unknown final invoice",()=>expect(parseAdminCycleCosts(report,id(1),id(2))).toEqual(report));
 it("rejects late cross-company/cycle data",()=>{expect(parseAdminCycleCosts(report,id(3),id(2))).toBeNull();expect(parseAdminCycleCosts(report,id(1),id(3))).toBeNull();});
 it("rejects fabricated invoice totals, categories and non-finite or negative costs",()=>{
  expect(parseAdminCycleCosts({...report,providerFinalCost:10},id(1),id(2))).toBeNull();
  for(const patch of [{category:"trial"},{estimated_baisa:-1},{estimated_baisa:Infinity},{attempts:1.2}])expect(parseAdminCycleCosts({...report,groups:[{...report.groups[0],...patch}]},id(1),id(2))).toBeNull();
 });
 it("rejects duplicated group keys and invalid periods",()=>{expect(parseAdminCycleCosts({...report,groups:[report.groups[0],report.groups[0]]},id(1),id(2))).toBeNull();expect(parseAdminCycleCosts({...report,expiresAt:report.startsAt},id(1),id(2))).toBeNull();});
 it("checks native company selection and exact cycle pagination binding",()=>{
  expect(parseCostCompanyPage({actorUserId:id(9),companies:[{id:id(1),name:"Business"}],next:null},id(9))).not.toBeNull();
  expect(parseCostCompanyPage({actorUserId:id(8),companies:[],next:null},id(9))).toBeNull();
  expect(parseCostCyclePage({companyId:id(1),cycles:[{id:id(2),startsAt:report.startsAt,expiresAt:report.expiresAt}],next:null},id(3))).toBeNull();
 });
});
