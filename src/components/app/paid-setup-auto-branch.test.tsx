// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PaidSetupFlow} from './paid-assistant-checklist';
import type {PaidBranchSetupEntryRead} from '@/lib/tenancy/paid-setup-contracts';
vi.mock('./paid-setup-workspace',()=>({PaidSetupWorkspace:()=>null,PaidSetupLoadingFrame:()=>null,nextWorkspaceSelection:()=>null}));
vi.mock('@/lib/tenancy/paid-setup-workspace-actions',()=>({readOwnedPaidSetupWorkspaceAction:vi.fn(),readOwnedPaidSetupDetailsAction:vi.fn()}));
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);window.history.replaceState(null,'','/setup');host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function mount(ids:string[],url='/setup',current=true,unavailable=false){
 window.history.replaceState(null,'',url);
 const readWorkspace=vi.fn(async(_input:{expectedAccountId:string;companyId:string;branchId:string})=>null);
 await act(async()=>root.render(createElement(PaidSetupFlow,{locale:'en',scope:{expectedAccountId:'account',companyId:'company',boundaryFingerprint:'boundary'},isCurrent:()=>current,readEntry:async():Promise<PaidBranchSetupEntryRead>=>({schemaVersion:1,sourceStatus:unavailable?'unavailable':'selection_required',companyId:'company',selectedBranchId:null,branches:ids.map((id,i)=>({id,label:`Branch ${i}`,isPrimary:i===0})),asOf:'now',reasonCodes:[]}),readBranch:vi.fn(),readWorkspace})));
 return readWorkspace;
}
it('loads the single owned branch without a selection gesture',async()=>{const read=await mount([a]);expect(read).toHaveBeenCalledWith({expectedAccountId:'account',companyId:'company',branchId:a});});
it('loads the first server-listed owned branch when several exist',async()=>{const read=await mount([a,b]);expect(read).toHaveBeenCalledTimes(1);expect(read.mock.calls[0][0].branchId).toBe(a);});
it('preserves an explicit valid branch on refresh',async()=>{const read=await mount([a,b],`/setup?branch=${b}`);expect(read.mock.calls[0][0].branchId).toBe(b);});
it('does not read a foreign explicit branch or silently substitute another',async()=>{const read=await mount([a],`/setup?branch=${b}`);expect(read).not.toHaveBeenCalled();});
it.each([{ids:[],current:true,unavailable:false},{ids:[a],current:false,unavailable:false},{ids:[a],current:true,unavailable:true}])('does not default from empty, revoked or unavailable scope %j',async({ids,current,unavailable})=>{expect(await mount(ids,'/setup',current,unavailable)).not.toHaveBeenCalled();});
