import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { blocksSettlement, readBillingPaymobWiringFlags } from "./flags";
import { processStoredPaymobEvent } from "./event-process";
import { settleHmacVerifiedViaRpc } from "./store";
import { isStoredPaymobPaymentSuccess } from "./stored-observation";
/** Called only after owner access has been checked; never reads query-string payment evidence. */
export async function processOwnerOrderEvents(companyId:string,orderId:string):Promise<void>{
 if(blocksSettlement(readBillingPaymobWiringFlags())!==null)return;
 const client=createAdminClient();if(!client)return;
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const admin=client as any;
 const {data:order}=await admin.from("billing_orders").select("id,special_reference,amount_baisa,provider_account_ref").eq("id",orderId).eq("company_id",companyId).eq("provider_environment","test").maybeSingle();
 if(!order)return;
 const {data:attempts}=await admin.from("billing_payment_attempts").select("id").eq("order_id",orderId).eq("company_id",companyId);
 for(const attempt of attempts??[]){const {data:events}=await admin.from("billing_provider_events").select("id,provider_transaction_id,event_status,observation_key,raw_summary").eq("payment_attempt_id",attempt.id).eq("company_id",companyId).eq("provider_environment","test").eq("event_status","success").limit(20);
 for(const event of events??[]){if(!isStoredPaymobPaymentSuccess(event.raw_summary))continue;await processStoredPaymobEvent({deps:{settleEnabled:true,settleHmacVerified:settleHmacVerifiedViaRpc},event:{id:String(event.id),companyId,orderId,paymentAttemptId:String(attempt.id),providerTransactionId:String(event.provider_transaction_id),eventStatus:"success",providerAccountRef:String(order.provider_account_ref),specialReference:String(order.special_reference),amountBaisa:Number(order.amount_baisa),observationKey:String(event.observation_key)}});}
 }
}
