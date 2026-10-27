import 'server-only';
import {createClient} from '@/lib/supabase/server';
import {createAdminClient} from '@/lib/supabase/admin';
import {parseBusinessPhoneInput} from '@/lib/business-phone-input';
import {validatePreparation,normalizeOptionalBranchContactPhone,type Preparation} from '@/lib/tenancy/prepayment-preparation';
import {es02Uuid,type Es02Result} from './contracts';
import type {AccountCheckoutInput,AccountCheckoutData} from './account-checkout';
import {readThawaniLocalLiveConfig,createThawaniLiveSession,recoverThawaniLiveSession,readThawaniLiveSession,thawaniLiveCheckoutUrl} from './thawani-live';
import {parseAccountOrderRow} from './account-order';
import {offersEqual,resolveEs02Offer} from './commercial-offer';
import {classifyCreateOrderWriteAck} from './write-ack';
import {retainLocalLiveOperation,bindLocalLiveOrder} from './local-live-operation';
function collection(value:unknown,grantId:string){const v=value as {amountBaisa?:unknown;currency?:unknown;grantId?:unknown}|null;return v?.amountBaisa===100&&v.currency==='OMR'&&v.grantId===grantId;}
export async function beginThawaniLocalLiveCheckout(input:AccountCheckoutInput):Promise<Es02Result<AccountCheckoutData>>{
 const config=readThawaniLocalLiveConfig(process.env);
 if(!config)return {ok:false,code:'UNCONFIGURED'};
 if(input.accountId!==config.accountId)return {ok:false,code:'FORBIDDEN'};
 const resolved=resolveEs02Offer(input.selection);if(!resolved.ok)return resolved;
 if(!input.preparation||validatePreparation(input.preparation).length||input.preparation.branches.length!==1||resolved.offer.branchSlots!==1)return {ok:false,code:'INVALID_INPUT'};
 const phone=parseBusinessPhoneInput(input.preparation.phone,input.preparation.country);if(!phone.ok||!phone.value)return {ok:false,code:'INVALID_INPUT'};
 const preparation:Preparation={name:input.preparation.name.trim(),type:input.preparation.type.trim(),country:input.preparation.country,city:input.preparation.city.trim(),phone:phone.value,branches:input.preparation.branches.map(b=>{const contact=normalizeOptionalBranchContactPhone(b.contactPhone);return {name:b.name.trim(),city:b.city.trim(),...(contact.ok&&contact.value?{contactPhone:contact.value}:{})};}),...(input.preparation.answers?{answers:input.preparation.answers}:{})};
 const admin=createAdminClient();if(!admin)return {ok:false,code:'UNCONFIGURED'};
 try{
  const client=await createClient();
  const retained=await retainLocalLiveOperation(config,{clientOpId:input.clientOpId,selection:input.selection,preparation});
  const result=await client.rpc('es02_begin_thawani_live_checkout' as never,{p_expected_account_id:input.accountId,p_client_op_id:retained.clientOpId,p_term:input.selection.term,p_slots:input.selection.slots,p_preparation:preparation,p_consent_accepted:true,p_grant_id:config.grantId} as never);
  if(result.error)return {ok:false,code:'UNKNOWN'};
  const ack=classifyCreateOrderWriteAck(result.data);if(ack.status==='denied')return {ok:false,code:ack.code};if(ack.status!=='success')return {ok:false,code:'UNKNOWN'};
  const order=parseAccountOrderRow(ack.data,input.accountId);
  if(!order||order.environment!=='live'||!offersEqual(order.offer,resolved.offer)||!collection((result.data as {collection?:unknown})?.collection,config.grantId))return {ok:false,code:'UNKNOWN'};
  await bindLocalLiveOrder(config,order.orderId);
  // A completed grant is recovered through the same saved payment route.
  if(['settled','provisioned'].includes(order.status))return {ok:true,data:{order,action:ack.action,checkoutUrl:`${config.origin}/account/payment/${order.orderId}/popup`}};
  const claimed=await admin.rpc('es02_claim_thawani_live_checkout' as never,{p_account_id:input.accountId,p_order_id:order.orderId,p_auth_session_id:input.sessionId} as never);
  const claim=claimed.data as {kind?:string;token?:string;sessionId?:string}|null;
  if(claimed.error||!claim)return {ok:false,code:'UNKNOWN'};
  if(claim.kind==='ready'&&claim.sessionId)return {ok:true,data:{order,action:ack.action,checkoutUrl:thawaniLiveCheckoutUrl(config,claim.sessionId)}};
  if(!['claimed','recover'].includes(claim.kind??'')||!es02Uuid(claim.token))return {ok:false,code:'UNKNOWN'};
  const binding={reference:order.specialReference,amountBaisa:100,token:claim.token};
  // Only a newly acquired claim may POST. Every retry of an uncertain claim is GET.
  const session=claim.kind==='claimed'?await createThawaniLiveSession(config,binding,`${config.origin}/account/payment/${order.orderId}/popup`):await recoverThawaniLiveSession(config,binding);
  const saved=await admin.rpc('es02_complete_thawani_live_checkout' as never,{p_account_id:input.accountId,p_order_id:order.orderId,p_claim_token:claim.token,p_session_id:session.sessionId,p_invoice:session.invoice} as never);
  if(saved.error||saved.data!==true)return {ok:false,code:'UNKNOWN'};
  return {ok:true,data:{order,action:ack.action,checkoutUrl:thawaniLiveCheckoutUrl(config,session.sessionId)}};
 }catch{return {ok:false,code:'UNKNOWN'};}
}
export async function verifyOwnedThawaniLocalLivePayment(accountId:string,orderId:string):Promise<{ok:true;paid:boolean}|{ok:false}>{
 const config=readThawaniLocalLiveConfig(process.env);if(!config||config.accountId!==accountId||!es02Uuid(orderId))return {ok:false};
 try{
  const client=await createClient();const result=await client.rpc('es02_read_thawani_live_payment' as never,{p_expected_account_id:accountId,p_order_id:orderId} as never);
  const value=result.data as {ok?:boolean;data?:{order?:unknown;state?:string;paidAt?:string;claimToken?:string;sessionId?:string;collection?:unknown}}|null;
  const order=parseAccountOrderRow(value?.data?.order,accountId);
  if(result.error||value?.ok!==true||!order||order.orderId!==orderId||order.environment!=='live'||!collection(value.data?.collection,config.grantId))return {ok:false};
  if(value.data?.state==='paid'&&value.data.paidAt)return {ok:true,paid:true};
  if(value.data?.state!=='ready'||!value.data.sessionId||!es02Uuid(value.data.claimToken))return {ok:false};
  const session=await readThawaniLiveSession(config,value.data.sessionId,{reference:order.specialReference,amountBaisa:100,token:value.data.claimToken});
  if(session.status!=='paid')return {ok:true,paid:false};
  const admin=createAdminClient();if(!admin)return {ok:false};
  const saved=await admin.rpc('es02_record_thawani_live_payment' as never,{p_account_id:accountId,p_order_id:orderId,p_session_id:session.sessionId,p_claim_token:value.data.claimToken,p_invoice:session.invoice,p_amount_baisa:100,p_currency:'OMR'} as never);
  return !saved.error&&(saved.data as {ok?:boolean}|null)?.ok===true?{ok:true,paid:true}:{ok:false};
 }catch{return {ok:false};}
}
