import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({rpc:vi.fn(),admin:vi.fn(),access:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({rpc:m.rpc})}));
vi.mock('./access',()=>({requirePlatformAdmin:m.admin,getCompanyAccess:m.access}));
import {adminListCompanies,adminGetCompany,getCompanyReviewRequest,listCompanyReviewEvents} from './actions';
beforeEach(()=>{vi.clearAllMocks();m.admin.mockResolvedValue({ok:true});m.access.mockResolvedValue({ok:true,context:{userId:'u',company:{id:'c',status:'active'},membership:{role:'owner',status:'active'}}});});
it.each([adminListCompanies,adminGetCompany,getCompanyReviewRequest,listCompanyReviewEvents])('sanitizes database failures at legacy public action',async action=>{
 m.rpc.mockResolvedValue({data:null,error:{message:'private.synthetic_detail token=synthetic-secret'}});
 const result=await (action as ()=>Promise<unknown>)();
 expect(result).toMatchObject({ok:false});expect(JSON.stringify(result)).not.toContain('private.synthetic_detail');expect(JSON.stringify(result)).not.toContain('synthetic-secret');
});
it('denies unauthenticated admin access before the database',async()=>{
 m.admin.mockResolvedValue({ok:false,code:'UNAUTHENTICATED'});
 expect(await adminListCompanies()).toEqual({ok:false,code:'UNAUTHENTICATED'});expect(m.rpc).not.toHaveBeenCalled();
});
