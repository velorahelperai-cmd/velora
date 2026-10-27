import {es02Uuid} from './contracts';
export const LOCAL_CUSTOMER_ORIGIN='http://127.0.0.1:3330';
export const THAWANI_MINIMUM_BAISA=100;
export function localLiveRequested(env:Record<string,string|undefined>){return env.VELORA_LOCAL_CUSTOMER_MODE==='live';}
export function localLiveReadiness(env:Record<string,string|undefined>){
 const blockers:string[]=[];
 const local=env.NODE_ENV==='development'&&env.NEXT_PUBLIC_SITE_URL===LOCAL_CUSTOMER_ORIGIN;
 if(!local||!localLiveRequested(env))blockers.push('LOCAL_LIVE_NOT_ENABLED');
 if(!es02Uuid(env.VELORA_LOCAL_LIVE_ACCOUNT_ID))blockers.push('ACCOUNT_NOT_BOUND');
 if(!es02Uuid(env.VELORA_LOCAL_LIVE_GRANT_ID))blockers.push('PRICE_EXCEPTION_NOT_BOUND');
 if(env.VELORA_LOCAL_LIVE_APPROVED_BAISA!==String(THAWANI_MINIMUM_BAISA))blockers.push('AMOUNT_APPROVAL_REQUIRED');
 if(!env.THAWANI_SECRET_KEY_LIVE?.trim()||!env.THAWANI_PUBLIC_KEY_LIVE?.trim())blockers.push('LIVE_KEYS_REQUIRED');
 if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||!env.SUPABASE_SERVICE_ROLE_KEY)blockers.push('LOCAL_SUPABASE_CONFIG_REQUIRED');
 if(!env.VELORA_SESSION_BROKER_KEY)blockers.push('LOCAL_SESSION_KEY_REQUIRED');
 return {local,mode:'live' as const,currency:'OMR' as const,minimumBaisa:THAWANI_MINIMUM_BAISA,merchantExpected:'Caramela / Vision Future Investments LLC',configurationReady:blockers.length===0,blockers};
}
