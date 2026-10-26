import "server-only";
import type {ProcessingOutcome} from "./processing";
/** Historical records remain readable; no new settlement uses the retired provider. */
export async function reconcileStoredBillingEvent(eventId:string,signal?:AbortSignal):Promise<ProcessingOutcome>{void eventId;signal?.throwIfAborted();return {kind:"blocked",code:"provider_retired"};}
export async function runStoredBillingReconciliation(limit=20){void limit;return {ok:false as const,code:"provider_retired"};}
