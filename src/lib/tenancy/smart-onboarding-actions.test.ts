import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({access:vi.fn(),client:vi.fn(),rpc:vi.fn(),contract:vi.fn()}));
vi.mock('./access',()=>({getCompanyAccess:mocks.access}));
vi.mock('@/lib/supabase/server',()=>({createClient:mocks.client}));
vi.mock('@/lib/channels/read',()=>({readCompanyChannelContract:mocks.contract}));
import {readSmartSetup,saveSmartBranchSetup,readSmartCompanySettings,saveSmartCompanySettings,saveSmartBranchSettings,createSmartBranch,renameSmartBranch} from './smart-onboarding-actions';
const companyId='11111111-1111-4111-8111-111111111111';
const scope={expectedUserId:'owner',expectedCompanyId:companyId};
const branch={companyId,revision:1,mode:'single',branches:[{id:'22222222-2222-4222-8222-222222222222',name:'Main',primary:true,status:'active'}]};
const input={...scope,expectedRevision:0,mode:'single' as const,primaryName:'Main',expectedPrimaryName:'Original'};
beforeEach(()=>{vi.clearAllMocks();mocks.access.mockResolvedValue({ok:true,context:{userId:'owner',company:{id:companyId},membership:{role:'owner'},needsCompanyContext:false}});mocks.client.mockResolvedValue({rpc:mocks.rpc});mocks.contract.mockResolvedValue(null);});
describe('smart setup authority',()=>{
 it('rejects stale actors, tenants and staff before persistence',async()=>{
  expect(await readSmartSetup({...scope,expectedUserId:'old'})).toEqual({ok:false,code:'UNAUTHENTICATED'});
  expect(await saveSmartBranchSetup({...input,expectedCompanyId:'other'})).toEqual({ok:false,code:'FORBIDDEN'});
  mocks.access.mockResolvedValue({ok:true,context:{userId:'owner',company:{id:companyId},membership:{role:'staff'}}});
  expect(await readSmartSetup(scope)).toEqual({ok:false,code:'FORBIDDEN'});expect(mocks.client).not.toHaveBeenCalled();
 });
 it('rejects malformed branch choices and optimistic concurrency inputs',async()=>{
  expect(await saveSmartBranchSetup({...input,expectedRevision:-1})).toEqual({ok:false,code:'INVALID_INPUT'});
  expect(await saveSmartBranchSetup({...input,primaryName:'\nBad'})).toEqual({ok:false,code:'INVALID_INPUT'});
  expect(await saveSmartBranchSetup({...input,expectedPrimaryName:''})).toEqual({ok:false,code:'INVALID_INPUT'});
  expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('returns scoped durable receipts and explicit conflicts',async()=>{
  mocks.rpc.mockResolvedValue({data:{ok:true,data:branch},error:null});
  expect(await saveSmartBranchSetup(input)).toEqual({ok:true,data:branch});
  mocks.rpc.mockResolvedValue({data:{ok:false,code:'CONFLICT'},error:null});
  expect(await saveSmartBranchSetup(input)).toEqual({ok:false,code:'CONFLICT'});
  mocks.rpc.mockResolvedValue({data:{ok:true,data:{...branch,companyId:'other'}},error:null});
  expect(await saveSmartBranchSetup(input)).toEqual({ok:false,code:'UNAVAILABLE'});
 });
 it('never treats unavailable or unproven channel data as operational',async()=>{
  mocks.rpc.mockResolvedValue({data:{ok:true,data:branch},error:null});
  const result=await readSmartSetup(scope);
  expect(result.ok&&result.data.operationalChannels).toEqual([]);
  mocks.rpc.mockResolvedValue({data:null,error:{code:'42883'}});
  expect(await readSmartSetup(scope)).toEqual({ok:false,code:'UNCONFIGURED'});
 });
});
describe('smart settings receipts',()=>{
 const actor='33333333-3333-4333-8333-333333333333',attemptId='44444444-4444-4444-8444-444444444444';
 const s={expectedUserId:actor,expectedCompanyId:companyId};
 const profile={name:'Business',type:'store' as const,country:'OM',city:'Muscat',hours:'',contactPhone:'',contactEmail:'',replyLanguage:'ar' as const};
 const record={companyId,revision:2,profileDigest:'a'.repeat(64),profile};
 beforeEach(()=>mocks.access.mockResolvedValue({ok:true,context:{userId:actor,company:{id:companyId},membership:{role:'owner'},needsCompanyContext:false}}));
 it('fences malformed actors, incomplete input, and mismatched write receipts',async()=>{
  const input={...s,attemptId,expectedRevision:1,expectedProfileDigest:'b'.repeat(64),profile};
  expect(await saveSmartCompanySettings({...input,expectedUserId:'bad'})).toEqual({ok:false,code:'INVALID_INPUT'});
  expect(await saveSmartCompanySettings({...input,profile:{...profile,contactEmail:'bad'}})).toEqual({ok:false,code:'INVALID_INPUT'});
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({error:null,data:{ok:true,data:{...record,userId:actor,attemptId:'other'}}});
  expect(await saveSmartCompanySettings(input)).toEqual({ok:false,code:'UNAVAILABLE'});
  mocks.rpc.mockResolvedValue({error:null,data:{ok:true,data:{...record,userId:actor,attemptId}}});
  expect(await saveSmartCompanySettings(input)).toEqual({ok:true,data:record});
  expect(mocks.rpc).toHaveBeenLastCalledWith('save_smart_profile',expect.objectContaining({p_expected_user_id:actor,p_attempt_id:attemptId,p_payload:profile}));
 });
 it('preserves sensitive review and rejects foreign read receipts',async()=>{
  mocks.rpc.mockResolvedValue({error:null,data:{ok:false,code:'REVIEW_REQUIRED'}});
  expect(await saveSmartCompanySettings({...s,attemptId,expectedRevision:1,expectedProfileDigest:'b'.repeat(64),profile})).toEqual({ok:false,code:'REVIEW_REQUIRED'});
  mocks.rpc.mockResolvedValue({error:null,data:{ok:true,data:{...record,companyId:'foreign'}}});expect(await readSmartCompanySettings(s)).toEqual({ok:false,code:'UNAVAILABLE'});
 });
 it('treats immutable attempt conflicts as terminal conflicts, never unknown outcomes',async()=>{
  mocks.rpc.mockResolvedValue({error:null,data:{ok:false,code:'OPERATION_CONFLICT'}});
  expect(await saveSmartCompanySettings({...s,attemptId,expectedRevision:0,expectedProfileDigest:'b'.repeat(64),profile})).toEqual({ok:false,code:'CONFLICT'});
  expect(await saveSmartBranchSettings({...s,attemptId,expectedPrimaryBranchId:branch.branches[0].id,expectedRevision:0,mode:'single',primaryName:'Main',expectedPrimaryName:'Main'})).toEqual({ok:false,code:'CONFLICT'});
  expect(await createSmartBranch({...s,attemptId,name:'Second',timezone:'Asia/Muscat'})).toEqual({ok:false,code:'CONFLICT'});
  expect(await renameSmartBranch({...s,attemptId,branchId:branch.branches[0].id,expectedName:'Old',name:'New'})).toEqual({ok:false,code:'CONFLICT'});
 });
 it('binds branch replay to actor, attempt and native primary branch',async()=>{
  const input={...s,attemptId,expectedRevision:1,expectedPrimaryBranchId:branch.branches[0].id,expectedPrimaryName:'Main',primaryName:'New',mode:'single' as const};
  mocks.rpc.mockResolvedValue({error:null,data:{ok:true,data:{...branch,userId:actor,attemptId}}});
  expect((await saveSmartBranchSettings(input)).ok).toBe(true);
  expect(mocks.rpc).toHaveBeenLastCalledWith('save_smart_branch_setup_v2',expect.objectContaining({p_expected_user_id:actor,p_expected_primary_branch_id:branch.branches[0].id}));
  mocks.rpc.mockResolvedValue({error:null,data:{ok:true,data:{...branch,userId:'other',attemptId}}});expect(await saveSmartBranchSettings(input)).toEqual({ok:false,code:'UNAVAILABLE'});
 });
 it('binds deliberate creation and secondary rename receipts to the requested branch',async()=>{
  const branchId=branch.branches[0].id;
  mocks.rpc.mockResolvedValue({error:null,data:{ok:true,data:{userId:actor,companyId,attemptId,branchId}}});
  expect((await createSmartBranch({...s,attemptId,name:'Second',timezone:'Asia/Muscat'})).ok).toBe(true);
  expect(mocks.rpc).toHaveBeenLastCalledWith('create_smart_branch',expect.objectContaining({p_expected_user_id:actor,p_attempt_id:attemptId,p_timezone:'Asia/Muscat'}));
  mocks.rpc.mockResolvedValue({error:null,data:{ok:true,data:{userId:actor,companyId,attemptId,branchId:'55555555-5555-4555-8555-555555555555',name:'New'}}});
  expect(await renameSmartBranch({...s,attemptId,branchId,expectedName:'Second',name:'New'})).toEqual({ok:false,code:'UNAVAILABLE'});
 });
});
