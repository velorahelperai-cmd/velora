import {billingUuid} from "../wiring/public-offer-policy";
export type CostReadResult<T>={ok:true;data:T}|{ok:false;code:"UNCONFIGURED"|"INVALID_INPUT"|"UNAUTHENTICATED"|"FORBIDDEN"|"CYCLE_UNAVAILABLE"|"UNAVAILABLE"};
export type CostCompanyPage={actorUserId:string;companies:{id:string;name:string}[];next:string|null};
export type CostCycleCursor={startsAt:string;id:string};
export type CostCyclePage={companyId:string;cycles:{id:string;startsAt:string;expiresAt:string}[];next:CostCycleCursor|null};
export type AdminCycleCosts={companyId:string;cycleId:string;startsAt:string;expiresAt:string;basis:"native_usage_tariff_estimate";providerFinalCost:null;unsettledAttempts:number;groups:{model:string;channel:"whatsapp"|"instagram"|null;category:"base"|"topup"|"compensation"|null;attempts:number;estimated_baisa:number}[]};
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==="object"&&!Array.isArray(v));
const instant=(v:unknown):v is string=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export function parseCostCompanyPage(value:unknown,actorId:string):CostCompanyPage|null{
 if(!object(value)||value.actorUserId!==actorId||!Array.isArray(value.companies)||value.companies.length>50||!(value.next===null||billingUuid(value.next)))return null;
 const seen=new Set<string>();for(const c of value.companies){if(!object(c)||!billingUuid(c.id)||typeof c.name!=="string"||!c.name.trim()||seen.has(c.id))return null;seen.add(c.id);}
 if(value.next!==null&&value.next!==(value.companies.at(-1) as {id?:string}|undefined)?.id)return null;
 return value as CostCompanyPage;
}
export function parseCostCyclePage(value:unknown,companyId:string):CostCyclePage|null{
 if(!object(value)||value.companyId!==companyId||!Array.isArray(value.cycles)||value.cycles.length>50)return null;
 const seen=new Set<string>();for(const c of value.cycles){if(!object(c)||!billingUuid(c.id)||!instant(c.startsAt)||!instant(c.expiresAt)||Date.parse(c.expiresAt)<=Date.parse(c.startsAt)||seen.has(c.id))return null;seen.add(c.id);}
 const next=value.next,last=value.cycles.at(-1);if(next!==null&&(!object(next)||!billingUuid(next.id)||!instant(next.startsAt)||!object(last)||next.id!==last.id||next.startsAt!==last.startsAt))return null;
 return value as CostCyclePage;
}
export function parseAdminCycleCosts(value:unknown,companyId:string,cycleId:string):AdminCycleCosts|null{
 if(!object(value)||value.companyId!==companyId||value.cycleId!==cycleId||value.basis!=="native_usage_tariff_estimate"||value.providerFinalCost!==null||!count(value.unsettledAttempts)
  ||!instant(value.startsAt)||!instant(value.expiresAt)||Date.parse(value.expiresAt)<=Date.parse(value.startsAt)||!Array.isArray(value.groups))return null;
 const keys=new Set<string>();let attempts=0,total=0;for(const g of value.groups){
  if(!object(g)||typeof g.model!=="string"||!g.model.trim()||!(g.channel===null||g.channel==="whatsapp"||g.channel==="instagram")||!(g.category===null||g.category==="base"||g.category==="topup"||g.category==="compensation")
   ||!count(g.attempts)||typeof g.estimated_baisa!=="number"||!Number.isFinite(g.estimated_baisa)||g.estimated_baisa<0||g.estimated_baisa>Number.MAX_SAFE_INTEGER)return null;
  const key=JSON.stringify([g.model,g.channel,g.category]);if(keys.has(key))return null;keys.add(key);attempts+=g.attempts;total+=g.estimated_baisa;
 }
 if(!count(attempts)||value.unsettledAttempts>attempts||!Number.isFinite(total)||total>Number.MAX_SAFE_INTEGER)return null;
 return value as AdminCycleCosts;
}
