import { getCompanyAccess } from "@/lib/tenancy/access";
import {loadBillingReturnRow} from "@/lib/billing/wiring/return-load";
import {mapBillingReturnDisplay} from "@/lib/billing/wiring/return-status";
import {AccessGate} from "@/components/app/access-gate";
import {SubscriptionPaymentStatus} from "@/components/app/subscription-payment-status";
export default async function Page({params}:{params:Promise<{orderId:string}>}) {
 const access=await getCompanyAccess("owner");
 if(!access.ok||!access.context.company||access.context.membership?.role!=="owner")return <AccessGate code={!access.ok&&access.code==="UNAVAILABLE"?"UNAVAILABLE":"FORBIDDEN"}/>;
 const {orderId}=await params;const companyId=access.context.company.id;
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(orderId))return <SubscriptionPaymentStatus display={{kind:"forbidden",messageKey:"order_not_found"}}/>;
 let row = null;
 try { row=await loadBillingReturnRow({requestCompanyId:companyId,orderId}); }
 catch { /* The generic unavailable/inaccessible display below does not disclose an order. */ }
 return <SubscriptionPaymentStatus display={mapBillingReturnDisplay({requestCompanyId:companyId,row})}/>;
}
