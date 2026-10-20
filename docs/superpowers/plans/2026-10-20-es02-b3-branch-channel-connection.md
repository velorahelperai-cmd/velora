# ES02 B3 Branch Channel Connection Implementation Plan

> For agentic workers: execute inline in the existing Cursor/Grok4.7High job. No new tasks/forks. Codex executes verification; Cursor authors product and test definitions only. This execution method and local scope are explicitly authorized by the parent. No commit/push or repeated presentation approval checkpoint.

**Goal:** Persist and verify account/company/branch-bound paid channel attempts while reusing existing provider protocols.

**Architecture:** Add private durable attempt/link provenance and native branch-aware bridge transactions. Add safe typed actions and pure DB projection; existing provider flows use guarded store ports. Company-only legacy links stay ambiguous and unchanged.

**Tech Stack:** Existing Next.js/TypeScript Server Actions, Supabase client/RPC, PostgreSQL17.6, Vitest and existing isolated native harness. No dependency/auth library upgrade.

**Spec:** `docs/es02-branch-channel-connection-contract.md`; UI handoff `task/es02-b3-ui-contract-handoff.json`.

## Global Constraints

- Canonical `C:\Users\DELL\Desktop\Velora new`; evidence `C:\Users\DELL\Documents\Codex\2026-10-16\task`.
- Existing c1_ui_integration/run f8bc3bb2-d6be-4c61-aea1-9c991192743e, PG17.6,4auth users, retained synthetic paid fixture.
- Backend writer touches no UI/Brain/assets or installed historical migration. Codex alone writes Brain and runs tests/local SQL.
- No provider call/OAuth grant, credentials/new actors, Production/remote SQL, commit/push/deploy/activation or new runtime.
- Preserve existing B1/B2 exported shapes, old grants/roles/default ACLs, Vault security and provider UNKNOWN/single-dispatch behavior.
- Existing hosted/native metadata sources and fresh139-function/53-relation local baseline are in es02-b3-native-baseline.json. Match before application.

## Review Focus

- A branch or paid selection changes while provider work is in flight: claim/stage/finalize/recovery deny the stale scope in the native transaction.
- A company already has a legacy link/unknown attempt: no implicit assignment, replacement or duplicate provider authorization.
- Same client operation key is retried for a different branch or flow: deny payload reuse; exact duplicate returns same committed attempt.
- Provider success response/DB commit is lost: recover committed state without repeating exchange or subscription POST.
- Company-level provider uniqueness cannot safely support a second branch: preserve the constraint and report exact compatibility/policy gap; no invented sharing/routing policy.

### Task1: Public contracts, deterministic projection and scope flow

**Files:** create `src/lib/tenancy/paid-branch-connection-contracts.ts`, `paid-branch-connection-flow.ts` and corresponding `.test.ts` files. Existing legacy contracts are consumed, not copied.

**Interfaces:** five fixed action names and exact scope/flow/state DTOs from the spec. Internal flow ports separate committed native transitions from existing provider exchange; client input never supplies verified/link authority. `expectedRevision` is issued by read, generation by committed native start.

- [ ] Write focused tests first for WA new number/Coexistence/Instagram direct flow-channel matching, invalid/extra input, exact scope echo, zero verified without branch proof, unknown/revoked/expired link evidence, stale callbacks and secret-free output.
- [ ] Implement narrow types/parsers/projectors and flow orchestration with explicit typed denials and no process-local durability.
- [ ] Release early exact exported signatures for UI; any unavoidable interface change must be reported before UI consumes it. Do not change the stable five action names without a concrete conflict.
- [ ] Codex independently runs released focused tests, recording actual failure/pass rather than asserting unexecuted RED.

### Task2: Native branch-bound store and legacy bridge

**Files:** CLI-generate one new `*_es02_b3_branch_channel_connection.sql` migration and create `src/lib/tenancy/paid-branch-connection-store.ts` plus `.test.ts`. Author native rollback definitions `task/es02-b3-native.sql`/`es02-b3-native.cjs` and, where required, `es02-b3-concurrency.cjs` using existing guarded helpers. Report generated migration path before body. No SQL execution by writer.

**Consumes:** native active actor/B1 paid facts/B2 selected channel binding; existing WA signup, Coexistence signup/projection and Instagram connection/subscription native functions. Inspect exact current SQL signatures and provenance before choosing wrappers.

**Produces:** durable immutable branch attempt and branch link evidence, explicit native read/start/claim/stage/finalize/recover/cancel bridges. Start associates old/new attempt in a single native transaction. Finalize binds exact authoritative legacy link/generation to branch in the same transaction. Guard owner, session, selected paid right/revision at every mutation. Public client cannot invoke proof finalization.

- [ ] Inspect current native baseline, relevant old migration/store functions, constraints and safe role boundaries. Record intended complete ACL matrix and exact unaffected metadata hashes.
- [ ] Write native tests for all Review Focus cases, wrong session/account/company/branch/channel/attempt/generation/revision, unpaid/unselected/suspended/foreign rights, competing branch/asset claims, exact duplicate and changed-payload operation IDs.
- [ ] Implement native locks/constraints, branch-aware reuse wrappers, real proof validation and pure side-effect-free projection. Do not update installed historical migration or weaken a legacy constraint/ACL. Fail-closed on missing dependency or unresolved binding, preserving old link/attempt rows.
- [ ] Include tests proving authenticated/anon cannot read tables, secrets or execute server-only proof wrappers; new client EXECUTE authenticated only, fixed owner/search_path, unchanged effective inherited rights/defaults on old objects.
- [ ] Include two-real-backend native overlap only for actual concurrency claims and use existing actors. Native business fixtures rollback; no fake Vault/provider schema or blanket grants in the retained fixture.
- [ ] Codex exact-byte reviews migration and scripts, captures before/after values/security, applies only reviewed new migration locally and runs native definitions. Missing actual dependency is a reported blocker, not permission to silently widen install scope.

### Task3: Existing provider adapters and Server Actions

**Files:** create `src/lib/tenancy/paid-branch-connection-adapters.ts`, `paid-branch-connection-actions.ts` plus focused `.test.ts` files. Minimal backend-only extension to `src/lib/whatsapp/embedded-signup-store.ts`, `src/lib/whatsapp/coexistence/signup-store.ts`, `src/lib/instagram/connection-store.ts` or their narrow internal flow helpers only if a reusable port cannot be injected otherwise. Preserve old callers and public signatures. No UI files.

Also modify `src/lib/tenancy/paid-setup-actions.ts`, `paid-setup-contracts.ts` and their focused tests only for a compatible authoritative channel-fact merge: same old DTO/action signatures; channel steps/count can become verified only from the exact new native B3 projection. No other readiness/launch mutation and no installed old RPC rewrite. Test no-provenance pending0/7/0/8, genuine single/both channel verification, and stale/foreign/missing/revoked source never granting verification.

Narrow backend callback integration also covers `src/app/api/instagram/oauth/callback/route.ts` and `src/lib/instagram/oauth-route.ts`/focused tests if needed: resolve B3 attempt provenance server-side and dispatch completion/cancel through guarded branch ports, preserving existing HttpOnly cookie/state and non-B3 legacy behavior. Tests must prove no B3 callback falls through to an unbound legacy finalize, lookup/source failure denies, and redirects never contain code/state/secrets or caller-selected URLs. This is required reuse of the existing route, not a second OAuth flow.

**Consumes:** Task1 DTO/flow and Task2 guarded stores; existing WA `finishEmbeddedSignup`/`onboardMetaSignup`, Coexistence `finishCoexistenceSignup` and Instagram `completeInstagramConnection` exchange/Vault/subscription semantics. Never call company-only owner actions as a branch adapter.

**Produces:** five fixed actions in the spec; genuine actor captured server-side, normalized exact inputs, native authoritative results, existing safe launch descriptor only after durable start, no provider/reconcile side effects on reads/recovery, no automatic retries. Completion provider ports only after committed exact native claim.

- [ ] Write tests proving denied scope causes0provider calls, read/recovery causes0profile fetch/reconcile effects, exact success persists native branch provenance, stale scope between claim/finalize fails, ambiguous completion rereads rather than redispatches, and safe outputs/logs contain no token/code/state/Vault material.
- [ ] Implement adapter composition and typed actions, preserving diagnostics/request correlation and owner/session checks. No new Instagram Facebook-alternate path.
- [ ] If current company-level uniqueness/routing cannot safely support paid branches, document exact conflicting schema/caller and return explicit conflict/legacy_ambiguous; do not pretend branch connection is fully enabled. Continue independently verifiable start/claim/projection guards where safe.
- [ ] Writer syntax/type review only; no test suites/provider/SQL apply. Release exact path/hash manifest, intended ACL deltas, UI export surface, actual NotRun tests and STOP.
- [ ] Codex runs affected focused and legacy adapter regressions, full TypeScript/scoped lint and native/concurrency verification. Use installed local test tools without dependency downloads. Report actual passed/failed/blocked counts and limits, update Brain and return stable backend release to existing UI owner for later mounted integration.

No task authorizes provider grants/calls, company-link adoption, historical cleanup, new policy, assistant readiness/launch, Production or Git publication. Broader ES02/WP01A remains open until its own acceptance.

## Ordered integration and final upload gate

Recorded ordered plan through real channel/backend testing and final upload (parent relay of explicit user direction): (1) fixed B3 contract and parallel ownership: existing Cursor/Grok backend writer implements guarded contracts/actions/RPCs/migration/tests; existing UI owner implements checklist/guide/isolated leaf against the fixed API; parent-added independent QA/release worker remains read-only and starts no competing browser/service. Codex coordinates exact-byte integration, native permissions/data checks and execution. (2) Release backend exact hashes, review/apply only the additive migration to the existing isolated c1_ui_integration, run native authorization/provenance/idempotency/concurrency and affected unit/type/lint regressions. (3) Mount released UI and backend together in the existing retained runtime; verify actual app->Server Action->DB connection/recovery/failure/stale-scope behavior, AR/EN responsive views and no secret/provider leakage. Label provider-free synthetic proof tests honestly. (4) Real WA new-number/Coexistence/Instagram-direct channel/backend acceptance follows only after its specific account/credential/OAuth-grant/provider-cost/environment approvals are satisfied; current planning authorizes NONE of those effects. No unimplemented Instagram Facebook alternative. (5) Fix defects, repeat affected verification, independently review release readiness/CI/security/metadata/rollback and record remaining limits; do not equate connection verification with assistant launch or overall WP01A completion. (6) Upload/push/publication/deployment is LAST, only after required acceptance, CI/branch protection and explicit release/Production authorization; no upload/push/release is executed now. Current actual status:45/45prior scoped mounted read acceptance is complete with its recorded limits; B3 stable interface/plan handed off and same inline backend writer is active, while B3 implementation release/native application/tests remain NotRun.


## Recorded independent QA integration limits

Independent QA channel constraints confirmed/recorded for B3: native es02-b3-legacy-constraints.json proves WA/company uniqueness, Coexistence/company primary key and Instagram active-company/account unique indexes. Current src/lib/instagram/webhook-store.ts and supabase/migrations/20261011193914_vel_instagram_webhook_store.sql expose company/link/generation-based persistence, with ordinary ingest requiring companies.status=active; current paid setup fixture remains setup. Branch-aware webhook/inbox routing and setup-vs-active ingest compatibility are unresolved integration boundaries, not permission to relax constraints, auto-adopt links, activate a company or add a reviewer bypass. Authoritative authorization/connection proof must not be advertised as demonstrated message delivery, assistant readiness or multi-branch webhook readiness. Real webhook acceptance needs a separately authorized reachable staging/test ingress; localhost cannot receive Meta events. These constraints do not block independent approved local branch-guard/projection tests, but real provider/webhook acceptance remains unverified and subject to its own approvals.

