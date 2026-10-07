/**
 * Internal retry entry: process stored success events → settlement.
 * Default settle flag OFF — safe to call; returns settle_disabled without external I/O.
 */

import { blocksSettlement, readBillingPaymobWiringFlags } from "@/lib/billing/wiring/flags";
import { processStoredPaymobEvent, type StoredProviderEvent } from "@/lib/billing/wiring/event-process";

export type ProcessRunnerResult =
  | { ok: true; processed: number; outcomes: Record<string, number> }
  | { ok: false; code: string };

export type ProcessRunnerDeps = {
  settleEnabled: boolean;
  loadAwaitingSuccessEvents: (limit: number) => Promise<StoredProviderEvent[]>;
  settleHmacVerified: (evidence: Record<string, unknown>) => Promise<
    | { ok: true; outcome: string }
    | { ok: false; code: string }
  >;
};

export async function runBillingEventProcessing(input: {
  deps: ProcessRunnerDeps;
  limit?: number;
}): Promise<ProcessRunnerResult> {
  const flags = readBillingPaymobWiringFlags({ settleEnabled: input.deps.settleEnabled });
  const block = blocksSettlement(flags);
  const settleEnabled = block === null && flags.settleEnabled;

  const events = await input.deps.loadAwaitingSuccessEvents(input.limit ?? 20);
  const outcomes: Record<string, number> = {};

  for (const event of events) {
    const result = await processStoredPaymobEvent({
      deps: { settleEnabled, settleHmacVerified: input.deps.settleHmacVerified },
      event,
    });
    const key = result.ok ? result.outcome : result.code;
    outcomes[key] = (outcomes[key] ?? 0) + 1;
    if (!result.ok) {
      return { ok: false, code: result.code };
    }
  }

  return { ok: true, processed: events.length, outcomes };
}
