# Staff final-dispatch authority — local acceptance

Scope: forward local correction after `ea03b78378f977710b71a244cb9a2daaa030bc2d`. Production installation, deployment, credentials, provider execution and acceptance accounting remain outside this slice.

Normalized UTF-8/LF migration SHA256: `f761d282779a8e376ad8bbf759ba159484649e814189e715a9474e80b2b58c7a`.

## Failure and correction

The real `replyWhatsappConversation` action checked staff capabilities before asynchronous registry/window/Vault reads. Its last pre-Graph check only examined the cached payment expiry. The ordinary regression reproduced a Vault-time capability revocation followed by one mocked Graph fetch: 1 failed / 37 passed. No provider was contacted.

New authenticated staff intent inserts bind `actor_user_id` to the verified JWT actor and derive `staff_actor_session_id` from the JWT. The existing creation RPC supplies the actor; callers cannot supply provenance columns. Existing activity history, a live session, verified email or phone and actual read/reply access are required. Historical unbound intents receive no fabricated session or payment provenance and cannot pass the new gate. Existing historical claim/recovery contracts remain intact.

The service-only atomic claim stores the exact proven Live plan version and paid-through date on a bound intent in the same transaction. These values and the actor/session/intent identity are immutable. Direct service writes cannot forge provenance even by setting the internal GUC flags; the trigger requires the table-owner execution boundary as well as the exact transition. Attempt and dispatch tokens remain outside authenticated table SELECT and outside action responses.

After every asynchronous preparation read, the action calls `whatsapp_authorize_staff_dispatch` using its authenticated session and server-held intent/attempt token. The RPC locks company → Live subscription → conversation → intent, then retains the actor, session/activity, membership/grant/delegation, exact receipt and link authorization read set. Reverse contention on authorization rows fails closed with NOWAIT. Current wall-clock JWT/session/idle/claim/payment/window expiry is checked after lock waits. Current company status, assigned-conversation readability, reply capability, delegated coverage, link generation and complete proven payment identity are required. Known refund/reversal events awaiting settlement also deny dispatch.

One dispatch token/time marker is committed on the existing intent; there is no new queue or accounting ledger. Repeated or concurrent authorization consumes no second permission. An uncertain transport result, malformed success or replay response produces no Graph call, no authorization retry, and no finalizer that could overwrite another send's evidence. Definitive pre-provider denials use the existing fenced settlement path. Accepted/unknown/rejected provider outcomes retain their established persistence and repair behavior.

The authorization is a point-in-time gate immediately before network initiation. Once the request begins, later revocation cannot guarantee cancellation or recall. The application must retain accepted/uncertain evidence and avoid resending; database transactions are not held across provider I/O.

## Verification

All PostgreSQL fixtures are disposable synthetic tenants, sessions, Meta authorization and INSERT-only payment receipts. They substitute external Supabase Auth/Storage infrastructure; project authorization, RLS, locks, triggers and RPCs are actual migration SQL. Optional `auth.sessions.not_after` and `auth.users.banned_until` fields are added only to the disposable Auth stubs to exercise those checks. No cloud identities, customer content or real payment/provider calls are used.

The harness replays migrations through `20261008173000`, then the reviewed service read, purchase-orchestration and Noura worker authority migrations, followed by this correction. The unrelated G03 exact-generation migration is not part of this staff baseline; its narrow prerequisite does not match a generic historical replay. This is no evidence of cloud installation or full cloud schema parity.

Commands:

- `node node_modules/vitest/vitest.mjs run --config scripts/service-entitlement/staff-dispatch.optin.config.mjs` — 36 cases passed, three prerequisite-denial checks passed, and the five established staff paid-claim/outcome checks passed within the regression case.
- `node node_modules/vitest/vitest.mjs run src/lib/whatsapp/p4-send-action-readiness.test.ts src/lib/whatsapp/p4-send-readiness.test.ts src/lib/whatsapp/p4-claimed-binding.test.ts src/lib/whatsapp/send-settlement.test.ts src/lib/whatsapp/service-window.test.ts src/lib/whatsapp/meta-send-policy.test.ts src/lib/whatsapp/meta-routing-policy.test.ts` — 93 passed, including the former expected failure as an ordinary test and five replay/uncertainty cases.
- `node node_modules/vitest/vitest.mjs run` — 1,434 ordinary tests passed, 42 opt-in tests skipped; no expected failure remains in this regression.
- `node node_modules/typescript/bin/tsc --noEmit` — passed.
- `node node_modules/eslint/bin/eslint.js .` — zero errors, the existing `paymob/reconcile.ts:344` unused `_result` warning.
- `node node_modules/next/dist/bin/next build` — passed.
- `git diff --check` — passed.

Ignored local evidence: `artifacts/internal-ui/staff-final-red.log`, `staff-final-action.log`, `staff-final-focused.log`, `staff-final-aggregate.log`, `staff-final-types.log`, `staff-final-lint.log`, `staff-final-build.log`, and `staff-final-sql-complete.log`. Earlier failed SQL runs retain fixture/setup failures separately; no guards were disabled to make the fixtures pass. Prerequisite negative tests deliberately mutate a function body, RPC ACL and receipt trigger, verify denial, then restore them before installing the migration.

Only harness-created containers are removed, after verifying exact run labels, network=none, tmpfs storage and no published ports/volumes. The preexisting `velora-c2-runtime-13861eb` is untouched.

## Remaining boundaries

Independent review and separately approved production installation/live acceptance are outstanding. The metadata-only preflight is `supabase/upgrade-packages/staff-dispatch-authority/preflight.readonly.sql`; installation validates ten exact function bodies, definer/search-path properties, both receipt view fingerprints, immutable receipt body/six triggers, claim ACL and table-owner boundary. No production migrations were run and no push/deployment occurred.

Accepted-intent quota commitment independent of display-message repair remains a separate deferred accounting slice. Customer answering activation, service-grant activation, commercial prices/quotas and paid AI trials are unchanged. This local result does not establish production readiness.
