import type {Es02ActivationFoundation} from '@/lib/billing/es02/contracts';
export type PaidSetupActivation=Pick<Es02ActivationFoundation,'companyId'|'orderGroupId'|'clockState'|'termUnit'|'subscriptionStartedAt'|'paidThroughAt'>;
/** A missing or mismatched native clock remains unknown, independently of launch. */
export function paidSetupActivation(value:unknown,companyId:string,orderGroupId:string|undefined):PaidSetupActivation|null{
 if(!value||typeof value!=='object'||!orderGroupId)return null;
 const v=value as PaidSetupActivation;
 const date=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(s)&&Number.isFinite(Date.parse(s));
 if(v.companyId!==companyId||v.orderGroupId!==orderGroupId||!['waiting_readiness','active','ended'].includes(v.clockState)||!['month','year'].includes(v.termUnit))return null;
 if(v.clockState==='waiting_readiness'&&(v.subscriptionStartedAt!==null||v.paidThroughAt!==null))return null;
 if(v.clockState==='active'&&(!date(v.subscriptionStartedAt)||!date(v.paidThroughAt)))return null;
 if(v.clockState==='ended'&&((v.subscriptionStartedAt!==null&&!date(v.subscriptionStartedAt))||(v.paidThroughAt!==null&&!date(v.paidThroughAt))))return null;
 return {companyId:v.companyId,orderGroupId:v.orderGroupId,clockState:v.clockState,termUnit:v.termUnit,subscriptionStartedAt:v.subscriptionStartedAt,paidThroughAt:v.paidThroughAt};
}
