import 'server-only';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
/** Short-lived, encrypted continuation. No token or PIN is exposed or logged. */
export type SignupPreparationBinding={accountId:string;sessionId:string;companyId:string;branchId:string;attemptId:string;generation:number;nonce:string;wabaId:string;phoneNumberId:string};
const key=(secret:string)=>createHash('sha256').update('velora:signup-preparation:v1\0'+secret).digest();
export function sealSignupPreparation(secret:string,binding:SignupPreparationBinding,token:string){
 if(!secret||!token)throw Error('SIGNUP_PREPARATION_UNAVAILABLE');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(secret),iv);
 cipher.setAAD(Buffer.from('velora:signup-preparation:v1'));
 const encrypted=Buffer.concat([cipher.update(JSON.stringify({binding,token,expires:Date.now()+5*60_000}),'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64url');
}
export function openSignupPreparation(secret:string,ticket:unknown,binding:SignupPreparationBinding):string|null{
 try{
  if(!secret||typeof ticket!=='string'||ticket.length>16_384)return null;
  const bytes=Buffer.from(ticket,'base64url');if(bytes.length<29)return null;
  const decipher=createDecipheriv('aes-256-gcm',key(secret),bytes.subarray(0,12));decipher.setAAD(Buffer.from('velora:signup-preparation:v1'));decipher.setAuthTag(bytes.subarray(12,28));
  const value=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
  if(!Number.isFinite(value.expires)||value.expires<=Date.now()||value.expires>Date.now()+5*60_000||!value.binding||!Object.entries(binding).every(([k,v])=>value.binding[k]===v)||typeof value.token!=='string'||!value.token)return null;
  return value.token;
 }catch{return null;}
}
