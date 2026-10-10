# G03 cloud compatibility package — local preparation

Base code: `c36f2286b70ee870a1dc7df9f60e1d50d1b0d1b0`, main only, one writer.
Target: `vmpifljyozsbtssxhoxd`. This document is the implementation ledger and
application proposal, not cloud authorization.

## Constraints and rulings

- Cloud access is catalog/metadata READ ONLY, explicitly authorized by the owner.
  No application RPC, customer row/file, role password, key or live change.
- Private schema export was secret-scanned before storage, outside all Git roots:
  `C:/Users/DELL/.codex/private-schema/velora-vmpifljyozsbtssxhoxd-g03-20261010/metadata.json`.
  SHA-256: `419c69f5dfb789df0daead54334bb388928f65cbe23be09ba2dd91a75cc77059`.
  Never add it, its rendered clone, or its contents to Git/NotebookLM.
- Supplementary read-only database-owner catalog is in the same private folder,
  `database-catalog.json` (SHA-256 `9cc4014d8cb28370d641990eff119aea3359507c5bea140fbd9dedd56402c267`).
  Cloud owner is postgres, PostgreSQL 17.11; postgres has pg_read_all_stats and is
  not a superuser. Local cached PostgreSQL is 17.6 (patch-level parity unverified).
- Ruling: scope the package to knowledge/setup-review contracts. The static RPC
  inventory found 16 absent published-code names: five direct G03/history RPCs
  belong here; eleven billing/WhatsApp/AI names remain separate launch gaps.
  Do not imply full-site compatibility or silently import financial migrations.
- Missing direct dependencies: usage_role + its invalidation trigger/column
  grants; company-scoped owner review history; G03 fields/tables/functions/triggers;
  explicit review-transition function privileges under Cloud default grants.
- Ruling: reuse immutable reviewed G03/history source SQL in a deterministic,
  single-transaction review package. Do not rebuild the queue/ledger or relax proof.
- Ruling: keep existing legacy content/approval/history. New file proof stays NULL;
  no current digest is attributed to old extraction and no bulk file preparation.
- Ruling: offer separate fail-closed legacy-review containment, but apply nothing
  now. A failed upgrade must not cause automatic rollback to an unverified writer.
- Use only verified, owned local Docker containers (network none, tmpfs, no ports).
  Auth/Storage definitions are cloned without data; all fixtures are synthetic.
- Ruling: require containment before upgrade and no other client transaction at
  installation. Replacing a function cannot cancel a body already executing.
  Never terminate other sessions. Cost: review writes pause; busy/hidden sessions
  abort the install and require an operator-controlled retry, not weaker guards.
- Ruling: reproduce database ownership, not an invented CREATE grant. The first
  clone attempt exposed pg_database_owner membership differences; a separate
  read-only catalog query confirmed the actual owner before fixing the fixture.
- Ruling: keep tools opt-in. Node tests were initially named *.test.mjs and Vitest
  found two empty suites; renamed to *-checks.mjs without changing assertions.

## Tasks

- [x] Inspect actual metadata and inventory missing contracts; preserve private export.
- [x] Build metadata-only local schema replay and watch baseline failures (RED).
- [x] Implement minimal knowledge prerequisite, package guards, scoped history,
      immutable G03 body, explicit ACL and postflight (GREEN).
- [x] Test populated upgrade/rollback, legacy writer refusal, privilege matrix,
      knowledge/file application paths, and all 24 G03 cases on the cloned baseline.
- [x] Verify application tests/typecheck/lint/build; record limitations and results.
- [x] Commit locally; prepare an Antigravity independent-review handoff, no push.

## Inventory and package boundary

Verified absent in the actual metadata: knowledge_sources.usage_role and three
prepared columns; five company_review_requests proof columns; two private G03
tables; G03 functions/triggers; scoped owner review-history reader. Existing
approval/versioning/Storage invalidation and permission helpers are reused.

Published code evidence: knowledge/actions.ts:51, prepared-publication.ts:18,
tenancy/review-proof.ts:22, tenancy/actions.ts:588 and :607. Existing sources,
review status/revision and audit history stay intact. Legacy files remain
unproven and return FILE_REPREPARE_REQUIRED; no file download or mass conversion.
The approved usage_role default is knowledge; no inferred instruction labeling.

Other **verified missing literal RPC names**, excluded from this bounded package:

| Contract | Published-code evidence | Impact |
|---|---|---|
| billing_create_offer_order | billing/operations/actions.ts:29 | Offer checkout unavailable |
| billing_load_worker_frame | answers/runtime/whatsapp-cost.ts:32 | Paid worker context unavailable |
| billing_read_company_operational_entitlement | billing/wiring/subscription-read.ts:18 | Paid entitlement cannot be confirmed |
| resolve_whatsapp_company_by_meta_asset | whatsapp/tenant-resolve.ts:151 | Trusted Meta tenant resolution unavailable |
| upsert_conversation_lead_state | whatsapp/actions.ts:914 | Lead persistence unavailable |
| whatsapp_apply_meta_delivery_status | whatsapp/store.ts:97 | Delivery settlement unavailable |
| whatsapp_read_answer_profile, whatsapp_retrieve_approved_knowledge | answers/approved-retrieval.ts:14,:27 | Tenant answer context unavailable |
| whatsapp_read_link_access_secret | whatsapp/actions.ts:533 | Channel secret access unavailable |
| whatsapp_revoke_meta_waba_authorization | app/api/whatsapp/webhook/route.ts:99 | Revocation persistence unavailable |
| whatsapp_store_meta_inbound | whatsapp/store.ts:59 | Durable inbound reception unavailable |

Paths in this table are under src/lib except app/api. Inventory is static literal
production-src RPC calls; dynamic RPC names, all table shapes and every product
flow are **not exhaustively certified**. Do not apply broad Billing/AI/Meta
migrations to hide these gaps. Their own reviewed upgrade package is required.

## Application/failure plan — proposal, not execution permission

1. Antigravity independently reproduces tests and reviews exact target/schema,
   source hashes and package. Then Ahmed separately approves cloud application
   and the temporary review pause. No approval is inferred from this local work.
2. Apply ONLY 00-containment.review.sql, using a reviewed migration runner with a
   unique new history entry. It validates the old writer, keeps its seven-argument
   API, revokes service/anon execute, and rejects every review mutation with
   UPGRADE_PENDING. Reads/history remain. Containment is needed even for a prompt
   upgrade because old in-flight function bodies could outlive CREATE OR REPLACE.
3. Wait for client transactions to finish; never kill them. The upgrade checks a
   pg_stat_activity snapshot for OTHER client backends in the current database
   with xact_start set or hidden query text. This is not a table-specific test or
   a permanent ban on new transactions; non-client backends are excluded. It takes
   SHARE ROW EXCLUSIVE NOWAIT locks on seven named tables. Ordinary reads may
   continue at that lock level; subsequent ALTER TABLE can take ACCESS EXCLUSIVE
   locks and briefly block reads as well. It may block setup/knowledge/permissions.
4. Apply ONLY 10-upgrade.review.sql in one transaction, under postgres, with
   lock_timeout 2s/statement_timeout 30s. Hash-check helpers and absence of partial
   G03 and a scoped catalog SHA-256 fingerprint (RLS/policies/ACL/default grants,
   schema/table owners, columns/constraints/triggers/helper security attributes),
   add usage_role/version invalidation, reuse immutable approved G03 and
   scoped history SQL, revoke old inherited grants, run postflight, notify the
   Data API cache, commit. Reapply/unknown baseline aborts without resets.
5. Verify all six public RPC signatures/ACL, nine new columns (usage_role + three
   prepared columns + five review proof columns), five triggers,
   private-table/column denial and exact function definitions. Confirm cache
   reload, then separately authorized synthetic checks via actual Auth/Storage:
   save/read text, prepare a test file, approve, submit, edit/revoke, retry and
   cross-tenant refusal. HTTP 200 or function existence alone does not pass.
6. Runner history must record the new bounded version, not falsely mark older
   source migrations applied. Existing local/cloud timestamp divergence needs
   reconciliation before any future blanket db push; no migration repair now.
7. Before commit, any SQL/assertion failure rolls back all upgrade DDL; containment
   remains from its earlier transaction. After new proof writes, preserve fields
   and history and forward-fix or contain. Do not DROP them or restore the old
   unchecked writer. No automatic backup/rollback scripts are provided.

Risks/limits: local synthetic rows do not prove current customer-data compatibility,
install lock duration/cardinality or Cloud Storage transport/bucket configuration.
No customer rows/files were inspected. Existing prepared data isn't backfilled;
owners reprepare affected files individually. Storage hash proof is observation
at read time, not permanent protection or a DB/Storage atomic transaction.

## Local evidence and reproduction

Run from `C:/Users/DELL/.codex/worktrees/main-consolidation/Velora new`.
No new dependencies. Tools accept only an outside-repository, secret-scanned
metadata file with manifest SHA; database access is Docker exec against a fresh
UUID-labeled, network-none, tmpfs container, no published ports or mounted data.
Cached image: supabase/postgres:17.6.1.136. No cloud DSN or .env is read.

```powershell
$schema = 'C:/Users/DELL/.codex/private-schema/velora-vmpifljyozsbtssxhoxd-g03-20261010/metadata.json'
node scripts/g03-cloud-upgrade/build.mjs
node --test scripts/g03-cloud-upgrade/build-checks.mjs scripts/g03-cloud-upgrade/replay-checks.mjs
node scripts/g03-cloud-upgrade/acceptance.mjs $schema
node scripts/g03-review-acceptance/run.mjs --cloud-schema $schema --containment-package supabase/upgrade-packages/g03-cloud-compatibility/00-containment.review.sql --upgrade-package supabase/upgrade-packages/g03-cloud-compatibility/10-upgrade.review.sql
$env:VELORA_G03_SCHEMA = $schema
node node_modules/vitest/vitest.mjs run --config scripts/g03-cloud-upgrade/vitest.optin.config.mjs
```

- RED actual baseline: G03 direct-submit regression failed because old RPC returned
  true without proof; missing published columns/history reproduced separately.
- GREEN native upgrade: **18 PASS / 0 FAIL**. Includes populated history/content
  preservation, repeat containment, separate backend drain, injected postflight
  rollback, role-only edit invalidation, replay refusal and service/anon/tenant ACL;
  refusal of RLS, broad UPDATE, SECURITY DEFINER, trigger, schema-owner and tenant
  policy drift. Fixture restoration regrants captured column UPDATE permissions:
  PostgreSQL table-level REVOKE also removes those; the guard caught that too.
- G03 on cloned actual schema: **24 PASS / 0 FAIL**, including real multi-session
  locks, revocation, Storage-generation change and audit rollback.
- Actual app functions with native PostgreSQL: **4 PASS / 0 FAIL**. Save text,
  publishPreparedFile, prepareReviewProof and stale-content refusal. Auth identity/
  routing and Storage byte transport are local substitutes; SDK/HTTP cloud
  operation is NOT RUN and not claimed.
- Offline builder/replay checks: **7 PASS / 0 FAIL**. Opt-in, not default discovery.
- Final default suite after fixing tool discovery: **1333 PASS / 0 FAIL / 42 SKIP**
  (116 passed files / 11 skipped). Skipped unrelated opt-in PostgreSQL suites were
  not rerun and are not counted as passed.
- Typecheck PASS; ESLint 0 errors, one pre-existing warning at
  billing/paymob/reconcile.ts:344; Next.js production Build PASS (33 pages).
- Docker temporarily blocked at image inspect; returned after owner confirmed
  Desktop running. No daemon restart/other container changes were performed.
- Cloud writes / customer-data copies / paid calls: **0**. Cloud G03 still absent
  in a subsequent catalog-only check. Nothing pushed or deployed.

SQL manifest hashes are SHA-256 of UTF-8 with LF line endings. Rebuild before any
approved application, then independently compare actual file hashes to manifest.
The offline reproduction check compares canonical content, not arbitrary raw
transport bytes or manifest consistency; Git CRLF checkout is not deployable as-is.
Only project-authored SQL and hashes are committed; actual captured definitions
and their rendered clone stay private, never Git or NotebookLM.

## Antigravity independent review handoff

Review this package against base c36f2286 and the final local commit supplied in
the delivery message. Use the private metadata path only locally. Reproduce the
commands above and inspect: containment/in-flight-call window, dependency hashes,
ACL after CREATE OR REPLACE and rename, transaction rollback, legacy content,
unchanged approved source SQL, actual-schema clone limitations and opt-in tests.
Return your own PASS/FAIL counts and any blocking finding. This package has NOT
received Antigravity approval at preparation time; no tool/session for contacting
Antigravity was available here. Owner subsequently supplied its review claims for
verification below. That update does not authorize a cloud application.

Local compatibility scope: knowledge/setup-review only. Whole-site staging and
cloud application remain BLOCKED pending independent review, separate approval,
the eleven out-of-scope contracts and real Auth/Storage acceptance.

## Final internal review and fix pass

Fresh Codex reviewer (not Antigravity) reviewed c36f2286..5c0f023. Important finding:
disabled knowledge RLS was accepted by the original preflight. Regression watched
RED (missing expected rejection), fixed by the scoped catalog SHA-256 guard;
GREEN 18/18 native cases. Expected fingerprint from a separate authorized READ
ONLY catalog query: cdb8ae52ae909fb63751029c782a2eabd967bf15f3cafd37e87cccfcad113952.
The query is project-authored; no captured schema bodies were added to Git.
Restoring captured schema ownership was necessary for matching this guard, rather
than loosening it to accommodate the clone. Final fix reruns G03/app/quality checks.

Final: Ruling: strict unknown-baseline refusal wins over permissive application;
scope includes default/schema grants and dependency security attributes. Cost:
legitimate schema drift requires a new reviewed capture/package, not an override.
Final: minor (deferred): binary artifact/manifest verifier and CRLF transport
normalization are not automated. Mandatory operator rebuild + raw SHA validation
before any application; direct CRLF containment can fail later proof comparison,
leaving the review path safely contained. No claim of byte-for-byte verification.

## Review reconciliation and ONE approval request — 2026-10-10

Reviewed SQL remains exactly at a3f4c93b4192d01b4e7b9261b4a0c06b6a1858ea.
This addendum changes documentation only. Antigravity's supplied wording is
treated as review claims, not an additional executed test record.

| Claim in supplied review | Verified SQL and correction |
|---|---|
| company_knowledge_sources / company_reviews | Names are wrong in the report only. SQL uses public.knowledge_sources and public.company_review_requests (upgrade:21,77,81). Catalog-only cloud reads confirm both actual tables exist and both reported aliases are absent. No rename/code change. |
| pg_stat_activity checks target-table transactions | upgrade:8 checks other client backends in current_database, xact_start IS NOT NULL OR hidden query text. It also catches idle-in-transaction clients, not just active queries. It does not inspect which tables they access, does not cover every backend type and does not prevent new sessions/transactions starting after the check. |
| BUSY_SESSIONS | Actual error is REVIEW_WINDOW_NOT_DRAINED_OR_NOT_VISIBLE (upgrade:8). No pg_terminate_backend/pg_cancel_backend or forced disconnection in either file. |
| LOCK TABLE ACCESS EXCLUSIVE NOWAIT | Explicit lock is SHARE ROW EXCLUSIVE NOWAIT on companies, knowledge_sources, company_review_requests, company_members, platform_admins, platform_admin_scopes, company_member_grants (upgrade:21-22). Not a database-wide lock. ALTER TABLE may separately require ACCESS EXCLUSIVE. Neither the precheck nor the explicit lock is a general halt of all transactions. |
| timeout limits whole outage to 30s | lock_timeout=2s and statement_timeout=30s are present (upgrade:5-6). The latter is per statement under simple-query protocol, not a whole-script/outage deadline. No transaction_timeout is set. |
| revoke PUBLIC/anon from every sensitive object | Explicit revokes cover the named G03/helper RPCs, prior JSON helper and two new private tables, including authenticated/service_role where specified (upgrade:110,432-440,466-471; containment:52-53). Existing table permissions aren't universally revoked. Authenticated retains approved column grants; service_role retains only the two trusted completion/publication RPCs. |
| SECURITY DEFINER on all functions | Public proof/transition/read RPCs use SECURITY DEFINER and empty search_path, with actor/session/company validation and restricted EXECUTE. The usage_role invalidation trigger is explicitly SECURITY INVOKER (upgrade:64-72); hashing helpers are not universally definers. Qualified names plus empty path don't replace authorization. |
| company_id RLS enabled on every new/modified table | False as stated. Existing public knowledge_sources/company_review_requests RLS is enabled and unchanged, verified in cloud catalog; FORCE RLS is false. No ENABLE/FORCE ROW LEVEL SECURITY or CREATE POLICY appears in the package. New private.g03_company_inputs/review_checks have ACL revocation, not new RLS policies. Definer RPC isolation is enforced in their actor/company logic, not inferred from RLS. |
| any non-postgres grant rejected with BASELINE_SECURITY_DRIFT and exact diff | Actual guard is BASELINE_SECURITY_MISMATCH (upgrade:55) over the pinned catalog fingerprint; approved baseline grants to authenticated/service_role/etc are allowed. Drift of covered definitions stops, including unexpected covered triggers/policies/grants. This is a scoped fingerprint, not all database privileges. It doesn't return a detailed diff. Helper body mismatches may first raise BASELINE_FUNCTION_MISMATCH with a signature. Diagnose by separate metadata-only comparison. |

Cloud metadata was re-read, without customer rows or application RPCs: the scoped
fingerprint still matches cdb8ae52ae909fb63751029c782a2eabd967bf15f3cafd37e87cccfcad113952;
G03 remains absent; both actual public tables have RLS enabled. This is a current
catalog observation, not a permanent integrity or production-readiness claim.

Backup/recovery actually available: Supabase organization API reports free /
tier_free. Logged-in target project Scheduled Backups page states Free Plan does
not include project backups. Target PITR page shows an unenabled Pro-only add-on.
No accessible scheduled restore point or enabled PITR was found. No upgrade,
backup download, paid subscription or Restore action was taken. Internal provider
backups, if any, aren't an available customer restore guarantee. A paused-project
unpause operation is not a pre-upgrade database recovery point.

Sources: [target scheduled backups](https://supabase.com/dashboard/project/vmpifljyozsbtssxhoxd/database/backups/scheduled),
[target PITR](https://supabase.com/dashboard/project/vmpifljyozsbtssxhoxd/database/backups/pitr),
[Supabase backup limitations](https://supabase.com/docs/guides/platform/backups),
[PostgreSQL lock compatibility](https://www.postgresql.org/docs/17/explicit-locking.html),
[PostgreSQL statement timeout](https://www.postgresql.org/docs/17/runtime-config-client.html).
Database backups do not include Storage object bytes; this package does not
modify/delete Storage objects. No permanent DB/Storage atomicity is claimed.

Requested authorization (NOT granted yet):

1. Target only Supabase project vmpifljyozsbtssxhoxd, production main branch,
   velorahelperai-cmd's Project, organization wwcihainyknysqjjojyq. No deployment,
   paid API, billing change, plan upgrade or AI/Meta activation.
2. FIRST permit a limited, consistent READ ONLY pre-change data export: all
   existing columns/rows of public.knowledge_sources and company_review_requests,
   plus admin_audit_logs rows only for review.submit/resubmit/request_changes/approve.
   It contains customer knowledge/review history, so earlier metadata permission
   does NOT authorize it. No Auth rows/passwords, provider tokens, Billing/AI/
   WhatsApp data or Storage file bytes. Associated schema definitions are the
   already authorized metadata. This is surgical recovery, NOT a whole-project
   backup or disaster-recovery substitute.
3. Proposed local destination only:
   C:/Users/DELL/.codex/private-recovery/velora-vmpifljyozsbtssxhoxd-g03-20261010/<run-id>/.
   User-restricted directory, encrypted Windows CurrentUser DPAPI payload, SHA-256
   manifest; no plaintext dump on disk, console output, Git, NotebookLM or uploads.
   This is recoverable under the same Windows user/machine, not a portable backup.
   Verify decryptability/checksum/completeness locally without showing rows; use
   synthetic fixtures for schema/restore-mechanism tests. No customer-data restore
   into test databases is authorized by this request. If a secure existing DB
   connection/export mechanism or recovery validation is unavailable, STOP before
   containment. No password reset/new cloud role or weakened test target.
4. After the backup gate passes, approve ONLY these unchanged UTF-8 LF SQL files:
   - 00-containment.review.sql SHA-256
     0cdf3681b2a4d0124eed2d6c4e874ed206137eb4a5a59894a52e0d333319237a
   - 10-upgrade.review.sql SHA-256
     f48e440bf2b6f6c760cd46dd7af44dc97621c31325de3ab1a9e68f17eff697f9
   Rebuild locally and compare raw file hashes; any mismatch means STOP/new review.
   Fresh metadata fingerprint must match; no concurrent DDL operator. Record only
   new migration history, no repair or false marking of older source migrations.
5. Estimated review-path pause: reserve 10-15 minutes AFTER backup is ready, for
   containment -> natural client transaction drain -> one atomic upgrade -> cache
   reload -> acceptance. Estimate, not measured cloud SLA; data size/traffic and
   validation are unverified. Backup preparation is outside this pause and its
   duration isn't known yet. No global maintenance lock/flags or session killing.
   Setup/knowledge/permissions can briefly block during DDL, with possible reads
   blocked by implicit ACCESS EXCLUSIVE. If upgrade fails after containment,
   reviews remain paused beyond the window; notify owner instead of reopening
   the unsafe legacy writer or applying a third unapproved script.
6. Recovery: failure before COMMIT rolls back that file; after containment COMMIT
   its review pause persists if the upgrade aborts. After upgrade COMMIT preserve
   new proof/history and prefer a separately reviewed forward fix. Original
   containment cannot be reapplied after G03 because its partial-state guard will
   refuse. No automatic DROP, old-body restore, full database restore, snapshot/
   PITR promise or overwrite of subsequent legitimate writes. Any data restore
   is separately authorized, targeted, and reconciled with newer records first.
7. Post-application tests are included only for owner-approved synthetic test
   tenants/accounts: catalog definitions/ACL/private table+column denial; actual
   authenticated text save/read, a tiny synthetic file prepare/approve, submission
   and review, same-request replay, edit/revocation/stale-proof refusal and tenant
   isolation; confirm own-number preference without paid subscription/Meta. No
   customer rows/files or external provider calls. If suitable isolated accounts
   aren't available, arrange them with owner first; don't silently alter Auth
   roles or send invitations. No cleanup deleting histories. Cloud success is NOT
   claimed from HTTP 200/function presence. Previously run G03 24 cases remain
   local synthetic PostgreSQL evidence, not 24 new tests on customer production.
8. The eleven Billing/AI/WhatsApp/lead RPC gaps above are excluded. This request
   does not authorize their migrations or certify full-site staging/production.

Approve the combined **scoped export + conditional two-file application + stated
synthetic acceptance** explicitly, or approve export only. Export-only permission
never authorizes cloud SQL. Nothing has been exported or applied by this request.
