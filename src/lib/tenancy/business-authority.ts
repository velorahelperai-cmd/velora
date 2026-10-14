import type {Business} from '@/lib/demo-state';
import {validDraftBusiness} from './setup-draft';
export type BusinessWriteCode='UNAUTHENTICATED'|'UNVERIFIED'|'FORBIDDEN'|'INVALID_INPUT'|'CONFLICT'|'PHONE_REQUIRED'|'DRAFT_ACTIVE'|'REVIEW_REQUIRED'|'THROTTLED'|'UNCONFIGURED'|'UNAVAILABLE';
export type BusinessWriteResult<T>={ok:true;data:T}|{ok:false;code:BusinessWriteCode;currentVersion?:number};
export const businessWriteCodes:BusinessWriteCode[]=['UNAUTHENTICATED','UNVERIFIED','FORBIDDEN','INVALID_INPUT','CONFLICT','PHONE_REQUIRED','DRAFT_ACTIVE','REVIEW_REQUIRED','THROTTLED','UNCONFIGURED','UNAVAILABLE'];
export const businessUuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function businessWritePayload(value:unknown):Business|null{
 if(!validDraftBusiness(value)||!value.name.trim()||!value.type.trim()||!value.country.trim())return null;
 return {...value,name:value.name.trim(),country:value.country.trim()};
}
