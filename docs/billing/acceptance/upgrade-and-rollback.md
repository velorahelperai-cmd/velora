# Existing-data upgrade and rollback acceptance

Scope: fixed review base `485d21e`, P1 `2931067`, equivalent P2 `8bf760b`
(original preserved P2 `3f2ed0f`). Historical migration
`20261008080000_vel_billing_p1_dependencies_d1_to_d5.sql` remains unchanged.
New forward migration: `20261008100000_vel_billing_legacy_evidence_upgrade_acceptance.sql`.
Supabase CLI created the new file; its generated UTC timestamp was earlier than
the existing future-dated migration, so the new file was advanced for correct
forward lexical order. No cloud migration history was repaired.

## Finding A: DEFAULT live grants unproved historical service

Historical P1 lines 15–17 add `environment NOT NULL DEFAULT 'live'` to all existing
subscription rows. Its operational reader then trusts status/date alone
(lines 956–966). Existing Test grants and unknown manually populated active rows
therefore become operational Live subscriptions without any evidence migration.

The forward migration removes the default and classifies existing rows from
consistent company/order/attempt/event/grant/outcome bindings. Live requires the
persisted receiver `hmac_verified=true`, exact adapter evidence marker
`VEL_PAYMOB_SERVER_HMAC_VERIFIED`, canonical positive signed-owner string and
`paymob_hmac_verified` method, plus complete signed collection flags and exact
stored processor amount, currency, integration and transaction identity. The
method label alone is insufficient: the historical P1 wrapper stamped it without
validating receipt authenticity. No flag, owner or marker is retroactively
backfilled from the old label or timestamps. CASE-protected validation quarantines
malformed owner data instead of aborting the upgrade. Authorized synthetic proof
is accepted only as Test. Historical
Test/Live mixing, absent or incomplete evidence, reversed collections and target
binding collisions become `environment='quarantined', status='review_required'`.
No ambiguous record is labeled Live. Historical receipt provenance includes
revoked grants, while current operational eligibility independently requires
active/nonreversed order-attempt-grant state. Catalog/order/grant currency,
amount and period snapshots must match; later plan retirement does not invalidate
an already verified collection. Original subscription IDs and all financial
orders, events, grants and outcomes remain intact; classification metadata is an
operational audit, not a newly created backup. Grant-backed known subscriptions
derive their paid-through/plan from actual persisted evidence. Existing explicit
suspension or past-due status is not lifted by the migration except a narrowly
attributed historical helper bug: the old reversal outcome and current
subscription mutation instant/truncation must match exactly, its old receipt
must have a complete trusted collection chain, and a newer independent active
receipt must establish the current paid period. The original helper's
`signed_lifecycle_reversal` label alone is not HMAC proof. Manual or security
suspension, company suspension and past-due state remain denied. This repairs
damage to a newer valid purchase; it does not choose a refund or suspension policy.

The same forward migration fixes operational/journey/cancel-renewal readers to
use explicit Live scope and proven grant bindings. Cancelling renewal preserves
the paid period, distinct from cancellation of a payment order. Operational reads
require server role or authorized company owner; arbitrary authenticated tenant
IDs do not grant access. Operational entitlement also denies service for a
suspended company even when its paid subscription remains active; this guard
does not alter the subscription or choose a financial suspension policy.

**Apply only with Billing writers and operational entitlement readers stopped or
denying service, and the historical plus forward changes isolated from traffic.**
Historical P1 still assigns Live before the correction executes. Separate commits
with old applications accepting traffic create an unsafe intermediate entitlement
window. A single PostgreSQL transaction over the complete offline upgrade is
preferred; prepare an audited combined script which handles the existing files'
explicit BEGIN/COMMIT statements rather than nesting transactions and assuming
an outer BEGIN will prevent their COMMIT. If the migration tool commits each file
separately, keep all affected application/worker reads and writes disabled until
the correction and post-upgrade data assertions have passed. Do not expose a
historical-only intermediate schema to users or background service. New post-classification
settlement requires the companion lifecycle migration's partial-index-aware
`ON CONFLICT` predicate. All files must deploy as one reviewed change set.

## Existing-data verification

`scripts/billing-acceptance/upgrade-fixtures.sql` seeds an actual pre-P1 Billing
schema with eighteen synthetic histories: Test, documented Live, unknown,
incomplete Live evidence, mixed Test/Live, refund flags alone, refund flags plus
newer Live collection, the actual historical helper's older revocation with newer
Live collection, revoked unverified history with newer collection, mismatched
grant-period metadata, manual suspension, past-due, and company security
suspension, plus company-only suspension with an otherwise active paid
subscription, plus missing receipt attestation, missing signed owner, unsupported
adapter marker and malformed owner. Trusted fixtures explicitly supply synthetic
receiver attestation; unsupported fixtures retain the old wrapper method label
and complete collection flags without supplying trustworthy receipt provenance.
`upgrade-post-p1-fixtures.sql` invokes the actual historical helper
after P1 and before the correction, preserving its exact global-suspension damage
rather than substituting a refund flag for revoked order/attempt/grant state.
The fixture has twenty-three
financial grant chains before P1, rather than testing an empty database.
`upgrade-assertions.sql` verifies correct classification, no financial deletion,
Test/unknown denial, proven Live entitlement, survival of the newer valid paid
entitlement after an older reversal, and unrelated caller denial.

The latest focused actual PostgreSQL red reproduction exposed that the previous
seven-case fixture did not invoke the historical helper: actual old-grant
revocation left the newer valid subscription suspended, unverified revoked
history was incorrectly retained as Live, and mismatched grant-period metadata
was accepted. These are additional regression cases, not successes covered by
the earlier seven-case run. A separate actual PostgreSQL red probe also showed
the service-role operational reader allowed an active paid subscription after
company-only suspension; the new predicate denies service without mutating any
financial state. A further actual populated-data red probe showed four
unsupported legacy Live receipts all remained active under the old method-label
check; missing attestation also returned operational active=true. The corrected
evidence rule quarantines those receipts without deleting financial history or
inventing proof. Final actual PostgreSQL evidence and counts are recorded after
the complete forward chain: **PASS**, eighteen scenarios, twenty-three financial
grants and twenty-three matching audit grant IDs, with twenty assertions in one
populated-upgrade suite. All four unsupported provenance cases are quarantined,
and the unattested receipt's authoritative operational result is active=false.
The manual-suspension case also includes a legacy NULL paid-through date with
otherwise matching historical-helper metadata: absent truncation evidence must
remain unknown, and must not be interpreted as permission to lift suspension.
Its actual red reproduction activated the manually suspended row; the final
`coalesce(attribution,false)` correction keeps it suspended and denies service.
Application and concurrency counts are reported separately in the final
acceptance report. This result does not claim PGlite proves PostgreSQL concurrency.
Fixtures model server verification provenance; they do not call Paymob or certify
production merchant configuration. Supabase/Auth dependencies in the isolated
harness are explicit test stubs, not evidence of cloud RLS or exact definitions.

## Finding B: destructive down-migration is not a safe rollback

Dropping subscription `environment`, order `expires_at`, or grant `status`
destroys evidence needed to distinguish Test from Live, expire/review pending
orders, and distinguish revoked from active grants. Restoring company-only
uniqueness fails as soon as a company has both Test and Live rows; forcing it
by deletion loses history. Older company-only readers/cancellers are incompatible
with the new schema even when TypeScript compiles. Do not execute those DROP
commands as an operational rollback.

### Before any new writes

1. Stop all checkout/webhook/worker/catalog writers and affected entitlement
   readers, and verify the access barrier.
2. Read actual migration history, function definitions, constraints, privileges
   and the classification ledger against the exact application commit.
3. If no committed D1–D5 schema change exists, keep the previous application;
   abort any uncommitted migration transaction normally.
4. If the schema transaction already committed, retain new columns and audit.
   Roll back application code only to a version proved compatible with scoped
   subscriptions, quarantine, deadlines and grant status. Prepare a reviewed
   forward function correction instead of a destructive down-migration.

### After Test/Live/quarantine or payment lifecycle writes exist

Keep the full additive schema, financial rows, classification ledger,
`private.billing_lifecycle_reviews` event/order/attempt audit, scoped uniqueness,
and guarded settlement functions. Removing the lifecycle ledger or restoring the
old unsigned reversal helper loses replay/reversal protection; retaining only
the new columns is insufficient. Freeze affected payment processing, retain incoming evidence in a
safe durable path, reconcile unresolved processor transactions without making
a new charge, and repair forward with an application matching the schema.
Never merge Test entitlement into Live or reactivate revoked/ambiguous history
to make an older application work. Do not drop dates or status flags, delete one
environment's rows, overwrite migration history or run migration repair.

Any separately authorized backup/snapshot prerequisite must be verified before
an irreversible recovery, but none was created by this task. Full restore would
also require reconciliation of processor collections made after its recovery
point and protection against replay; restoring a database alone is insufficient.

## Separate owner approvals and cloud prerequisites

- Read-only cloud verification of project identity, installed migration versions,
  actual function/policy/constraint/privilege definitions and existing data.
  Current task performs no cloud SQL writes or migration repair.
- Approval of the deployment write barrier and the exact reviewed migration,
  application commits, execution window, operator and recovery procedure.
- Independent authorization for any cloud apply, restore or new backup. None is
  implied by these local tests or by this documented rollback plan.
- Approval of checkout timeout duration (the historical hard-coded two hours is
  not accepted policy), treatment of payment confirmed after deadline, refund
  entitlement allocation/partial-versus-full reversal and suspension policy.

Unresolved policy does not authorize invented grace periods or global tenant
suspension. A genuine later paid entitlement must survive review of an older
collection. Cloud exact-definition verification and those policy decisions
remain launch blockers.

## Application reader integration and source revisions

`src/lib/billing/wiring/subscription-read.ts` now calls the authoritative Live
operational entitlement RPC rather than interpreting a future subscription date
as proof of payment. Its open-order lookup also filters Live environment. RPC
failure or malformed evidence returns the existing display `error` state instead
of retaining a possibly active fallback. The existing function signature and
display types remain intact; this patch does not change UI or Auth. A verified
cancel-at-period-end subscription stays active through its paid period.

Source versions are distinct: P1 `2931067` originally introduced the global
provider-order index, while integration base `485d21e` contains the later scoped
index correction and P2-equivalent `8bf760b`. Original P2 `3f2ed0f` is preserved
on its own branch. Test claims in an earlier P1 report do not demonstrate these
forward acceptance fixes or the final reviewed application path. The acceptance
report records its own concrete commits and executed tests.
