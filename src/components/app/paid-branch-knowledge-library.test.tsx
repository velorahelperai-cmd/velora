// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {webcrypto,createHash} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {PaidBranchKnowledge,type PaidBranchKnowledgeProps} from './paid-branch-knowledge';
import type {KnowledgeSourceRecord} from '@/lib/knowledge/types';
const scope={expectedAccountId:'actor',companyId:'company',branchId:'branch'};
const source={id:'source',company_id:'company',kind:'text',title:'Hours',content:'Open 10–14',status:'ready',content_version:2,approved_for_answers:false,approved_version:null} as KnowledgeSourceRecord;
const props:PaidBranchKnowledgeProps={locale:'en',scope,boundaryFingerprint:'stable',isCurrent:()=>true,state:{scope,version:1,phase:'ready'},snapshot:{scope,version:1,branchLabel:'Main',websiteQuota:{limit:10,used:0},pages:[],files:[],faq:[{branchId:'branch',source}],capabilities:{canAddWebsite:true,canUploadFiles:true,canSaveText:true}}};
async function mount(p=props){vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(createElement(PaidBranchKnowledge,p)));return {host,root,close:async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();}};}
const button=(host:HTMLElement,name:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===name)!;
it.each(['ar','en'] as const)('starts with a compact source summary and opens the review without any mutation in %s',async locale=>{
 const approval=vi.fn(),mutation=vi.fn();const m=await mount({...props,locale,onSourceApproval:approval,onSourceMutation:mutation});
 try{const detail=m.host.querySelector<HTMLDetailsElement>('[data-knowledge-source]')!;expect(detail).not.toBeNull();expect(detail.open).toBe(false);expect(detail.querySelector('summary')?.textContent).toContain('Hours');expect(detail.querySelector('summary')?.textContent).toContain(locale==='ar'?'جاهز للمراجعة':'Ready for review');expect(detail.querySelector('summary button')).toBeNull();await act(async()=>detail.querySelector('summary')!.click());expect(detail.open).toBe(true);expect(detail.textContent).toContain('Open 10–14');expect(approval).not.toHaveBeenCalled();expect(mutation).not.toHaveBeenCalled();await act(async()=>m.root.render(createElement(PaidBranchKnowledge,{...props,locale,onSourceApproval:approval,state:{...props.state,phase:'loading'}})));expect(detail.open).toBe(true);}finally{await m.close();}
});
it('approves the exact reviewed version only after the explicit action and preserves existing status until the receipt',async()=>{
 vi.stubGlobal('crypto',webcrypto);const approval=vi.fn();const m=await mount({...props,onSourceApproval:approval});try{await act(async()=>m.host.querySelector('[data-knowledge-source] summary')!.dispatchEvent(new MouseEvent('click',{bubbles:true})));await act(async()=>button(m.host,'Approve this version for assistant answers').click());expect(approval).toHaveBeenCalledExactlyOnceWith({...scope,sourceId:'source',contentVersion:2,approved:true,reviewedContentFingerprint:createHash('sha256').update('Open 10–14').digest('hex')});expect(m.host.querySelector('[data-knowledge-source] summary')?.textContent).toContain('Ready for review');}finally{await m.close();}
});
it('reports inability to verify reviewed content instead of silently succeeding',async()=>{
 vi.stubGlobal('crypto',{});const approval=vi.fn();const m=await mount({...props,onSourceApproval:approval});try{await act(async()=>button(m.host,'Approve this version for assistant answers').click());expect(approval).not.toHaveBeenCalled();expect(m.host.querySelector('[role="alert"]')?.textContent).toContain('could not be confirmed');}finally{await m.close();}
});
it('keeps remove scoped and requires the existing confirmation, with no automatic repeat',async()=>{
 const remove=vi.fn().mockRejectedValue(Error('offline'));const confirm=vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);const m=await mount({...props,onSourceMutation:remove});try{await act(async()=>button(m.host,'Remove from branch').click());expect(remove).not.toHaveBeenCalled();await act(async()=>button(m.host,'Remove from branch').click());expect(remove).toHaveBeenCalledExactlyOnceWith({...scope,sourceId:'source',contentVersion:2,action:'remove'});await act(async()=>m.root.render(createElement(PaidBranchKnowledge,{...props,onSourceMutation:remove})));expect(remove).toHaveBeenCalledTimes(1);expect(confirm).toHaveBeenCalledTimes(2);expect(m.host.textContent).toContain('Hours');}finally{await m.close();}
});
it('shows an unresolved file result without a reprocess button or provider internals',async()=>{
 const retry=vi.fn();const m=await mount({...props,onReprocessFile:retry,snapshot:{...props.snapshot!,faq:[],files:[{branchId:'branch',source:{...source,kind:'file',status:'failed',failure_code:'provider_outcome_unknown'}}]}});try{expect(m.host.querySelector('[data-knowledge-source] summary')?.textContent).toContain('Processing failed');expect(m.host.textContent).not.toContain('provider');expect(Array.from(m.host.querySelectorAll('button')).some(b=>b.textContent?.includes('Reprocess'))).toBe(false);expect(retry).not.toHaveBeenCalled();}finally{await m.close();}
});

it.each(['ar','en'] as const)('shows every knowledge input together without tabs in %s',async locale=>{
 const m=await mount({...props,locale});try{expect(m.host.querySelector('[role="tablist"]')).toBeNull();for(const name of ['website','files','faq']){const panel=m.host.querySelector('[data-panel="'+name+'"]')!;expect(panel).not.toBeNull();expect(panel.hasAttribute('hidden')).toBe(false);}expect(m.host.querySelector('input[type="url"]')).not.toBeNull();expect(m.host.querySelector('input[type="file"]')).not.toBeNull();expect(m.host.querySelector('textarea')).not.toBeNull();}finally{await m.close();}
});
it('cancels an edit without writing or changing the saved source',async()=>{
 const mutation=vi.fn();const m=await mount({...props,onSourceMutation:mutation});try{await act(async()=>button(m.host,'Edit text').click());expect(m.host.textContent).toContain('Edit saved text');await act(async()=>button(m.host,'Cancel').click());expect(m.host.textContent).not.toContain('Edit saved text');expect(mutation).not.toHaveBeenCalled();expect(m.host.textContent).toContain('Open 10–14');}finally{await m.close();}
});
it('removes a pending file locally and ignores new drops during an in-flight upload',async()=>{
 let finish!:()=>void;const upload=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));const m=await mount({...props,onUploadFiles:upload});
 const drop=async(name:string)=>{const event=new Event('drop',{bubbles:true,cancelable:true});Object.defineProperty(event,'dataTransfer',{value:{files:[new File(['text'],name,{type:'text/plain'})]}});await act(async()=>m.host.querySelector('[data-file-drop]')!.dispatchEvent(event));};
 try{await drop('first.txt');await act(async()=>button(m.host,'Remove').click());expect(m.host.querySelector('[data-selected-file]')).toBeNull();expect(upload).not.toHaveBeenCalled();await drop('first.txt');await act(async()=>button(m.host,'Upload').click());expect(upload).toHaveBeenCalledTimes(1);await drop('later.txt');expect(m.host.querySelector('[data-selected-file]')?.textContent).toContain('first.txt');expect(m.host.querySelector('[data-selected-file]')?.textContent).not.toContain('later.txt');await act(async()=>finish());expect(upload).toHaveBeenCalledTimes(1);expect(m.host.querySelector('[data-selected-file]')).toBeNull();}finally{await m.close();}
});
