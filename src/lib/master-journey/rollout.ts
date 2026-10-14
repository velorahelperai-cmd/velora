import 'server-only';
/** Code can ship on the baseline schema; new contracts need an explicit rollout. */
export function masterJourneyEnabled():boolean{return process.env.VELORA_MASTER_JOURNEY_ENABLED==='true';}
