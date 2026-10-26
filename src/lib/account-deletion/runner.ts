export type Stage = 'STORAGE' | 'DATABASE' | 'AUTH' | 'VERIFY';
export type Outcome = 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
export class RejectedEffect extends Error {
  constructor(public readonly code: 'PROVIDER_REJECTED'|'SCOPE_CHANGED'|'PROTECTED_RELATION_REQUIRES_REVIEW') { super(code); }
}
export type ClaimedStep = { stage: Stage; state: string; claim: string; target: string; objects: {bucket:string;path:string;version:string}[] };
export type DeletionPort = {
  authorize(): Promise<void>;
  claim(): Promise<ClaimedStep | null>;
  inspect(step: ClaimedStep): Promise<'ABSENT' | 'PRESENT' | 'UNKNOWN' | 'CHANGED'>;
  remove(step: ClaimedStep): Promise<void>;
  finish(outcome: Outcome, code: string | null, step: ClaimedStep): Promise<void>;
};

/** One leased step per request. A stale lease is UNKNOWN, never presumed unexecuted. */
export async function runDeletionStep(port: DeletionPort): Promise<void> {
  await port.authorize();
  const step = await port.claim();
  if (!step) return;
  let outcome: Outcome = 'UNKNOWN', code: string | null = 'EFFECT_UNCONFIRMED';
  let before: Awaited<ReturnType<DeletionPort['inspect']>> = 'UNKNOWN';
  try { before = await port.inspect(step); } catch { /* unknown read */ }
  if (before === 'PRESENT') await port.authorize();
  try {
    if (before === 'ABSENT') { outcome = 'SUCCEEDED'; code = null; }
    else if (before === 'CHANGED') { outcome = 'FAILED'; code = 'SCOPE_CHANGED'; }
    else if (before === 'PRESENT') {
      await port.remove(step);
      const after = await port.inspect(step);
      if (after === 'ABSENT') { outcome = 'SUCCEEDED'; code = null; }
      else if (after === 'CHANGED') { outcome = 'FAILED'; code = 'SCOPE_CHANGED'; }
    }
  } catch (e) {
    if(e instanceof RejectedEffect){outcome='FAILED';code=e.code;}
    // Other provider exception text may contain credentials; never persist it.
  }
  await port.authorize();
  await port.finish(outcome, code, step);
}
