import "server-only";
export type ClaimedProcessingJob={event_id:string;lease_token:string;attempts:number};
export type ProcessingOutcome={kind:"done"|"review"|"blocked"|"retry";code:string};
/** Retired provider: never enqueue or claim a settlement job. */
export async function enqueueStoredBillingEvent(eventId:string){void eventId;return {ok:false as const,code:"provider_retired"};}
export async function processDurableBillingJobs(settleStoredEvent:(eventId:string,signal?:AbortSignal)=>Promise<ProcessingOutcome>,limit=20){void settleStoredEvent;void limit;return {ok:false as const,code:"provider_retired"};}
