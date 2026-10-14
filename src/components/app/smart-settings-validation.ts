import type {Business} from '@/lib/demo-state';
/** A typing snapshot may contain incomplete contacts; only the server validates a committed profile. */
export function validSmartProfileDraft(v:unknown):v is Business{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const row=v as Record<string,unknown>,limits={name:120,type:80,country:80,city:160,hours:2000,contactPhone:40,contactEmail:254,replyLanguage:4};
 return Object.keys(row).every(k=>Object.hasOwn(limits,k))&&Object.entries(limits).every(([k,max])=>typeof row[k]==='string'&&(row[k] as string).length<=max)&&['ar','en','both'].includes(String(row.replyLanguage));
}
