// @vitest-environment jsdom
import {act,createElement} from "react";import {renderToStaticMarkup} from "react-dom/server";import {createRoot} from "react-dom/client";import {expect,it,vi} from "vitest";
import {PaidAssistantTrial,trialSuggestions,trialViewKey,type PaidAssistantTrialProps,type TrialMessage} from "./paid-assistant-trial";
import {businessTypes} from "@/lib/business-types";
const scope={expectedAccountId:"actor",companyId:"company",branchId:"branch"};
const props:PaidAssistantTrialProps={locale:"en",scope,boundaryFingerprint:"capture",snapshot:{scope,version:1,knowledgeRevision:"k1",branchLabel:"Branch",businessType:"restaurant",canAsk:true,messages:[]},state:{scope,version:1,phase:"ready",requestId:null,failure:null,canRetry:false},isCurrent:()=>true,onAsk:()=>{throw Error("Render must not ask");}};
const render=(patch:Partial<PaidAssistantTrialProps>={})=>renderToStaticMarkup(createElement(PaidAssistantTrial,{...props,...patch}));
it('labels handoff as preview without a real transfer or consumed reply',()=>{
 expect(render({snapshot:{...props.snapshot!,handoffPreview:'human_request'}})).toContain('Escalation preview only');
});
it('recovers saved result without asking the provider and explains discarded obsolete context',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div'),root=createRoot(host),onRecover=vi.fn(),onAsk=vi.fn();
 try{
  await act(async()=>root.render(createElement(PaidAssistantTrial,{...props,onRecover,onAsk,snapshot:{...props.snapshot!,pendingOperation:{id:'saved-op',status:'success',recoverable:true}}})));
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Recover reply')!;
  await act(async()=>button.click());expect(onRecover).toHaveBeenCalledWith('saved-op');expect(onAsk).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
 expect(render({snapshot:{...props.snapshot!,recoveryNotice:'context_changed'}})).toContain('without using quota');
});
it('keeps uncertain holds pending and refreshes without offering an unproven release',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div'),root=createRoot(host),onRelease=vi.fn(),onAsk=vi.fn(),onRecover=vi.fn(),onRefresh=vi.fn();
 try{
  await act(async()=>root.render(createElement(PaidAssistantTrial,{...props,onRelease,onRecover,onAsk,onRefresh,snapshot:{...props.snapshot!,canAsk:false,pendingOperation:{id:'stuck-op',status:'uncertain',recoverable:false}}})));
  expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='Recover reply')).toBe(false);
  expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='Release request')).toBe(false);
  const button=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Refresh status')!;
  await act(async()=>button.click());
  expect(onRelease).not.toHaveBeenCalled();
  expect(onRefresh).toHaveBeenCalledTimes(1);
  expect(onAsk).not.toHaveBeenCalled();
  expect(onRecover).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
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
it.each(["ar","en"] as const)("renders %s chat shell with three suggestions, free text, and no internal test jargon",locale=>{
 const html=render({locale,persona:"level_2"});
 expect(html).toMatch(/maxlength="1000"/i);
 expect(html).toContain('<textarea');
 expect(html).toContain('dir="auto"');
 expect(html).toContain(locale==="ar"?"لينا":"Lina");
 expect(html).toContain(locale==="ar"?"جرّب مساعدك قبل التشغيل":"Try your assistant before launch");
 expect(html).not.toContain("اختبار داخلي");
 expect(html).not.toContain("Internal trial only");
 expect(trialSuggestions("restaurant",locale)).toHaveLength(3);
 expect(html).not.toContain("UI example only");
});
it.each(["restaurant","retail","school","clinic","real_estate","hotel","beauty_salon","auto_repair","other","custom"])("suggests three distinct questions for %s",type=>{expect(new Set(trialSuggestions(type,"en")).size).toBe(3);});
it("reuses sector catalog and retail alias without guessing from names",()=>{expect(trialSuggestions("store","en")).toEqual(trialSuggestions("retail","en"));expect(trialSuggestions("restaurant","en")).not.toEqual(trialSuggestions("clinic","en"));expect(trialSuggestions("custom restaurant name","en")).toEqual(trialSuggestions("other","en"));});
it("covers every named catalog group with distinct sector prompts",()=>{for(const group of new Set(businessTypes.map(item=>item.group))){if(group==="other")continue;const sample=businessTypes.find(item=>item.group===group)!;for(const locale of ["ar","en"] as const)expect(trialSuggestions(sample.id,locale)).not.toEqual(trialSuggestions("other",locale));}});
it.each(["loading","pending","unknown","unavailable"] as const)("blocks requests in %s",phase=>{const html=render({state:{...props.state,phase}});expect(html).toContain(phase==="loading"||phase==="unavailable"?'role="status"':'disabled=""');});
it.each([false,null])("respects canAsk %s",canAsk=>expect(render({snapshot:{...props.snapshot!,canAsk}})).toMatch(/type="submit"[^>]*disabled=""/));
it.each([false,undefined])("does not retry when retrySafe=%s even if host capability true",retrySafe=>{const html=render({state:{...props.state,phase:"error",requestId:"r",failure:{ok:false,code:"UNAVAILABLE",retrySafe},canRetry:true},onRetry:()=>{}});expect(html).toMatch(/type="button"[^>]*disabled=""[^>]*>Retry safely/);});
it("allows retry only with matching request, canAsk, and explicit safe/capability proofs",()=>{expect(render({state:{...props.state,phase:"error",requestId:"r",failure:{ok:false,code:"UNAVAILABLE",retrySafe:true,requestId:"r"},canRetry:true},onRetry:()=>{}})).toMatch(/type="button"(?![^>]*disabled)[^>]*>Retry safely/);expect(render({state:{...props.state,phase:"error",requestId:"r",failure:{ok:false,code:"UNAVAILABLE",retrySafe:true,requestId:"r"},canRetry:true},onRetry:()=>{}})).toMatch(/type="submit"[^>]*disabled=""/);});
it("blocks send during error even when retrySafe is true",()=>{expect(render({state:{...props.state,phase:"error",requestId:"r",failure:{ok:false,code:"UNAVAILABLE",retrySafe:true,requestId:"r"},canRetry:true},onRetry:()=>{}})).toMatch(/type="submit"[^>]*disabled=""/);});
it.each([undefined,"","request-A"])("blocks safe failure %s from authorizing current request-B",requestId=>{expect(render({state:{...props.state,phase:"error",requestId:"request-B",failure:{ok:false,code:"UNAVAILABLE",retrySafe:true,requestId},canRetry:true},onRetry:()=>{}})).toMatch(/type="button"[^>]*disabled=""[^>]*>Retry safely/);});
it("blocks retry when a pending hold remains even if failure claims retrySafe",()=>{expect(render({snapshot:{...props.snapshot!,canAsk:true,pendingOperation:{id:"hold",status:"uncertain",recoverable:false}},state:{...props.state,phase:"error",requestId:"r",failure:{ok:false,code:"UNAVAILABLE",retrySafe:true,requestId:"r"},canRetry:true},onRetry:()=>{}})).toMatch(/type="button"[^>]*disabled=""[^>]*>Retry safely/);});
const message:TrialMessage={id:"m",scope,version:1,knowledgeRevision:"k1",question:"Question?",origin:"synthetic",result:{ok:true,text:"EXAMPLE_RESULT",citations:[],usage:{promptChars:1,contextChars:1,sourceCount:0}}};
it("labels synthetic messages, renders host results without readiness control",()=>{const html=render({snapshot:{...props.snapshot!,messages:[message]}});expect(html).toContain("EXAMPLE_RESULT");expect(html).toContain("UI example only");expect(html).not.toContain("Sources (");expect(html).not.toContain("Launch");});
it.each([{scope:{...scope,expectedAccountId:"other"}},{scope:{...scope,companyId:"other"}},{scope:{...scope,branchId:"other"}},{version:2},{knowledgeRevision:"old"}])("hides stale message %#",patch=>expect(render({snapshot:{...props.snapshot!,messages:[{...message,...patch}]}})).not.toContain("EXAMPLE_RESULT"));
it("rejects wrong host scope/revision and missing knowledge revision",()=>{for(const patch of [{state:{...props.state,scope:{...scope,expectedAccountId:"other"}}},{state:{...props.state,version:2}},{snapshot:{...props.snapshot!,knowledgeRevision:""}}])expect(render(patch)).toContain("unavailable");});
it("shows quota and sends a suggestion through the real ask path",async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div'),root=createRoot(host),onAsk=vi.fn();
 try{
  await act(async()=>root.render(createElement(PaidAssistantTrial,{...props,persona:"level_1",onAsk,snapshot:{...props.snapshot!,trialAllowance:{used:2,limit:10}}})));
  expect(host.textContent).toContain("2/10");
  const chip=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==="What are the working hours?");
  expect(chip).toBeDefined();
  await act(async()=>chip!.click());
  expect(onAsk).toHaveBeenCalledTimes(1);
  expect(onAsk.mock.calls[0]![0]).toMatchObject({question:"What are the working hours?",companyId:"company",branchId:"branch"});
  expect(host.querySelector('[role="log"]')!.textContent).toContain("What are the working hours?");
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
it("handles Enter to send, Shift+Enter for newline, blocks empty send, and retains question on failure",async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div'),root=createRoot(host),onAsk=vi.fn();
 try{
  await act(async()=>root.render(createElement(PaidAssistantTrial,{...props,onAsk})));
  const input=host.querySelector<HTMLTextAreaElement>('textarea')!;
  const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!;
  // Empty Enter does not send
  await act(async()=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
  expect(onAsk).not.toHaveBeenCalled();
  // Shift+Enter does not send
  await act(async()=>{set.call(input,'Line 1');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}));});
  expect(onAsk).not.toHaveBeenCalled();
  expect(input.value).toBe('Line 1');
  // Enter sends
  await act(async()=>{input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));});
  expect(onAsk).toHaveBeenCalledTimes(1);
  expect(onAsk.mock.calls[0]![0]).toMatchObject({question:'Line 1'});
  // On failure, the question is retained in the input and optimistic bubble
  await act(async()=>root.render(createElement(PaidAssistantTrial,{...props,onAsk,state:{...props.state,phase:'error',requestId:'req-1',failure:{ok:false,code:'UNAVAILABLE',requestId:'req-1',retrySafe:true},canRetry:true}})));
  expect(input.value).toBe('Line 1');
  expect(host.querySelector('[role="log"]')!.textContent).toContain('Line 1');
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
it("blocks sending and disables composer when 10/10 free trial replies are reached",()=>{
 const html=render({locale:"ar",snapshot:{...props.snapshot!,canAsk:false,trialAllowance:{used:10,limit:10}}});
 expect(html).toContain("10/10");
 expect(html).toContain("استخدمت كامل الردود المجانية للتجربة (10/10)");
 expect(html).toMatch(/<textarea[^>]*disabled=""/);
 expect(html).toMatch(/type="submit"[^>]*disabled=""/);
});
it("resets drafts on all identity/version/knowledge/capture boundaries",()=>{const key=trialViewKey(props);for(const field of ["expectedAccountId","companyId","branchId"] as const)expect(trialViewKey({...props,scope:{...scope,[field]:"new"}})).not.toBe(key);expect(trialViewKey({...props,boundaryFingerprint:"new"})).not.toBe(key);expect(trialViewKey({...props,snapshot:{...props.snapshot!,version:2}})).not.toBe(key);expect(trialViewKey({...props,snapshot:{...props.snapshot!,knowledgeRevision:"k2"}})).not.toBe(key);expect(trialViewKey({...props,locale:"ar"})).toBe(key);});

it('shows a budget blocker with no answer or retry dispatch permission',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div'),root=createRoot(host),onAsk=vi.fn(),onRetry=vi.fn(),onRefresh=vi.fn();
 try{
  await act(async()=>root.render(createElement(PaidAssistantTrial,{...props,onAsk,onRetry,onRefresh,state:{...props.state,phase:'error',requestId:'budget-request',canRetry:false,failure:{ok:false,code:'UNAVAILABLE',message:'TRIAL_BUDGET_EXCEEDED',requestId:'budget-request',retrySafe:false}}})));
  expect(host.textContent).toContain('blocked by the trial budget limit');expect(host.textContent).toContain('Answer generation did not start');
  expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  expect(Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Retry safely')!.disabled).toBe(true);
  await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Check request status')!.click());
  expect(onRefresh).toHaveBeenCalledOnce();expect(onAsk).not.toHaveBeenCalled();expect(onRetry).not.toHaveBeenCalled();
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});

it('permits an explicitly authorized new question while keeping an old unknown visible and never replaying it',async()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
 const host=document.createElement('div'),root=createRoot(host),onAsk=vi.fn();
 const old='66666666-6666-4666-8666-666666666666';
 const snapshot={...props.snapshot!,pendingOperation:{id:old,status:'uncertain',recoverable:false,blocksNewRequests:false}};
 try{
  await act(async()=>root.render(createElement(PaidAssistantTrial,{...props,onAsk,snapshot})));
  const suggestion=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='What are the working hours?')!;
  expect(suggestion.disabled).toBe(false);expect(host.textContent).toContain('still unresolved');
  await act(async()=>suggestion.click());expect(onAsk).toHaveBeenCalledOnce();
  expect(onAsk.mock.calls[0][0].operationId).not.toBe(old);
  await act(async()=>root.render(createElement(PaidAssistantTrial,{...props,onAsk,snapshot:{...snapshot,canAsk:false}})));
  expect(Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='What are the working hours?')!.disabled).toBe(true);
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
