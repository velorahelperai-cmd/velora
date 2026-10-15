export type CycleCreditUnits={granted:number;consumed:number;held:number;forfeited:number;expired:number;remaining:number};
export type CycleCreditSnapshot={companyId:string;cycleId:string;subscriptionId:string;startsAt:string;expiresAt:string;active:boolean;baseCap:500|1500;credits:Record<"base"|"topup"|"compensation",CycleCreditUnits>;totalConsumed:number;totalRemaining:number;topupConfiguration:"CONFIGURED"|"UNCONFIGURED";compensationConfiguration:"CONFIGURED"|"UNCONFIGURED";usageNotices?:{threshold:80|100;state:"pending"|"sent"}[]};
export function cycleCreditSnapshot(value:unknown,companyId:string):CycleCreditSnapshot|null{
 if(!value||typeof value!=="object"||Array.isArray(value))return null;const s=value as CycleCreditSnapshot;
 if(s.companyId!==companyId||typeof s.cycleId!=="string"||typeof s.subscriptionId!=="string"||typeof s.active!=="boolean"||![500,1500].includes(s.baseCap)
  ||typeof s.startsAt!=="string"||typeof s.expiresAt!=="string"||!Number.isFinite(Date.parse(s.startsAt))||!Number.isFinite(Date.parse(s.expiresAt))||Date.parse(s.expiresAt)<=Date.parse(s.startsAt)
  ||![s.topupConfiguration,s.compensationConfiguration].every(c=>c==="CONFIGURED"||c==="UNCONFIGURED")||!s.credits)return null;
 if(s.usageNotices!==undefined&&(!Array.isArray(s.usageNotices)||s.usageNotices.some(n=>!n||![80,100].includes(n.threshold)||!["pending","sent"].includes(n.state))))return null;
 let consumed=0,remaining=0;
 for(const kind of ["base","topup","compensation"] as const){const n=s.credits[kind];if(!n||![n.granted,n.consumed,n.held,n.forfeited,n.expired,n.remaining].every(v=>Number.isSafeInteger(v)&&v>=0)
   ||n.granted!==n.consumed+n.held+n.forfeited+n.expired+n.remaining)return null;consumed+=n.consumed;remaining+=n.remaining;}
 return consumed===s.totalConsumed&&remaining===s.totalRemaining&&(s.active||remaining===0)?s:null;
}
