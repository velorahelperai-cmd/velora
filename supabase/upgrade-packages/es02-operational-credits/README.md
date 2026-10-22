# ES02 operational credits — LOCAL review candidate

Owner-approved scope, 22 October 2026: implement and test locally only. No
Production installation, credential change, new credit, price or provider call.

`build-local.mjs` deterministically produces
`supabase/migrations/20261022040333_es02_operational_credit_acceptance.sql`.
Current SHA256: `45bf043cfcbc3ef352c0308bb946731b1693e1a021e3e599c08d3bc850c671e5`.
This migration deliberately refuses any database except `c1_ui_integration`
over the local PostgreSQL socket. It is **not a Production migration** and must
not be included in a bulk Production `db push`. `local-baseline.json` pins the
14 existing local function bodies, owners, definer flags, search paths and ACLs.
Production needs its own freshly inspected compatible baseline and reviewed
installer; removing the local guard is not that review.

## Connected behavior

- `wallet-core.sql`: job-keyed holds against existing ES02 balances; purchased
  units first across order groups, ignoring ordinary purchased expiry; base
  units retain their authorized group/expiry. Reservation does not debit units.
  Accepted consumes once, rejection releases, UNKNOWN blocks resend and keeps
  capacity held. Contradictory acceptance after release freezes new allocation
  for review. Initial real-customer replies serialize until the clock is bound.
- `acceptance-clock.sql`: immutable server-classified original recipient and
  native initial-acceptance receipts. Readiness does not start the term. Only a
  durable accepted native company-live reply to a real customer starts it;
  configured test traffic, review traffic and setup trials are excluded.
  Calendar month/year calculation uses Asia/Muscat and the stored approved
  bonus. Original active/ended dates are never restarted. Historical acceptance
  remains accountable after current readiness is revoked.
- `authority.sql`: verified live ES02 settlement, same paid branch/slot,
  B3 channel proof/generations, current knowledge/hours and assistant trial proof
  authorize prestart operation without inventing a native plan UUID or a start
  date. Existing native subscription binds to the actual accepted start.
- `worker-cost.sql`: wallet/capacity/cost reservation in one rollback boundary,
  with exact immutable order/branch/slot/fingerprint/persona provenance on the
  existing AI ledger. A denial must undo newly created reservations.
- `usage-reconciliation.sql`: native outcome proof before settlement; replay
  repairs accounting without repeating the provider send. A raw released
  status without rejection proof remains held as UNKNOWN. Native accepted
  evidence survives an accounting error for later reconciliation.
- `worker-bridge.sql`: connects the real existing worker RPCs to ES02 authority,
  preserving legacy paths. Original inbound question, claim, company, branch,
  source citations, generation, staged response and send intent must agree.

The historical B5–B8 file is retained intact. Only this new local composed
package replaces its unavailable old master-credit adapter with the complete
approved ES02 contract. The builder also composes the pinned single-branch/B4
sources and the previously approved local trial-session-history correction.

## Executed evidence and limitations

`python .git/velora-consolidation-20261022/full-es02-native.py`:
**121 PostgreSQL checks PASS**, compiled full package inside BEGIN/ROLLBACK.
Balances, activation, jobs/messages, function bodies/ACLs and schema-column
fingerprints unchanged afterward. The driver pins the existing container ID.
Two response_kind columns required by an existing fixture trigger are added
only inside that rolled-back transaction. No trigger, RLS or authorization
check is disabled. SQL tests are the wallet-core, acceptance-clock,
worker-profile-bounds and worker-bridge `.test.sql` files in `scripts/integration`.

`node node_modules/vitest/vitest.mjs run src/lib/billing/es02 src/lib/answers/approved-retrieval.test.ts src/lib/answers/runtime/whatsapp-cost.test.ts src/lib/whatsapp/integration-store.test.ts src/lib/whatsapp/integration-worker.test.ts src/lib/whatsapp/operational-recipient.test.ts --reporter=dot`:
**18 suites / 223 tests PASS**. These include explicitly synthetic offline
provider doubles; they do not prove real provider acceptance.

Scoped ESLint on the changed worker/profile/clock files and builder: PASS.
Independent final source review found no additional concrete wiring defect.

**NOT_RUN:** positive full native paid-owner/provider journey, actual simultaneous
last-unit contention, Production installation, deployed browser acceptance,
whole-platform release gates. The fixture has no existing verified live ES02
paid order/provider receipt; its legacy cost trigger also expects retired
master slots. Tests do not manufacture a valid financial proof or disable that
trigger. Sequential last-unit exclusion is tested, not simultaneous contention.
Core helper settlement tests are not native provider evidence.

Current full-repository TypeScript check is **FAILED outside this task**:
`src/components/app/admin-catalog.tsx:320` references undefined `versions`
(TS2304 and resulting TS7006). Its modification time changed during this run;
do not attribute that external edit or its correction to this package. Source
must be stable and that failure resolved before release integration.

## Proposed Fix / Needs Decision — Production permissions, NOT applied

This is a disclosure inventory, not approved Production SQL. Three new private
tables (holds, recipient proofs, initial acceptance receipts) enable RLS and
deny direct access to PUBLIC/anon/authenticated/service_role. All new private
helpers are postgres-owned SECURITY DEFINER with empty search_path and no direct
runtime-role EXECUTE. Existing AI usage ledger gets five ES02 provenance columns,
constraints and an immutability trigger; existing jobs receive a settlement
trigger. Existing financial/Auth/membership/RLS history is not deleted.

New service_role-only public EXECUTE endpoints:

- `es02_classify_claimed_reply(uuid,uuid,text,text,text[])`
- `es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text)`
- `es02_verify_claimed_reply_citations(uuid,uuid,jsonb)`

Existing service-only worker entrypoints are replaced with checked wrappers:
`billing_load_worker_frame`, `whatsapp_reserve_job_usage`,
`ai_start_whatsapp_attempt`, `whatsapp_stage_job_reply`,
`whatsapp_claim_assistant_job_send`, `whatsapp_retrieve_approved_knowledge`,
`billing_finalize_automated_usage`. Saved native aliases become private and
lose direct runtime EXECUTE. `es02_reconcile_activation_readiness(uuid,uuid)`
retains its existing ACL and actor/session/owner checks while replacing its
missing master-helper dependency. No browser gets a debit endpoint.

The composed branch package has its own existing owner/session RPC and private
table ACL effects; a future Production review must enumerate those too from
the exact final SQL rather than approving only the three new worker endpoints.
After genuine positive native and concurrency verification, present the exact
Production-compatible SQL/hash and full effective permission diff separately.

Security Notes: no environment-file read, secret output, credential mutation,
new credit/grant/price, paid request or Production write. No new dependency.
Relevant official guidance: [Supabase function search_path advisory](https://supabase.com/docs/guides/observability/advisors?queryGroups=lint&lint=0011_function_search_path_mutable).

Status: **Implemented locally / Pending Codex Review and remaining acceptance**.
