# C2 final Meta integration update

**Unified local fixture acceptance: PASS. Ready for Staging: NO. Release Security Gate: BLOCKED.** Real Auth, cloud parity, Meta, payment, model and delivery acceptance remain unverified. No real customer/provider execution occurred.

Branch: `integration/overnight-velora`. Frozen starting SHA: `6cd64560fd4f1b2af23f513cf4a430004ed4940b`. The final local commit containing this report is supplied in the delivery message. Original source branches/worktrees are preserved. Before modification, Git was clean and the app/task inventory showed no other active local task editing this checkout; delegated work within this task used separate file ownership and was frozen before final verification.

## Inclusion and preservation

`7c7c17d2e9dfa59f15c3a57a411bd9770d6a8bce` was already an ancestor. No additional merge/cherry-pick was necessary. Each required SHA below was found exactly once in Git history, with `merge-base --is-ancestor` exit 0:

- Meta: `7c7c17d`.
- Security: `61163a6`; subsequent saved C1 hardening remains included.
- P3/P4: `23bbec8`, `b24064f`.
- A2 Dashboard/Onboarding/Knowledge: `58415d0`.
- A2 catalog/variants: `1aca190`.
- A1 Unified Inbox: `7bca9ff`.
- Selected-plan/Noura acceptance corrections: `6cd6456`.

## Focused findings and corrections

| Finding | Evidence file:line | Local correction and evidence | Remaining dependency |
|---|---|---|---|
| High: manual staff/owner replies checked Meta/window/capability but not current paid entitlement | `supabase/migrations/20261008143000_vel_meta_routing_send_policy.sql:171`; `20261006120000_vel_access_management_01.sql:1343`; existing `src/lib/billing/subscription-state.ts:94` requires paid manual sending | New forward `20261008173000_vel_staff_paid_send_entitlement.sql` preserves the original claim chain, locks stored company → Live subscription → conversation → intent, and checks the existing authoritative paid-proof reader for NEW dispatch only. Unpaid denial rolls back the attempted allocation. SQL RED reproduced actual unpaid allocation; GREEN passed. | Review/approve compatible forward Cloud application separately. Historical migrations were not edited. |
| Application could otherwise use an old Cloud claim RPC without the new paid gate | `src/lib/whatsapp/actions.ts:516`, `:563` | New claims must carry exact company/Live/plan/future paid-through attestation before Vault lookup and immediately before Graph. Missing/foreign/Test/malformed/expired proof prevents provider contact and uses the existing rejection/unknown persistence handling. Old accepted/unknown paths are preserved. Localized UI explains inactive subscription. | Deploy compatible schema/application together after parity verification; old schemas fail closed. |
| Stale text claimed per-number credentials were not yet stored | `src/lib/app-copy.ts:572`, `:746`, `:1364`, `:1538` | Replaced four Arabic/English values with connection/authorization evidence and separate deployment/testing/rollout requirements. Verified Meta tokens are actually stored encrypted in Vault; no token-presence assertion is made for every company. | Meta app/configuration/customer authorization and actual tests remain separate. |
| Opening documentation described an obsolete prototype and wrong signup flag | `README.md:3`; `docs/integration/overnight-local-testing.md:3` | Updated actual integration state, local Auth limitation, Cloud prerequisites and correct `WHATSAPP_EMBEDDED_SIGNUP` flag. Added explicit nonempty tmpfs safety instructions. No outside references were followed. | Protected browser login still needs a local Supabase Auth/REST environment. |

Independent source re-review returned PASS with no material remaining issue in the reviewed correction scope. Financial settlement, processor amount conversion, prices and business deadline/refund/grace policies were not changed. New code grants no service from an unproved future date, Test subscription or catalog publication alone.

## Meta compatibility and complete fixture journey

Verified current signup owner/session/nonce bindings, WABA + phone ownership/proof, one-time completion, Vault encryption/replacement/expiry/revocation and exact generation routing. Inbox/onboarding authorization states match the provider registry. AI uses the same company-approved knowledge/profile and existing paid entitlement + joint message/cost reservation; no parallel queue/ledger or fine-tuning was introduced.

Expanded `src/lib/whatsapp/company-journey-postgres.test.ts` through actual signup flow/store and provider adapter. It uses a strict ten-request Graph HTTP mock, synthetic numeric assets and an opaque synthetic token; unmatched HTTP throws. Actual authenticated start/claim and service-role finalize write Vault evidence. Replay, wrong-company claim/secret and stale generation are denied. A signed webhook routes to a newly created conversation, deduplicates, and preserves the original immutable conversation. Owner control then enables automation only in the test, and actual worker/Noura accounting, saved reply/intent, Inbox/read boundary and human takeover complete the journey.

Auth identity/transport, model and outbound provider boundaries are mocked. Actual project SQL, RLS, ACLs, transactions, Vault encryption, token usage/cost and message/receipt bindings execute. This is not password/OAuth registration or real Meta delivery. Customer Live Answering and external-send source/host switches remain disabled outside explicitly mocked tests.

## Fresh verification

| Category | PASS | FAIL | Skipped / NOT RUN |
|---|---:|---:|---|
| Default unified application suite | 1253 | 0 | 40 skipped; 110 files passed, 10 skipped |
| Actual PostgreSQL Billing upgrade/lifecycle/catalog/races | 29 | 0 | 0; populated legacy upgrade includes 18 scenarios / 20 assertions |
| Actual PostgreSQL immutable receipts and refund/renewal/rollback | 18 | 0 | 15 immutability + 3 transaction cases |
| Actual PostgreSQL full AI/WhatsApp/Meta/Inbox + staff paid SQL | 139 | 0 | 0; all 71 current source migrations executed locally |
| New independent-session staff expiry/revocation lock races | 2 | 0 | 0; real Lock and blocking backend observations |
| Actual PostgreSQL AI security/budget independent sessions | 19 | 0 | 14 security + 5 races; same unchanged AI schema from before the staff-only forward correction |
| Actual PostgreSQL scoped owner review reader | 7 | 0 | 0 |
| SQL-backed application suites / HTTP consumer / expanded company journey | 22 | 0 | Billing 2, admin AI 3, WhatsApp 12, actual HTTP consumer 4, expanded Meta/company journey 1; providers and Auth transport are synthetic |
| TypeScript | PASS | 0 | Exit 0 |
| Full ESLint | PASS | 0 errors | 2 pre-existing unused-variable warnings in `reconcile.ts:344`, `return-status.ts:78` |
| Next.js 16.3.8 production build | PASS | 0 | Compile/type/static generation completed; exit 0 |
| Fresh local browser public/access smoke | 4 | 0 | Desktop/mobile and protected access guard; real Auth is NOT RUN |
| PGlite / real Auth / cloud parity / real providers | — | — | NOT RUN; not counted as successful |

Database counts total 214 assertion/case groups across separate suites, not 214 unique customer journeys. The complete default suite is separate; skipped opt-in tests are not silently counted as passed. Full SQL regression ran at 71 migrations with 139 passes; the subsequently executed two new lock races bring that category to 141 without repeating bootstrap. Fixture and application checks are separately reported.

The initial scratch-container creation used an empty tmpfs option string; the target safety verifier rejected it BEFORE bootstrap/SQL. Its exact task label/network/mount metadata was verified, then that task-owned empty disposable container was replaced using `rw,size=1g`; safety guards were not weakened. A temporary TypeScript narrowing error while the paid gate was being edited was corrected and fresh typecheck/build passed. No failed checkpoint was represented as successful.

## Remaining Cloud and commercial gates

- Exact deployed migration history, function definitions/ACLs/constraints/legacy data and Vault parity remain BLOCKED. Local object counts or 71 local migrations are not proof of Cloud parity. No Cloud SQL or migration repair was run.
- The new staff-paid forward RPC/application contract, existing financial/accounting/Meta/Inbox prerequisites and their operator rollout must be reviewed together. No migration was added to Cloud.
- Actual Meta app/Tech Provider eligibility, allowed HTTPS domains, pinned Graph version, app/config IDs, webhook/app secret/verify token, server introspection credential, customer grants/payment method and WABA subscriptions require the intended accounts. Standard signup is implemented; coexistence/history sync remain unsupported setup dependencies.
- Production worker authentication/scheduling/monitoring, expiry/rotation/revocation operations, unknown cost/send reconciliation, company AI budget provisioning and separately approved customer/external-send rollout remain required. Model availability and real provider behavior are NOT RUN. Administrative AI trials retain the separate persisted 1 OMR lifetime cap.
- Paymob merchant/environment/order namespace and actual Oman processing-unit contract, commercial catalog approval and owner deadline/late-payment/refund/reconciliation policies remain unapproved/unverified. Conversion factors and business policies were unchanged; new Live checkout remains refused.
- Real local Auth/REST password/OAuth and protected browser journey remain NOT RUN. Company review, saved phone entry, verified registration and payment-page success do not independently activate paid customer replies.

## Opening and testing locally

Use the attached worktree `C:\Users\DELL\.codex\worktrees\overnight-velora-integration\Velora new`:

```powershell
npm run build
npm run start -- --hostname 127.0.0.1 --port 3108
```

Open `http://127.0.0.1:3108/` or `/login`. Keep provider keys absent and `WHATSAPP_EMBEDDED_SIGNUP`, `WHATSAPP_ALLOW_EXTERNAL_SEND`, `WHATSAPP_WORKER_ENABLED` unset/false. Public/unconfigured/access-guard states are honest; no fake account or Auth bypass is included. Protected manual pages require a separately provisioned local Supabase Auth/REST setup with matching schema and synthetic memberships.

Default tests: `npx vitest run --reporter=dot`. [Offline SQL/worker/journey instructions](overnight-local-testing.md) describe the labelled no-network/no-port/tmpfs container and explicit opt-in commands; the full WhatsApp runner now also includes staff paid SQL and both staff concurrency cases. Do not use Cloud/customer keys or a remote database target.

No Push, merge to original/main branches, deployment, Cloud migration/SQL, real model/payment/WhatsApp call, real-secret change or backup was performed. Final changed/staged credential-pattern and whitespace checks precede the local commit.

Changed-file credential-pattern scan covered 15 files and found zero matching files. No real credential was read/copied into the worktree. The task-labelled SQL container remains running for explicit offline fixture reruns, with no network, ports or persistent mounts; its data is synthetic and volatile. It does not provide browser Auth/REST. The loopback production preview remains available at port 3108 with provider/Auth settings absent and activation flags disabled.
