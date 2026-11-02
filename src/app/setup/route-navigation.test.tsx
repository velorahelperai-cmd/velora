import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {AccessResult} from '@/lib/tenancy/access';
const state=vi.hoisted(()=>({path:'/setup',access:vi.fn()}));
vi.mock('next/headers',()=>({headers:async()=>new Headers({'x-velora-return-path':state.path})}));
vi.mock('next/navigation',()=>({redirect:(href:string)=>{throw Error(`redirect:${href}`);}}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:state.access}));
vi.mock('@/components/app/setup-account-entry',()=>({SetupAccountEntry:()=>null}));
vi.mock('@/components/app/access-gate',()=>({AccessGate:()=>null}));
import SetupLayout from './layout';
import SetupPage from './page';
import {SetupAccountEntry} from '@/components/app/setup-account-entry';
const selected='/app/settings?tab=plan&term=monthly&persona=level_1&package=basic&version=fixture-version&amount=45000&currency=OMR';
const returnTo=`/setup?next=${encodeURIComponent(selected)}`;
async function layout(){const child=SetupLayout({children:'public entry'}).props.children;return child.type(child.props);}
beforeEach(()=>{vi.clearAllMocks();state.path=returnTo;});
describe('public setup root keeps data in attested readers',()=>{
 it('returns only safe navigation props without waiting on native access',async()=>{
  state.access.mockReturnValue(new Promise(()=>{}));
  const page=await SetupPage();
  expect(page.type).toBe(SetupAccountEntry);
  expect(page.props).toEqual({returnTo,preferredNext:selected});
  expect(await layout()).toBe('public entry');
  expect(state.access).not.toHaveBeenCalled();
 });
 it('preserves a branch selection without projecting private branch data',async()=>{
  const branch='10000000-0000-4000-8000-000000000001';state.path=`/setup?branch=${branch}&next=${encodeURIComponent(selected)}`;
  expect((await SetupPage()).props).toEqual({returnTo:state.path,preferredNext:selected});expect(state.access).not.toHaveBeenCalled();
 });
 it('discards external and duplicate next selections',async()=>{
  for(const path of ['/setup?next=https://foreign.test','/setup?next=%2Fapp&next=%2Faccount']){
   state.path=path;expect((await SetupPage()).props).toEqual({returnTo:'/setup',preferredNext:''});
  }
 });
 it.each(['UNVERIFIED','UNAUTHENTICATED'] as const)('retains child-route %s enforcement',async code=>{
  state.path='/setup/branches/10000000-0000-4000-8000-000000000001/whatsapp';state.access.mockResolvedValue({ok:false,code} satisfies AccessResult);
  const target=code==='UNVERIFIED'?'/verify-email':'/login';
  await expect(layout()).rejects.toThrow(`redirect:${target}?next=${encodeURIComponent(state.path)}`);
 });
 it.each(['UNAVAILABLE','FORBIDDEN'] as const)('keeps child-route %s closed',async code=>{
  state.path='/setup/branches';state.access.mockResolvedValue({ok:false,code});expect((await layout()).props.code).toBe(code);
 });
 it('does not infer public entry when the trusted path hint is absent',async()=>{
  state.path='';state.access.mockResolvedValue({ok:false,code:'UNAVAILABLE'});expect((await layout()).props.code).toBe('UNAVAILABLE');expect(state.access).toHaveBeenCalledOnce();
 });
});
