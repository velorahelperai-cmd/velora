import "server-only";
import {randomInt} from "node:crypto";
import {logEvent} from "@/lib/logging/logger.mjs";
/** Server provider adapter. Secrets and raw provider errors never cross its boundary. */
export type MetaSignupConfig={enabled:boolean;appId:string;appSecret:string;systemUserToken?:string;graphVersion:string};
export type MetaSignupInput={code:string;wabaId:string;phoneNumberId:string;pin:string;keepOnPhone:boolean};
export type MetaSignupProof={app_id:string;waba_id:string;phone_number_id:string;display_phone_number:string;scopes:string[];granular_scopes:{scope:string;target_ids:string[]}[];expires_at:number;data_access_expires_at:number;authorization_expires_at:string|null;code_verification_status:"VERIFIED";platform_type:"CLOUD_API";registered:true;subscribed:true;is_on_biz_app:false;verified_at:string};
export type MetaSignupResult={ok:true;accessToken:string;proof:MetaSignupProof}|{ok:false;code:"NEEDS_SETUP"|"INVALID_INPUT"|"META_AUTHORIZATION_REJECTED"|"META_ASSET_REJECTED"|"META_UNAVAILABLE"|"RECONCILIATION_REQUIRED"};
export type MetaFetch=(url:string,init?:RequestInit)=>Promise<Response>;
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const requiredScopes=["whatsapp_business_management","whatsapp_business_messaging"];
const id=(v:string)=>/^\d{1,64}$/.test(v);
function inspectTokenRejection(value:unknown,appId:string,wabaId?:string):string{
 const debug=object(value);
 if(!debug)return "DEBUG_DATA_MISSING";
 if(debug.is_valid!==true)return "TOKEN_INVALID";
 if(String(debug.app_id)!==appId)return "APP_ID_MISMATCH";
 const scopes=debug.scopes;
 if(!Array.isArray(scopes)||!scopes.every(x=>typeof x==="string")||!requiredScopes.every(x=>scopes.includes(x)))return "MISSING_REQUIRED_SCOPES";
 const expires=debug.expires_at,dataExpires=debug.data_access_expires_at;
 if(typeof expires!=="number"||!Number.isSafeInteger(expires)||expires<0||typeof dataExpires!=="number"||!Number.isSafeInteger(dataExpires)||dataExpires<0)return "INVALID_EXPIRY";
 if([expires,dataExpires].some(x=>x!==0&&x*1000<=Date.now()))return "TOKEN_EXPIRED";
 const granular=Array.isArray(debug.granular_scopes)?debug.granular_scopes.map(object):[];
 if(!requiredScopes.every(scope=>granular.some(g=>g?.scope===scope&&Array.isArray(g.target_ids)&&(wabaId?g.target_ids.includes(wabaId):g.target_ids.some(target=>typeof target==='string'&&/^\d{1,64}$/.test(target))))))return wabaId?"GRANULAR_WABA_NOT_GRANTED":"GRANULAR_TARGET_MISSING";
 return "VALID";
}
function validateToken(value:unknown,appId:string,wabaId?:string){
 if(inspectTokenRejection(value,appId,wabaId)!=="VALID")return null;
 const debug=object(value)!;
 return {scopes:debug.scopes as string[],expires:debug.expires_at as number,dataExpires:debug.data_access_expires_at as number};
}
function traceMetaStage(stage:string,outcome:"ok"|"rejected"|"error",startedAt:number,meta?:{code?:string;reason?:string;httpStatus?:number;graphCode?:number;graphSubcode?:number;mode?:string}){
 try{
  logEvent(outcome==="ok"?"info":"warn","whatsapp.embedded_signup.meta_stage",{
   stage,outcome,duration_ms:Math.max(0,Date.now()-startedAt),
   ...(meta?.mode?{mode:meta.mode}:{}),
   ...(meta?.code?{error_code:meta.code}:{}),
   ...(meta?.reason?{reason_code:meta.reason}:{}),
   ...(typeof meta?.httpStatus==="number"?{http_status:meta.httpStatus}:{}),
   ...(typeof meta?.graphCode==="number"?{graph_error_code:meta.graphCode}:{}),
   ...(typeof meta?.graphSubcode==="number"?{graph_error_subcode:meta.graphSubcode}:{}),
  });
 }catch{/* Diagnostics never alter provider verification. */}
}

export async function onboardMetaSignup(config:MetaSignupConfig,input:MetaSignupInput,http:MetaFetch=fetch,preparation?:{token?:string;probe?:boolean;readOnly?:boolean;autoPinAllowed?:()=>boolean;capture?:(token:string,registrationRequired:boolean)=>void}):Promise<MetaSignupResult>{
 const mode=preparation?.probe?"probe":preparation?.readOnly?"read_only":"complete";
 if(!config.enabled||!id(config.appId)||!config.appSecret||!/^v\d+\.0$/.test(config.graphVersion)||input.keepOnPhone)return {ok:false,code:"NEEDS_SETUP"};
 const appAccessToken=`${config.appId}|${config.appSecret}`; // Server-only debug credential; never return or log.
 if(!id(input.wabaId)||!id(input.phoneNumberId)||!input.code||input.code.length>4096||!(input.pin===''||/^\d{6}$/.test(input.pin)))return {ok:false,code:"INVALID_INPUT"};
 let wrote=false,currentStage="oauth_exchange",stageStarted=Date.now();
 const base=`https://graph.facebook.com/${config.graphVersion}`;
 async function request(path:string,token?:string,body?:Record<string,unknown>,query?:Record<string,string>){
  const url=new URL(`${base}/${path}`);for(const [key,value] of Object.entries(query??{}))url.searchParams.set(key,value);
  const headers:Record<string,string>={};if(token)headers.Authorization=`Bearer ${token}`;
  if(body)headers["Content-Type"]="application/json";
  // A write may have reached Meta even when the transport reports an error. Never retry here.
  if(body)wrote=true;
  const response=await http(url.toString(),{method:body?"POST":"GET",headers,body:body?JSON.stringify(body):undefined,cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!response.ok){
   let graphCode:number|undefined,graphSubcode:number|undefined;
   try{const err=object(object(await response.json())?.error);if(typeof err?.code==="number")graphCode=err.code;if(typeof err?.error_subcode==="number")graphSubcode=err.error_subcode;}catch{}
   traceMetaStage(currentStage,"error",stageStarted,{mode,code:wrote?"RECONCILIATION_REQUIRED":"META_UNAVAILABLE",reason:"HTTP_ERROR",httpStatus:response.status,graphCode,graphSubcode});
   throw Error("META_REQUEST_FAILED");
  }
  const data=object(await response.json());
  if(!data||data.error){
   const err=object(data?.error);
   traceMetaStage(currentStage,"error",stageStarted,{mode,code:wrote?"RECONCILIATION_REQUIRED":"META_UNAVAILABLE",reason:"GRAPH_ERROR_BODY",httpStatus:response.status,graphCode:typeof err?.code==="number"?err.code:undefined,graphSubcode:typeof err?.error_subcode==="number"?err.error_subcode:undefined});
   throw Error("META_RESPONSE_INVALID");
  }
  return data;
 }
 async function list(path:string,token:string){
  const values:unknown[]=[];let after:string|undefined;
  for(let page=0;page<10;page++){
   const result=await request(path,token,undefined,{limit:"100",...(after?{after}:{})});
   if(!Array.isArray(result.data))throw Error("META_LIST_INVALID");values.push(...result.data);
   const paging=object(result.paging), cursors=object(paging?.cursors);
   if(!paging?.next)return values;
   if(typeof cursors?.after!=="string"||!cursors.after||cursors.after.length>2048)throw Error("META_PAGINATION_INVALID");after=cursors.after;
  }throw Error("META_LIST_INCOMPLETE");
 }
 try{
  const exchange=preparation?.token?{access_token:preparation.token}:await request("oauth/access_token",undefined,undefined,{client_id:config.appId,client_secret:config.appSecret,code:input.code});
  if(typeof exchange.access_token!=="string"||!exchange.access_token.trim()){traceMetaStage("oauth_exchange","rejected",stageStarted,{mode,code:"META_AUTHORIZATION_REJECTED",reason:"MISSING_ACCESS_TOKEN"});return {ok:false,code:"META_AUTHORIZATION_REJECTED"};}
  const token=exchange.access_token;
  currentStage="debug_token";stageStarted=Date.now();
  const debugPayload=(await request("debug_token",appAccessToken,undefined,{input_token:token})).data;
  const tokenReason=inspectTokenRejection(debugPayload,config.appId,input.wabaId);
  if(tokenReason!=="VALID"){traceMetaStage("debug_token","rejected",stageStarted,{mode,code:"META_AUTHORIZATION_REJECTED",reason:tokenReason});return {ok:false,code:"META_AUTHORIZATION_REJECTED"};}
  currentStage="waba_lookup";stageStarted=Date.now();
  const waba=await request(input.wabaId,token,undefined,{fields:"id"});
  if(waba.id!==input.wabaId){traceMetaStage("waba_lookup","rejected",stageStarted,{mode,code:"META_ASSET_REJECTED",reason:"WABA_ID_MISMATCH"});return {ok:false,code:"META_ASSET_REJECTED"};}
  currentStage="phone_list";stageStarted=Date.now();
  const phones=await list(`${input.wabaId}/phone_numbers`,token);
  const member=phones.map(object).find(p=>p?.id===input.phoneNumberId);
  if(!member||member.code_verification_status!=="VERIFIED"){traceMetaStage("phone_list","rejected",stageStarted,{mode,code:"META_ASSET_REJECTED",reason:!member?"PHONE_NOT_IN_WABA":"PHONE_NOT_VERIFIED"});return {ok:false,code:"META_ASSET_REJECTED"};}
  const fields={fields:"id,display_phone_number,code_verification_status,platform_type,status,is_on_biz_app"};
  currentStage="phone_lookup";stageStarted=Date.now();
  let phone=await request(input.phoneNumberId,token,undefined,fields);
  if(phone.id!==input.phoneNumberId||phone.code_verification_status!=="VERIFIED"||phone.is_on_biz_app!==false){traceMetaStage("phone_lookup","rejected",stageStarted,{mode,code:"META_ASSET_REJECTED",reason:phone.is_on_biz_app!==false?"PHONE_ON_BIZ_APP":"PHONE_UNVERIFIED"});return {ok:false,code:"META_ASSET_REJECTED"};}
  const registrationRequired=phone.status!=="CONNECTED"||phone.platform_type!=="CLOUD_API";
  if(preparation?.probe){preparation.capture?.(token,registrationRequired);traceMetaStage("probe","ok",stageStarted,{mode,reason:registrationRequired?"REGISTRATION_REQUIRED":"READY"});return {ok:false,code:'RECONCILIATION_REQUIRED'};}
  if(preparation?.readOnly&&registrationRequired){traceMetaStage("read_only_check","rejected",stageStarted,{mode,code:"RECONCILIATION_REQUIRED",reason:"REGISTRATION_STILL_REQUIRED"});return {ok:false,code:'RECONCILIATION_REQUIRED'};}
  if(!preparation?.readOnly){
   if(registrationRequired&&!/^\d{6}$/.test(input.pin)&&!preparation?.autoPinAllowed?.())return {ok:false,code:'INVALID_INPUT'};
   currentStage="subscribe_app";stageStarted=Date.now();
   const subscribed=await request(`${input.wabaId}/subscribed_apps`,token,{});
   if(subscribed.success!==true){traceMetaStage("subscribe_app","rejected",stageStarted,{mode,code:"RECONCILIATION_REQUIRED",reason:"SUBSCRIBE_NOT_CONFIRMED"});return {ok:false,code:"RECONCILIATION_REQUIRED"};}
   if(registrationRequired){
    const pin=input.pin|| (preparation?.autoPinAllowed?.()?String(randomInt(0,1_000_000)).padStart(6,"0"):null);
    if(!pin)return {ok:false,code:"INVALID_INPUT"};
    currentStage="register_phone";stageStarted=Date.now();
    const registration=await request(`${input.phoneNumberId}/register`,token,{messaging_product:"whatsapp",pin});
    if(registration.success!==true){traceMetaStage("register_phone","rejected",stageStarted,{mode,code:"RECONCILIATION_REQUIRED",reason:"REGISTER_NOT_CONFIRMED"});return {ok:false,code:"RECONCILIATION_REQUIRED"};}
   }
  }
  currentStage="final_readback";stageStarted=Date.now();
  phone=await request(input.phoneNumberId,token,undefined,fields);
  const apps=await list(`${input.wabaId}/subscribed_apps`,token);
  if(!apps.some(a=>{const row=object(a);return object(row?.whatsapp_business_api_data)?.id===config.appId;})
   ||phone.id!==input.phoneNumberId||phone.code_verification_status!=="VERIFIED"||phone.platform_type!=="CLOUD_API"||phone.status!=="CONNECTED"||phone.is_on_biz_app!==false
   ||typeof phone.display_phone_number!=="string"||!phone.display_phone_number.trim()||phone.display_phone_number.length>40){traceMetaStage("final_readback","rejected",stageStarted,{mode,code:"RECONCILIATION_REQUIRED",reason:"READBACK_MISMATCH"});return {ok:false,code:"RECONCILIATION_REQUIRED"};}
  const finalToken=validateToken((await request("debug_token",appAccessToken,undefined,{input_token:token})).data,config.appId,input.wabaId);
  if(!finalToken){traceMetaStage("final_readback","rejected",stageStarted,{mode,code:"RECONCILIATION_REQUIRED",reason:"FINAL_TOKEN_INVALID"});return {ok:false,code:"RECONCILIATION_REQUIRED"};}
  const {scopes,expires,dataExpires}=finalToken;
  const deadlines=[expires,dataExpires].filter(x=>x>0);
  traceMetaStage("complete","ok",stageStarted,{mode});
  return {ok:true,accessToken:token,proof:{app_id:config.appId,waba_id:input.wabaId,phone_number_id:input.phoneNumberId,display_phone_number:phone.display_phone_number,scopes:scopes as string[],granular_scopes:requiredScopes.map(scope=>({scope,target_ids:[input.wabaId]})),expires_at:expires,data_access_expires_at:dataExpires,authorization_expires_at:deadlines.length?new Date(Math.min(...deadlines)*1000).toISOString():null,code_verification_status:"VERIFIED",platform_type:"CLOUD_API",registered:true,subscribed:true,is_on_biz_app:false,verified_at:new Date().toISOString()}};
 }catch{return {ok:false,code:wrote?"RECONCILIATION_REQUIRED":"META_UNAVAILABLE"};}
}

/** Server-only pre-asset exchange. Returns no authority to bind a WABA or send messages. */
export async function exchangeEarlyMetaAuthorization(config:MetaSignupConfig,code:string,http:MetaFetch=fetch):Promise<{ok:true;token:string}|{ok:false}>{
 if(!config.enabled||!id(config.appId)||!config.appSecret||!/^v\d+\.0$/.test(config.graphVersion)||!code.trim()||code.length>4096)return {ok:false};
 const started=Date.now();
 try{
  const url=new URL(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token`);
  url.searchParams.set('client_id',config.appId);url.searchParams.set('client_secret',config.appSecret);url.searchParams.set('code',code);
  const exchanged=await http(url.toString(),{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!exchanged.ok){traceMetaStage("early_oauth_exchange","error",started,{mode:"early",code:"META_UNAVAILABLE",reason:"HTTP_ERROR",httpStatus:exchanged.status});return {ok:false};}
  const value=object(await exchanged.json());const token=value?.access_token;
  if(typeof token!=='string'||!token||token.length>16384||value?.error){traceMetaStage("early_oauth_exchange","rejected",started,{mode:"early",code:"META_AUTHORIZATION_REJECTED",reason:"MISSING_ACCESS_TOKEN"});return {ok:false};}
  const debug=new URL(`https://graph.facebook.com/${config.graphVersion}/debug_token`);debug.searchParams.set('input_token',token);
  const checked=await http(debug.toString(),{headers:{Authorization:`Bearer ${config.appId}|${config.appSecret}`},cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!checked.ok){traceMetaStage("early_debug_token","error",started,{mode:"early",code:"META_UNAVAILABLE",reason:"HTTP_ERROR",httpStatus:checked.status});return {ok:false};}
  const debugData=object(await checked.json())?.data;
  const tokenReason=inspectTokenRejection(debugData,config.appId);
  if(tokenReason!=="VALID"){traceMetaStage("early_debug_token","rejected",started,{mode:"early",code:"META_AUTHORIZATION_REJECTED",reason:tokenReason});return {ok:false};}
  return {ok:true,token};
 }catch{return {ok:false};}
}
