import {setupUuid} from './smart-onboarding';
export type SmartStartFields={name:string;type:string;country:string};
export type SmartStartAttempt={id:string;fields:SmartStartFields};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function fields(v:unknown):v is SmartStartFields{
  return record(v)&&(['name','type','country'] as const).every(k=>typeof v[k]==='string'&&v[k].length<=(k==='name'?120:80)&&!/[\u0000-\u001f\u007f]/.test(v[k]));
}
/** Corrupt/foreign storage never establishes an actor or a new creation attempt. */
export function parseSmartStartStorage(value:unknown,userId:string):{fields:SmartStartFields;attempt?:SmartStartAttempt}|null{
  if(!record(value)||value.userId!==userId||!fields(value.fields))return null;
  if(value.attempt===undefined)return {fields:value.fields};
  if(!record(value.attempt)||!setupUuid(value.attempt.id)||!fields(value.attempt.fields)
    ||Object.values(value.attempt.fields).some(v=>!v.trim()))return null;
  return {fields:value.attempt.fields,attempt:{id:value.attempt.id,fields:value.attempt.fields}};
}
