import {createElement} from "react";import {renderToStaticMarkup} from "react-dom/server";import {expect,it} from "vitest";
import {PaidLaunchSummary,blockerExplanation,hostAllowsLaunch,launchViewKey,type PaidLaunchSummaryProps} from "./paid-launch-summary";
const scope={expectedAccountId:"actor",companyId:"company",branchId:"branch"},operationId="11111111-1111-4111-8111-111111111111",item={detail:"Confirmed detail",status:"verified" as const};
const props:PaidLaunchSummaryProps={locale:"en",scope,boundaryFingerprint:"capture",snapshot:{scope,version:1,branchLabel:"Branch",setup:{companyId:"company",selectedBranchId:"branch",sourceStatus:"ready",selectedChannels:["whatsapp"],entitlement:{orderGroupId:"order",slotIndex:0,persona:"level_2",package:"basic",maxChannels:1,employeesExcludingOwner:2},launch:{canRequest:true,confirmationRequired:true,confirmed:false,blockedReasons:[]}},readiness:{status:"ready",revision:"r1",blockers:[]},summary:{channels:[{channel:"whatsapp",...item},{channel:"instagram",detail:"HIDDEN_UNENTITLED",status:"pending"}],hours:item,knowledge:item,persona:item,team:{detail:"No invitations",status:"skipped_optional"}},operationId,activation:{status:"not_started",receiptId:null,operationId:null}},state:{scope,version:1,phase:"ready"},isCurrent:()=>true,onLaunch:()=>{throw Error("No render activation");}};
const render=(patch:Partial<PaidLaunchSummaryProps>={})=>renderToStaticMarkup(createElement(PaidLaunchSummary,{...props,...patch}));
it("offers dashboard navigation only after a matching confirmed receipt",()=>{
 const snapshot={...props.snapshot!,activation:{status:"launched" as const,receiptId:"receipt",operationId},setup:{...props.snapshot!.setup,launch:{...props.snapshot!.setup.launch,confirmed:true}}};
 expect(render({snapshot})).toContain('href="/app"');
 expect(render()).not.toContain('href="/app"');
 expect(render({snapshot,state:{scope,version:1,phase:"unknown"}})).not.toContain('href="/app"');
 expect(render({snapshot:{...snapshot,operationId:"22222222-2222-4222-8222-222222222222"}})).not.toContain('href="/app"');
});
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
it("renders approved summary sections with knowledge+languages merged and assistant trial instead of a languages row",()=>{
  const arHtml=render({locale:"ar"});
  expect(arHtml).toContain("الباقة");
  expect(arHtml).toContain("واتساب");
  expect(arHtml).toContain("مواعيد العمل");
  expect(arHtml).toContain("المعرفة واللغات");
  expect(arHtml).toContain("تجربة المساعد");
  expect(arHtml).toContain("فريق العمل");
  expect(arHtml).not.toContain("<dt>لغات الرد</dt>");
  expect(arHtml).toContain("تعديل");
  const enHtml=render({locale:"en"});
  expect(enHtml).toContain("Plan");
  expect(enHtml).toContain("WhatsApp");
  expect(enHtml).toContain("Business hours");
  expect(enHtml).toContain("Knowledge &amp; languages");
  expect(enHtml).toContain("Assistant trial");
  expect(enHtml).toContain("Staff team");
  expect(enHtml).not.toContain("<dt>Reply languages</dt>");
  expect(enHtml).toContain("Edit");
});
it("displays customer-friendly blocker explanations in simple Arabic",()=>{
  const snapshot={
    ...props.snapshot!,
    readiness:{status:"blocked" as const,revision:"r1",blockers:["trial_incomplete","channel_unverified:whatsapp"]},
    setup:{...props.snapshot!.setup,launch:{...props.snapshot!.setup.launch,canRequest:false,blockedReasons:["trial_incomplete","channel_unverified:whatsapp"]}},
  };
  const html=render({locale:"ar",snapshot});
  expect(html).toContain("التجربة السابقة لم تعد مطابقة لإعدادات الفرع الحالية");
  expect(html).toContain("يلزم ربط قناة واتساب الخاصة بالفرع والتحقق من اتصالها");
  expect(html).toContain("إكمال الإجراء");
});
it("displays current package without renewal policy copy and omits misleading edit link for package",()=>{
  const arHtml=render({locale:"ar"});
  expect(arHtml).toContain("الباقة الحالية:");
  expect(arHtml).not.toContain("سياسة التغيير");
  const packageSectionAr = arHtml.split("<div><dt>واتساب")[0];
  expect(packageSectionAr).toContain("الباقة");
  expect(packageSectionAr).not.toMatch(/class="[^"]*editBtn[^"]*"/);
  const enHtml=render({locale:"en"});
  expect(enHtml).toContain("Current plan:");
  expect(enHtml).not.toContain("Change policy:");
  const packageSectionEn = enHtml.split("<div><dt>WhatsApp")[0];
  expect(packageSectionEn).toContain("Plan");
  expect(packageSectionEn).not.toMatch(/class="[^"]*editBtn[^"]*"/);
});

it.each([
 ['ar','basic','القياسية'],['ar','premium','المميزة'],['en','basic','Standard'],['en','premium','Premium'],
] as const)('uses the shared customer plan name for %s/%s', (locale,packageId,label)=>{
 const h=render({locale,snapshot:{...props.snapshot!,setup:{...props.snapshot!.setup,entitlement:{...props.snapshot!.setup.entitlement!,package:packageId}}}});
 expect(h).toContain(label);expect(h).not.toContain('Basic Plan');expect(h).not.toContain('الباقة الأساسية');expect(h).not.toContain('الباقة المتقدمة');
});

it.each(['ar','en'] as const)('shows optional team policy without claiming a %s skip',locale=>{
 const h=render({locale,snapshot:{...props.snapshot!,summary:{...props.snapshot!.summary,team:{status:'optional',detail:'دعوة الفريق اختيارية ولا تمنع الإطلاق.'}}}});
 expect(h).toContain(locale==='ar'?'اختياري':'Optional');expect(h).not.toContain('Skipped optionally');expect(h).not.toContain('تم التخطي');
 if(locale==='en')expect(h).toContain('Inviting your team is optional and does not prevent launch.');
});

it.each([true,false])('keeps unknown launch reasons out of customer copy (Arabic=%s)',ar=>{
 for(const reason of ['INTERNAL_REVISION_DRIFT','channel_unverified:INTERNAL_CHANNEL']){
  const result=blockerExplanation(reason,ar);
  expect(result.message).not.toContain('INTERNAL');expect(result.stepId).toBeUndefined();
  expect(result.message).toBe(ar?'تعذّر تأكيد أحد متطلبات الإطلاق. حدّث الحالة وحاول مجددًا.':'A launch requirement could not be confirmed. Refresh the status and try again.');
 }
 expect(blockerExplanation('channel_unverified:whatsapp',ar).stepId).toBe('whatsapp');
});


it.each(['ar','en'] as const)('shows honest initial launch loading without invented facts in %s',locale=>{
 const html=render({locale,snapshot:null,state:{scope,version:null,phase:'loading'}});
 expect(html).toContain('aria-busy="true"');
 expect(html).toContain(locale==='ar'?'جارٍ تحميل ملخص الفرع':'Loading branch summary');
 expect(html).not.toContain('<dl');
 expect(html).not.toContain('Arabic &amp; English');
 expect(html).not.toContain('العربية والإنجليزية');
 expect(html).not.toContain('Selected paid channels are unavailable');
 expect(html).not.toContain('type="submit"');
});
it('retains a confirmed launch summary during refresh without allowing launch or a second refresh',()=>{
 const html=render({onRefresh:()=>{throw Error('No read during render');},state:{scope,version:props.snapshot!.version,phase:'loading'}});
 expect(html).toContain('Review and confirm launch');
 expect(html).toContain('Current plan:');
 expect(html).toContain('<dl');
 expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Refresh operation status/);
 expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
});
it('keeps missing language summary out of a separate languages row and shows assistant trial instead',()=>{
 const html=render({snapshot:{...props.snapshot!,summary:{...props.snapshot!.summary,languages:undefined}}});
 expect(html).not.toContain('Arabic &amp; English');
 expect(html).not.toContain('<dt>Reply languages</dt>');
 expect(html).toContain('Assistant trial');
 expect(html).toContain('Assistant trial verified.');
});
it('surfaces unconfirmed languages inside the knowledge row',()=>{
 const html=render({locale:'en',snapshot:{...props.snapshot!,readiness:{status:'blocked',revision:'r1',blockers:['language_unconfirmed']},summary:{...props.snapshot!.summary,languages:{detail:'Reply languages have not been confirmed',status:'pending'}}}});
 expect(html).toContain('Knowledge &amp; languages');
 expect(html).toContain('Reply languages have not been confirmed');
 expect(html).not.toContain('<dt>Reply languages</dt>');
});
