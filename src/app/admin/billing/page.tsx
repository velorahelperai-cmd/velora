import {readAdminBillingOrders} from "@/lib/billing/admin/actions";
import {AdminBillingLedger} from "@/components/admin/billing-ledger";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const raw=await searchParams,query:Record<string,string>={};for(const k of ["companyId","environment","from","until","cursor"]){if(typeof raw[k]==="string")query[k]=raw[k];}
 const result=await readAdminBillingOrders(Object.values(raw).some(Array.isArray)?{pageSize:0}:query);return <AdminBillingLedger result={result} query={query}/>;
}
