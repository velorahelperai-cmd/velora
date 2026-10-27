import 'server-only';
import {localLiveReadiness,LOCAL_CUSTOMER_ORIGIN,THAWANI_MINIMUM_BAISA} from './local-live-policy';
import {matchThawaniSession,type ThawaniBinding,type ThawaniSession} from './thawani-test';
const LIVE='https://checkout.thawani.om';
type Config={secretKey:string;publicKey:string;accountId:string;grantId:string;origin:typeof LOCAL_CUSTOMER_ORIGIN};
export function readThawaniLocalLiveConfig(env:Record<string,string|undefined>):Config|null{
 if(!localLiveReadiness(env).configurationReady)return null;
 const secretKey=env.THAWANI_SECRET_KEY_LIVE!.trim(),publicKey=env.THAWANI_PUBLIC_KEY_LIVE!.trim();
 if(!/^[\x21-\x7e]{8,512}$/.test(secretKey)||!/^[A-Za-z0-9_-]{8,256}$/.test(publicKey))return null;
 return {secretKey,publicKey,accountId:env.VELORA_LOCAL_LIVE_ACCOUNT_ID!,grantId:env.VELORA_LOCAL_LIVE_GRANT_ID!,origin:LOCAL_CUSTOMER_ORIGIN};
}
function validBinding(binding:ThawaniBinding){return binding.amountBaisa===THAWANI_MINIMUM_BAISA&&/^ES02-[A-Za-z0-9-]{1,100}$/.test(binding.reference)&&/^[A-Za-z0-9_-]{8,256}$/.test(binding.token);}
async function request(config:Config,path:string,init:RequestInit,http:typeof fetch){
 const response=await http(LIVE+'/api/v1'+path,{...init,headers:{'Content-Type':'application/json','thawani-api-key':config.secretKey},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20_000)});
 if(!response.ok||Number(response.headers.get('content-length'))>65536)throw Error('THAWANI_LIVE_OUTCOME_UNKNOWN');
 const text=await response.text();if(text.length>65536)throw Error('THAWANI_LIVE_OUTCOME_UNKNOWN');
 const payload=JSON.parse(text) as {success?:boolean;data?:unknown};
 if(payload?.success!==true)throw Error('THAWANI_LIVE_OUTCOME_UNKNOWN');return payload.data;
}
export function thawaniLiveCheckoutUrl(config:Config,sessionId:string){
 if(!/^checkout_[A-Za-z0-9]{8,150}$/.test(sessionId))throw Error('INVALID_LIVE_SESSION');
 const url=new URL(LIVE+'/pay/'+sessionId);url.searchParams.set('key',config.publicKey);return url.href;
}
export async function createThawaniLiveSession(config:Config,binding:ThawaniBinding,returnUrl:string,http:typeof fetch=fetch):Promise<ThawaniSession>{
 const target=new URL(returnUrl);
 if(!validBinding(binding)||target.origin!==config.origin||!/^\/account\/payment\/[0-9a-f-]{36}\/popup$/.test(target.pathname)||target.search||target.hash||target.username||target.password)throw Error('INVALID_LIVE_BINDING');
 const row=await request(config,'/checkout/session',{method:'POST',body:JSON.stringify({client_reference_id:binding.reference,mode:'payment',products:[{name:'Velora plan - one-time offer',quantity:1,unit_amount:binding.amountBaisa}],success_url:target.href,cancel_url:target.href,save_card_on_success:false,expire_in_minutes:1440,metadata:{binding:binding.token}})},http);
 const session=matchThawaniSession(row,binding);if(!session||session.status!=='unpaid')throw Error('THAWANI_LIVE_OUTCOME_UNKNOWN');return session;
}
export async function readThawaniLiveSession(config:Config,sessionId:string,binding:ThawaniBinding,http:typeof fetch=fetch){
 if(!validBinding(binding)||!/^checkout_[A-Za-z0-9]{8,150}$/.test(sessionId))throw Error('INVALID_LIVE_BINDING');
 const row=await request(config,'/checkout/session/'+sessionId,{method:'GET'},http);
 const session=matchThawaniSession(row,binding);if(!session||session.sessionId!==sessionId)throw Error('THAWANI_LIVE_OUTCOME_UNKNOWN');return session;
}
/** A timed-out create is recovered by reference, never by issuing another POST. */
export async function recoverThawaniLiveSession(config:Config,binding:ThawaniBinding,http:typeof fetch=fetch){
 if(!validBinding(binding))throw Error('INVALID_LIVE_BINDING');
 const row=await request(config,'/checkout/reference/'+encodeURIComponent(binding.reference),{method:'GET'},http);
 const session=matchThawaniSession(row,binding);if(!session)throw Error('THAWANI_LIVE_OUTCOME_UNKNOWN');return session;
}
