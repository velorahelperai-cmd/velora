import {afterEach,expect,it,vi} from 'vitest';
import {fetchDashboardBranch,fetchDashboardBilling} from './dashboard-read';
afterEach(()=>vi.unstubAllGlobals());
it('starts independent GET reads without waiting on another card or mutation queue',async()=>{
 let complete!:(r:Response)=>void;
 const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{complete=r;})).mockResolvedValueOnce(Response.json({status:'empty',companyId:'company'}));vi.stubGlobal('fetch',fetcher);
 const pending=fetchDashboardBranch({expectedCompanyId:'company',branchId:'branch'});
 expect(await fetchDashboardBilling({expectedCompanyId:'company'})).toEqual({status:'empty',companyId:'company'});
 expect(fetcher).toHaveBeenNthCalledWith(1,'/api/dashboard/read?section=branch&companyId=company&branchId=branch',expect.objectContaining({method:'GET',credentials:'same-origin',cache:'no-store',signal:expect.any(AbortSignal)}));
 complete(Response.json({status:'ready',companyId:'company'}));expect((await pending).status).toBe('ready');
});
it('rejects stale company, malformed data and transport failures',async()=>{
 for(const response of [Response.json({status:'ready',companyId:'foreign'}),Response.json(null),new Response('',{status:503})]){vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response));expect(await fetchDashboardBranch({expectedCompanyId:'company'})).toEqual({status:'unavailable'});}
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new DOMException('timeout','TimeoutError')));expect(await fetchDashboardBilling({expectedCompanyId:'company'})).toEqual({status:'unavailable'});
});
