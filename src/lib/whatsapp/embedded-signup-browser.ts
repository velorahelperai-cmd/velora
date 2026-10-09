export type SignupSignal={event:"FINISH";wabaId:string;phoneNumberId:string}|{event:"CANCEL"|"ERROR"|"UNSUPPORTED"};
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
 if(msg.event!=="FINISH")return {event:"UNSUPPORTED"};
 const asset=object(msg.data);const waba=asset?.waba_id??(Array.isArray(asset?.waba_ids)&&asset.waba_ids.length===1?asset.waba_ids[0]:null);
 if(!numeric(waba)||!numeric(asset?.phone_number_id))return {event:"UNSUPPORTED"};return {event:"FINISH",wabaId:waba,phoneNumberId:asset.phone_number_id};
}
export function joinSignupSignals(current:SignupSignals,signal:SignupSignal|{code:string}):SignupSignals{
 if("code" in signal)return {...current,code:signal.code};if(signal.event==="FINISH")return {...current,wabaId:signal.wabaId,phoneNumberId:signal.phoneNumberId};return {};
}
export function signupLoginOptions(configId:string){return {config_id:configId,response_type:"code" as const,override_default_response_type:true,extras:{setup:{}}};}
