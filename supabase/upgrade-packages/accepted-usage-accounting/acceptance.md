# Accepted usage independent of display persistence

Local implementation and isolated acceptance only. Production SQL, provider execution, rollout, push and deployment were not authorized for this slice and were not performed.

## Cause and correction

The previous settlement and owner usage read required an outbound display message. Display persistence therefore determined whether an already accepted provider response consumed the existing original job reservation. Repair attempted the display write first, and retry/stale status writers could release or downgrade accepted usage.

Settlement now verifies the immutable original company/job/intent/subscription/period, inbound conversation and successful staged AI response/citations/generation, then settles that existing reservation independently of display. The existing reservation still enforces capacity; no allowance, billing ledger or AI budget is created by this correction. Worker settlement precedes repair, and an unavailable or thrown display repair retains accepted/completed reporting without scheduling another send. Accounting errors retain accepted receipts and the original hold for repair, rather than releasing capacity or rerunning a provider.

A globally unique canonical provider receipt prevents two intents from charging the same provider identity. Fenced receipt observations are captured before the original uniqueness/display savepoint; conflicts retain each tenant's private evidence and an unknown hold without returning another tenant's identity. Historical duplicate provider IDs refuse installation without deleting, selecting or reassigning a winner. A retained finalized attempt fence permits later proven acceptance of the same unknown attempt. A contradictory receipt after proven rejection remains disputed/held across replay; historical missing fences are not fabricated.

Accepted usage and its subscription, period, intent, AI response and citations cannot be changed by later refund, revocation, expiry, takeover, retry or repair. Locks follow company -> original subscription -> conversation -> job -> intent. Current authorization remains a dispatch concern; retrospective accounting does not need to reactivate an expired or revoked grant.

## Installation boundary

Migration: `supabase/migrations/20261010100003_accepted_usage_independent_display.sql`.
Normalized LF UTF-8 SHA-256: `975614c27eb3f58ad1a7f44d789bf0d4a0ad860e2692ad6ee7255e56ece29a68`.
Requires the staff final-dispatch slice and exact bodies/ACLs of seven existing RPCs, the persisted identity guards, correct table ownership and consistent accepted bindings. A read-only aggregate/metadata preflight is supplied alongside this document; it exposes no IDs or customer content. Installation takes bounded table locks for duplicate preflight and index creation. Any drift or historical anomaly stops the whole transaction. Cloud state has not been checked or changed in this slice.

## Verification

Commands run from the main worktree:

```powershell
node node_modules/vitest/vitest.mjs run --config scripts/service-entitlement/accepted-usage.optin.config.mjs
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next build
git diff --check
```

Focused red/green evidence: repair-before-settlement failed before the ordering fix; a thrown repair transport failed before the final catch. Their assertions require retained acceptance and no retry/provider replay.

Repository suite: 1,437 passed, 42 skipped (separate opt-in integration suites); TypeScript passed; lint passed with the pre-existing `reconcile.ts:344` unused `_result` warning; Next.js 16.3.8 production build passed with 34 pages; whitespace check passed. Final isolated PostgreSQL: 15 cases passed, plus all three negative installation probes (body drift, ACL broadening and historical duplicate refusal). The first complete run passed 14 cases but timed out on the two-company fixture under concurrent build load; rerunning alone with a 90-second fixture/test limit passed every assertion in 410 seconds. No SQL or assertion was changed for that rerun. Logs are local, ignored artifacts under `artifacts/internal-ui/accepted-usage-*`.

The opt-in suite uses verified disposable Docker PostgreSQL containers with network disabled, tmpfs and no published ports or volumes. It discards only its own historical-duplicate fixture container and cleans up its own final container. The pre-existing `velora-c2-runtime-13861eb` is untouched. Bootstrap applies historical local schema through 20261008173000 plus the four dependent service/staff slices. The separate G03 cloud compatibility package is not replayed against the generic local baseline.

Synthetic database cases cover no display/idempotent repair; forced accounting outage; invalid fence; unknown hold and proven rejection release; concurrent finalization/settlement/repair; cross-tenant duplicate provider IDs; real owner read and final existing quota slot; rollover; refund/revocation/takeover/deactivation/expiry; rollback uncertainty; company substitution/direct forged provenance; private column ACLs; late unknown acceptance; and contradictory acceptance replay. Setup also refuses changed function bodies, broadened ACLs and historical duplicate receipts. Tests compare the original AI cost ledger and budget snapshots before/after settlement. AI success, provider receipts and signed payment observations are synthetic fixture data; no model, Graph or payment provider is called.

## Remaining limits

Live acceptance and production prerequisite preflight remain unperformed and require a separately authorized deployment/QA slice. Unknown or conflicting historical receipts require reviewed evidence; this slice adds no automatic provider lookup, external retry or reconciliation scheduler. If an entire acceptance transaction rolls back after network success, the pre-existing hold remains and the job cannot dispatch again automatically. No database can preserve a response that never committed; recovery requires the original fenced provider evidence. This is bounded accounting proof, not a production launch claim.
