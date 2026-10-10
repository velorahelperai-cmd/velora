import {createHmac,timingSafeEqual} from "node:crypto";
import {billingUuid} from "../wiring/public-offer-policy";
export type LedgerFilters={companyId:string|null;environment:"all"|"live"|"test"|"unknown";from:string|null;until:string|null;pageSize:number};
export type OwnerBinding={actorId:string;sessionId:string};
export type LedgerPosition={snapshot:string;createdAt:string;id:string};
const record=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:null;
const time=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
function date(v:unknown,end=false):string|null|false {if(v===undefined||v===null||v==="")return null;if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+"T00:00:00Z");if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)return false;if(end)d.setUTCDate(d.getUTCDate()+1);return d.toISOString();}
export function parseLedgerFilters(input:unknown):LedgerFilters|null {
 const v=record(input);if(!v)return null;const from=date(v.from),until=date(v.until,true),companyId=v.companyId===undefined||v.companyId===null||v.companyId===""?null:v.companyId;
 const environment=v.environment??"all",pageSize=v.pageSize??25;
 if(companyId!==null&&!billingUuid(companyId)||from===false||until===false||from&&until&&from>=until||!["all","live","test","unknown"].includes(String(environment))||!Number.isInteger(pageSize)||Number(pageSize)<1||Number(pageSize)>100||v.dateBasis!==undefined&&v.dateBasis!=="order_created")return null;
 return {companyId:companyId as string|null,environment:environment as LedgerFilters["environment"],from,until,pageSize:Number(pageSize)};
}
function signature(payload:string,filters:LedgerFilters,binding:OwnerBinding,key:string):Buffer {
 // Separate the cursor purpose from the existing credential; no key or session
 // identifier is serialized. Existing credential rotation invalidates cursors.
 const derived=createHmac("sha256",key).update("velora:owner-billing-cursor:v1").digest();
 return createHmac("sha256",derived).update(JSON.stringify([payload,filters,binding.actorId,binding.sessionId])).digest();
}
export function encodeBillingCursor(page:LedgerPosition,filters:LedgerFilters,binding:OwnerBinding,key:string):string {const payload=Buffer.from(JSON.stringify(page)).toString("base64url");return payload+"."+signature(payload,filters,binding,key).toString("hex");}
export function decodeBillingCursor(token:unknown,filters:LedgerFilters,binding:OwnerBinding,key:string):LedgerPosition|null {
 try {if(typeof token!=="string"||token.length>2000)return null;const [payload,sig,...extra]=token.split(".");if(extra.length||!/^[a-zA-Z0-9_-]+$/.test(payload)||!/^[a-f0-9]{64}$/.test(sig))return null;const expected=signature(payload,filters,binding,key),actual=Buffer.from(sig,"hex");if(!timingSafeEqual(expected,actual))return null;
 const p=record(JSON.parse(Buffer.from(payload,"base64url").toString()));if(!p||!time(p.snapshot)||!time(p.createdAt)||!billingUuid(p.id)||Date.parse(p.createdAt)>Date.parse(p.snapshot)||Object.keys(p).length!==3)return null;return p as LedgerPosition;
 }catch{return null;}
}
