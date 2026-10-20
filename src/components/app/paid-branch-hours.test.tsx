import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import {emptyBranchHours} from "@/lib/tenancy/branch-hours-contracts";
import {PaidBranchHours,branchHoursViewKey,type PaidBranchHoursProps} from "./paid-branch-hours";
const scope={expectedAccountId:"account",companyId:"company",branchId:"branch"};
const props:PaidBranchHoursProps={locale:"en",scope,boundaryFingerprint:"capture",snapshot:{scope,version:1,branchLabel:"Main",timezone:"Asia/Muscat",schedule:emptyBranchHours()},state:{scope,version:1,phase:"ready"},copyTargets:[],isCurrent:()=>true};
const render=(patch:Partial<PaidBranchHoursProps>={})=>renderToStaticMarkup(createElement(PaidBranchHours,{...props,...patch}));
it.each(["ar","en"] as const)("renders seven explicit unset days in %s",locale=>{
 const html=render({locale});expect(html.match(/data-hours-day=/g)).toHaveLength(7);expect(html).toContain('dir="'+(locale==="ar"?"rtl":"ltr")+'"');expect(html).toContain("Asia/Muscat");expect(html).toContain('disabled=""');
});
it("does not infer saved state or readiness from a render",()=>{
 expect(render()).not.toContain("server confirmed");expect(render({onSave:()=>{throw Error("No render side effects");}})).not.toContain("server confirmed");
 expect(render({state:{...props.state,phase:"saved"}})).toContain("server confirmed");
});
it.each([
 {scope:{...scope,branchId:"other"}},
 {state:{...props.state,scope:{...scope,expectedAccountId:"other"}}},
 {state:{...props.state,version:2}},
 {snapshot:null},
])("fails closed for unavailable or mismatched snapshot %#",patch=>{
 const html=render(patch);expect(html).toContain("unavailable");expect(html).not.toContain("data-hours-day");
});
it("distinguishes loading and conflict without optimistic completion",()=>{
 expect(render({state:{...props.state,phase:"loading"}})).toContain("Loading branch hours");
 const html=render({state:{...props.state,phase:"conflict"}});expect(html).toContain("Saved hours changed");expect(html).toContain('<fieldset');expect(html).toContain('disabled=""');
});
it("does not substitute a default timezone",()=>{
 const html=render({snapshot:{...props.snapshot!,timezone:null}});expect(html).toContain("Unknown");expect(html).not.toContain("Asia/Muscat");expect(html).not.toContain(">UTC<");
});
it("remounts drafts on scope, capture or version changes, but not language",()=>{
 const key=branchHoursViewKey(props);for(const field of ["expectedAccountId","companyId","branchId"] as const)expect(branchHoursViewKey({...props,scope:{...scope,[field]:"other"}})).not.toBe(key);
 expect(branchHoursViewKey({...props,boundaryFingerprint:"new"})).not.toBe(key);
 expect(branchHoursViewKey({...props,snapshot:{...props.snapshot!,version:2}})).not.toBe(key);
 expect(branchHoursViewKey({...props,locale:"ar"})).toBe(key);
});
it("shows prior-day carry-over explicitly even when no interval starts today",()=>{
 const schedule=emptyBranchHours();schedule.monday={state:"open",intervals:[{start:"22:00",end:"02:00",nextDay:true}]};schedule.tuesday={state:"closed"};
 expect(render({snapshot:{...props.snapshot!,schedule}})).toContain("Carry-over from the previous day until:");
});
