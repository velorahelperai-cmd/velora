import type {DashboardBranchLoad} from './dashboard-branch-actions';
import type {DashboardBillingLoad} from './dashboard-billing-model';

async function read<T extends DashboardBranchLoad|DashboardBillingLoad>(section:'branch'|'billing',companyId:string|undefined,branchId?:string):Promise<T|{status:'unavailable'}>{
 if(!companyId)return {status:'unavailable'};
 try{
  const q=new URLSearchParams({section,companyId});if(branchId)q.set('branchId',branchId);
  const response=await fetch(`/api/dashboard/read?${q}`,{method:'GET',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(45000)});
  if(!response.ok)return {status:'unavailable'};
  const result=await response.json() as T;
  if(!result||typeof result!=='object'||!['ready','empty','unavailable','forbidden','scope_changed'].includes(result.status))return {status:'unavailable'};
  if((result.status==='ready'||result.status==='empty')&&(!('companyId' in result)||result.companyId!==companyId))return {status:'unavailable'};
  return result;
 }catch{return {status:'unavailable'};}
}
export const fetchDashboardBranch=(input:{expectedCompanyId:string;branchId?:string}):Promise<DashboardBranchLoad>=>read<DashboardBranchLoad>('branch',input.expectedCompanyId,input.branchId);
export const fetchDashboardBilling=(input:{expectedCompanyId?:string}):Promise<DashboardBillingLoad>=>read<DashboardBillingLoad>('billing',input.expectedCompanyId);
