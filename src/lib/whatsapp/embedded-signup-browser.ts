/** Embedded Signup v5 (extras.version "v5"); FINISH proves nothing until the server verifies assets.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-5/ */
export type SignupSignal={event:"FINISH";wabaId:string;phoneNumberId:string}|{event:"CANCEL"|"ERROR"|"UNSUPPORTED"|"FINISH_ONLY_WABA"|"BUSINESS_APP_ONBOARDING"|"GRANT_ONLY"|"MULTIPLE_ACCOUNTS"|"MISSING_PHONE_NUMBER"};
export type SignupSignals={code?:string;wabaId?:string;phoneNumberId?:string};
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const numeric=(v:unknown):v is string=>typeof v==="string"&&/^\d{1,64}$/.test(v);
/** Exact HTTPS origins; browser asset IDs remain untrusted selectors for server verification. */
export function parseSignupMessage(origin:string,data:unknown):SignupSignal|null{
 if(!["https://www.facebook.com","https://web.facebook.com","https://facebook.com"].includes(origin))return null;
 let raw=data;if(typeof raw==="string"){if(raw.length>16384)return null;try{raw=JSON.parse(raw);}catch{return null;}}
 const msg=object(raw);if(msg?.type!=="WA_EMBEDDED_SIGNUP")return null;
 if(msg.event==="CANCEL"||msg.event==="ERROR")return {event:msg.event};
 if(typeof msg.event!=="string"||!msg.event.startsWith("FINISH"))return null;
 // Finished without a phone number: needs its own guidance, never success.
 if(msg.event==="FINISH_ONLY_WABA")return {event:"FINISH_ONLY_WABA"};
 // New-number route opts out of Business app onboarding; such a finish must never be accepted here.
 if(msg.event==="FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")return {event:"BUSINESS_APP_ONBOARDING"};
 if(msg.event==="FINISH_GRANT_ONLY_API_ACCESS")return {event:"GRANT_ONLY"};
 if(msg.event!=="FINISH")return {event:"UNSUPPORTED"};
 const asset=object(msg.data);if(!asset)return {event:"UNSUPPORTED"};
 if(asset.is_on_biz_app===true)return {event:"BUSINESS_APP_ONBOARDING"};
 if("is_on_biz_app" in asset&&asset.is_on_biz_app!==false)return {event:"UNSUPPORTED"};
 // v5 messaging_account_ids replaces waba_id; v4 waba_id/waba_ids still accepted. Never pick the first of several.
 const ids=new Set<string>();
 if("waba_id" in asset){if(!numeric(asset.waba_id))return {event:"UNSUPPORTED"};ids.add(asset.waba_id);}
 for(const key of ["messaging_account_ids","waba_ids"]){if(!(key in asset))continue;const list=asset[key];if(!Array.isArray(list)||list.length>100||!list.every(numeric))return {event:"UNSUPPORTED"};list.forEach(id=>ids.add(id));}
 if(ids.size>1)return {event:"MULTIPLE_ACCOUNTS"};
 const waba=[...ids][0];if(!waba)return {event:"UNSUPPORTED"};
 if(!("phone_number_id" in asset)||asset.phone_number_id===""||asset.phone_number_id===null)return {event:"MISSING_PHONE_NUMBER"};
 if(!numeric(asset.phone_number_id))return {event:"UNSUPPORTED"};return {event:"FINISH",wabaId:waba,phoneNumberId:asset.phone_number_id};
}
export function joinSignupSignals(current:SignupSignals,signal:SignupSignal|{code:string}):SignupSignals{
 if("code" in signal)return {...current,code:signal.code};if(signal.event==="FINISH")return {...current,wabaId:signal.wabaId,phoneNumberId:signal.phoneNumberId};return {};
}
export function signupLoginOptions(configId:string){return {config_id:configId,response_type:"code" as const,override_default_response_type:true,extras:{setup:{},version:"v5" as const,features:[{name:"whatsapp_business_app_onboarding" as const,enabled:false as const}]}};}
