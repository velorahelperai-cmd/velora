import {canUseAccountPrepDraft} from "@/lib/tenancy/account-prep-eligibility";
import {redirect} from 'next/navigation';
import {getCompanyAccess} from '@/lib/tenancy/access';
import {PrepaymentPreparation} from '@/components/app/prepayment-preparation';
import {AccessGate} from '@/components/app/access-gate';
import {localLiveReadiness} from '@/lib/billing/es02/local-live-policy';
import {readLocalLiveOperation,type LocalLiveOperation} from '@/lib/billing/es02/local-live-operation';
import type {Es02AccountOrderView} from '@/lib/billing/es02/contracts';
import {LocalLiveCheckoutRecovery} from '@/components/app/local-live-checkout-recovery';
import {createClient} from '@/lib/supabase/server';
import {parseAccountOrderRow} from '@/lib/billing/es02/account-order';
export const dynamic='force-dynamic';
export default async function Page(){
 const access=await getCompanyAccess();
 if(!access.ok){if(access.code==='UNVERIFIED')redirect('/verify-email?next=%2Faccount%2Fbusinesses%2Fnew');if(access.code==='UNAUTHENTICATED')redirect('/login?next=%2Faccount%2Fbusinesses%2Fnew');return <AccessGate code={access.code==='FORBIDDEN'?'FORBIDDEN':'UNAVAILABLE'}/>;}
 const ctx=access.context;
 if(ctx.needsProfileName)redirect('/complete-profile?next=%2Faccount%2Fbusinesses%2Fnew');
 if(!canUseAccountPrepDraft(ctx))return <AccessGate code="FORBIDDEN"/>;
 // Account-owned preparation draft is separate from business activation. Existing companies remain managed through
 // /setup; phone/payment authority is checked at its later server boundary.
 const local=localLiveReadiness(process.env);
 const liveOffer=local.configurationReady&&ctx.userId===process.env.VELORA_LOCAL_LIVE_ACCOUNT_ID;
 const checkoutNotice={ar:'المستحق الآن: ٠٫١٠٠ ر.ع فقط، دفعة واحدة على Caramela / Vision Future Investments LLC، بكامل حقوق الباقة والمدة المختارة. لا حفظ للبطاقة أو خصم متكرر.',en:'Due now: OMR0.100 only, one payment to Caramela / Vision Future Investments LLC, with full rights for your selected plan and term. No saved card or recurring charge.'};
 let recovery:{operation:LocalLiveOperation;order:Es02AccountOrderView|null}|null=null,recoveryFailed=false;
 if(liveOffer){
  try{
   const operation=await readLocalLiveOperation({accountId:ctx.userId,grantId:process.env.VELORA_LOCAL_LIVE_GRANT_ID!});
   if(operation){
    let order:Es02AccountOrderView|null=null;
    if(operation.orderId){
     const client=await createClient();const result=await client.rpc('es02_read_thawani_live_payment' as never,{p_expected_account_id:ctx.userId,p_order_id:operation.orderId} as never);
     const value=result.data as {ok?:boolean;data?:{order?:unknown;collection?:{amountBaisa?:number;currency?:string;grantId?:string}}}|null;
     if(!result.error&&value?.ok===true&&value.data?.collection?.amountBaisa===100&&value.data.collection.currency==='OMR'&&value.data.collection.grantId===operation.grantId){
      const parsed=parseAccountOrderRow(value.data.order,ctx.userId);if(parsed?.environment==='live'&&parsed.orderId===operation.orderId)order=parsed;
     }
    }
    recovery={operation,order};
   }
  }catch{recoveryFailed=true;}
 }
 if(recoveryFailed)return <AccessGate code="UNAVAILABLE"/>;
 if(recovery)return <LocalLiveCheckoutRecovery operation={recovery.operation} order={recovery.order} checkoutNotice={checkoutNotice}/>;
 return <PrepaymentPreparation key={ctx.userId} userId={ctx.userId} {...(liveOffer?{variant:'studio' as const,checkoutNotice}:{})}/>;
}
