// @vitest-environment jsdom
import {act,createElement} from "react";import {renderToStaticMarkup} from "react-dom/server";import {createRoot} from "react-dom/client";import {expect,it,vi} from "vitest";
import {PaidAssistantTrial,trialSuggestions,trialViewKey,type PaidAssistantTrialProps,type TrialMessage} from "./paid-assistant-trial";
import {businessTypes} from "@/lib/business-types";
const scope={expectedAccountId:"actor",companyId:"company",branchId:"branch"};
const props:PaidAssistantTrialProps={locale:"en",scope,boundaryFingerprint:"capture",snapshot:{scope,version:1,knowledgeRevision:"k1",branchLabel:"Branch",businessType:"restaurant",canAsk:true,messages:[]},state:{scope,version:1,phase:"ready",requestId:null,failure:null,canRetry:false},isCurrent:()=>true,onAsk:()=>{throw Error("Render must not ask");}};
const render=(patch:Partial<PaidAssistantTrialProps>={})=>renderToStaticMarkup(createElement(PaidAssistantTrial,{...props,...patch}));
it('labels handoff as preview without a real transfer or consumed reply',()=>{
 expect(render({snapshot:{...props.snapshot!,handoffPreview:'human_request'}})).toContain('No real conversation was transferred');
});
it('recovers saved result without asking the provider and explains discarded obsolete context',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div'),root=createRoot(host),onRecover=vi.fn(),onAsk=vi.fn();
 try{
  await act(async()=>root.render(createElement(PaidAssistantTrial,{...props,onRecover,onAsk,snapshot:{...props.snapshot!,pendingOperation:{id:'saved-op',status:'success',recoverable:true}}})));
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Recover saved answer')!;
  await act(async()=>button.click());expect(onRecover).toHaveBeenCalledWith('saved-op');expect(onAsk).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
 expect(render({snapshot:{...props.snapshot!,recoveryNotice:'context_changed'}})).toContain('without using a trial reply');
});
it("refreshes an unknown result without resending and blocks refresh after authority loss",async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div'),root=createRoot(host),onRefresh=vi.fn(),onAsk=vi.fn();let current=true;
 try{
  await act(async()=>root.render(createElement(PaidAssistantTrial,{...props,state:{...props.state,phase:'unknown'},isCurrent:()=>current,onAsk,onRefresh} as PaidAssistantTrialProps)));
  const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Check request status');
  expect(button).toBeDefined();
  await act(async()=>button!.click());expect(onRefresh).toHaveBeenCalledTimes(1);expect(onAsk).not.toHaveBeenCalled();
  current=false;await act(async()=>button!.click());expect(onRefresh).toHaveBeenCalledTimes(1);
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
it.each(["ar","en"] as const)("renders %s with three suggestions, free text and no effects",locale=>{const html=render({locale});expect(html).toMatch(/maxlength="1000"/i);expect(html).toContain('<textarea');expect(html).toContain('dir="auto"');expect(trialSuggestions("restaurant",locale)).toHaveLength(3);expect(html).not.toContain("Synthetic UI example");});
it.each(["restaurant","retail","school","clinic","real_estate","hotel","beauty_salon","auto_repair","other","custom"])("suggests three distinct questions for %s",type=>{expect(new Set(trialSuggestions(type,"en")).size).toBe(3);});
it("reuses sector catalog and retail alias without guessing from names",()=>{expect(trialSuggestions("store","en")).toEqual(trialSuggestions("retail","en"));expect(trialSuggestions("restaurant","en")).not.toEqual(trialSuggestions("clinic","en"));expect(trialSuggestions("custom restaurant name","en")).toEqual(trialSuggestions("other","en"));});
it("covers every named catalog group with distinct sector prompts",()=>{for(const group of new Set(businessTypes.map(item=>item.group))){if(group==="other")continue;const sample=businessTypes.find(item=>item.group===group)!;for(const locale of ["ar","en"] as const)expect(trialSuggestions(sample.id,locale)).not.toEqual(trialSuggestions("other",locale));}});
it.each(["loading","pending","unknown","unavailable"] as const)("blocks requests in %s",phase=>{const html=render({state:{...props.state,phase}});expect(html).toContain(phase==="loading"||phase==="unavailable"?'role="status"':'disabled=""');});
it.each([false,null])("respects canAsk %s",canAsk=>expect(render({snapshot:{...props.snapshot!,canAsk}})).toContain('type="submit" disabled=""'));
it.each([false,undefined])("does not retry when retrySafe=%s even if host capability true",retrySafe=>{const html=render({state:{...props.state,phase:"error",requestId:"r",failure:{ok:false,code:"UNAVAILABLE",retrySafe},canRetry:true},onRetry:()=>{}});expect(html).toContain('type="button" disabled="">Retry safely');});
it("allows retry only with matching request and explicit safe/capability proofs",()=>{expect(render({state:{...props.state,phase:"error",requestId:"r",failure:{ok:false,code:"UNAVAILABLE",retrySafe:true,requestId:"r"},canRetry:true},onRetry:()=>{}})).toContain('type="button">Retry safely');});
it.each([undefined,"","request-A"])("blocks safe failure %s from authorizing current request-B",requestId=>{expect(render({state:{...props.state,phase:"error",requestId:"request-B",failure:{ok:false,code:"UNAVAILABLE",retrySafe:true,requestId},canRetry:true},onRetry:()=>{}})).toContain('type="button" disabled="">Retry safely');});
const message:TrialMessage={id:"m",scope,version:1,knowledgeRevision:"k1",question:"Question?",origin:"synthetic",result:{ok:true,text:"EXAMPLE_RESULT",citations:[],usage:{promptChars:1,contextChars:1,sourceCount:0}}};
it("labels synthetic messages, renders host results without readiness control",()=>{const html=render({snapshot:{...props.snapshot!,messages:[message]}});expect(html).toContain("EXAMPLE_RESULT");expect(html).toContain("Synthetic UI example");expect(html).toContain("No sources are attached");expect(html).not.toContain("Launch");});
it.each([{scope:{...scope,expectedAccountId:"other"}},{scope:{...scope,companyId:"other"}},{scope:{...scope,branchId:"other"}},{version:2},{knowledgeRevision:"old"}])("hides stale message %#",patch=>expect(render({snapshot:{...props.snapshot!,messages:[{...message,...patch}]}})).not.toContain("EXAMPLE_RESULT"));
it("rejects wrong host scope/revision and missing knowledge revision",()=>{for(const patch of [{state:{...props.state,scope:{...scope,expectedAccountId:"other"}}},{state:{...props.state,version:2}},{snapshot:{...props.snapshot!,knowledgeRevision:""}}])expect(render(patch)).toContain("trial is unavailable");});
it("resets drafts on all identity/version/knowledge/capture boundaries",()=>{const key=trialViewKey(props);for(const field of ["expectedAccountId","companyId","branchId"] as const)expect(trialViewKey({...props,scope:{...scope,[field]:"new"}})).not.toBe(key);expect(trialViewKey({...props,boundaryFingerprint:"new"})).not.toBe(key);expect(trialViewKey({...props,snapshot:{...props.snapshot!,version:2}})).not.toBe(key);expect(trialViewKey({...props,snapshot:{...props.snapshot!,knowledgeRevision:"k2"}})).not.toBe(key);expect(trialViewKey({...props,locale:"ar"})).toBe(key);});
