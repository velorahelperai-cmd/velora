# Bounded WhatsApp fixed acknowledgement candidate

This package is a forward compatibility candidate, not an installed production release. Apply no production SQL until the scoped recoverable backup and restore proof, fresh pinned preflight, dependency approval, and staged postflight gates are complete. Existing G03 00/10 must not be reapplied. No activation, grant, credential, provider call, or customer message is authorized by these files.

Required reviewed billing dependencies: financial-proof-cloud Stage1, Stage2A, Stage2B. Current checkout/admin application dependencies have their own reviewed packages and release gates. Apply these three WhatsApp files in order, each in its own transaction. A later stage failure does not roll back an earlier successful file. Stop on drift; preserve existing data, including new history written after a stage succeeds. No broad downgrade/drop or bulk customer re-preparation.

## Frozen SQL SHA-256

- `10-required-whatsapp.review.sql`: `c2fc0868bc5da2e83a740099c7caa39f0d1c5697f4c13b1e8eb29974e661adc2`
- `20-fixed-ack.review.sql`: `1ff7ed21bf5ddca7b14443b56c4260d5af0a6eb3f64714bf9a2f10cc759a9c28`
- `30-required-inbox.review.sql`: `00b37b53f1429de8374e9a7fc0795f5b15855e4923d50fc61a73865d6233700d`

The manifest pins six existing tables and nineteen security-relevant function definitions, ownership, RLS and effective ACLs. Function-body MD5 comparisons normalize CR characters consistently with SQL. Raw CR/LF differences were verified as normalization differences, not demonstrated production drift.

## Claim race and local evidence

A pending-job cursor could become stale while waiting for the company lock. A helper called with NULL claim could then overwrite a newly active claim. Stage20 revalidates status, retry eligibility, attempt count, response kind and active claim expiry after locking the job.

Native run20 reproduced duplicate claims: `[1,1]` instead of `[0,1]`. The separate-session concurrency test passes after the correction. Independent source review verified the frozen Stage20 hash and fix.

Native run22 executed all19 scenarios: 15 passed, 4 timed out (one15s SQL statement, two Docker inspect calls, one120s test). Host CPU was measured at100%, with Windows Defender a major consumer. Native run23 repeated only those4 cases with unchanged code, guards and SQL timeout limits:4 passed,15 deliberately filtered. Thus all19 scenarios have passing evidence across the two runs; no single all19passing run is claimed, and the original failures are retained outside the repository.

Passing scenarios cover paid/activated authority, Test/unpaid/inactive rejection, owner-session and recipient scope, duplicate/final capability replay, concurrent FIFO claims, automation revocation at claim/stage/final, held legacy quota, concurrent final-unit reservation, prior-month separation, unknown-send hold, real accepted persistence/accounting failure and repair, actual inbox isolation, and populated original history-field preservation. All database rows are synthetic in labelled, network-none, portless, tmpfs PostgreSQL containers. No Graph/model/payment transport executed.

Native command: `node node_modules/vitest/vitest.mjs run --config scripts/whatsapp-fixed-ack/postgres.optin.config.mjs --testTimeout 120000`. It requires the explicitly captured metadata file paths documented by the runner's environment checks. Targeted repeat adds `-t 'real paid and activated|automation disabled before final|receipt never creates a fixed claim:.*(paid|active)'`.

## Remaining acceptance gates

Encrypted billing/WhatsApp backup authorization and a secure existing DB connection remain pending. No backup/restore proof or production install is asserted. The controlled company UUID, reviewer membership, genuine qualifying paid Live authority, verified Meta binding, worker flags and explicit controlled-send authorization remain live rollout gates. New conversations require an owner Resume decision before a subsequent eligible inbound message. Fixed acknowledgements perform no AI call and do not fabricate an AI ledger.

History checks cover all original columns in six populated history tables. Signup tests verify status preservation/cancellation; they do not yet prove every signup field. Prior-month quota separation is covered; an intent staged across the month boundary is not. These limits remain visible before rollout.
