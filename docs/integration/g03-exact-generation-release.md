# G03 exact-generation release gate

Status: local implementation verified; cloud SQL and deployment NOT AUTHORIZED
by this slice. Parent technical review precedes any push. This is a narrow G03
repair, not a complete production-launch claim.

## Exact SQL proposed for separate approval

Target: vmpifljyozsbtssxhoxd, existing G03 00/10 already installed. Apply ONLY
supabase/migrations/20261010050337_g03_exact_file_generation.sql, after review.
Canonical UTF-8/LF SHA-256:
96b1b138498dfdef0501d663ba49a480f25ead5f44b44c761acc5cfe1f24c7c9.
Verify against Git blob bytes (normalize a CRLF working copy before hashing).
Do not apply the whole migrations directory or reapply 00/10.

Scope: one new authenticated-only metadata function; no table changes, data
writes, backfill, approval, activation, provider, billing or credential changes.
Anonymous and service-role execution are revoked. Explicit G03 authorization
is reused for each read; action selects existing publish/owner/reviewer scope.
The exact source/company/path is joined to the object, with canonical six-digit
UTC fractions; no file content is returned. Two-second lock timeout, thirty-
second statement timeout, one transaction, and existing-function body pins
make incompatible prerequisites fail before creating anything.

Pinned read-only cloud prerequisites:
- private.g03_lock_actor: 6a7e552989ce5f3e980d11ca320c4683 (body MD5).
- public.g03_publish_prepared_file: 5e0dccd905f383e1b4ba541cff94b0bf.

## Technical gate before application/deployment

Confirm the exact target, approved SQL hash, current prerequisite hashes,
function absence, execute privileges and owner/reviewer/writer scope. Review the
existing trusted publication guards alongside this addition. Owner approval
must identify this exact additive SQL; local implementation authorization does
not authorize production application.

Recovery is narrow: a failed transaction rolls back the new function/grants.
After success, the new function only reads metadata and does not change any
customer row, object or historical evidence. Preserve the exact before/after
function and ACL inventory as the recovery record. If later removal is needed,
revert application readers first, then separately authorize removal of this
new signature only. Do not restore or delete customer data, reapply 00/10, or
weaken the original publication function. No recovery operation was executed.

Apply approved SQL before deploying these readers: code against an absent RPC
fails closed and cannot prepare files. Postflight must verify authenticated-only
ACL, canonical timestamp output, exact cross-tenant isolation, revocation and
unchanged publication guards. Then use existing authorized synthetic QA sessions
for upload/preparation and deliberate review acceptance, observing RPC bodies
and persisted proof fields. Do not auto-repair existing customers or approve
processing files. QA B isolation and live acceptance remain pending.

## Local evidence

- Initial rounded-timestamp expected-success reproduction: FAIL (expected true,
  got false), before fix.
- Final exact/read/upload/review isolated tests: 11 PASS. Covers unchanged bytes,
  exact canonical fractions, within-millisecond replacements, source replacement,
  revoked membership/session, anonymous/service denial, bad/null paths, and
  real upload-action preparation through the bounded synthetic transport.
- Existing G03 isolated PostgreSQL acceptance: 24 PASS.
- Default Vitest: 1367 PASS / 42 SKIP; focused knowledge/review: 66 PASS / 1 SKIP.
- TypeScript PASS; lint 0 errors/1 pre-existing billing warning; build PASS.
- No production SQL, provider execution, live QA repair, push or deployment.

Commands run from the verified main worktree:

```powershell
node node_modules/vitest/vitest.mjs run
node node_modules/vitest/vitest.mjs run src/lib/knowledge src/lib/tenancy/review-file-proof.test.ts src/lib/tenancy/review-proof.test.ts
node node_modules/vitest/vitest.mjs run --config scripts/g03-cloud-upgrade/vitest.optin.config.mjs
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js .
node node_modules/next/dist/bin/next build
```

Opt-in tests require the documented data-free VELORA_G03_SCHEMA fixture.
The 24-case run used scripts/g03-review-acceptance/run.mjs with --cloud-schema,
--containment-package, and --upgrade-package pointing to a temporary concatenation
of the existing reviewed 10 package plus this additive migration. That bundle
was applied only to the fresh isolated test container, never production.
