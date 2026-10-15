import {parseBusinessPhoneInput,supportedPhoneCountry} from '@/lib/business-phone-input';
export type Preparation={name:string;type:string;phone:string;country:string;city:string;branches:{name:string;city:string}[]};
/** Deliberately has no persistence or server port. A new mount starts blank. */
export function emptyPreparation():Preparation{return {name:'',type:'',phone:'',country:'',city:'',branches:[{name:'',city:''}]};}
const text=(value:string,max=120)=>Boolean(value.trim())&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
export function validatePreparation(value:Preparation):string[]{
 const errors:string[]=[];
 for(const key of ['name','type','city'] as const)if(!text(value[key]))errors.push(key);
 if(!supportedPhoneCountry(value.country))errors.push('country');
 const phone=parseBusinessPhoneInput(value.phone,value.country);
 if(!phone.ok||!phone.value)errors.push('phone');
 if(!value.branches.length)errors.push('branches');
 const seen=new Set<string>();
 value.branches.forEach((branch,index)=>{for(const key of ['name','city'] as const)if(!text(branch[key]))errors.push(`branches.${index}.${key}`);const key=JSON.stringify([branch.name.trim().toLocaleLowerCase(),branch.city.trim().toLocaleLowerCase()]);if(seen.has(key))errors.push(`branches.${index}.duplicate`);seen.add(key);});
 return errors;
}
