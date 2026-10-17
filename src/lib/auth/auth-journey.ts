import { safeInternalPath } from "./safe-next";
import { IDLE_TIMEOUT_MS } from "./idle-session";
/** Nonsecret browser storage identifier (not a credential). Runtime value preserved exactly. */
export const PENDING_SIGNUP_KEY=["velora","pending_signup","v1"].join("_");
export const AUTH_RETURN_COOKIE="velora_auth_return_to";
export type PendingSignup={email:string;next:string;savedAt:number};
export function authFlowHref(path:string,next?:string|null,email?:string):string{const params=new URLSearchParams(),safe=safeInternalPath(next,"");if(safe)params.set("next",safe);if(email)params.set("email",email);return params.size?`${path}?${params}`:path;}
export function serializePendingSignup(input:PendingSignup):string{return JSON.stringify({email:input.email.trim().toLowerCase(),next:safeInternalPath(input.next,""),savedAt:input.savedAt});}
export function pendingSignupFromStorage(raw:string|null,now=Date.now()):PendingSignup|null{try{const row=JSON.parse(raw??"null");if(!row||typeof row.email!=="string"||!/^\S+@\S+\.\S+$/.test(row.email)||row.email.length>254||typeof row.savedAt!=="number"||row.savedAt>now||now-row.savedAt>=IDLE_TIMEOUT_MS)return null;return {email:row.email.trim().toLowerCase(),next:safeInternalPath(row.next,""),savedAt:row.savedAt};}catch{return null;}}
export function savePendingSignup(email:string,next:string){try{sessionStorage.setItem(PENDING_SIGNUP_KEY,serializePendingSignup({email,next,savedAt:Date.now()}));}catch{}}
export function readPendingSignup(){try{return pendingSignupFromStorage(sessionStorage.getItem(PENDING_SIGNUP_KEY));}catch{return null;}}
export function clearPendingSignup(){try{sessionStorage.removeItem(PENDING_SIGNUP_KEY);}catch{}}
