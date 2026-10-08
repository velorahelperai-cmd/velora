# Overnight Velora unified candidate

**Ready for Local Testing: YES (offline fixtures and public preview). Ready for Staging: NO.** Production payment, AI and WhatsApp readiness are not certified. No real customer, provider or cloud activation occurred.

Acceptance follow-up: [final acceptance update](final-acceptance-update.md) records the latest A1/A2 inclusion proofs, plan-selection/return fixes, Admin Noura labels and fresh unified verification. The figures below are the saved `200100b` base evidence; they are not the later acceptance-run totals.

Final branch `integration/overnight-velora`. Fixed P1/P2 base `485d21e44eb0c676a3aec9cfe47c5f5f40f86ade`. The exact final commit SHA is supplied in the delivery message; the independent final commit containing this report follows the local integration merge. Original worktrees/branches are preserved.

## Included source commits

| Source branch | Frozen source SHA / treatment |
|---|---|
| `overnight/security-foundation` | `13861eb3dd20717c84517870667b77351932800c`; fast-forward after verifying saved C1 security results |
| `overnight/ai-whatsapp-runtime` | `af75afe8588e9da6e80faa90ada8501158800e6d`; fast-forward next |
| `overnight/ui-inbox` | `7bca9ff8c867e6eedd1da6d5194f78dc2c7c2b49`; local integration merge |
| `overnight/ui-onboarding` | Initial `16d7cca2ff3a6c5ad5591195628f9239c36c0b7a` includes `58415d0` and `1aca190`; latest clean frozen `6fa67e9bd2d99416bf2000a5f0b4c2965a44d884` additionally includes `161c2100`, `83f66c3c`, merged last |
| Preserved P3/P4 | `23bbec86591be63f8a2e699429eb2340e7ff8a6c`, `b24064f625e9b2a3a9f96ca84d35e4aa1b12ec13`; already ancestors through the saved integration, not merged again |

All four source worktrees were clean at the frozen SHAs. UI branch-specific completion reports were absent from Git; commit messages were not accepted as test evidence. The combined source was inspected, repaired and verified independently. Two onboarding conflicts in knowledge/WhatsApp settings were resolved while retaining usage-role editing, Embedded Signup, authorization expiry and the intended UI.

The source Onboarding branch advanced with three completed landing commits while integration ran. Its latest five-file change was independently checked: scroll/UI/local-image changes only, no external calls, secrets, persistence or production flags. Static marketing prices/quotas, live/launch-ready claims and booking/dispatch confirmations were corrected as clearly illustrative examples awaiting team confirmation. Source ownership was preserved; only the final integration copy was edited.

## Completed and corrected

- Reused verified Meta WABA/phone routing, per-company Vault credentials, expiry/revocation, raw-body HMAC, the existing durable job queue, FIFO/backoff/dead-letter, crash recovery and monotonic delivery. No parallel queue/ledger or per-company fine-tuning.
- Reused Noura/نورا system prompts and actual router/Approved Knowledge, SQL-enforced paid entitlement and joint message-capacity/AI-cost reservation, saved response/original-inbound/outbound-intent bindings, generation/credential/window rechecks, accepted-versus-delivered states and idempotent settlement. Unknown cost/send outcomes remain held/reviewed and never receive blind paid/send retries.
- Added the bounded initial inbox/refresh contract, then adapted Inbox/thread/audit pagination, actual unread messages and exact visible-boundary acknowledgement, authoritative controls and connection state. Changed membership fingerprints invalidate read caches while same-scope stable send identities and unknown locks survive. Search/subset metrics are explicitly limited to loaded rows.
- Dashboard uses bounded pages, actual SQL totals/intervention counts and loaded automation-permission counts; it does not traverse every transcript or claim actual AI activity from `automation_allowed`. Onboarding hydrates persisted fields from SQL and cannot advance on failed/wrong-company saves. Meta verification/authorization/tests/rollout and subscription are separate states.
- Removed invented knowledge facts, feature availability, capacities and unknown billing-period/date activation claims. Prices/capacity require catalog evidence. The inherited Noura Basic 45 OMR Test-selection reference remains conservative and is not evidence of commercial/processor Live approval; misleading approval copy was removed.
- Added rendered-company guards to seven write actions and knowledge/review/history reloads, including empty/null results. A stale tab cannot write or attribute a newly selected workspace's data to the old company. Legacy callers without the optional fields remain compatible; integrated UI callers supply them.
- Fixed missing-Supabase public-page crashes: optional auth observers tolerate unavailable SDK initialization while strict client construction/server authorization and authoritative sign-out remain intact. Expiry still clears identity and redirects protected routes.

Detailed source/evidence: [runtime](c2-runtime-report.md), [Inbox](c2-inbox-ui-report.md), [onboarding](c2-onboarding-ui-report.md), [workspace bindings](c2-workspace-binding-report.md), [C1 security](../security-foundation/c1-report.md).

## Shared SQL dependency

`20261008170000_vel_owner_review_scope_read.sql` adds only the scoped owner review-history reader and preserves the historical no-argument RPC. That RPC selects the first active owned company, so it could silently substitute a new scope after ownership changes. The new reader pins the requested company, canonical active owner, verified identity and actual two-hour session activity. Only safe review fields are projected. No Auth/RLS ownership policy was changed; fixtures respect the existing one-active-owner-per-user constraint.

This is a documented C1 read-contract dependency implemented only on the final integration branch after C1 was frozen. Independent review returned **PASS**, including the SQL, binding and partial-page contracts; two caller/label findings were fixed and re-reviewed. The new getter never falls back to the old unscoped history when the new RPC is missing. Cloud application remains separately approved work; no cloud SQL was executed.

## Final verification

| Category | PASS | FAIL | Skipped / NOT RUN |
|---|---:|---:|---|
| Default application suite | 1194 | 0 | 40 skipped; 104 files passed, 10 skipped |
| Actual isolated PostgreSQL: Billing acceptance + receipt/races | 47 | 0 | 0; includes populated legacy upgrade |
| Actual isolated PostgreSQL: AI security + independent-session races | 19 | 0 | 0 |
| Actual isolated PostgreSQL: full AI/WhatsApp/inbox regression | 134 | 0 | 0 |
| Actual isolated PostgreSQL: scoped owner review reader | 7 | 0 | 0 |
| SQL-backed application journeys | 22 | 0 | 0: Billing 2, admin AI 3, worker integration 12, HTTP consumer 4, complete company journey 1 |
| Headless browser public desktop/mobile/access smoke | 4 | 0 | 0 |
| TypeScript / scoped/full ESLint / whitespace checks | PASS | 0 errors | 2 pre-existing lint warnings in unchanged Billing files |
| Next.js 16.3.8 production build | PASS | 0 | 33 routes |
| Real Auth browser login → protected UI, Meta OAuth, paid models, real payment/send, cloud parity | — | — | NOT RUN; no configured local Supabase Auth and no real-provider authorization |

Numbers are separate assertion/case categories, not unique end-to-end production journeys. The default skipped cases include separately executed opt-in database tests. Earlier failing integration checkpoints (scope fixture assumptions, public SDK crash, stale history callers and unsupported transcript-derived counters) were corrected; only final results above count as passed.

The complete synthetic journey verified authenticated owner-session SQL/RLS, dashboard readiness, company knowledge, paid Live-proof fixture, credential state, Noura generation/accounting, Inbox/read acknowledgement, human takeover and retained usage. Auth identity/transport boundaries, model and Graph responses are mocked; actual project SQL, constraints, RLS, transactions, Vault and accounting execute. Password/OAuth login through a real Auth service is not inferred from this fixture identity.

Local PostgreSQL uses only `velora-c2-runtime-13861eb`, label `c2-runtime-integration`, network none, no exposed ports/persistent mounts, tmpfs data. The 69 prerequisite source migrations were executed through the existing full harness; the final scoped reader brings the local chain to 70. Seven new scope assertions validate ownership transfer, unrelated tenant, safe audit projection/ACL, staff/revoked membership, idle expiry and unverified identity. Independent sessions observed real PostgreSQL locks, including the existing 14 WhatsApp cases and new AI/Billing races; PGlite and Promise.all alone were not treated as concurrency evidence.

## Local preview and remaining gates

From the attached final worktree, run `npm run start -- --hostname 127.0.0.1 --port 3108` after `npm ci` and `npm run build`, with all Live flags off. The local preview URL is `http://127.0.0.1:3108`. [Local setup and verification](overnight-local-testing.md) includes fixture commands. Screenshots are retained under `artifacts/overnight-preview/` (ignored local evidence), with desktop/mobile login, homepage and protected-access guard.

The preview renders public pages and truthful unconfigured/anonymous states. It does not contain fixture authentication bypasses or fake company accounts. Protected manual browsing/sign-in needs an actual separately provisioned local Supabase Auth/HTTP setup. Automatic fixtures test the integrated backend and data contracts instead.

Staging remains blocked on exact cloud history/function/ACL/Vault/data parity and separately approved migration/rollout; Paymob merchant/OMR/order namespace plus deadline/refund/reconciliation policies; supported catalog approval; reviewed company AI-budget provisioning/monthly rotation; production worker scheduling/monitoring and unknown-outcome operations; Meta app/scopes/domains/webhooks/customer grants and optional coexistence/history sync; and the full real-account journey. No production readiness claim follows from mocks or local SQL.

No provider/customer credential was copied, logged or committed. Changed-file credential-pattern scanning found zero matches. A broader scan of every integrated file matched only five deliberate redaction fixtures in two older P3 test files (explicit synthetic markers or sequential alphabet/digits); they were inspected without printing their values. No actual credential was found. Customer Live AI and External Send remain off; no production settings, push, merge to original/main branches, cloud migration, deployment, real payment/model/WhatsApp send or backup was performed.
