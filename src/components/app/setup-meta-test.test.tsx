// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,createElement} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {projectTrustedBoundSelection} from '@/lib/tenancy/paid-setup-contracts';
import {SetupMetaTest} from './setup-meta-test';
const m=vi.hoisted(()=>({session:vi.fn(),inspect:vi.fn(),leave:vi.fn()}));
vi.mock('./paid-setup-unsaved',()=>({confirmSetupLeave:m.leave}));
vi.mock('./account-chrome',()=>({useOptionalAccountSession:m.session}));
vi.mock('@/lib/demo-state',()=>({useDemo:()=>({locale:'ar'})}));
vi.mock('@/lib/tenancy/setup-meta-test-actions',()=>({inspectOwnedSetupMetaTestAction:m.inspect}));
vi.mock('./paid-setup-step-host',async()=>{
 const {useState}=await import('react');
 return {PaidSetupStepHost:function StatefulSettingsHost(p:{step:string;scope:{companyId:string};onRefresh?:()=>void}){
  const [url,setUrl]=useState<string|null>(null);
  return <div data-testid="real-settings-host">{p.step}:{p.scope.companyId}{p.step==='team'&&<button type="button" onClick={()=>{setUrl('https://synthetic.invalid/invite/one-time');p.onRefresh?.();}}>Synthetic invite</button>}{url&&<a href={url}>One-time invite link</a>}</div>;
 }};
});
const scope={expectedAccountId:'11111111-1111-4111-8111-111111111111',companyId:'22222222-2222-4222-8222-222222222222',branchId:'33333333-3333-4333-8333-333333333333'};
const read=projectTrustedBoundSelection({...scope,branchLabel:'Main',orderGroupId:'paid-order',slotIndex:0,persona:'level_1',package:'basic',term:'monthly',maxChannels:1,employeesExcludingOwner:2,clockState:'waiting_readiness',asOf:'now'},{channels:['whatsapp']});
const initial={scope,read,authorityFingerprint:'opaque-server-fence',expiresAt:'2099-01-01T00:00:00.000Z'};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);m.leave.mockReturnValue(true);m.session.mockReturnValue({status:'ready',identity:{userId:scope.expectedAccountId,companyId:scope.companyId},boundaryFingerprint:'client-fence',liveSnapshot:()=>({ready:true,userId:scope.expectedAccountId,boundaryFingerprint:'client-fence'}),isCurrentUser:()=>true});m.inspect.mockResolvedValue({status:'unknown',code:'META_UNAVAILABLE'});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=async(value=initial)=>{await act(async()=>root.render(createElement(SetupMetaTest,{initial:value,companyName:'Synthetic business'})));};
const button=(name:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===name);
const click=async(name:string)=>{expect(button(name)).toBeTruthy();await act(async()=>button(name)!.click());};
it('reuses the native settings host and keeps launch separate from test access',async()=>{await render();await click('مواعيد العمل');expect(host.querySelector('[data-testid="real-settings-host"]')?.textContent).toContain(`hours:${scope.companyId}`);await click('تجربة المساعد');expect(host.querySelector('[data-testid="real-settings-host"]')?.textContent).toContain('test:');await click('التشغيل التجاري');expect(host.querySelector('[data-testid="real-settings-host"]')).toBeNull();expect(button('تأكيد التشغيل')).toBeUndefined();});
it('denies another signed-in account rather than exposing the prior owner settings',async()=>{m.session.mockReturnValue({status:'ready',identity:{userId:'other',companyId:scope.companyId},boundaryFingerprint:'other'});await render();expect(button('مواعيد العمل')).toBeUndefined();});
it('shows UNKNOWN without claiming the commercial channel connected',async()=>{await render();await click('التحقق من رقم Meta');expect(host.textContent).toMatch(/UNKNOWN.*META_UNAVAILABLE/);expect(host.textContent).not.toContain('ربط تجاري مكتمل');});
it('does not expose actions after the test authorization expires',async()=>{await render({...initial,expiresAt:'2000-01-01T00:00:00Z'});expect(button('مواعيد العمل')).toBeUndefined();});
it('honors unsaved settings before moving to another test step',async()=>{m.leave.mockReturnValue(false);await render();await click('مواعيد العمل');expect(host.querySelector('[data-testid="real-settings-host"]')).toBeNull();m.leave.mockReturnValue(true);await click('مواعيد العمل');expect(host.querySelector('[data-testid="real-settings-host"]')).not.toBeNull();});
it('preserves the one-time invitation URL returned by the real host contract',async()=>{await render();await click('دعوة الفريق');await click('Synthetic invite');expect(host.querySelector('a[href="https://synthetic.invalid/invite/one-time"]')).not.toBeNull();});
