# P1/P2 financial security acceptance — 2026-10-08

**Ready for Staging: NO.** Local corrections and tests are separate from cloud
parity, merchant contract verification and owner approval of payment policies.
No cloud writes, real payment, provider request, push, merge, deployment or new
backup was performed.

## Reviewed versions and isolation

- Branch: `codex/p1-p2-security-acceptance`.
- Fixed base: `485d21e44eb0c676a3aec9cfe47c5f5f40f86ade`, the latest merged
  `integration/p1-p2-billing` tip inspected for this review.
- Included P1: `29310678bcb829d6aefd0074fc04a9df64113249`.
- Included P2 integration: `8bf760b043424da36772a770e18560b00f5fea96`.
  Its patch ID matches preserved P2 `3f2ed0fc0a9872e47a89f6ea90d2c1ebd6db64a2`
  (`4e6c1d44c14943a33c2e080da3dc74fec433e9c9`); P2 was not merged again.
- Included D5 scoped-index correction: `485d21e44eb0c676a3aec9cfe47c5f5f40f86ade`.
- P3 was completed and preserved first at
  `23bbec86591be63f8a2e699429eb2340e7ff8a6c`; P4 remains at
  `b24064f625e9b2a3a9f96ca84d35e4aa1b12ec13`.
- Independent managed worktree:
  `C:\Users\DELL\.codex\worktrees\p1-p2-security-acceptance\Velora new`.
  Other worktrees and original branches were not modified.
- The final local commit is supplied in the delivery message. Resolve it with
  `git rev-parse codex/p1-p2-security-acceptance`.

The user-provided P1 report belongs to the earlier P1 version. Its 54/54 PGlite,
30-table/72-RPC and cloud-applied claims are not evidence for the later merged
base or the forward corrections below. Likewise, Antigravity's 600 passed / 18
skipped and successful build describe its integration report, not these changes.

## Findings, fixes and evidence

`P1` below means `20261008080000_vel_billing_p1_dependencies_d1_to_d5.sql`.
Forward files are under `supabase/migrations`; application files are under
`src/lib/billing` unless stated otherwise. Historical P1 was not edited.

- `F1`: `20261008100000_vel_billing_legacy_evidence_upgrade_acceptance.sql`.
- `F2`: `20261008110000_vel_billing_provider_binding_acceptance.sql`.
- `F3`: `20261008111500_vel_billing_catalog_snapshot_acceptance.sql`.
- `F4`: `20261008120000_vel_billing_lifecycle_evidence_acceptance.sql`.
- Test SQL/MJS files below are in `scripts/billing-acceptance`; notes are in
  `docs/billing/acceptance`. `file:line` identifies a one-based source line.

| Severity / finding | Evidence file:line | Fix | Test evidence | Remaining blocker |
| --- | --- | --- | --- | --- |
| Critical: legacy Test/unknown subscriptions automatically become Live, while old grants default Active | P1:15, :64, :955; F1:37 | F1: classify from complete receipt chains; quarantine absent, mixed, reversed or inconsistent history. Active defaults alone never authorize service. Preserve financial records and original subscription IDs. | Populated pre-P1 upgrade, actual historical reversal helper, operational reads and grant-count assertions in `upgrade-assertions.sql` | Production historical reconciliation and a controlled offline upgrade are required. |
| Critical: old wrapper labels arbitrary evidence HMAC verified | P1:834; F1:64; `upgrade-assertions.sql:50` | Require persisted server HMAC attestation, expected evidence marker, canonical signed owner and complete typed binding/lifecycle evidence. Never infer proof from a label, timestamp or future paid date. | Missing attestation/owner/marker populated-history regressions; malformed receipt tests | Unattested real historical collections need authenticated reconciliation before service can be restored. |
| Critical: unsigned reversal can suspend a newer valid paid subscription | P1:846, :894; F4:140 | F4: private helpers inaccessible externally; require verified stored evidence, retain an order-specific durable review, prevent old-success replay. Repair attributable historical helper damage only with a newer proven collection; preserve manual/past-due/security suspension. | `reversal-cases.sql`: unsigned rejection, refund replay, older refund/newer payment, void and cancellation; populated historical-helper and NULL-attribution regressions | Full/partial refund service effects and review resolution require owner policy and authenticated processor linkage. Automatic refund resolution is not enabled. |
| High: delayed success can grant after expiry or an unapproved deadline | P1:39, :404, settlement core | Forward lifecycle guard: retain late payment evidence for review; default `deadline_policy_approved=false`; no first Live grant without separately approved policy. Existing valid grant replays remain idempotent. | Late arrival and expiry during a real PostgreSQL lock wait; unapproved Live policy regression | Deadline duration, late-collection handling and an authorized approval workflow are unresolved. |
| High: nullable/mismatched scope and bare order-ID lookup evade correct binding | P1:172; `wiring/store.ts:19`; original scope-copy trigger | Keep the existing provider/account/environment index without claiming its namespace is contractually proved. Reject missing or conflicting bound scope; use signed integration plus server-pinned environment; lock durable event insertion consistently with settlement. | Same ID in different scopes accepted, same-scope duplicate rejected, wrong tenant rejected, Test/Live replay and actual application tests | The configured account ref is an integration ID. The processor contract must establish whether order IDs belong to that integration, a merchant account, or another environment scope; actual Test/Live accounts also need verification. Neither global nor integration-scoped uniqueness is assumed proven. |
| High: caller can submit a 99-year period for a published 30-day offer | P1 financial-snapshot check; F3:15 | Compare period unit/count with the locked catalog snapshot. Keep the existing working catalog locks. | Actual PostgreSQL red reproduction and `FINANCIAL_SNAPSHOT_MISMATCH`; parent/version withdrawal and publication races | No remaining local failure; cloud function-body parity still unverified. |
| High: P1/P2 evidence and read contracts do not align | P1:495; `wiring/settlement-bridge.ts:64`; original date-based subscription reader | Preserve the API and send consistent currency aliases, actual event status/environment; recover durable lifecycle events under existing switches; use the authorized operational-entitlement RPC. | Two tests invoke the actual Next POST, real HMAC calculation, service-role SQL persistence, settlement RPC and owner subscription read; recovery and reader unit tests | Real Supabase transport/Auth and deployed RPC definitions are not certified by the local dependency stubs. |
| High: event insert fails under actual service-role privileges when acquiring the company lock | F2:25 | Narrow private security-definer trigger with fixed empty search path and server-role restriction. No company UPDATE grant was added. | Actual application-to-PostgreSQL red failure, then both service-role integration cases passed | Production grants/policies need exact catalog verification. |
| High: dropping environment/deadline/grant status is a destructive rollback | Proposed down-migration operations discussed in the gate; schema changes at P1:15, :39, :64 | Document compatible application rollback and forward repair, before/after new writes; retain scoped data, lifecycle audit and all protection functions | `upgrade-and-rollback.md`; no rollback executed | Separately approved write barrier, cloud apply/recovery procedure and any backup prerequisite. No backup was created. |
| Launch blocker: OMR factor and account availability are not proven by configuration flags | `paymob/config.ts:84`; `money.ts:107`; P2 report's contract boundary | Retain exact integer conversion and unconfigured rejection. No conversion factor or secret setting changed. | Existing exact-factor/precision/account/currency unit tests; signed receipt binding and actual PostgreSQL amount checks | Merchant-specific Oman processing contract and configured accounts must establish the actual factor. |
| Launch blocker: conflicting cloud reports do not establish parity | `cloud-evidence.md` | Keep cloud verification separate; prepare metadata-only verification query without executing it | Earlier permitted read returned 51 migration history entries; no D1–D5 history entry. No subsequent cloud SQL executed | **Cloud exact-definition verification: BLOCKED / NOT RUN.** |

## Executed tests and honest limits

| Category | PASS | FAIL | NOT RUN / skipped | Evidence |
| --- | ---: | ---: | ---: | --- |
| Application regression suite, default environment | 626 | 0 | 20 skipped | `npx vitest run --reporter=dot`: 65 files passed, 6 skipped; exit 0 |
| Actual PostgreSQL-backed application path, explicit local opt-in | 2 | 0 | 0 | `BILLING_ACCEPTANCE_POSTGRES_TESTS=1 npx vitest run src/lib/billing/wiring/acceptance-postgres-app.test.ts --reporter=verbose`; exit 0 |
| Actual PostgreSQL 17.6 acceptance cases | 29 | 0 | 0 | `node scripts/billing-acceptance/run-postgres.mjs`; exit 0; final frozen-source output recorded below |
| PGlite in this gate | 0 | 0 | NOT RUN: 0 executed | External 54/54 claim was not rerun or counted as concurrency evidence |
| Cloud exact definitions / policies / privileges / constraints | 0 | 0 | BLOCKED / NOT RUN | No catalog SQL after the later prohibition |

The default 20 skipped tests are 17 older opt-in SQL tests, the two new local
application/PostgreSQL tests (executed separately), and one unrelated deferred
Storage test. Skipped tests are not counted as passed. Counts above are separate
runs; do not add the PostgreSQL assertions or unit tests together as unique end
to end cases. TypeScript, scoped ESLint and Git whitespace checks passed.
No local production build was claimed for this gate.

Actual PostgreSQL used 20 Billing migrations, including the untouched historical
P1 and four forward corrections. The task-labelled container had no network,
published ports or persistent data volume; database storage was tmpfs. Minimal
Supabase/Auth/company/session dependencies are explicitly labelled local stubs.
The application adapter executes real SQL as `service_role` but replaces the
Supabase HTTP transport and access-context lookup. Positive Live data and deadline
approval are synthetic fixtures, not real payment or owner policy approval.

The populated-data upgrade passed **18 scenarios / 20 assertions**, preserving
**23 financial grants and 23 matching classification-audit grant IDs**. This is
one of the 29 PostgreSQL cases, not 20 extra test suites. Test, unknown, incomplete,
mixed, reversed, unsupported-marker, missing-attestation/owner and malformed-owner
histories cannot grant operational Live service. The actual historical helper's
older reversal preserves a newer proven receipt; manual NULL-date, past-due and
company-security suspension remain denied. An independent post-run SQL query
returned exactly `scenarios=18, audit_grant_ids=23, financial_grants=23`.

The new provenance regressions were red on the earlier forward implementation:
all four unsupported histories became Active/Live, and an unattested complete
receipt returned `active:true`. The final strict provenance guard changed all
four to quarantined review and denied service without backfilling proof or
discarding financial records. These were not covered by the earlier 14-case run.

Concurrency is proved by separate psql backends and observed PostgreSQL Lock
waits, plus committed row/grant/outcome assertions. It is not inferred from
Promise.all or PGlite. Final root-run backend evidence: replay **24027 / 24049**,
different collections **24105 / 24127**, catalog withdrawal **24177 / 24192**,
expiration while settlement waited **24613 / 24638**. In each observed pair the
waiting backend reported `wait_event_type='Lock'`; committed results passed the
case assertions. Parent plan withdrawal and publication races also passed.

## Applied policy versus owner decisions

The reviewed implementation sets order expiration to **two hours** at P1:39
and :404. No 24-hour checkout duration or automatic three-day grace period was
found in the reviewed Billing path. Those report values are not accepted policy.

Owner decisions still required:

1. Adopt or revise the checkout deadline and decide handling of confirmed late
   collections. Establish the authorized approval workflow before Live creation.
2. Define full/partial refund and void effects on the specific paid entitlement,
   treatment of ambiguous child transactions, and reconciliation authority.
   An older refund must not revoke a newer unrelated purchase.
3. Define financial suspension/grace behavior explicitly; no three-day grace or
   blanket tenant suspension was introduced.

The public [Paymob Create Intention specification](https://developers.paymob.com/paymob-docs/intention-apis/create-intention)
describes an amount in cents and requires integration currency and Test/Live mode
to match the key. It does not establish this merchant's Oman OMR conversion
factor. The [official HMAC specification](https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback)
signs the owner/integration/order/amount/currency and lifecycle fields used by this
review; unsigned `is_live` or parent details do not replace trusted binding.

## Cloud evidence and integration handoff

Before the later Cloud SQL prohibition, one authorized read-only metadata query
returned 51 cloud history entries for the matching project `vmpifljyozsbtssxhoxd`,
latest `20261008001430`. The base has 54 local migration files. Differing names,
split/grouped statements and absence of the new history entry do not establish
whether all prior definitions match. The change from 12 Applied / 12 Pending /
16 Mismatch / 13 Review to all first 53 Applied remains unexplained. Object counts
or OpenAPI names cannot resolve it. See `cloud-evidence.md` for the precise limit.

For Antigravity: integrate the four forward migrations together with the Billing
application correction and tests only after review. Do not expose the historical
P1 intermediate Live/Active defaults to traffic. Freeze all affected writers and
entitlement readers through the populated-data verification; explicit migration
BEGIN/COMMIT statements mean an outer transaction must not be assumed effective.
Follow the source-hash preflight and data-preserving rollback plan. Do not merge
or apply automatically. Auth, UI, AI and WhatsApp code were not changed.

Payment switches still default to off, new Live payment creation remains refused,
and no production policy approval was populated. The remaining blockers are cloud
definition/data parity, authenticated historical reconciliation, merchant OMR and
account proof, and the approved payment-policy/review workflow. Local green tests
do not certify a production gateway integration.
