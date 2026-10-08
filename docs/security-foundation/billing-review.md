# C1 billing continuation — 2026-10-08

## Scope and baseline

Reviewed in `overnight/security-foundation`, linked worktree
`C:\Users\DELL\.codex\worktrees\overnight-security-foundation\Velora new`,
from `a5b8d141ec629d3129e3fb57c00360b7a0cbba35`.
`git merge-base --is-ancestor 485d21e HEAD` returned exit 0. The merged
`61163a6` fixes and `docs/billing/acceptance/security-acceptance-report.md`
were reused; this continuation did not reopen their closed findings.

Only one remaining local defect family was proved: stored financial evidence
could be rewritten or erased through the server role after insertion. This is
a server persistence-contract failure, not a demonstrated browser/tenant attack.
The earlier adapter grants all table privileges to `service_role`
(`supabase/migrations/20261008050000_vel_billing_ui_adapter.sql:29`), while
receipt binding ran only on insert
(`supabase/migrations/20261008110000_vel_billing_provider_binding_acceptance.sql:49`).

## Proved findings and minimal correction

| Finding | Actual PostgreSQL RED evidence | Forward correction |
| --- | --- | --- |
| Authorization or capture can be rewritten into a collection after HMAC attestation | `scripts/security-foundation/billing-immutability-cases.mjs:28`: an `other` receipt with signed `is_auth=true` or `is_capture=true` initially fails settlement; a service-role update changes the flag and event status, then the actual settlement RPC returns `granted` | Provider event rows immutable after insertion; column/table privilege restriction and row trigger at `supabase/migrations/20261008161000_vel_billing_receipt_immutability.sql:17`, `:37`, `:53` |
| Removing an unprocessed refund destroys the durable barrier against stale success | Test `:53` reproduced successful service-role deletion; after the correction, deletion is rejected and the following success returns `lifecycle_review` with zero grants | DELETE rejected by the receipt trigger at migration `:13`; service-role DELETE revoked at `:53` |
| Grant period can be rewritten, or an already revoked grant reactivated | Tests `:63` and `:69` reproduced a 99-year change to `applied_paid_through` and `revoked -> active` update | All grant fields except the existing one-way `active -> revoked` lifecycle are immutable at migration `:21`; only column `status` UPDATE remains at `:55` |
| Settlement provenance/period can be changed or the outcome deleted | Tests `:77` and `:83` reproduced `evidence_marker`/paid-through rewrites and deletion | All outcome fields except replay `detail` immutable at migration `:26`; only column `detail` UPDATE remains at `:57` |
| The same tables expose TRUNCATE to the application role | Test `:89` returned `[true,true,true]` for the three tables' TRUNCATE privileges | TRUNCATE revoked and statement triggers protect privileged maintenance mistakes at migration `:46` |

The correction does not create a refund policy or automatically revoke service.
It preserves the earlier active-to-revoked record transition and ordinary replay
bookkeeping. Restoring a revoked grant requires a future reviewed reconciliation
path instead of overwriting its receipt. No existing financial data is modified.

## Verification and limits

Executed by the billing worker unless labelled root-run:

- Billing unit baseline: `node node_modules/vitest/vitest.mjs run src/lib/billing --reporter=dot`.
  **323 passed / 0 failed / 19 skipped**, 29 files passed and 6 skipped.
- Actual PostgreSQL RED: `node scripts/security-foundation/billing-immutability-cases.mjs`.
  **2 passed / 9 failed**, exit 1, before the forward migration. The two
  authorization/capture mutations both produced a real `granted` result.
- Applied only the new forward migration to the root-validated ephemeral C1
  `billing_acceptance` database, without bootstrapping or resetting it.
- Actual PostgreSQL GREEN, initial focused cases: the same script returned
  **11 passed / 0 failed**, exit 0. Ordinary replay updated `detail.replayed_at`
  without changing financial proof; publishing a replacement 99 OMR/year version
  preserved the original order's 5 OMR/30-day snapshot.
- Final root-run of the focused script, including four supplementary privileged
  receipt/grant/outcome trigger and TRUNCATE checks: **15 passed / 0 failed**.
  This supersedes the initial 11-case GREEN count; do not add those overlapping
  runs together as unique cases.
- Final root-run of the existing billing acceptance runner with **21 billing
  migrations** from the complete **69-migration** source chain: **29 passed /
  0 failed / 0 not run**. The populated upgrade retained **23 grants** and passed
  **18 scenarios / 20 assertions**. These are existing acceptance cases, not
  29 additional newly discovered bugs or 20 extra test suites.
- Node syntax check, scoped ESLint for the new script and `git diff --check`
  passed after the correction.

The root owns the shared harness and performed its final clean bootstrap/run. The shared
reversal fixtures that previously mutated receipt summaries now construct their
malformed/partial receipt summaries before insertion. This adaptation is test
setup, not an exception to immutability. The billing worker did not edit any
shared harness file or historical migration.

Database evidence uses synthetic tenants, provider IDs and attestation fixtures
under actual migrated PostgreSQL. It proves local functions, triggers and
privileges; it does not certify Supabase transport/Auth, merchant gateway
behavior, cloud function definitions or production historical data. The local
container is task-labelled `c1-security-foundation`, has network `none`, no
published ports, no persistent mount, and PostgreSQL storage in tmpfs.

## Commercial decisions remain separate

Live calls remain refused by `src/lib/billing/paymob/config.ts:143` and new Live
checkout remains blocked by `src/lib/billing/wiring/test-checkout.ts:8`.
No activation flag, OMR conversion factor, merchant namespace assumption,
deadline approval, refund resolution, suspension/grace rule or live policy was
changed. The inherited staging/launch blockers remain:

1. Merchant-specific Oman OMR conversion and real Test/Live account proof.
2. Trusted processor contract for the provider-order namespace, rather than an
   inference from the existing integration-scoped index.
3. Approved deadline, late-collection, full/partial refund/void and authorized
   reconciliation workflow. Synthetic approval fixtures are not owner approval.
4. Exact cloud definition/data parity and authenticated historical reconciliation.

No cloud SQL, real provider/API call, paid verification, payment, backup, push,
merge, deployment or commit was performed by this worker. Obsidian was not
opened, searched or read.

## Exact worker-owned changed files

- `supabase/migrations/20261008161000_vel_billing_receipt_immutability.sql`
- `scripts/security-foundation/billing-immutability-cases.mjs`
- `docs/security-foundation/billing-review.md`

The migration was created with `supabase migration new
vel_billing_receipt_immutability` and then renamed to the root-reserved forward
version because the CLI's current UTC timestamp preceded the reviewed future
migration chain. No billing application changes were needed.
