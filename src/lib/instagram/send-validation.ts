import 'server-only';
import {createHash} from 'node:crypto';
import type {InstagramFreshSendClaim,InstagramSendBinding,InstagramSendFailure,InstagramSendProgress} from './send-contracts';
export const sendObject=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const sendUuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const sendMid=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=2048&&!/[\s\x00-\x1f\x7f]/.test(v);
export const sendText=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&new TextEncoder().encode(v).byteLength<=1000&&!v.includes('\0');
export const sendTextHash=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
export const sendUnavailable=():never=>{throw Error('INSTAGRAM_SEND_STORE_UNAVAILABLE');};
const keys=['companyId','actorId','sessionId','intentId','conversationId','linkId','generation','accountId','recipientId','textHash'] as const;
export function captureSendBinding(v:unknown):InstagramSendBinding{
 if(!sendObject(v)||Object.keys(v).length!==keys.length||keys.some(k=>!(k in v))||!keys.slice(0,6).every(k=>sendUuid(v[k]))
 ||!Number.isSafeInteger(v.generation)||(v.generation as number)<1||!['accountId','recipientId'].every(k=>typeof v[k]==='string'&&/^\d{1,64}$/.test(v[k] as string))
 ||typeof v.textHash!=='string'||!/^[0-9a-f]{64}$/.test(v.textHash))return sendUnavailable();
 return Object.freeze(Object.fromEntries(keys.map(k=>[k,keys.slice(0,6).includes(k as typeof keys[0])?(v[k] as string).toLowerCase():v[k]])) as InstagramSendBinding);
}
export function exactSendBinding(v:unknown,b:InstagramSendBinding){const got=captureSendBinding(v);if(keys.some(k=>got[k]!==b[k]))return sendUnavailable();return got;}
export function sendDenial(v:Record<string,unknown>):InstagramSendFailure|null{
 if(v.ok!==false)return null;
 const codes=['FORBIDDEN','NOT_FOUND','INVALID_INPUT','CONFLICT','SEND_DISABLED','ENTITLEMENT_DENIED','WINDOW_CLOSED','BINDING_CHANGED','RECONCILIATION_REQUIRED','UNAVAILABLE'];
 if(!codes.includes(String(v.code)))return sendUnavailable();return {ok:false,code:v.code as InstagramSendFailure['code']};
}
export function captureSendProgress(v:unknown,b?:InstagramSendBinding):InstagramSendProgress{
 if(!sendObject(v)||!['ready','claimed','unknown','blocked','rejected','accepted'].includes(String(v.state))||v.delivery!=='unconfirmed'
 ||(v.state==='accepted'?!sendMid(v.providerMessageId):v.providerMessageId!==null)
 ||v.projectedMessageId!==null&&(!sendUuid(v.projectedMessageId)||v.state!=='accepted'))return sendUnavailable();
 return Object.freeze({binding:b?exactSendBinding(v.binding,b):captureSendBinding(v.binding),state:v.state as InstagramSendProgress['state'],providerMessageId:v.providerMessageId as string|null,projectedMessageId:v.projectedMessageId as string|null,delivery:'unconfirmed'});
}
export function captureFreshSendClaim(v:unknown,b:InstagramSendBinding):InstagramFreshSendClaim{
 if(!sendObject(v)||v.kind!=='fresh'||v.committed!==true||!sendUuid(v.claimReceipt)||!sendText(v.text)||sendTextHash(v.text)!==b.textHash
 ||typeof v.accessToken!=='string'||!v.accessToken||v.accessToken.length>16384||/[\s\x00-\x1f\x7f]/.test(v.accessToken)
 ||typeof v.notAfter!=='string'||!Number.isFinite(Date.parse(v.notAfter)))return sendUnavailable();
 return Object.freeze({kind:'fresh',committed:true,binding:exactSendBinding(v.binding,b),claimReceipt:v.claimReceipt.toLowerCase(),text:v.text,accessToken:v.accessToken,notAfter:v.notAfter});
}
