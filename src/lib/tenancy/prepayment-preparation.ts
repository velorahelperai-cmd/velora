import {parseBusinessPhoneInput,supportedPhoneCountry} from '@/lib/business-phone-input';
import {normalizeOnboardingAnswers,type OnboardingAnswers} from '@/lib/tenancy/onboarding-answers';
export type PreparationBranch={name:string;city:string;contactPhone?:string;/** Current-visit editor identity, never database authority. */localId?:string};
export type Preparation={name:string;type:string;phone:string;country:string;city:string;branches:PreparationBranch[];/** Optional current-visit questions. Absence is valid. */answers?:OnboardingAnswers|null};
export type PreparationDraft=Omit<Preparation,'answers'>&{answers?:unknown};
export function createPreparationBranch():PreparationBranch{return {localId:globalThis.crypto.randomUUID(),name:'',city:''};}
export function normalizeOptionalBranchContactPhone(value:unknown):{ok:true;value:string|null}|{ok:false;code:'INVALID_BRANCH_PHONE'}{
 if(value===undefined)return {ok:true,value:null};
 if(typeof value!=='string')return {ok:false,code:'INVALID_BRANCH_PHONE'};
 const parsed=parseBusinessPhoneInput(value,undefined);
 return parsed.ok?{ok:true,value:parsed.value||null}:{ok:false,code:'INVALID_BRANCH_PHONE'};
}
/** Local blank seed. Server unpaid draft hydrate is a separate account_prep_drafts read. */
export function emptyPreparation():Preparation{return {name:'',type:'',phone:'',country:'',city:'',branches:[createPreparationBranch()]};}
const text=(value:string,max=120)=>Boolean(value.trim())&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
export function validatePreparation(value:PreparationDraft):string[]{
 const errors:string[]=[];
 for(const key of ['name','type','city'] as const)if(!text(value[key]))errors.push(key);
 if(!supportedPhoneCountry(value.country))errors.push('country');
 const phone=parseBusinessPhoneInput(value.phone,value.country);
 if(!phone.ok||!phone.value)errors.push('phone');
 if(!value.branches.length)errors.push('branches');
 const seen=new Set<string>();
 value.branches.forEach((branch,index)=>{for(const key of ['name','city'] as const)if(!text(branch[key]))errors.push(`branches.${index}.${key}`); if(!normalizeOptionalBranchContactPhone(branch.contactPhone).ok)errors.push(`branches.${index}.contactPhone`);const key=JSON.stringify([branch.name.trim().toLocaleLowerCase(),branch.city.trim().toLocaleLowerCase()]);if(seen.has(key))errors.push(`branches.${index}.duplicate`);seen.add(key);});
 if(value.answers!=null&&!normalizeOnboardingAnswers(value.answers).ok)errors.push('answers');
 return errors;
}
