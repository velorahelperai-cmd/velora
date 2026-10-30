import {createElement} from "react";import {renderToStaticMarkup} from "react-dom/server";import {expect,it} from "vitest";
import {PaidLaunchSummary,hostAllowsLaunch,launchViewKey,type PaidLaunchSummaryProps} from "./paid-launch-summary";
const scope={expectedAccountId:"actor",companyId:"company",branchId:"branch"},operationId="11111111-1111-4111-8111-111111111111",item={detail:"Confirmed detail",status:"verified" as const};
const props:PaidLaunchSummaryProps={locale:"en",scope,boundaryFingerprint:"capture",snapshot:{scope,version:1,branchLabel:"Branch",setup:{companyId:"company",selectedBranchId:"branch",sourceStatus:"ready",selectedChannels:["whatsapp"],entitlement:{orderGroupId:"order",slotIndex:0,persona:"level_2",package:"basic",maxChannels:1,employeesExcludingOwner:2},launch:{canRequest:true,confirmationRequired:true,confirmed:false,blockedReasons:[]}},readiness:{status:"ready",revision:"r1",blockers:[]},summary:{channels:[{channel:"whatsapp",...item},{channel:"instagram",detail:"HIDDEN_UNENTITLED",status:"pending"}],hours:item,knowledge:item,persona:item,team:{detail:"No invitations",status:"skipped_optional"}},operationId,activation:{status:"not_started",receiptId:null,operationId:null}},state:{scope,version:1,phase:"ready"},isCurrent:()=>true,onLaunch:()=>{throw Error("No render activation");}};
const render=(patch:Partial<PaidLaunchSummaryProps>={})=>renderToStaticMarkup(createElement(PaidLaunchSummary,{...props,...patch}));
it.each(["ar","en"] as const)("renders %s without initial consent or action",locale=>{const h=render({locale});expect(h).not.toContain('checked=""');expect(h).toContain('type="submit" disabled=""');expect(h).not.toContain("HIDDEN_UNENTITLED");});
it.each(["blocked","unknown"] as const)("local verified summaries cannot override %s readiness",status=>{expect(hostAllowsLaunch({...props.snapshot!,readiness:{status,revision:"r1",blockers:[]}})).toBe(false);});
it.each([{revision:null},{revision:""},{blockers:["Pending proof"]}])("requires authoritative readiness revision without blockers %#",extra=>expect(hostAllowsLaunch({...props.snapshot!,readiness:{...props.snapshot!.readiness,...extra}})).toBe(false));
it.each([{canRequest:false},{confirmed:true},{blockedReasons:["CHANNEL_PENDING"]}])("honors authoritative B1 negative launch fields %#",extra=>expect(hostAllowsLaunch({...props.snapshot!,setup:{...props.snapshot!.setup,launch:{...props.snapshot!.setup.launch,...extra}}})).toBe(false));
it.each([null,[],["whatsapp","whatsapp"]])("fails closed for missing/duplicate paid channel selection %j",selectedChannels=>expect(hostAllowsLaunch({...props.snapshot!,setup:{...props.snapshot!.setup,selectedChannels:selectedChannels as never}})).toBe(false));
it("requires entitlement and operation identity",()=>{expect(hostAllowsLaunch({...props.snapshot!,setup:{...props.snapshot!.setup,entitlement:null}})).toBe(false);expect(hostAllowsLaunch({...props.snapshot!,operationId:null})).toBe(false);expect(hostAllowsLaunch(props.snapshot!)).toBe(true);});
it.each(["unknown","launched"] as const)("blocks fresh activation for %s outcome",status=>expect(hostAllowsLaunch({...props.snapshot!,activation:{status,receiptId:null,operationId:null}})).toBe(false));
it.each(["pending","error","unknown"] as const)("request %s state disables confirmation",phase=>expect(render({state:{scope,version:1,phase}})).toContain('type="checkbox" disabled=""'));
it("requires host launch receipt and confirmed B1 state for launched message",()=>{const snapshot={...props.snapshot!,activation:{status:"launched" as const,receiptId:"receipt",operationId},setup:{...props.snapshot!.setup,launch:{...props.snapshot!.setup.launch,confirmed:true}}};expect(render({snapshot})).toContain("system confirmed this branch was launched");expect(render({snapshot:{...snapshot,activation:{...snapshot.activation,receiptId:null}}})).not.toContain("system confirmed this branch was launched");});
it.each(["expectedAccountId","companyId","branchId"] as const)("rejects mismatched %s",field=>expect(render({snapshot:{...props.snapshot!,scope:{...scope,[field]:"foreign"}}})).toContain("summary is unavailable"));
it("rejects B1 identity mismatch or stale version",()=>{expect(render({snapshot:{...props.snapshot!,setup:{...props.snapshot!.setup,selectedBranchId:"other"}}})).toContain("summary is unavailable");expect(render({state:{scope,version:2,phase:"ready"}})).toContain("summary is unavailable");});
it("resets consent for captured scope, readiness revision, operation and version",()=>{const key=launchViewKey(props);for(const field of ["expectedAccountId","companyId","branchId"] as const)expect(launchViewKey({...props,scope:{...scope,[field]:"new"}})).not.toBe(key);for(const snapshot of [{...props.snapshot!,version:2},{...props.snapshot!,readiness:{...props.snapshot!.readiness,revision:"r2"}},{...props.snapshot!,operationId:"other"}])expect(launchViewKey({...props,snapshot})).not.toBe(key);expect(launchViewKey({...props,boundaryFingerprint:"new"})).not.toBe(key);expect(launchViewKey({...props,locale:"ar"})).toBe(key);});
it("renders all 6 approved summary sections with real data and edit links",()=>{
  const arHtml=render({locale:"ar"});
  expect(arHtml).toContain("الباقة");
  expect(arHtml).toContain("واتساب");
  expect(arHtml).toContain("مواعيد العمل");
  expect(arHtml).toContain("المعرفة والبيانات");
  expect(arHtml).toContain("لغات الرد");
  expect(arHtml).toContain("فريق العمل");
  expect(arHtml).toContain("تعديل");
  const enHtml=render({locale:"en"});
  expect(enHtml).toContain("Plan");
  expect(enHtml).toContain("WhatsApp");
  expect(enHtml).toContain("Business hours");
  expect(enHtml).toContain("Knowledge base");
  expect(enHtml).toContain("Reply languages");
  expect(enHtml).toContain("Staff team");
  expect(enHtml).toContain("Edit");
});
it("displays customer-friendly blocker explanations in simple Arabic",()=>{
  const snapshot={
    ...props.snapshot!,
    readiness:{status:"blocked" as const,revision:"r1",blockers:["trial_incomplete","channel_unverified:whatsapp"]},
    setup:{...props.snapshot!.setup,launch:{...props.snapshot!.setup.launch,canRequest:false,blockedReasons:["trial_incomplete","channel_unverified:whatsapp"]}},
  };
  const html=render({locale:"ar",snapshot});
  expect(html).toContain("يلزم تجربة المساعد والتأكد من صحة إجاباته قبل التفعيل");
  expect(html).toContain("يلزم ربط قناة واتساب الخاصة بالفرع والتحقق من اتصالها");
  expect(html).toContain("إكمال الإجراء");
});
it("displays package renewal change policy and omits misleading edit link for package",()=>{
  const arHtml=render({locale:"ar"});
  expect(arHtml).toContain("الباقة الحالية:");
  expect(arHtml).toContain("سياسة التغيير: يسري تعديل الباقة مع بداية دورة التجديد القادمة");
  const packageSectionAr = arHtml.split("<div><dt>واتساب")[0];
  expect(packageSectionAr).toContain("الباقة");
  expect(packageSectionAr).not.toMatch(/class="[^"]*editBtn[^"]*"/);
  const enHtml=render({locale:"en"});
  expect(enHtml).toContain("Current plan:");
  expect(enHtml).toContain("Change policy: Plan changes take effect at the start of the next renewal cycle");
  const packageSectionEn = enHtml.split("<div><dt>WhatsApp")[0];
  expect(packageSectionEn).toContain("Plan");
  expect(packageSectionEn).not.toMatch(/class="[^"]*editBtn[^"]*"/);
});
