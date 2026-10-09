import "server-only";
/** Server provider adapter. Secrets and raw provider errors never cross its boundary. */
export type MetaSignupConfig={enabled:boolean;appId:string;appSecret:string;systemUserToken:string;graphVersion:string};
export type MetaSignupInput={code:string;wabaId:string;phoneNumberId:string;pin:string;keepOnPhone:boolean};
export type MetaSignupProof={app_id:string;waba_id:string;phone_number_id:string;display_phone_number:string;scopes:string[];granular_scopes:{scope:string;target_ids:string[]}[];expires_at:number;data_access_expires_at:number;authorization_expires_at:string|null;code_verification_status:"VERIFIED";platform_type:"CLOUD_API";registered:true;subscribed:true;is_on_biz_app:false;verified_at:string};
export type MetaSignupResult={ok:true;accessToken:string;proof:MetaSignupProof}|{ok:false;code:"NEEDS_SETUP"|"INVALID_INPUT"|"META_AUTHORIZATION_REJECTED"|"META_ASSET_REJECTED"|"META_UNAVAILABLE"|"RECONCILIATION_REQUIRED"};
export type MetaFetch=(url:string,init?:RequestInit)=>Promise<Response>;
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const requiredScopes=["whatsapp_business_management","whatsapp_business_messaging"];
const id=(v:string)=>/^\d{1,64}$/.test(v);
function validateToken(value:unknown,appId:string,wabaId:string){
 const debug=object(value),scopes=debug?.scopes,expires=debug?.expires_at,dataExpires=debug?.data_access_expires_at;
 const granular=Array.isArray(debug?.granular_scopes)?debug.granular_scopes.map(object):[];
 if(!debug||debug.is_valid!==true||String(debug.app_id)!==appId||!Array.isArray(scopes)||!scopes.every(x=>typeof x==="string")||!requiredScopes.every(x=>scopes.includes(x))
 ||typeof expires!=="number"||!Number.isSafeInteger(expires)||expires<0||typeof dataExpires!=="number"||!Number.isSafeInteger(dataExpires)||dataExpires<0
 ||[expires,dataExpires].some(x=>x!==0&&x*1000<=Date.now())
 ||!requiredScopes.every(scope=>granular.some(g=>g?.scope===scope&&Array.isArray(g.target_ids)&&g.target_ids.includes(wabaId))))return null;
 return {scopes:scopes as string[],expires,dataExpires};
}

export async function onboardMetaSignup(config:MetaSignupConfig,input:MetaSignupInput,http:MetaFetch=fetch):Promise<MetaSignupResult>{
 if(!config.enabled||!id(config.appId)||!config.appSecret||!config.systemUserToken||!/^v\d+\.0$/.test(config.graphVersion)||input.keepOnPhone)return {ok:false,code:"NEEDS_SETUP"};
 if(!id(input.wabaId)||!id(input.phoneNumberId)||!input.code||input.code.length>4096||!/^\d{6}$/.test(input.pin))return {ok:false,code:"INVALID_INPUT"};
 let wrote=false;
 const base=`https://graph.facebook.com/${config.graphVersion}`;
 async function request(path:string,token?:string,body?:Record<string,unknown>,query?:Record<string,string>){
  const url=new URL(`${base}/${path}`);for(const [key,value] of Object.entries(query??{}))url.searchParams.set(key,value);
  const headers:Record<string,string>={};if(token)headers.Authorization=`Bearer ${token}`;
  if(body)headers["Content-Type"]="application/json";
  // A write may have reached Meta even when the transport reports an error. Never retry here.
  if(body)wrote=true;
  const response=await http(url.toString(),{method:body?"POST":"GET",headers,body:body?JSON.stringify(body):undefined,cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error("META_REQUEST_FAILED");
  const data=object(await response.json());if(!data||data.error)throw Error("META_RESPONSE_INVALID");return data;
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
  const exchange=await request("oauth/access_token",undefined,undefined,{client_id:config.appId,client_secret:config.appSecret,code:input.code});
  if(typeof exchange.access_token!=="string"||!exchange.access_token.trim())return {ok:false,code:"META_AUTHORIZATION_REJECTED"};
  const token=exchange.access_token;
  if(!validateToken((await request("debug_token",config.systemUserToken,undefined,{input_token:token})).data,config.appId,input.wabaId))return {ok:false,code:"META_AUTHORIZATION_REJECTED"};
  const waba=await request(input.wabaId,token,undefined,{fields:"id"});
  if(waba.id!==input.wabaId)return {ok:false,code:"META_ASSET_REJECTED"};
  const phones=await list(`${input.wabaId}/phone_numbers`,token);
  const member=phones.map(object).find(p=>p?.id===input.phoneNumberId);
  if(!member||member.code_verification_status!=="VERIFIED")return {ok:false,code:"META_ASSET_REJECTED"};
  const fields={fields:"id,display_phone_number,code_verification_status,platform_type,status,is_on_biz_app"};
  let phone=await request(input.phoneNumberId,token,undefined,fields);
  if(phone.id!==input.phoneNumberId||phone.code_verification_status!=="VERIFIED"||phone.is_on_biz_app!==false)return {ok:false,code:"META_ASSET_REJECTED"};
  const subscribed=await request(`${input.wabaId}/subscribed_apps`,token,{});
  if(subscribed.success!==true)return {ok:false,code:"RECONCILIATION_REQUIRED"};
  if(phone.status!=="CONNECTED"||phone.platform_type!=="CLOUD_API"){
   const registration=await request(`${input.phoneNumberId}/register`,token,{messaging_product:"whatsapp",pin:input.pin});
   if(registration.success!==true)return {ok:false,code:"RECONCILIATION_REQUIRED"};
  }
  phone=await request(input.phoneNumberId,token,undefined,fields);
  const apps=await list(`${input.wabaId}/subscribed_apps`,token);
  if(!apps.some(a=>{const row=object(a);return object(row?.whatsapp_business_api_data)?.id===config.appId;})
   ||phone.id!==input.phoneNumberId||phone.code_verification_status!=="VERIFIED"||phone.platform_type!=="CLOUD_API"||phone.status!=="CONNECTED"||phone.is_on_biz_app!==false
   ||typeof phone.display_phone_number!=="string"||!phone.display_phone_number.trim()||phone.display_phone_number.length>40)return {ok:false,code:"RECONCILIATION_REQUIRED"};
  const finalToken=validateToken((await request("debug_token",config.systemUserToken,undefined,{input_token:token})).data,config.appId,input.wabaId);
  if(!finalToken)return {ok:false,code:"RECONCILIATION_REQUIRED"};
  const {scopes,expires,dataExpires}=finalToken;
  const deadlines=[expires,dataExpires].filter(x=>x>0);
  return {ok:true,accessToken:token,proof:{app_id:config.appId,waba_id:input.wabaId,phone_number_id:input.phoneNumberId,display_phone_number:phone.display_phone_number,scopes:scopes as string[],granular_scopes:requiredScopes.map(scope=>({scope,target_ids:[input.wabaId]})),expires_at:expires,data_access_expires_at:dataExpires,authorization_expires_at:deadlines.length?new Date(Math.min(...deadlines)*1000).toISOString():null,code_verification_status:"VERIFIED",platform_type:"CLOUD_API",registered:true,subscribed:true,is_on_biz_app:false,verified_at:new Date().toISOString()}};
 }catch{return {ok:false,code:wrote?"RECONCILIATION_REQUIRED":"META_UNAVAILABLE"};}
}
