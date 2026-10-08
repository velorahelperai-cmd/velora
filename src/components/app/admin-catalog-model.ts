import {validateDraft,VARIANT_CODES,type CatalogDraft,type CatalogAdminSnapshot,type VariantCode} from '@/lib/billing/catalog-backend/contract';
import { subscriptionCopy, subscriptionTiers } from './subscription-copy';
export type CatalogEditorVersion = CatalogDraft & {versionId:string;version:number;status:'draft'|'published'|'retired'};
/** Display identities are independent of immutable catalog and asset codes. */
export function catalogVariantLabel(code:VariantCode,locale:'ar'|'en'):string {
 const [persona,variant]=code.split('_') as ['noor'|'lina'|'dana','basic'|'premium'];
 const tier={noor:subscriptionTiers[0],lina:subscriptionTiers[1],dana:subscriptionTiers[2]}[persona];
 return `${tier[locale]} / ${subscriptionCopy[locale][variant]}`;
}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function catalogEditorVersions(snapshot:CatalogAdminSnapshot):CatalogEditorVersion[]|null {
 if(!Number.isSafeInteger(snapshot.revision)||snapshot.revision<1||!Array.isArray(snapshot.versions))return null;
 const rows:CatalogEditorVersion[]=[];
 for(const raw of snapshot.versions){
  if(!record(raw)||!record(raw.limits)||typeof raw.version_id!=='string'||!raw.version_id||!Number.isSafeInteger(raw.version)||Number(raw.version)<1||!['draft','published','retired'].includes(String(raw.status)))return null;
  const draft=validateDraft({...raw,automated_outbound_per_month:raw.limits.automated_outbound_per_month,feature_availability:raw.limits.feature_availability});
  if(!draft)return null;
  rows.push({...draft,versionId:raw.version_id,version:Number(raw.version),status:raw.status as CatalogEditorVersion['status']});
 }
 return rows;
}
/** Exact OMR decimals, converted to integer baisa without floating point rounding. */
export function omrInputToBaisa(text:string):number|null {
 if(!/^\d+(\.\d{1,3})?$/.test(text.trim()))return null;
 const [whole,fraction='']=text.trim().split('.');const amount=BigInt(whole)*BigInt(1000)+BigInt(fraction.padEnd(3,'0'));
 return amount>BigInt(0)&&amount<=BigInt(Number.MAX_SAFE_INTEGER)?Number(amount):null;
}
export function editorDraft(code:VariantCode,price:string,cap:string,features:CatalogDraft['feature_availability']):CatalogDraft|null {
 const amount=omrInputToBaisa(price);if(!amount||!/^\d+$/.test(cap))return null;
 return validateDraft({code,currency:'OMR',amount_baisa:amount,period_unit:'month',period_count:1,automated_outbound_per_month:Number(cap),feature_availability:features});
}
export {VARIANT_CODES};
