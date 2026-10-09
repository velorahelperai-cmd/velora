# G03 verified setup review

Approved scope: implement the server-owned review evidence contract, content-version
binding, current authorization, safe replay/concurrency, and the existing review UI.
Base: `667f88d9cf0dea4945981d3913345db0bde5602d` (`origin/main`, fetched 2026-10-10).
Worktree: `g03-verified-review`; branch: `codex/g03-verified-review`.

## Rulings

- Retain the seven-argument `transition_company_review` contract. Its write path
  now requires a short-lived check completed by the trusted server, never a
  browser trial flag. No payment, Meta link, or live AI prerequisite is added.
- SQL owns the canonical manifest and a per-company input epoch. Relevant writes
  increment that epoch before commit; final decisions acquire the guard and
  authorization read set with NOWAIT. Busy locks return CONFLICT with no effect.
  This avoids inversion with multi-statement profile/permission RPCs. Writers
  acquire source rows before the guard; a later commit makes evidence stale.
- New file preparations bind the SHA-256 of the actual extraction buffer to the
  extracted text/version. Historical files receive no invented backfill.
- Storage byte checks prove only what was read at check time. Database and
  Storage are not an atomic transaction; external byte changes after observation
  cannot be excluded. No permanent Storage guarantee is claimed.
- Reuse the existing 10 MiB file limit and 40-source answer-context limit. New
  review I/O limits: two simultaneous downloads, ten seconds per file, thirty
  seconds per complete check. The DB proof ticket expires after sixty seconds.
  Preparation metadata/download reads also use ten-second deadlines. The actual
  SDK stream API caps byte consumption; a limit/read failure blocks, never passes.
- Identical submit replay returns EXISTING without another audit. Different
  intent/content returns CONFLICT; duplicate approval may also return CONFLICT.
- Preserve original knowledge, review history, balances and rollout flags. No
  cloud writes, provider calls, push, PR, merge or deployment.

## Execution/checkpoints

1. Isolation and baseline: complete; 174 relevant tests passed, one skipped.
2. RED: original SQL accepted forged browser readiness; original file checker
   lacked byte proof; PDF extraction detached the download buffer; expired-session
   reads bypassed the disabled rollout setting. These regressions now pass.
3. Implemented: forward migration, trusted preparation/publication, server
   preflight/final transition, current/stale review reads and owner/admin UI.
4. PostgreSQL: 24 cases passed, zero failed/skipped. Application: 1333 passed,
   zero failed, 42 skipped (11 files). Typecheck passed; ESLint zero errors,
   one existing warning in `billing/paymob/reconcile.ts:344`. Production build passed.
5. One independent read-only whole-branch review found three lock inversions.
   Actual profile/role/scope/session paths now return CONFLICT on busy locks,
   without effects. A test-only reconstruction of the old lock order reproduced
   PostgreSQL `deadlock detected` (RED); all three regressions passed (GREEN).

## Contract and invalidation

- SQL hashes a canonical manifest of the saved company/profile, requester
  identity/verified email, and sorted source metadata, text digests, versions,
  approval evidence and prepared-file digests. The monotonic input epoch also
  detects edits followed by restoration. Company, source and membership writes
  share the guard through AFTER triggers, including the existing Storage
  invalidation path. Timestamps alone are not content proof.
- Submit/resubmit consumes a completed server check bound to actor, session,
  company, action, expected revision and normalized number preference/note.
  Approval rechecks the submitted manifest and observes the eligible file bytes
  again. Current actor/session, requester ownership/verification, and delegated
  authorization are revalidated under nonblocking row locks at the final write.
- Identical submit replay has one audit effect. Different input is CONFLICT;
  approval replay with an old revision is CONFLICT. No blind automatic retries.
  Owner drafts/own-new number preference survive conflicts; the UI offers refresh.
- Snapshots/observations remain in private checks and before/after review audit
  history. Resubmission keeps the prior revision's evidence. Historical rows are
  preserved, with NULL preparation proof and no invented extraction digest.
  Explicit file re-preparation uses the existing action, replaces its prepared
  text/version, and clears approval until explicitly approved again.
- A review does not prove number ownership, model quality or channel readiness;
  it does not change company activation, subscription, balances or rollout flags.

## Acceptance evidence

| Area | Evidence |
| --- | --- |
| Populated migration | Historical approved file/text/request seeded BEFORE G03; content, approval and two audit events preserved; request becomes unverified |
| Replay/isolation | One submit/approve effect; conflicting intent/revision; cross-company RPCs and forged check/digest writes denied |
| Changed input | Content/title/profile/source insertion/deletion, revoke-reapprove ABA, Storage generation drift and explicit resubmission |
| Authorization | Owner revoked during I/O, session expiry, reviewer scope revocation, actual scope/role RPCs with dependent grants |
| Concurrency | Separate psql backends/PIDs and observed pg_stat_activity lock waits; actual profile RPC, session delete cascade, decision/writer ordering |
| Atomicity | Injected audit failure rolls back request and check consumption; subsequent retry has one effect |
| File proof | Known SHA-256, same-size changed bytes, missing legacy digest, generation drift, cross-company/traversal paths, stream cap, timeout, max two readers, PDF buffer preservation |
| UI | Stale/legacy resubmit and milestones, current server-action workspace binding, honest error messages; default SSR/component tests passed |

## Run locally (opt-in PostgreSQL)

From this worktree, with the installed locked dependencies:

```powershell
node scripts/g03-review-acceptance/run.mjs
node node_modules/vitest/vitest.mjs run --reporter=dot
npm run typecheck
npm run lint
npm run build
```

The PostgreSQL runner requires a local Docker pipe/socket and cached
`supabase/postgres:17.6.1.136`. It creates a uniquely labelled container with
network none, no ports/volumes, tmpfs PGDATA, synthetic rows, and verifies its
identity before access/removal. It never accepts a DB URL or reads `.env`.
It removes only its own verified container in `finally`. Existing project
migrations supply actual tables/RPCs/triggers/RLS; Auth and Storage infrastructure
tables/functions are synthetic substitutes. The PostgreSQL suite is not added
to the default test command.

RED reproduction switches (test database only): `--baseline` for browser-proof
bypass; `--red-lock-order --lock-regressions-only` for the reviewed lock inversion.
The latter reconstructs prior locking from installed function definitions and
must fail. `--lock-regressions-only` runs the corrected paths.

## Limits, cloud dependency and rollback

- Storage checks prove the bytes observed during the check window only. External
  mutations outside the DB invalidation path can evade epoch invalidation until
  the next byte read. G03 does not promise DB/Storage atomicity or permanent file
  integrity and does not change the separate AI retrieval contract.
- Actual Cloud Storage, hosted Auth, paid providers and a full authenticated
  browser journey were NOT RUN. UI policy/server-action and existing component
  tests ran offline. No cloud synchronization or production readiness claim.
- A separately approved cloud application of
  `20261009215520_g03_verified_review.sql` and the existing server service-role
  configuration are required before using the new actions against hosted DB.
  Missing schema/server configuration fails closed. No secret was copied/changed.
- Forward-only deployment. Do not DROP proof columns/tables/history after writes.
  Rolling back only the app while retaining this migration blocks old unverified
  review mutations (PROOF_REQUIRED). Any rollback that restores the old bypass or
  removes data requires separate review; no automatic rollback/backup is supplied.
- New preparation still supports the project's existing PDF/TXT/DOCX formats;
  this task adds no bulk conversion or new extractor/provider. No originals were
  deleted or bulk re-prepared. API/provider execution cost: 0 OMR.

Next: independent Antigravity review of this local branch; no push/PR/merge/deploy
or cloud migration is authorized by completion of these checks.
