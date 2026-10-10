import {readAdminBillingOrder} from "@/lib/billing/admin/actions";
import {AdminBillingOrderView} from "@/components/admin/billing-order";
import {safeInternalPath,pathAtOrUnder} from "@/lib/auth/safe-next";
export default async function Page({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {id}=await params,p=await searchParams,companyId=typeof p.companyId==="string"?p.companyId:"";const requested=typeof p.returnTo==="string"?safeInternalPath(p.returnTo):null;
 const back=requested&&pathAtOrUnder(requested,"/admin/billing")?requested:"/admin/billing";const result=await readAdminBillingOrder({companyId,orderId:id});const refresh=`/admin/billing/orders/${encodeURIComponent(id)}?`+new URLSearchParams({companyId,returnTo:back});return <AdminBillingOrderView result={result} back={back} refresh={refresh}/>;
}
