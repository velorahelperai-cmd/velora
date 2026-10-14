import {createHmac,timingSafeEqual} from "node:crypto";
import {normalizePersonalPhone,personalPhoneUuid} from "./personal-phone";
export type PersonalPhoneSmsDeliveryPort={deliver:(input:{phone:string;otp:string;idempotencyKey:string})=>Promise<{accepted:boolean}>};
export type PersonalPhoneSmsHookPort={configured:boolean;signingSecret:string;delivery:PersonalPhoneSmsDeliveryPort|null;
 consume:(input:{userId:string;phone:string;hookId:string})=>Promise<{ok:boolean;data?:Record<string,unknown>;code?:string}>;
 settle:(input:{intentId:string;deliveryReceipt:string;accepted:boolean})=>Promise<{ok:boolean;data?:Record<string,unknown>}>};
function failure(status:number){return Response.json({error:{http_code:status,message:status===503?"SMS delivery is not configured or its result is unknown":"SMS hook request rejected"}},{status,headers:{"Cache-Control":"no-store"}});}
function signingKey(secret:string){const encoded=secret.replace(/^(?:v1,)?whsec_/,"");if(encoded===secret||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))return null;const bytes=Buffer.from(encoded,"base64");return bytes.length>=24&&bytes.length<=64&&bytes.toString("base64")===encoded?bytes:null;}
export function verifyPersonalPhoneHookSignature(body:Uint8Array,headers:Headers,secret:string,now=Date.now()):string|null{
 const key=signingKey(secret),id=headers.get("webhook-id")??"",timestamp=headers.get("webhook-timestamp")??"",signatures=headers.get("webhook-signature")??"";
 if(!key||!/^[-A-Za-z0-9_]{1,128}$/.test(id)||!/^\d{1,12}$/.test(timestamp)||signatures.length>4096||Math.abs(now/1000-Number(timestamp))>300)return null;
 const expected=createHmac("sha256",key).update(`${id}.${timestamp}.`).update(body).digest("base64"),a=Buffer.from(expected);
 return signatures.split(/\s+/).some(signature=>{if(!signature.startsWith("v1,"))return false;const b=Buffer.from(signature.slice(3));return a.length===b.length&&timingSafeEqual(a,b);})?id:null;
}
async function boundedBody(request:Request):Promise<Uint8Array|null>{
 if(Number(request.headers.get("content-length"))>32768)return null;
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();const chunks:Uint8Array[]=[];let length=0;
 try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>32768){await reader.cancel();return null;}chunks.push(next.value);}return Buffer.concat(chunks);}finally{reader.releaseLock();}
}
/** Authenticate bytes, consume durable capability, then invoke the chosen port once.
 * No raw body/OTP/provider error is logged, persisted, returned or automatically retried. */
export async function handlePersonalPhoneSmsHook(request:Request,port:PersonalPhoneSmsHookPort):Promise<Response>{
 if(!port.configured||!port.delivery||!signingKey(port.signingSecret))return failure(503);
 try{
  const bytes=await boundedBody(request);if(!bytes)return failure(413);
  const hookId=verifyPersonalPhoneHookSignature(bytes,request.headers,port.signingSecret);if(!hookId)return failure(401);
  let payload:unknown;try{payload=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{return failure(400);}
  if(!payload||typeof payload!=="object")return failure(400);
  const p=payload as {user?:{id?:unknown;phone_change?:unknown;new_phone?:unknown;phone?:unknown};sms?:{phone?:unknown;otp?:unknown}};
  if(!personalPhoneUuid(p.user?.id)||typeof p.sms?.otp!=="string"||!/^\d{6}$/.test(p.sms.otp))return failure(400);
  const rawPending=p.user.new_phone??p.user.phone_change;
  const rawTarget=p.sms.phone??rawPending??p.user.phone;
  const phone=typeof rawTarget==="string"?normalizePersonalPhone(rawTarget.startsWith("+")?rawTarget:`+${rawTarget}`):null;
  if(!phone)return failure(400);
  if(p.sms.phone!==undefined&&rawPending){const pending=String(rawPending),current=typeof p.user.phone==="string"?p.user.phone:"";
   if(normalizePersonalPhone(pending.startsWith("+")?pending:`+${pending}`)!==phone&&normalizePersonalPhone(current.startsWith("+")?current:`+${current}`)!==phone)return failure(400);}
  const claim=await port.consume({userId:p.user.id,phone,hookId});
  if(!claim.ok)return failure(claim.code==="UNCONFIGURED"?503:403);
  if(claim.data?.dispatch===false)return claim.data.accepted===true?new Response(null,{status:200,headers:{"Cache-Control":"no-store"}}):failure(503);
  if(claim.data?.dispatch!==true||!personalPhoneUuid(claim.data.intentId)||!personalPhoneUuid(claim.data.deliveryReceipt))return failure(503);
  let accepted=false;try{accepted=(await port.delivery.deliver({phone,otp:p.sms.otp,idempotencyKey:claim.data.intentId})).accepted===true;}catch{/* Durable consumed reservation prevents a timeout retry from dispatching again. */}
  const settled=await port.settle({intentId:claim.data.intentId,deliveryReceipt:claim.data.deliveryReceipt,accepted});
  return accepted&&settled.ok&&settled.data?.accepted===true?new Response(null,{status:200,headers:{"Cache-Control":"no-store"}}):failure(503);
 }catch{return failure(503);}
}
