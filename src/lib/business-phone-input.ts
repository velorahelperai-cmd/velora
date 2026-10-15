import {parsePhoneNumberFromString,getCountryCallingCode,getExampleNumber,isSupportedCountry,type CountryCode} from 'libphonenumber-js/max';
import examples from 'libphonenumber-js/mobile/examples';
export const supportedPhoneCountry=(country:string):country is CountryCode=>isSupportedCountry(country);
export const phoneCallingCode=(country:string|undefined)=>country&&supportedPhoneCountry(country)?`+${getCountryCallingCode(country)}`:'';
export function normalizePhoneEntry(value:string){return value.replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/＋/g,'+').trim().replace(/^00/,'+');}
type Parsed={ok:true;value:string;country?:CountryCode;display:string}|{ok:false;code:'INVALID'|'COUNTRY_REQUIRED'|'COUNTRY_MISMATCH'};
/** Numbering-plan validation only; never proves ownership, reachability or WhatsApp registration. */
export function parseBusinessPhoneInput(raw:string,country:string|undefined):Parsed{
 if(/[\u0000-\u001f\u007f]/.test(raw))return {ok:false,code:'INVALID'};
 const value=normalizePhoneEntry(raw),defaultCountry=country&&supportedPhoneCountry(country)?country:undefined;
 if(!value)return {ok:true,value:'',country:defaultCountry,display:''};
 if(value.length>40||!/^[+\d\s().-]+$/.test(value))return {ok:false,code:'INVALID'};
 const international=value.startsWith('+');if(!international&&!defaultCountry)return {ok:false,code:'COUNTRY_REQUIRED'};
 const parsed=parsePhoneNumberFromString(value,{defaultCountry,extract:false});
 if(!parsed||parsed.ext||!parsed.isValid()||!/^\+\d{7,15}$/.test(parsed.number))return {ok:false,code:'INVALID'};
 if(!international&&parsed.country&&parsed.country!==defaultCountry)return {ok:false,code:'COUNTRY_MISMATCH'};
 return {ok:true,value:parsed.number,country:parsed.country,display:parsed.country?parsed.formatNational():parsed.formatInternational()};
}
export function phoneCountryFromValue(value:string,fallback?:string):CountryCode|undefined{const parsed=parsePhoneNumberFromString(normalizePhoneEntry(value),{extract:false});return parsed?.country??(fallback&&supportedPhoneCountry(fallback)?fallback:undefined);}
/** Display conversion never changes the stored value or establishes a save attempt. */
export function storedPhoneDisplay(value:string,country?:string){const parsed=parsePhoneNumberFromString(normalizePhoneEntry(value),{extract:false});return parsed&&country&&parsed.country===country?parsed.formatNational():value;}
export function maskedPhoneExample(country?:string){
 if(country==='OM')return {national:'xxxx xxxx',international:'+968 xxxx xxxx'};
 if(country==='EG')return {national:'10xxxxxxxx',international:'+20 10xxxxxxxx'};
 const sample=country&&supportedPhoneCountry(country)?getExampleNumber(country,examples):undefined;
 const national=sample?sample.formatNational().replace(/\d/g,'x'):'xxxx xxxx';
 return {national,international:`${phoneCallingCode(country)||'+…'} ${national}`};
}
