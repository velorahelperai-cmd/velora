import {getCompanyAccess,runWithVerifiedCompanyRead} from '@/lib/tenancy/access';
import {readDashboardBranch} from '@/lib/customer/dashboard-branch-actions';
import {readDashboardBilling} from '@/lib/customer/dashboard-billing-actions';
import {runWithVerifiedReadClient} from '@/lib/supabase/server';
import {traceRead,measureRead} from '@/lib/diagnostics/read-performance';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store, max-age=0','Vary':'Cookie','X-Content-Type-Options':'nosniff'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Read-only transport. Existing native readers retain all business authority;
 * the final broker fence rejects session changes before returning any data. */
export async function GET(request:Request){
 const url=new URL(request.url),q=url.searchParams,companyId=q.get('companyId')??'',section=q.get('section'),branchId=q.get('branchId');
 const fail=(status:number)=>Response.json({status:'unavailable'},{status,headers});
 if(request.headers.get('sec-fetch-site')==='cross-site'||request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return fail(403);
 if(!uuid.test(companyId)||!['branch','billing'].includes(section??'')||branchId!==null&&(!uuid.test(branchId)||section!=='branch')
  ||[...q.keys()].some(key=>!['companyId','section','branchId'].includes(key)||q.getAll(key).length!==1))return fail(400);
 try{
  const {value,actorId}=await traceRead('dashboard_http',()=>runWithVerifiedReadClient(()=>runWithVerifiedCompanyRead(async()=>{
   const access=await getCompanyAccess('owner');
   if(!access.ok||access.context.company?.id!==companyId||access.context.membership?.role!=='owner')return null;
   const result=section==='branch'
    ?await measureRead('branch',()=>readDashboardBranch({expectedCompanyId:companyId,...(branchId?{branchId}:{})}))
    :await measureRead('billing',()=>readDashboardBilling({expectedCompanyId:companyId}));
   const current=await getCompanyAccess('owner');
   if(!current.ok||current.context.userId!==access.context.userId||current.context.company?.id!==companyId||current.context.membership?.role!=='owner')return null;
   return {result,userId:access.context.userId};
  })));
  if(!value||value.userId!==actorId)return fail(403);
  if('companyId' in value.result&&value.result.companyId!==companyId)return fail(409);
  return Response.json(value.result,{headers});
 }catch{return fail(503);}
}
