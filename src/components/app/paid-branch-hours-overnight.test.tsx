// @vitest-environment jsdom
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {describe,it,expect,vi} from 'vitest';
import {emptyBranchHours} from '@/lib/tenancy/branch-hours-contracts';
import {PaidBranchHours,type PaidBranchHoursProps} from './paid-branch-hours';
const scope={expectedAccountId:'account',companyId:'company',branchId:'branch'};
const schedule=emptyBranchHours();
for(const day of ['sunday','monday','tuesday','wednesday','thursday'] as const)schedule[day]={state:'open',intervals:[{start:'10:00',end:'14:00',nextDay:false}]};
schedule.friday={state:'closed'};schedule.saturday={state:'closed'};
const props:PaidBranchHoursProps={locale:'en',scope,boundaryFingerprint:'scope',snapshot:{scope,version:1,branchLabel:'Main',timezone:'Asia/Muscat',schedule},state:{scope,version:1,phase:'ready'},copyTargets:[],isCurrent:()=>true};
async function mount(p:PaidBranchHoursProps){vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);const host=document.createElement('div');document.body.append(host);const root=createRoot(host);await act(async()=>root.render(createElement(PaidBranchHours,p)));return {host,close:async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}};}
async function type(host:HTMLElement,label:string,value:string){const f=host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(f,value);f.dispatchEvent(new Event('input',{bubbles:true}));});}
const nextDay=(host:HTMLElement)=>host.querySelector<HTMLInputElement>('input[aria-label="Ends next day for quick apply"]')!;
async function edit(host:HTMLElement){await act(async()=>host.querySelector<HTMLButtonElement>('[data-hours-action="edit"]')!.click());}
describe('quick hours: timezone, AM/PM and midnight crossing',()=>{
 it.each(['ar','en'] as const)('shows the branch timezone in %s',async locale=>{const m=await mount({...props,locale});try{
  expect(m.host.querySelector('[data-hours-timezone]')?.textContent).toContain('Asia/Muscat');
  await edit(m.host);expect(m.host.querySelector('[data-hours-timezone]')?.textContent).toContain('Asia/Muscat');}finally{await m.close();}});
 it('marks an end before the start as closing the next day and clears it again',async()=>{const save=vi.fn();const m=await mount({...props,onSave:save});try{
  await edit(m.host);expect(nextDay(m.host).checked).toBe(false);
  await type(m.host,'Quick start time','6:00 pm');await type(m.host,'Quick end time','2:00 am');
  expect(nextDay(m.host).checked).toBe(true);
  expect(m.host.querySelector('[data-hours-overnight]')?.textContent).toContain('Closes the next day at');
  expect(m.host.querySelector('[data-hours-overnight]')?.textContent).toContain('02:00');
  expect(m.host.querySelector('[data-hours-preview-day="sunday"]')?.textContent).toContain('18:00');
  await type(m.host,'Quick end time','11:30 pm');expect(nextDay(m.host).checked).toBe(false);
  expect(m.host.querySelector('[data-hours-overnight]')).toBeNull();
  expect(save).not.toHaveBeenCalled();}finally{await m.close();}});
 it('asks what equal times mean instead of assuming 24 hours or closed',async()=>{const m=await mount(props);try{
  await edit(m.host);await type(m.host,'Quick start time','09:00');await type(m.host,'Quick end time','9:00 am');
  expect(nextDay(m.host).checked).toBe(false);
  expect(m.host.querySelector('[data-hours-same-time]')?.textContent).toContain('Do you mean 24 hours?');
  await act(async()=>nextDay(m.host).click());
  expect(m.host.querySelector('[data-hours-same-time]')).toBeNull();
  expect(m.host.querySelector('[data-hours-overnight]')?.textContent).toContain('24 hours');}finally{await m.close();}});
});
