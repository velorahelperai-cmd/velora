# Claimed-job Noura authority gate

Base: clean main `31f32b4dc14810140bc8745247f3709a5015fc88`. Local implementation only. Customer answering remains hard-disabled; grants still default inactive; the separate administrative lifetime budget remains 1 OMR. No commercial cap is chosen, seeded or published. No production SQL, push, deployment, live providers, activation, payments or messages are performed.

## Behavior

The baseline actual PostgreSQL probe reproduced approved knowledge returning `ok:true` to a proven paid job with an inactive Noura service grant. The added guard requires an activated immutable Noura service snapshot joined to the existing proven Live financial receipt, exact tenant/subscription/version/paid-through, current lifecycle eligibility and active company. Persona labels and catalog targets cannot establish service authority. Existing verified Meta link/window, original inbound identity, claim, automation generation, source approval/version, model identity, cost and paid-proof checks remain in the backing functions.

The original inbound job gains immutable provenance fields for entitlement application, subscription, plan version, paid-through, existing `automated_outbound_per_month` cap and Asia/Muscat allowance month. These fields add no new ledger or counter. The guard uses only a valid positive cap from the already published/retired immutable version; absent/zero values deny. A job binds once before returning knowledge. It cannot adopt a different receipt, version, paid-through or allowance month, or retroactively authorize historical already-reserved/paid work. Prior jobs remain unchanged until an eligible unworked claimed job executes this gate; there is no bulk backfill.

The shared profile guard, worker frame and existing capacity reservation are gated. Existing retrieval, model reservation/start, staging and assistant-send claim functions retain their original implementations as externally uncallable private backing functions. Final authority checks run after backing work because downstream knowledge, budget and AI-ledger locks can wait beyond paid expiry. A denial inside a subtransaction rolls back only newly made work/holds; earlier cost, reservations and uncertain evidence remain intact. Company -> subscription -> conversation -> job ordering is retained, then service/plan read locks. The service/plan lock conflicts fail closed with NOWAIT.

This is an additional runtime prerequisite, not a new answer-capability grant or rollout. The existing immutable offer has `noura.knowledge.read`; this slice neither extends that commercial contract nor makes it sufficient to enable customer answering. The independent hard-off gate stays in place. Normal worker identity comes from the original stored customer job; no staff/user session is fabricated for a service worker.

## Split work and separate blocker

Acceptance accounting is explicitly left for a subsequent reviewed slice. The existing capacity/cost ledgers and finalizer/recovery behavior are preserved here: one logical job owns one capacity slot; model fallback has separate cost attempts; known rejection releases capacity; ambiguous/running work retains holds and requires reconciliation. Existing accepted/rejected/unknown repeat-finalization is verified. Accepted intent/provider evidence remains distinct from delivered/read webhooks. Currently `billing_finalize_automated_usage` waits for matching display-message persistence; changing acceptance accounting to commit from the durable bound accepted intent/provider ID independently of display repair is not implemented or claimed in this gate slice.

The separate staff regression reproduces an actual action reaching its mocked Graph boundary after RBAC revocation during Vault lookup. `p4-send-action-readiness.test.ts` contains one explicitly named `it.fails` probe; it is an expected failure for a remaining blocker, not a fixed security test. Its initial ordinary test run failed because mocked fetch ran once after capability became false. No real Graph request occurs. Staff production behavior is untouched; a reviewed final dispatch-authority correction remains necessary before live rollout.

## Exact installation prerequisites

Canonical SQL: `supabase/migrations/20261010084102_noura_claimed_job_authority.sql`, CLI-generated with installed Supabase 2.54.11. One-time transaction; 2-second installation lock and 30-second statement limits. It requires the reviewed service-read contract and purchase orchestration, plus the existing worker/profile/cost/Meta chain through `20261008173000_vel_staff_paid_send_entitlement.sql`. No target installation is inferred from local replay. Production installation remains separate and must stop on mismatched evidence.

`supabase/upgrade-packages/noura-worker-authority/preflight.readonly.sql` is metadata-only. Compare all 14 pinned worker/service function bodies, definer flags and empty search paths; service-only public RPC ACLs; both proof-view hashes; the financial immutability body; six exact financial and six exact service immutable triggers; service-table RLS and denied anon/authenticated/service-role table DML. The migration enforces those prerequisites and fails reapplication after wrapping the profile. No cloud state has been inspected.

Canonical SQL SHA-256 (UTF-8, no BOM, LF): `c44a1e42b8efbb106513b087fde8731323400ca54da1154d5820cd56aaa6dd34`.

## Verification

SQL uses the ownership-verified isolated PostgreSQL 17.6.1.136 harness: labeled container, no network, no ports, tmpfs, no volume/cloud URL/credentials. Existing synthetic worker and staff-paid fixtures are reused with explicit pre-payment Noura snapshots and guarded synthetic receipt grants. Synthetic activations exist only in this disposable database. Short-lived receipts are INSERT-only synthetic financial fixtures; they do not represent actual processor payments. No AI/provider call occurs. Legacy authentication dependency stubs are used; this is not live GoTrue/provider acceptance.

The first fixture run found a transaction-start timestamp preceding the offer and was corrected to use insertion-time timestamps and assert snapshot success. The initial expanded run passed 18 cases and exposed two fixtures violating conversation claim serialization; independent conversations fixed them. Another run passed 22 cases and exposed harness timeout limits, which were corrected explicitly for expiry barriers. The exact-source complete run then passed all 26 PostgreSQL cases plus three prerequisite-denial checks. Both downstream expiry barriers proved a still-valid paid receipt while blocked, waited through expiry, and denied after release with zero new capacity, AI ledger rows or budget holds. Negative and corrected logs remain separate.

Commands:

- `node node_modules/vitest/vitest.mjs run --config scripts/service-entitlement/noura-worker.optin.config.mjs`
- `node node_modules/vitest/vitest.mjs run src/lib/whatsapp/p4-send-action-readiness.test.ts src/lib/whatsapp/integration-worker.test.ts src/lib/answers/runtime/p3-runtime-boundaries.test.ts src/lib/answers/runtime/whatsapp-persona.test.ts src/lib/answers/approved-retrieval.test.ts src/lib/services/access.test.ts src/lib/services/decision.test.ts`
- `node node_modules/vitest/vitest.mjs run`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/eslint/bin/eslint.js .`
- `node node_modules/next/dist/bin/next build`
- `node --check scripts/service-entitlement/noura-worker.optin.mjs`
- `git diff --check`

Focused: 132 reported passes, including the one explicitly expected staff failure (131 ordinary passes). Aggregate: 1,429 reported passes, including that expected failure (1,428 ordinary passes), 42 opt-in skips. TypeScript, lint (existing reconcile.ts warning only), build (34 pages) passed. Final SQL suite has 26 cases plus three prerequisite-denial checks: inactive grant; binding/immutability; frame/capacity; tenant/claim substitution; joint cost rollback; logical-job fallback/dedup; model/stage/send revalidation; pending refunds/revocation; paid/allowance-period drift; historical jobs; final-slot concurrency; deactivation/takeover/paid-expiry waits; accepted/rejected/unknown replay; absent allowance; interrupted calls; and downstream source/budget expiry barriers. Ignored evidence: `artifacts/internal-ui/noura-worker-*.log`, `noura-staff-gap-red.log`.

Final container cleanup retained only the pre-existing `velora-c2-runtime-13861eb`; the ownership-verified temporary SQL containers were removed. Production prerequisites and live acceptance remain unverified. Independent review is the next step; customer rollout is not authorized by this local result.
