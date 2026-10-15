import {normalizeBusinessEmail} from './tenancy/business-contacts';
/** An optional current-actor suggestion; never writes Auth or business data. */
export function accountContactEmail(userId:string,identity:{userId:string;email:string}|null|undefined,current:boolean):string{return current&&identity?.userId===userId?(normalizeBusinessEmail(identity.email)??''):'';}
