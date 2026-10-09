import { processOwnerOrderEvents } from "@/lib/billing/wiring/order-event-processing";
import { getCompanyAccess } from "@/lib/tenancy/access";
import {loadBillingReturnRow} from "@/lib/billing/wiring/return-load";
import {mapBillingReturnDisplay} from "@/lib/billing/wiring/return-status";
import {AccessGate} from "@/components/app/access-gate";
import {SubscriptionPaymentStatus} from "@/components/app/subscription-payment-status";
import {readPublicCatalogBackend} from "@/lib/billing/catalog-backend/rpc";
import {offersViewFromCatalog} from "@/components/app/subscription-offers-view";
import {subscriptionReturnHref} from "@/components/app/subscription-navigation";
export default async function Page({params}:{params:Promise<{orderId:string}>}) {
 const access=await getCompanyAccess("owner");
 if(!access.ok||!access.context.company||access.context.membership?.role!=="owner")return <AccessGate code={!access.ok&&access.code==="UNAVAILABLE"?"UNAVAILABLE":"FORBIDDEN"}/>;
 const {orderId}=await params;const companyId=access.context.company.id;
 if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(orderId))return <SubscriptionPaymentStatus display={{kind:"forbidden",messageKey:"order_not_found"}}/>;
 let row = null;
 try { await processOwnerOrderEvents(companyId,orderId); row=await loadBillingReturnRow({requestCompanyId:companyId,orderId}); }
 catch { /* The generic unavailable/inaccessible display below does not disclose an order. */ }
 let subscriptionHref="/app/settings?tab=plan";
 if(row?.selection){try{subscriptionHref=subscriptionReturnHref(companyId,row,offersViewFromCatalog(await readPublicCatalogBackend()));}catch{/* Order status remains available when the catalog cannot be read. */}}
 return <SubscriptionPaymentStatus orderId={orderId} subscriptionHref={subscriptionHref} display={mapBillingReturnDisplay({requestCompanyId:companyId,row})}/>;
}
