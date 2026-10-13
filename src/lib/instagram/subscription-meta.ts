import 'server-only';
import {instagramConfig} from './config';

export type InstagramSubscriptionInput=Readonly<{accountId:string;accessToken:string}>;
export type InstagramSubscriptionOutcome='verified'|'rejected'|'unknown';
/** Reviewed Meta setup contract (2026-09-16): Instagram Login, Instagram User
 * token, professional-account subscribed_apps, messages only, success:true.
 * https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
 * No HTTP retry, GET-response inference, echo subscription or message dispatch. */
export async function subscribeInstagramMessages(input:InstagramSubscriptionInput,dependencies:{fetch?:typeof fetch}={}):Promise<InstagramSubscriptionOutcome>{
 const cfg=instagramConfig();
 if(!cfg.connectEnabled||cfg.graphVersion!=='v26.0')return 'unknown';
 const accountId=input.accountId,accessToken=input.accessToken;
 if(typeof accountId!=='string'||!/^\d{1,64}$/.test(accountId)||typeof accessToken!=='string'||!accessToken||accessToken.length>16384||/[\s\x00-\x1f\x7f]/.test(accessToken))return 'unknown';
 const url=new URL(`https://graph.instagram.com/${cfg.graphVersion}/${accountId}/subscribed_apps`);
 url.searchParams.set('subscribed_fields','messages');
 // Match the reviewed provider request exactly. Never log this secret-bearing URL.
 url.searchParams.set('access_token',accessToken);
 try{
  const response=await(dependencies.fetch??fetch)(url.href,{method:'POST',cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(12000)});
  if(Number(response.headers.get('content-length')??0)>65536)return 'unknown';
  const raw=await response.text();if(Buffer.byteLength(raw,'utf8')>65536)return 'unknown';
  const body:unknown=JSON.parse(raw);
  if(!body||typeof body!=='object'||Array.isArray(body))return 'unknown';
  const data=body as Record<string,unknown>;
  if(response.ok)return Object.keys(data).length===1&&data.success===true?'verified':'unknown';
  const error=data.error;
  // Only a definite provider 4xx error is rejection. Diagnostics never leave here.
  return response.status>=400&&response.status<500&&error!==null&&typeof error==='object'&&!Array.isArray(error)?'rejected':'unknown';
 }catch{return 'unknown';}
}
