// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import type {DashboardBranchLoad} from '@/lib/customer/dashboard-branch-actions';
const m=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('@/lib/customer/dashboard-read',()=>({fetchDashboardBranch:m.read}));
import {DashboardBranch} from './dashboard-branch';
const scope={expectedAccountId:'owner',companyId:'company',branchId:'branch'};
const item={detail:'Verified',status:'verified' as const};
const ready:Extract<DashboardBranchLoad,{status:'ready'}>={status:'ready',companyId:'company',asOf:'2026-11-02T08:00:00Z',branches:[{id:'branch',label:'Business branch'}],selectedId:'branch',summary:{scope,version:1,branchLabel:'Business branch',setup:{companyId:'company',selectedBranchId:'branch',sourceStatus:'ready',selectedChannels:['whatsapp'],entitlement:{orderGroupId:'order',slotIndex:0,persona:'level_1',package:'basic',maxChannels:1,employeesExcludingOwner:2},launch:{canRequest:false,confirmationRequired:true,confirmed:true,blockedReasons:[]}},readiness:{status:'ready',revision:'one',blockers:[]},summary:{channels:[{channel:'whatsapp',...item},{channel:'instagram',detail:'Not selected',status:'pending'}],hours:item,knowledge:item,persona:item,team:{detail:'Optional',status:'skipped_optional'}},operationId:'operation',activation:{status:'launched',operationId:'operation',receiptId:'receipt'}}};
let root:Root,host:HTMLDivElement;
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());vi.unstubAllGlobals();});
async function render(data:DashboardBranchLoad,locale:'ar'|'en'='en'){m.read.mockResolvedValue(data);await act(async()=>root.render(<DashboardBranch companyId="company" locale={locale}/>));}
it('shows only selected channels and separates branch plan from payment and delivery proof',async()=>{
 await render(ready);expect(host.textContent).toContain('Branch plan: Noura · Standard');expect(host.textContent).toContain('Payment and usage status');expect(host.textContent).toContain('Launch confirmed');expect(host.textContent).toContain('WhatsApp');expect(host.textContent).not.toContain('Instagram');
});
it('does not confirm launch from a mismatched operation receipt',async()=>{
 await render({...ready,summary:{...ready.summary!,activation:{status:'launched',operationId:'other',receiptId:'receipt'}}});expect(host.textContent).not.toContain('Launch confirmed');expect(host.textContent).toContain('Setup needs attention');
});
it('explains a missing channel selection in Arabic',async()=>{
 await render({...ready,summary:{...ready.summary!,setup:{...ready.summary!.setup,selectedChannels:[]}}},'ar');expect(host.textContent).toContain('لم يتم اختيار قناة');expect(host.textContent).not.toContain('WhatsApp');
});
it('rejects a foreign company read instead of showing its branch details',async()=>{
 await render({...ready,companyId:'other'});expect(host.textContent).not.toContain('Business branch');expect(host.textContent).toContain('could not be confirmed');
});
it('clears stale receipt on refresh failure and allows retry',async()=>{
 await render(ready);m.read.mockResolvedValue({status:'unavailable'});await act(async()=>host.querySelector('button')!.click());expect(host.textContent).not.toContain('Launch confirmed');expect(host.textContent).toContain('could not be confirmed');expect(host.querySelector('button')!.disabled).toBe(false);
});
