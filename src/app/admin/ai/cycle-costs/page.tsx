import {CycleCostsPanel} from "@/components/admin/cycle-costs-panel";
import {readAdminCostCompaniesAction} from "@/lib/billing/admin/cycle-cost-actions";
export const metadata={title:"Cycle costs · Velora Admin"};
export default async function Page(){const result=await readAdminCostCompaniesAction();return <CycleCostsPanel key={result.ok?result.data.actorUserId:"unavailable"} initialResult={result}/>;}
