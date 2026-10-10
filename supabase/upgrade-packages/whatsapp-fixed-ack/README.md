# Bounded WhatsApp fixed acknowledgement candidate

This package is a forward compatibility candidate, not an installed production release. Apply no production SQL until the scoped recoverable backup and restore proof, fresh pinned preflight, dependency approval, and staged postflight gates are complete. Existing G03 00/10 must not be reapplied. No activation, grant, credential, provider call, or customer message is authorized by these files.

Combined application order: financial-proof-cloud Stage1 → Stage2A → company-timezone prerequisite → Stage2B → checkout-slice1 → admin-billing-ledger → WhatsApp 10 → 20 → 30. Checkout/admin must precede WhatsApp 10: its additive `whatsapp_worker_subscription_company_uidx` changes their earlier exact financial-table preflight contract. Keep every frozen SQL file and pin unchanged.

Required reviewed billing dependencies: financial-proof-cloud Stage1, Stage2A, Stage2B. Current checkout/admin application dependencies have their own reviewed packages and release gates. Apply these three WhatsApp files in order, each in its own transaction. A later stage failure does not roll back an earlier successful file. Stop on drift; preserve existing data, including new history written after a stage succeeds. No broad downgrade/drop or bulk customer re-preparation.

## Resume and final verification

Record the hash and committed postflight checkpoint after each successful transaction. On failure, inspect the failed transaction and fresh metadata; preserve all earlier committed stages and history. Resume only the next uncommitted stage after its exact prerequisite matches. Do not replay committed installers or their earlier preflight contracts against the final schema. An uncertain commit outcome requires read-only inspection before any retry.

Final verification checks the combined schema, including the WhatsApp worker subscription index and foreign key plus the unchanged checkout/admin function bodies, owner, search path and ACL. New inbox sequences must continue forward after a failed transaction; gaps are valid and must not be rewound. A pre-release backup is recovery evidence, not permission to restore stale data over newer private history.

## Frozen SQL SHA-256

- `10-required-whatsapp.review.sql`: `c2fc0868bc5da2e83a740099c7caa39f0d1c5697f4c13b1e8eb29974e661adc2`
- `20-fixed-ack.review.sql`: `2c25428ed39a99740564d70475c5fa4964a5df653f9bb72251a74a7c3bbae3f0`
- `30-required-inbox.review.sql`: `00b37b53f1429de8374e9a7fc0795f5b15855e4923d50fc61a73865d6233700d`

The manifest pins six existing tables and nineteen security-relevant function definitions, ownership, RLS and effective ACLs. Function-body MD5 comparisons normalize CR characters consistently with SQL. Raw CR/LF differences were verified as normalization differences, not demonstrated production drift.

## Claim race and local evidence

A pending-job cursor could become stale while waiting for the company lock. A helper called with NULL claim could then overwrite a newly active claim. Stage20 revalidates status, retry eligibility, attempt count, response kind and active claim expiry after locking the job.

Native run20 reproduced duplicate claims: `[1,1]` instead of `[0,1]`. The separate-session concurrency test passes after the correction. Independent source review verified the frozen Stage20 hash and fix.

Native run22 executed all19 scenarios: 15 passed, 4 timed out (one15s SQL statement, two Docker inspect calls, one120s test). Host CPU was measured at100%, with Windows Defender a major consumer. Native run23 repeated only those4 cases with unchanged code, guards and SQL timeout limits:4 passed,15 deliberately filtered. Native run24 subsequently passed all19 scenarios in one run with unchanged guards and timeout limits. The original failures are retained outside the repository.

Passing scenarios cover paid/activated authority, Test/unpaid/inactive rejection, owner-session and recipient scope, duplicate/final capability replay, concurrent FIFO claims, automation revocation at claim/stage/final, held legacy quota, concurrent final-unit reservation, prior-month separation, unknown-send hold, real accepted persistence/accounting failure and repair, actual inbox isolation, and populated original history-field preservation. All database rows are synthetic in labelled, network-none, portless, tmpfs PostgreSQL containers. No Graph/model/payment transport executed.

Native command: `node node_modules/vitest/vitest.mjs run --config scripts/whatsapp-fixed-ack/postgres.optin.config.mjs --testTimeout 120000`. It requires the explicitly captured metadata file paths documented by the runner's environment checks. Targeted repeat adds `-t 'real paid and activated|automation disabled before final|receipt never creates a fixed claim:.*(paid|active)'`.

## Final intent-lock correction

Final dispatch authorization originally checked owner-session, paid entitlement and job-claim authority before waiting for the intent lock. A real separate-session lock wait could allow authority to expire. Two native regressions reproduced `ok:true` after job or owner-session expiry. Stage20 now reruns the existing authority helper after the intent lock, checks job/attempt expiry with current time, and only then creates the durable dispatch marker. The focused green run passed both regressions and the existing paid/activated case (3 passed,18 filtered). Independent source review found no material issue or lock-order inversion.

## Remaining acceptance gates

The owner approved the exact existing18-table encrypted export and isolated restore. The previously authorized DPAPI connection was located by filename metadata, and the existing helper passed a read-only TLS verify-full probe against PostgreSQL17.11 with zero customer rows read. No backup/restore proof or production install is asserted. The controlled company UUID, reviewer membership, genuine qualifying paid Live authority, verified Meta binding, worker flags and explicit controlled-send authorization remain live rollout gates. New conversations require an owner Resume decision before a subsequent eligible inbound message. Fixed acknowledgements perform no AI call and do not fabricate an AI ledger.

History tests project every original signup column, allowing only the intended active-attempt status/consumed_at cancellation changes. Additional native scenarios check a persisted prior-month reservation at send claim/final authorization and repair accepted accounting without changing its original period. These use synthetic persisted timestamps; they do not advance the system clock.

The synthetic post-stage drill compares populated new private-history rows across a failed later DDL transaction and verifies that three nontransactional inbox sequences continue advancing. It is a transaction rollback/monotonicity drill, not proof of encrypted backup restoration or actual installer-stage compensation. Backup restore, complete security metadata restoration and staged installation recovery remain acceptance gates. Execution results for the expanded scenarios are recorded separately; do not infer production acceptance from this source.

Expanded native run25 executed24 scenarios:23 passed and1 signup test failed because it compared additive post-upgrade fields with an original8-column snapshot. The assertion was corrected to project original columns. Run26 passed all6 affected or strengthened checks (18 deliberately filtered), including both final-lock expiry regressions, complete signup preservation, both month-boundary scenarios, and the strengthened recovery/sequence drill. Every24 scenario has passing evidence across these runs; no single all24-green run is claimed. Original failure output and the frozen run25 test source are retained outside Git. No production/provider execution occurred.
