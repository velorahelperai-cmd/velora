import 'server-only';
import {createAdminClient} from '@/lib/supabase/admin';
import {expiryEmailText,subscriptionLifecycle} from '../lifecycle';
import {emailAddress,emailUuid} from './contracts';
import {readEmailConfig,sendSubscriptionMail} from './resend';
import {runExpiryEmail,type ExpiryEmailClaim} from './expiry-worker';
type Rpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
export function validExpiryClaim(v:unknown):v is ExpiryEmailClaim{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const c=v as ExpiryEmailClaim;
 if(!emailUuid(c.id)||!emailUuid(c.claimToken)||!emailAddress(c.recipient)||!['expired','disconnect_7d','disconnect_24h'].includes(c.kind)||typeof c.companyName!=='string'||c.companyName.length>240||typeof c.expiredAt!=='string'||typeof c.disconnectAt!=='string'||typeof c.deleteAt!=='string'||typeof c.dispatchUntil!=='string'||!Number.isFinite(Date.parse(c.dispatchUntil)))return false;
 const d=subscriptionLifecycle(c.expiredAt);return d.disconnectAt!==null&&Date.parse(c.disconnectAt)===Date.parse(d.disconnectAt)&&Date.parse(c.deleteAt)===Date.parse(d.deleteAt!);
}
export async function processExpiryEmailOutbox(){
 if(process.env.SUBSCRIPTION_EXPIRY_EMAIL_ENABLED!=='true')return {ok:false,code:'EMAIL_DISABLED'};
 const cfg=readEmailConfig(process.env);if(!cfg.ok)return cfg;
 const db=createAdminClient() as unknown as Rpc|null;if(!db)return {ok:false,code:'EMAIL_STORE_UNAVAILABLE'};
 return runExpiryEmail(true,{
  claim:async()=>{const {data,error}=await db.rpc('billing_claim_expiry_email',{});if(error||!data||typeof data!=='object'||!('ok' in data)||data.ok!==true||!('claim' in data))throw Error('STORE_UNAVAILABLE');if(data.claim===null)return null;if(!validExpiryClaim(data.claim))throw Error('CLAIM_INVALID');return data.claim;},
  authorize:async c=>{const r=await db.rpc('billing_authorize_expiry_email',{p_id:c.id,p_claim_token:c.claimToken});return !r.error&&r.data===true;},
  send:c=>sendSubscriptionMail(cfg.config,{recipient:c.recipient,idempotencyKey:`velora-expiry/${c.id}/v1`,subject:'Velora subscription expiry / انتهاء الاشتراك',text:expiryEmailText(c),notAfter:c.dispatchUntil}),
  finish:async(c,outcome)=>{const r=await db.rpc('billing_finish_expiry_email',{p_id:c.id,p_claim_token:c.claimToken,p_state:outcome.kind==='accepted'?'accepted':outcome.kind==='rejected'?'rejected':'unknown',p_provider_id:outcome.kind==='accepted'?outcome.providerId:null});return !r.error&&r.data===true;},
 });
}
