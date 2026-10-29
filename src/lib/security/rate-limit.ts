import 'server-only';
import {createHmac} from 'node:crypto';
import {isIP} from 'node:net';
import {headers} from 'next/headers';
import {createAdminClient} from '@/lib/supabase/admin';
import {logEvent} from '@/lib/logging/logger.mjs';

export type RateEndpoint='checkout'|'invitation'|'ai_trial'|'auth_login'|'otp_verify'|'otp_resend'|'auth_signup';
export type RateDecision={allowed:true}|{allowed:false;code:'RATE_LIMITED'|'UNAVAILABLE';httpStatus:429|503;retryAfterSeconds:number};
type Receipt={allowed:boolean;mode:'monitor'|'enforce';exceeded:boolean;retryAfterSeconds:number;replayed:boolean};
export function rateDecision(value:unknown,enforce:boolean):RateDecision|null{
 const r=value as Receipt|null;
 if(!r||typeof r.allowed!=='boolean'||!['monitor','enforce'].includes(r.mode)||typeof r.exceeded!=='boolean'||typeof r.replayed!=='boolean'||!Number.isSafeInteger(r.retryAfterSeconds)||r.retryAfterSeconds<0||r.retryAfterSeconds>86400)return null;
 if(r.allowed!==(r.mode==='monitor'||!r.exceeded)||r.replayed&&(!r.allowed||r.exceeded||r.retryAfterSeconds!==0))return null;
 if(r.allowed)return {allowed:true};
 if(r.mode!=='enforce'||!r.exceeded||r.retryAfterSeconds<1)return null;
 return enforce?{allowed:false,code:'RATE_LIMITED',httpStatus:429,retryAfterSeconds:r.retryAfterSeconds}:{allowed:true};
}
/** Settings: DB policy controls threshold/mode. Global server switch enables
 * enforcement and fail-closed store failures; default rollout observes only.
 * Existing native Auth throttles, payment CAS and AI budget reservations remain.
 */
export async function checkRateLimit(endpoint:RateEndpoint,subject:string|null,input:{accountId?:string;operationId?:string}={}):Promise<RateDecision>{
 const enforce=process.env.VELORA_RATE_LIMIT_ENFORCE==='true';
 const unavailable=():RateDecision=>enforce?{allowed:false,code:'UNAVAILABLE',httpStatus:503,retryAfterSeconds:5}:{allowed:true};
 try{
  const key=process.env.VELORA_RATE_LIMIT_HASH_KEY||process.env.VELORA_SESSION_BROKER_KEY;
  if(!subject||subject.length>512||!key)throw Error('RATE_CONTEXT_UNAVAILABLE');
  const subjectHash=createHmac('sha256',key).update('velora.rate.v1\0'+endpoint+'\0'+subject).digest('hex');
  const client=createAdminClient();if(!client)throw Error('RATE_STORE_UNAVAILABLE');
  const {data,error}=await client.rpc('security_consume_rate_limit' as never,{p_endpoint:endpoint,p_subject_hash:subjectHash,p_account_id:input.accountId??null,p_operation_id:input.operationId??null} as never).abortSignal(AbortSignal.timeout(3000));
  const result=!error?rateDecision(data,enforce):null;
  if(!result)throw Error('RATE_STORE_UNAVAILABLE');
  if((data as unknown as Receipt).exceeded)logEvent('warn','security.rate.observed',{endpoint,enforced:!result.allowed});
  return result;
 }catch{
  logEvent('warn','security.rate.unavailable',{endpoint,enforced:enforce});
  return unavailable();
 }
}
/** Trust only the Vercel-provided single IP, never arbitrary forwarded chains.
 * Local requests stay observation-only unless a trusted ingress is configured.
 */
export async function checkAuthRateLimit(endpoint:Extract<RateEndpoint,'auth_login'|'otp_verify'|'otp_resend'|'auth_signup'>):Promise<RateDecision>{
 let ip:string|null=null;
 try{if(process.env.VERCEL==='1'){const candidate=(await headers()).get('x-vercel-forwarded-for')?.trim();if(candidate&&isIP(candidate))ip=candidate;}}catch{/* Missing request context is not trusted. */}
 return checkRateLimit(endpoint,ip?`ip:${ip}`:null);
}
