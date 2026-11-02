import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({access:vi.fn(),branch:vi.fn(),billing:vi.fn(),broker:vi.fn(),companyRead:vi.fn()}));
vi.mock('next/headers',()=>({cookies:async()=>({getAll:()=>[{name:'opaque',value:'fixture'}]})}));
vi.mock('@/lib/auth/broker',()=>({createBrokerUserClient:m.broker}));
vi.mock('@/lib/tenancy/access',()=>({getCompanyAccess:m.access,runWithVerifiedCompanyRead:m.companyRead}));
vi.mock('@/lib/customer/dashboard-branch-actions',()=>({readDashboardBranch:m.branch}));
vi.mock('@/lib/customer/dashboard-billing-actions',()=>({readDashboardBilling:m.billing}));
import {GET} from './route';
const cid='11111111-1111-4111-8111-111111111111',uid='22222222-2222-4222-8222-222222222222';
const request=(section='branch',extra='',headers?:HeadersInit)=>new Request(`https://velora.test/api/dashboard/read?section=${section}&companyId=${cid}${extra}`,{headers});
const bound=()=>({ok:true,client:{},resolve:{registryId:'registry',boundary:{userId:uid,boundaryFingerprint:'same',nativeSessionId:'sid',cookieName:'opaque',generation:'generation',authOrdinal:1,contextGeneration:1}}});
beforeEach(()=>{vi.resetAllMocks();m.companyRead.mockImplementation(work=>work());m.broker.mockImplementation(async()=>bound());m.access.mockResolvedValue({ok:true,context:{userId:uid,company:{id:cid},membership:{role:'owner'}}});m.branch.mockResolvedValue({status:'ready',companyId:cid,branches:[]});m.billing.mockResolvedValue({status:'empty',companyId:cid});});
it.each(['branch','billing'])('uses the native %s reader and a fresh final broker fence',async section=>{
 const response=await GET(request(section));expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('vary')).toBe('Cookie');
 expect(section==='branch'?m.branch:m.billing).toHaveBeenCalledExactlyOnceWith({expectedCompanyId:cid});expect(m.broker).toHaveBeenCalledTimes(2);
});
it('rejects malformed, duplicate and cross-origin requests before reading',async()=>{
 for(const req of [request('unknown'),request('branch','&companyId='+cid),request('billing','&branchId='+cid),request('branch','',{origin:'https://foreign.test'})])expect((await GET(req)).status).toBeGreaterThanOrEqual(400);
 expect(m.branch).not.toHaveBeenCalled();expect(m.broker).not.toHaveBeenCalled();
});
it('never returns foreign company data',async()=>{m.branch.mockResolvedValue({status:'ready',companyId:uid,secret:'private'});const response=await GET(request());expect(response.status).toBe(409);expect(await response.json()).toEqual({status:'unavailable'});});
it('drops data if current owner scope changes during the read',async()=>{m.access.mockResolvedValueOnce({ok:true,context:{userId:uid,company:{id:cid},membership:{role:'owner'}}}).mockResolvedValue({ok:false});expect((await GET(request())).status).toBe(403);});
it('drops data when the final session is revoked',async()=>{m.broker.mockResolvedValueOnce(bound()).mockResolvedValueOnce({ok:false});expect((await GET(request())).status).toBe(503);});
it('never substitutes a reader actor for the actual broker actor',async()=>{m.broker.mockImplementation(async()=>({...bound(),resolve:{...bound().resolve,boundary:{...bound().resolve.boundary,userId:cid}}}));expect((await GET(request())).status).toBe(403);});
it('preserves native denial and does not leak thrown details',async()=>{m.branch.mockResolvedValueOnce({status:'forbidden'});expect(await (await GET(request())).json()).toEqual({status:'forbidden'});m.branch.mockRejectedValue(new Error('private'));expect(await (await GET(request())).json()).toEqual({status:'unavailable'});});
it('does not release card data if the final company authority fence fails',async()=>{m.companyRead.mockImplementation(async work=>{await work();throw new Error('COMPANY_READ_CHANGED');});const response=await GET(request());expect(response.status).toBe(503);expect(await response.json()).toEqual({status:'unavailable'});});
