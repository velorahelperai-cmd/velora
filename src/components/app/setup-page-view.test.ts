import {describe,expect,it} from 'vitest';
import {buildSetupPageView,setupPageStep} from './setup-page-view';
import {buildSmartOnboarding,type SmartBranchSetup} from '@/lib/tenancy/smart-onboarding';
import type {CompanyRecord} from '@/lib/tenancy/types';
const company={id:'company',status:'setup',display_name:'Business',business_type:'restaurant',country:'OM',reply_language:'ar',hours:''} as CompanyRecord;
const branch:SmartBranchSetup={companyId:'company',revision:2,mode:'multiple',branches:[{id:'primary',name:'Main',primary:true,status:'active'},{id:'secondary',name:'Second',primary:false,status:'setup'}]};
const read=()=>buildSmartOnboarding({company,branchSetup:branch,knowledge:'failed',contract:null,review:null,reviewLoadFailed:true,operationalChannels:[],reviewPolicyReady:false});
describe('setup page scope without changing operational requirements',()=>{
 it('removes exactly the five requested sections and leaves source contracts intact',()=>{
  const original=read(),before=structuredClone(original),view=buildSetupPageView(original,company,branch);
  expect(view.cards.map(c=>c.id)).toEqual(['profile','branches','subscription','review']);
  expect(original).toEqual(before);expect(original.cards).toHaveLength(9);
  expect(view.cards.find(c=>c.id==='review')).toEqual(original.cards.find(c=>c.id==='review'));
 });
 it('can complete page data while knowledge, channel, subscription and review readiness remain incomplete',()=>{
  const original=read(),view=buildSetupPageView(original,company,branch);
  expect(view.percent).toBe(100);expect(view.completedRequired).toBe(2);expect(view.totalRequired).toBe(2);
  expect(original.percent).toBeLessThan(100);expect(original.cards.find(c=>c.id==='branches')?.status).toBe('needs_attention');
  expect(view.cards.find(c=>c.id==='branches')?.status).toBe('ready');
  expect(view.cards.find(c=>c.id==='review')?.status).toBe('failed');
 });
 it('never counts missing, foreign or unconfirmed branch data as completed',()=>{
  for(const value of [null,{...branch,companyId:'other'},{...branch,mode:null},{...branch,branches:[]}])expect(buildSetupPageView(read(),company,value).percent).toBe(50);
 });
 it('does not count suspended business data as completed',()=>{
  const suspended={...company,status:'suspended'} as CompanyRecord;
  expect(buildSetupPageView(read(),suspended,branch).percent).toBe(0);
 });
 it('keeps restored or stale navigation away from removed panels',()=>{
  expect([0,1,7].map(setupPageStep)).toEqual([0,1,7]);
  expect([2,3,4,5,6,-1,8].map(setupPageStep)).toEqual([0,0,0,0,0,0,0]);
 });
});
