import {describe,expect,it} from 'vitest';
import type {CompanyRecord,CompanyReviewRequest} from './types';
import type {ChannelContract} from '@/lib/channels/contract';
import {buildSmartOnboarding,parseSmartBranchSetup} from './smart-onboarding';

const company={id:'11111111-1111-4111-8111-111111111111',display_name:'Shop',business_type:'retail',country:'OM',reply_language:'ar',hours:'',status:'setup'} as CompanyRecord;
const branches={companyId:company.id,revision:1,mode:'single' as const,branches:[{id:'22222222-2222-4222-8222-222222222222',name:'Main',primary:true,status:'active' as const}]};
const contract={companyId:company.id,planVersionId:'plan',plan_entitlements:{status:'approved',channelCount:1},selected_channels:{planVersionId:'plan',revision:1,channels:['whatsapp']},subscription:{state:'active',expiresAt:'2030-01-01T00:00:00Z'}} as ChannelContract;
const review={company_id:company.id,status:'approved',proof_current:true} as CompanyReviewRequest;
const input={company,branchSetup:branches,knowledge:'ready' as const,contract,review,reviewLoadFailed:false,operationalChannels:['whatsapp']};

describe('smart onboarding server evidence',()=>{
 it('offers nine independent cards and excludes optional hours/trials from requirements',()=>{
  const result=buildSmartOnboarding(input);
  expect(result.cards).toHaveLength(9);expect(result.percent).toBe(100);
  expect(result.cards.find(c=>c.id==='hours')).toMatchObject({required:false,status:'not_started'});
  expect(result.cards.find(c=>c.id==='trial')).toMatchObject({required:false,status:'not_started'});
 });
 it('does not invent completion from a connection, payment, or skipped requirements',()=>{
  const result=buildSmartOnboarding({...input,operationalChannels:[]});
  expect(result.percent).toBeLessThan(100);expect(result.cards.find(c=>c.id==='channels')?.status).toBe('needs_attention');
  expect(buildSmartOnboarding({...input,knowledge:'needs_attention'}).percent).toBeLessThan(100);
 });
 it('adds a second selected channel as its own requirement',()=>{
  const both={...contract,plan_entitlements:{status:'approved' as const,channelCount:2 as const},selected_channels:{...contract.selected_channels,channels:['whatsapp','instagram'] as ('whatsapp'|'instagram')[]}};
  const result=buildSmartOnboarding({...input,contract:both});
  expect(result.totalRequired).toBe(buildSmartOnboarding(input).totalRequired+1);
  expect(result.percent).toBeLessThan(100);
 });
 it('rejects stale plan selections and unknown operational evidence',()=>{
  expect(buildSmartOnboarding({...input,contract:{...contract,selected_channels:{...contract.selected_channels,planVersionId:'previous'}}}).percent).toBeLessThan(100);
  expect(buildSmartOnboarding({...input,contract:null}).cards.find(c=>c.id==='channels')?.status).toBe('failed');
 });
 it('never carries company, branch, channel or review evidence across tenants',()=>{
  const result=buildSmartOnboarding({...input,branchSetup:{...branches,companyId:'other'},contract:{...contract,companyId:'other'},review:{...review,company_id:'other'}});
  expect(result.percent).toBeLessThan(100);
  expect(result.cards.find(c=>c.id==='branches')?.status).toBe('failed');
  expect(result.cards.find(c=>c.id==='review')?.status).toBe('not_started');
 });
 it('requires explicit branch-mode confirmation even when the primary exists',()=>{
  expect(buildSmartOnboarding({...input,branchSetup:{...branches,mode:null}}).cards.find(c=>c.id==='branches')?.status).toBe('in_progress');
 });
 it('keeps provisioned secondary branches visibly incomplete until ready',()=>{
  const pending={...branches,mode:'multiple' as const,branches:[...branches.branches,{id:'33333333-3333-4333-8333-333333333333',name:'Second',primary:false,status:'setup' as const}]};
  const result=buildSmartOnboarding({...input,branchSetup:pending});
  expect(result.percent).toBeLessThan(100);expect(result.cards.find(c=>c.id==='branches')?.status).toBe('needs_attention');
 });
 it('does not use stale reviews, expired subscriptions or suspended company facts',()=>{
  expect(buildSmartOnboarding({...input,review:{...review,proof_current:false}}).percent).toBeLessThan(100);
  expect(buildSmartOnboarding({...input,contract:{...contract,subscription:{...contract.subscription,state:'locked'}}}).percent).toBeLessThan(100);
  expect(buildSmartOnboarding({...input,company:{...company,status:'suspended'}}).percent).toBe(0);
 });
 it('rejects malformed branches, revisions and duplicate primary branches',()=>{
  expect(parseSmartBranchSetup(branches,company.id)).toEqual(branches);
  expect(parseSmartBranchSetup({...branches,revision:-1},company.id)).toBeNull();
  expect(parseSmartBranchSetup({...branches,branches:[...branches.branches,{...branches.branches[0],id:'33333333-3333-4333-8333-333333333333'}]},company.id)).toBeNull();
  expect(parseSmartBranchSetup(branches,'other')).toBeNull();
 });
});
