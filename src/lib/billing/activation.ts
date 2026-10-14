/** Read contract only. All timing/readiness decisions belong to PostgreSQL. */
export type ActivationState={companyId:string;state:'waiting'|'active'|'ended'|'legacy';paymentConfirmedAt:string;entitlementCreatedAt:string;activationDeadline:string;subscriptionStartedAt:string|null;expiresAt:string|null;operationalReady:boolean;bonusDays:0|7;paused:boolean;legacy:boolean};
const timestamp=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v));
export function parseActivationState(value:unknown,companyId:string):ActivationState|null {
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const v=value as Record<string,unknown>;
 if(v.companyId!==companyId||!['waiting','active','ended','legacy'].includes(String(v.state))||!timestamp(v.paymentConfirmedAt)||!timestamp(v.entitlementCreatedAt)||!timestamp(v.activationDeadline)
  ||!(v.subscriptionStartedAt===null||timestamp(v.subscriptionStartedAt))||!(v.expiresAt===null||timestamp(v.expiresAt))||typeof v.operationalReady!=='boolean'||![0,7].includes(Number(v.bonusDays))||typeof v.bonusDays!=='number'||typeof v.paused!=='boolean'||typeof v.legacy!=='boolean')return null;
 if(v.state==='waiting'&&(v.subscriptionStartedAt!==null||v.expiresAt!==null||v.operationalReady))return null;
 if(v.state!=='waiting'&&(v.subscriptionStartedAt===null||v.expiresAt===null))return null;
 if(v.state==='ended'&&v.operationalReady)return null;
 return v as ActivationState;
}
