import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({access:vi.fn(),client:vi.fn(),rpc:vi.fn(),contract:vi.fn()}));
vi.mock('./access',()=>({getCompanyAccess:mocks.access}));
vi.mock('@/lib/supabase/server',()=>({createClient:mocks.client}));
vi.mock('@/lib/channels/read',()=>({readCompanyChannelContract:mocks.contract}));
import {readSmartSetup,saveSmartBranchSetup} from './smart-onboarding-actions';
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
