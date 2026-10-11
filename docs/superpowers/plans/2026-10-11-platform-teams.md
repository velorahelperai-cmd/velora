# Internal team foundation — local implementation plan

Goal: Persist a small internal directory and owner-controlled team transfers without changing platform administration, company access or finance permissions.

Approved scope: The parent's 2026-10-11 delegation is the design brief and authorizes inline implementation on the existing main checkout. This package must remain local until independent review and separate synchronized-release approval. No UI route, production SQL, invitations, accounts, grants, external messages or providers are included.

## Architecture and decisions

Use `public.platform_teams`, `public.platform_team_members`, and a private successful-operation ledger. Reuse verified Auth identities, profiles, persisted platform-owner authority and `private.write_admin_audit`. Existing company scopes and memberships remain untouched. Team managers receive only their current roster; employees receive only their own membership and manager summary. Team membership confers no platform-admin/company/finance authority.

Approved corrected criteria: multiple independently revocable active memberships; a delegated admin may manage multiple teams. Current active persisted delegated-admin eligibility plus the owner-set team manager pointer and active same-team membership grant only the specific roster scope. Disabling the platform role revokes all its rosters. The active manager has no employee edge in another active team. Replacement atomically enrolls the new manager and preserves unrelated scopes; promotion/reactivation rejects conflicting retained employee edges. Transfers preserve unrelated active memberships and all business grants. Caller-only plural self reads retain denied status while hiding denied team/manager metadata. Specialty is directory text, not permission.

Owner mutations require verified current Auth/session, current persisted owner, expected team/member revisions, operation UUID and a nonblank 2–240-character reason. A single transaction serializes team mutations, locks affected rows in deterministic order, writes membership/team changes, one audit entry and one replay outcome. Exact retry returns the confirmed outcome; changed payload conflicts; failed audit rolls everything back. Replay never bypasses current owner authorization.

Read pagination validates cursors inside the current scope. Unauthorized team IDs, row counts and cursors disclose no other team. Public RPC wrappers expose only guarded private implementations; clients cannot write team tables directly. No current live route imports this package.

## Task 1: Database behavior

Files: `supabase/upgrade-packages/platform-teams/10-teams.review.sql`, `preflight.readonly.sql`, `scripts/platform-teams/{postgres.mjs,bootstrap.sql,cases.mjs}`.

- [x] Write synthetic two-team owner/manager/employee/finance/outsider assertions, including direct-write denial, cursor isolation, role transitions and revision conflicts; observe missing-contract RED.
- [x] Implement read_self, read_directory, create, update, set_member, preview_transfer and transfer through four narrow RPCs and private helpers.
- [x] Run actual PostgreSQL assertions plus concurrent transfer/revoke and retry/audit rollback cases; preserve independent business grants.

## Task 2: Server contracts

Files: `src/lib/platform-teams/{contracts.ts,contracts.test.ts,actions.ts,actions.test.ts}`.

- [x] Write failing runtime input/response and server-session binding tests.
- [x] Implement exact action normalization, fail-closed response decoding and authenticated SSR RPC calls. Require expected actor binding, reject account switches, and keep confirmed mutation results independent of optional subsequent reads.
- [x] Verify missing schema returns UNAVAILABLE without fallback grants or fake success.

## Task 3: Review checkpoint

- [x] Run focused tests, PostgreSQL suite, full Vitest aggregate, TypeScript, lint, build and diff checks.
- [x] Obtain independent read-only review using Sol High; fix material findings with RED→GREEN evidence.
- [x] Record exact SQL SHA-256, dependency preflight and recovery strategy in the package manifest/README.
- [x] Create a local commit on main only. Do not push, deploy or apply production schema. Hand off commit/hash and remaining synchronized-release gates.

Review focus: stale auth/role revocation while waiting for locks; forged cross-team cursors; manager replacement and disable transitions; replay following lost response; audit failure after mutation; successful mutation followed by a failed refresh.

## Progress

2026-10-11: clean base `78566163f1e24fa00600f638d99f7afc7796c570`; read-only production catalog confirms dependencies and absent team relations at 08:20:28 UTC. Existing role/scopes/audit contracts inspected. Isolated PostgreSQL 17.6 container has no network, ports, persistent mounts or logs; only synthetic bootstrap data will be loaded.

2026-10-11 review checkpoint: initial review found expiry during lock waits and loss of confirmed receipts during optional session failure. Both reproduced RED then fixed; reviewer re-review clear. Real idle-session predicate reused in fixture. Read-only production preflight at 08:50:21 UTC passed, including session deadline/activity dependencies. Focused 31 pass; aggregate 2033 pass/42 existing skips; TypeScript/build pass; lint 0 errors/7 existing warnings. PostgreSQL 16/16 passed, including NOWAIT authority contention with zero write/audit/replay and successful exact retry. Blocked race tests verify actual lock waits via synthetic pg_stat_activity.

The r1 checkpoint `ccb00fe11929581429650b8b92504011c6e52678` and its Library archive are preserved. R2 corrects the provisional single-membership/role-independent model to the existing approved criteria above. RED regression evidence covers multi-team responsibility, active-destination conflicts, persisted specialty, replacement/reactivation transitions and pending role/member/manager-summary revocation. Terminal RPC checks invalidate captured revisions and authority. Direct-table RLS retains ordinary statement-snapshot semantics; no full-runtime or live acceptance is claimed. `SCENARIO-MAPPING.md` records the original twenty scenarios with assertion-level evidence and gaps. Production installation and main push/deployment remain held for separate synchronized approval.

Final r2 local evidence: actual synthetic PostgreSQL 29/29; focused Vitest 33/33; aggregate 2035 pass/42 existing skips; TypeScript/build pass; lint 0 errors/7 existing warnings. Independent Sol High source/SQL/documentation review clear after fixes. Updated r2 preflight is not a new production observation. Canonical-schema/Auth/PostgREST runtime remains unavailable here and is not claimed.

R3 owner review: reproduced navigation-context mismatch without claiming parser reuse proves unauthorized access. Coordinated actor/team/search/scope fingerprint in TS parser/decoder, six-argument authenticated RPC, SQL validation/generation and terminal full-scope comparison. Native shared-member cross-team and stale-between-page failures reproduced RED→GREEN. Materialized transfer previews now invoke a read-only VOLATILE current actor/session/owner/destination-manager/four-revision guard. Six paused preview failures reproduced RED→GREEN; preview passes BEGIN READ ONLY with no audit/outcome change.

R3 dependency reconciliation: authorized metadata-only current production observation at 09:57:27 UTC supplies exact normalized owner/session/audit definitions and provenance; catalog preflight at 10:03:22 UTC passes required columns/RLS/hash/new-object absence. Installer now independently rejects exact body drift. Checked-in final owner body e76d5… is semantically identical to inspected production d465… but differs in formatting; parent-reported desktop runtime 8e066… definition was not supplied and is not independently semantically verified. Guarded local-only dependency overlay preserves ACLs/data and hash pins. Desktop 78-chain G03 block, successful 72-prefix/six synthetic HTTP sessions and unsuccessful team installation/rollback probe are distinct evidence; full-runtime team acceptance remains open.

R3 final local verification: PostgreSQL40/40 using exact production dependency bodies; focused36/36; aggregate2038/42 existing skips; TypeScript passed after updating a legacy test fixture shape; lint0errors/7existingwarnings; build passed. No additional broad rerun for unchanged production code; independent final source/SQL/documentation/provenance review clear. No production install, main push or deployment.
