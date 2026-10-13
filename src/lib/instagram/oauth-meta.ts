import 'server-only';
import {instagramConfig} from './config';
import {instagramOwnerConnectScope,instagramOwnerConnectProfile} from './connect-scope';
import type {AttemptBinding,ProviderResult} from './connection-contracts';
export type InstagramOAuthConfig=Readonly<{appId:string;appSecret:string;contractId:string;redirectUri:string;requiredPermissions:readonly string[]}>;
const required=Object.freeze(['instagram_business_basic','instagram_business_manage_messages']);
const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const text=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=16384;
const account=(v:unknown):string|null=>typeof v==='string'&&/^[0-9]{1,64}$/.test(v)?v:typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):null;
/** Server-only configuration. No WhatsApp/app-secret fallback or env rollout. */
export function readInstagramOAuthConfig(environment:Readonly<Record<string,string|undefined>>=process.env):InstagramOAuthConfig|null{
 const appId=environment.INSTAGRAM_APP_ID?.trim(),appSecret=environment.INSTAGRAM_APP_SECRET,contractId=environment.INSTAGRAM_LOGIN_CONTRACT_ID?.trim(),redirectUri=environment.INSTAGRAM_REDIRECT_URI;
 if(!appId||!/^[0-9]{1,64}$/.test(appId)||!text(appSecret)||!contractId||contractId.length>128||!redirectUri)return null;
 try{const u=new URL(redirectUri);const site=environment.NEXT_PUBLIC_SITE_URL;if(environment.NODE_ENV==='production'&&!site)return null;if(site){const s=new URL(site);const reviewedCanonicalAlias=appId==='1130181646406297'&&site==='https://velorahelper.com'&&redirectUri==='https://www.velorahelper.com/api/instagram/oauth/callback';if((s.origin!==u.origin&&!reviewedCanonicalAlias)||s.username||s.password||s.pathname!=='/'||s.search||s.hash)return null;}if(u.username||u.password||u.search||u.hash||u.pathname!=='/api/instagram/oauth/callback')return null;
  if(u.protocol!=='https:'&&!(environment.NODE_ENV!=='production'&&u.protocol==='http:'&&u.hostname==='127.0.0.1'))return null;
  return Object.freeze({appId,appSecret,contractId,redirectUri:u.href,requiredPermissions:required});
 }catch{return null;}
}
export function instagramAuthorizationUrl(cfg:InstagramOAuthConfig,state:string):string|null{
 const flags=instagramConfig();if(!flags.connectEnabled||flags.graphVersion!=='v26.0'||!/^[a-f0-9]{64}$/.test(state))return null;
 const u=new URL('https://www.instagram.com/oauth/authorize');
 for(const [k,v] of Object.entries({client_id:cfg.appId,redirect_uri:cfg.redirectUri,response_type:'code',scope:cfg.requiredPermissions.join(','),state,enable_fb_login:'false',force_reauth:'true'}))u.searchParams.set(k,v);
 return u.href;
}
/** One code POST and one long-token conversion, never HTTP retries. The server
 * credential authenticates the pinned app; exact returned professional identity,
 * permissions and provider expiry must all be proven before Vault staging.
 * Current provider response/field compatibility still requires approved fixtures
 * and live verification before activation. Missing evidence fails closed. */
export async function exchangeInstagramCode(code:string,binding:AttemptBinding,cfg:InstagramOAuthConfig,dependencies:{fetch?:typeof fetch}={}):Promise<ProviderResult>{
 let stage='preflight';
 const report=(code:string)=>{if(process.env.NODE_ENV==='production')console.info(JSON.stringify({stage,code}));};
 const rejected=(code='VALIDATION_REJECTED'):ProviderResult=>{report(code);return {ok:false,code:'REJECTED'};},unknown=(code='UNPROVEN_RESPONSE'):ProviderResult=>{report(code);return {ok:false,code:'UNKNOWN'};};
 const flags=instagramConfig();if(!instagramOwnerConnectScope(binding.companyId,binding.userId,binding.appId)||!flags.connectEnabled||flags.graphVersion!=='v26.0'||binding.appId!==cfg.appId||binding.contractId!==cfg.contractId||!text(code)||/[\x00-\x1f\x7f]/.test(code))return rejected();
 const http=dependencies.fetch??fetch;
 async function request(url:string,init:RequestInit){
  if(!instagramConfig().connectEnabled||!instagramOwnerConnectScope(binding.companyId,binding.userId,binding.appId))throw Error('INSTAGRAM_CONNECT_DISABLED');
  const response=await http(url,{...init,cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(12000)});
  if(Number(response.headers.get('content-length')??0)>65536)throw Error('PROVIDER_RESPONSE_TOO_LARGE');
  const raw=await response.text();if(Buffer.byteLength(raw,'utf8')>65536)throw Error('PROVIDER_RESPONSE_TOO_LARGE');
  const body:unknown=JSON.parse(raw);return {ok:response.ok,status:response.status,body};}
 try{
  stage='code_exchange';
  const exchanged=await request('https://api.instagram.com/oauth/access_token',{method:'POST',body:new URLSearchParams({client_id:cfg.appId,client_secret:cfg.appSecret,grant_type:'authorization_code',redirect_uri:cfg.redirectUri,code})});
  if(!exchanged.ok){return exchanged.status>=400&&exchanged.status<500&&record(exchanged.body)&&(exchanged.body.error_type==='OAuthException'||record(exchanged.body.error))?rejected('OAUTH_HTTP_'+exchanged.status):unknown('HTTP_'+exchanged.status);}
  let short=exchanged.body;if(record(short)&&Array.isArray(short.data)){if(short.data.length!==1)return rejected();short=short.data[0];}
  if(!record(short)||!text(short.access_token))return unknown();
  stage='granted_permissions';
  const id=account(short.user_id),permissions=typeof short.permissions==='string'?short.permissions.split(',').map(s=>s.trim()):short.permissions;
  if(!id||!Array.isArray(permissions)||permissions.some(p=>typeof p!=='string'||!p||p.length>128)||!cfg.requiredPermissions.every(p=>permissions.includes(p)))return rejected();
  stage='long_token_exchange';
  const issuedBefore=Date.now(),longUrl=new URL('https://graph.instagram.com/access_token');
  longUrl.searchParams.set('grant_type','ig_exchange_token');longUrl.searchParams.set('client_secret',cfg.appSecret);longUrl.searchParams.set('access_token',short.access_token);
  const upgraded=await request(longUrl.href,{method:'GET'});if(!upgraded.ok||!record(upgraded.body)||!text(upgraded.body.access_token)||!Number.isSafeInteger(upgraded.body.expires_in)||(upgraded.body.expires_in as number)<=0)return unknown();
  const expires=issuedBefore+(upgraded.body.expires_in as number)*1000;if(!Number.isSafeInteger(expires)||expires<=Date.now()||!Number.isFinite(new Date(expires).getTime()))return unknown();
  stage='profile_read';
  const me=new URL('https://graph.instagram.com/v26.0/me');me.searchParams.set('fields','user_id,username,account_type');
  const profile=await request(me.href,{method:'GET',headers:{Authorization:'Bearer '+upgraded.body.access_token}});
  if(!profile.ok||!record(profile.body))return unknown();
  const profileBody=profile.body;
  let identity:unknown=profileBody;
  if(Array.isArray(profileBody.data)){
   if(profileBody.data.length!==1||['user_id','username','account_type'].some(field=>field in profileBody))return rejected();
   identity=profileBody.data[0];
  }
  stage='profile_identity';
  if(!record(identity)||account(identity.user_id)!==id)return rejected('ACCOUNT_ID_MISMATCH');
  if(!['BUSINESS','MEDIA_CREATOR'].includes(String(identity.account_type)))return rejected('PROFESSIONAL_ACCOUNT_REQUIRED');
  if(!instagramOwnerConnectProfile(binding.companyId,binding.userId,binding.appId,identity.username))return rejected('TARGET_USERNAME_MISMATCH');
  return {ok:true,accessToken:upgraded.body.access_token,evidence:{appId:cfg.appId,accountId:id,permissions:[...new Set(permissions as string[])],expiresAt:new Date(expires).toISOString(),contractId:cfg.contractId}};
 }catch{return unknown();}
}
