# Preserved HTTP test remainders — local evaluation

Date: 2026-10-09 (Asia/Muscat). Branch: `codex/remainders-validation`.
Base: `667f88d9cf0dea4945981d3913345db0bde5602d` (`origin/main`, fetched for this task).
Scope: test tools and this audit update only; no product, pricing, ACL/RLS or migration changes.

## Preservation and file decisions

Independent immutable-by-convention copy: `C:/Users/DELL/.codex/preserved/velora-remainders-2026-10-09-83a2308a`.
`manifest.json` records the original source root/HEAD, base main, byte lengths and SHA-256. Original and copied bytes matched 5/5 before edits and were checked again during evaluation. The originals remain in the `overnight-velora-integration` worktree. Nothing was moved/deleted there.

| Original file | Purpose and equivalent in main | Decision |
|---|---|---|
| `scripts/integration/local-http-stack.mjs` | Real GoTrue migrations + PostgREST + disposable PostgreSQL, internal network and loopback ingress. `scripts/whatsapp-integration/postgres.mjs:25-27` instead bootstraps SQL dependency stubs; not an equivalent HTTP backend. | READY FOR REVIEW: hardened isolated copy passed native bootstrap, crypto and cleanup |
| `scripts/integration/local-http-browser-journey.mjs` | Real signup/company/text knowledge/approval/catalog, honest unavailable states and Inbox controls. `scripts/integration/preview-smoke.mjs:20-26` covers anonymous pages only. | READY FOR REVIEW: final local UI run passed; earlier timing observations remain disclosed |
| `scripts/integration/local-http-e2e.mjs` | Owns app/backend/browser lifecycle and joins real UI writes to synthetic worker fixtures. No equivalent orchestrator in main. | READY FOR REVIEW: opt-in run completed, exit 0; truthful diagnostic failure mode retained |
| `src/lib/whatsapp/local-http-runtime-e2e.test.ts` | SDK → Auth/PostgREST/RLS/RPC → receipts/Meta fixtures/worker/accounting/Inbox. `src/lib/whatsapp/company-journey-postgres.test.ts:12,14,89,90` uses SQL adapters instead; business coverage overlaps but transport coverage differs. | READY FOR REVIEW: renamed working copy `local-http-runtime-e2e.optin.ts`; prepare and answer executions passed; original preserved unchanged |
| `artifacts/audit/VELORA-COMPLETE-BUSINESS-TECHNICAL-JOURNEY-AUDIT-2026-10-09.md` | Historical journey audit at `31f1fc0`, preceding G07 and later workspace-binding fixes. | Historical/incomplete as a current-status report. Retained independently and at source; not added to Git. Updated summary: `remainders-audit-notebooklm-2026-10-09.md` |

No file is classified duplicate merely because an SQL/unit test exercises related business logic. No Desktop/Ready or Cinematic archive was imported.

## Opt-in run and prerequisites

Use this dedicated worktree, not an active development checkout. Node 24, `npm ci --ignore-scripts --no-audit --no-fund`, Windows listener ownership APIs, local Docker Engine, Chrome and the already installed Codex bundled Playwright are required.

Cached images (the harness refuses to pull):

- `supabase/postgres:17.6.1.136`
- `supabase/gotrue:v2.196.0`
- `postgrest/postgrest:v14.17`

Keep ports 3120/3130/3140/3141 free. The harness rejects a busy port without stopping its owner. Project `.env` / `.env.*` files other than `.env.example` cause refusal by presence; their values are never consumed. Do not copy credentials into this worktree.

```powershell
node --test scripts/integration/local-http-safety.optin.mjs
node scripts/integration/local-http-e2e.mjs --run
```

The runtime is selected only by `scripts/integration/vitest.local-http.config.mts`, with `envDir:false`, `envFile:false`, serial execution and an explicit `.optin.ts` include. The launcher supplies `C1_HTTP_E2E_TESTS=1` to its synthetic prepare/answer subprocesses. `package.json` and the default `vitest.config.ts` are unchanged. Running the launcher without `--run` fails before startup; importing it is inert. Without the opt-in environment, the custom-config test skips and is **not** a pass.

The app runs at `http://127.0.0.1:3120` during the test. Optional `--keep-alive` retains only the harness-owned stack for deliberate local inspection; Ctrl+C performs verified cleanup. Default run cleans up automatically. Artifacts are ignored under `artifacts/c1-http-e2e` and `artifacts/local-http-browser-journey`; they are not committed.

An intermittent setup-navigation failure was observed and left unrepaired (UI-NAV-01 in the audit). To evaluate independent worker paths despite **that exact** failure:

```powershell
node scripts/integration/local-http-e2e.mjs --run --record-setup-navigation-failure
```

This diagnostic option retains the screenshot and expected/observed step, records a FAIL, does not retry/force navigation, and retains exit 1 when the issue recurs. Other failures still abort. It is not a passing-test workaround or a product fix.

## Isolation and harness repairs

- Children receive an OS environment allowlist, not inherited provider keys, proxies or preloads. Next telemetry is disabled. A preloaded guard rejects external fetch/HTTP/HTTPS/TCP before dispatch; HTTP redirects are refused. Playwright context routes allow only the local app/backend.
- Docker context must use a local pipe/socket. Each run has a distinct **internal** network, task/run labels, image verification, PostgreSQL tmpfs, no database host port and no persistent volume. Cleanup rechecks identities and deletes only this run's owned containers/network; existing Docker resources are retained.
- Next readiness requires a live owned PID subtree/listener. Existing listeners are never trusted, killed or given synthetic credentials. Children have bounded timeouts and serialized cleanup.
- RED: an early TCP fallback listener raced `docker start --attach`, stealing its published Auth port. Fix: wait for the owned Auth container to be running before inspecting actual bindings/installing fallback. GoTrue then started normally.
- RED: Windows `NODE_OPTIONS` stripped path backslashes, so the guard failed to preload. Fix: forward slashes in the quoted absolute preload path; a subprocess regression failed before and passed after the repair.
- RED: the old runtime fixture tried a direct company-status UPDATE, which correctly failed SQLSTATE `42501`. Fix: preserve that rejection as a regression and provision the synthetic active company through **existing** `admin_set_company_status` with a real local Auth session for the synthetic platform owner. No status-change guard, grant or permission was weakened.
- The old HTTP stack omitted the local Vault platform prerequisite, so Meta signup could not start. The cached PostgreSQL image contains the genuine `supabase_vault`/`pgsodium` extensions. Reuse the existing `scripts/whatsapp-integration/run.mjs:20` prerequisite, initialize the image's reviewed local random-key script with output discarded (`overnight-local-testing.md:21`), and verify native encryption/decryption with a rolled-back synthetic probe. No Vault mock, Cloud change, project migration or new permission grant is used.
- The original Inbox locator required an emoji-free exact button name, but the real UI includes a decorative robot/person. Use the existing `Resume Noura` / `Take over from Noura` titles (`src/components/app/conversations.tsx:1649,1660`); no UI or behavior change. The runtime's test recipient is deliberately longer than an E.164 phone number, so it cannot represent a real contact.
- A first-load HTML preview can be visible before client handlers exist (installed Next guide `05-server-and-client-components.md:123-129`). For the pinned React 19.3 runtime, critical client controls wait for React's actual `onClick` attachment before the single click; no arbitrary sleep, click retry or forced product state. This test-only synchronization depends on React's `__reactProps$` marker and must be reviewed on a React upgrade. Its delayed-handler regression passes. Intermittent observations remain documented rather than declared fixed in the product.
- Docker/SQL diagnostics report only fixed operation names and SQLSTATE, not SQL text, credentials or stderr. DOM logging avoids form values/page bodies. Shared files retain their original content at the preservation location.

The isolated fixture uses an explicitly synthetic Live receipt and approved deadline flag to exercise existing SQL entitlement contracts. It does not approve a production deadline/refund policy, prove OMR processor conversion, perform a Paymob checkout or move money. Synthetic company budget/cost values are test data only. Meta Graph is a closed finite fake transport; AI and send functions are mocked in the Vitest subprocess. The unmodified Next application keeps all customer/worker/send/payment execution flags disabled. Customer Noura trials stay disabled.

## Fresh results

Final evaluated command: `node scripts/integration/local-http-e2e.mjs --run --record-setup-navigation-failure`, **exit 0**. The diagnostic option suppressed no failure in this final run: `uiFailed` is empty. It never forced a selected step, replayed a click, or modified a product guard.

| Check | PASS / FAIL / BLOCKED / NOT RUN |
|---|---|
| Safety/opt-in subprocess regressions | **7 PASS / 0 FAIL**, explicit Node test runner |
| Native PostgreSQL bootstrap | **71/71 project migrations PASS**, genuine GoTrue migrations and native Vault encryption/decryption probe PASS |
| Customer browser assertions | **16 PASS / 0 FAIL / 4 BLOCKED operations** |
| Separate platform-owner catalog publication | **1 PASS / 0 FAIL**, real UI → database persistence |
| Runtime integration | **2 PASS / 0 FAIL** executions of one opt-in test: prepare + answer; native HTTP/Auth/PostgREST/RLS/RPC/database, mocked providers |
| TypeScript | PASS, `tsc --noEmit`, exit 0 |
| Scoped ESLint | PASS, eight harness/config/test files, exit 0 |
| Default test discovery | Both `.optin` files excluded by installed Vitest default patterns; main config/package scripts unchanged |
| Owned runtime cleanup | PASS: final run containers/network removed; prior/unowned resources retained |
| PGlite, broad concurrency, entire default application suite and production build | **NOT RUN** in this tool-only evaluation; no current pass claim |
| Cloud, actual Paymob/Meta/AI/WhatsApp delivery | **NOT RUN**, forbidden |

`journey-result.json` records 36 local HTTP calls in answer phase, exactly one **mock** model call and one **mock** send, 30 synthetic tokens, successful automated outbound quota 1, held quota 0, durable cost/budget/ledger assertions, and delivery **accepted**, never delivered. The browser verified the saved reply and read boundary, resumed automation, took over, and retained accounting. Cross-tenant reads/retrieval/Meta start were denied; direct service-role budget/ledger updates returned `42501`.

Earlier attempts **in this task** failed before the tool/fixture corrections listed above. Additionally, setup review navigation and Knowledge modal opening timed out intermittently before client-event synchronization. Their screenshots are retained. Setup navigation's precise cause remains UNVERIFIED; the final success is not presented as a product fix or proof that every timing/role/browser is covered. Earlier failures are not erased or combined into the final PASS count.

Final artifacts: `artifacts/c1-http-e2e/journey-result.json`, `runtime-result.json`, and screenshots under `artifacts/local-http-browser-journey/`. Safe evidence copies and hashes are retained in the independent preservation folder under `evaluation-evidence`; no credentials/environment files are included.

The first three excluded cases are independent of HTTP transport: provider checkout and real Meta authorization require forbidden external execution; the customer trial returns `NEEDS_SETUP` by source design. The additional review submission is blocked because the trial cannot pass. Assertions that the UI presents these limitations honestly may pass; the operations themselves are **BLOCKED**, never counted as successful provider/service runs.

The HTTP payment UI run checks proven-success despite `?success=false` and foreign-order rejection despite `?success=true`. It does **not** produce browser fixtures for every financial status; `runtime-result.paymentStates` is absent in the supplied remainder. Refund/pending/replay coverage in main's existing G07 tests is not claimed as fresh HTTP coverage.

No general PostgreSQL concurrency suite, Storage upload service, staff onboarding/grant/revoke browser journey, Cloud parity or real provider delivery is certified by this harness. A fake send's `accepted` status is not `delivered`.

## Historical evidence, separate from new results

- The previous prototype artifact reported 8 successful browser checks and 3 blocked operations, then failed at the setup-review stage. That is historical evidence, not the result of this branch.
- G07's historical report records 2 actual PostgreSQL tests passing for financial view parity, settlement, partial-refund review and replay (`g07-financial-truth-report.md:45,63`). They were not rerun solely to refresh this audit.
- Prior merged unit/native PostgreSQL counts are not combined with this task's results.

## Independent review boundary

The NotebookLM summary re-evaluates G01–G17 against the current main source and distinguishes implementation, disabled rollout, unresolved product gaps and unverified Cloud/provider behavior. G03 remains a separate product task; G12 contrast and G15 retention-policy wiring also remain outside this tool-only task.

No push, PR, merge, deployment, Cloud SQL, secret modification, paid subscription, real AI/Meta/Paymob call or external WhatsApp message was performed. Actual provider spend: zero; only local compute and dependency installation. Completion of this evaluation is not approval: stop for Antigravity's independent review.
