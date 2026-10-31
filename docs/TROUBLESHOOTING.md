# Local Smart Debugging — تشغيل عند الطلب

Scope: LOCAL-SMART-DEBUG-20261026. This is the owner-requested searchable repository troubleshooting entrypoint and local verification record. Existing historical lessons remain in [Brain / 08-LESSONS](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/08-LESSONS.md>); this file does not replace product decisions or the Engineering Constitution. Both are searched by `lookup` and before checks. No daemon, dashboard, telemetry upload, dependencies, automatic product edits, commit, push or deployment.

## التشغيل المختصر — Cursor وCodex

From the canonical checkout, read AGENTS.md, inspect Git status and preserve other work. Coordinate affected paths without mandatory writer leases or a custom workspace guard.

```powershell
node scripts/debug/debug.mjs lookup TS2322
Get-Content .\sanitized-local.log | node scripts/debug/debug.mjs analyze runtime
npx eslint src/path/file.ts
npx vitest run --config vitest.ci.config.ts src/path/file.test.ts
node --test scripts/debug/debug.test.mjs
npx tsc --noEmit --incremental false
```

`analyze` categories: `types`, `lint` (ESLint JSON or text), `runtime`, `browser`, `network`, `supabase`, `react`, `build`, `test`. Feed actual sanitized logs, not hypotheses. Structured JSON lines may supply `message`, `code`/`error_code`, `file`, `line`. TypeScript locations and stack frames are extracted where present. Each finding includes signature, code, file/line, message, UNKNOWN cause, observed impact, verification and a prior-record match. Empty/unrecognized logs are **not PASS**. Text formats are best-effort: retain the original sanitized stack if parsing lacks a location. Max input 1 MiB / 100 findings; not an exhaustive log collector.

For a bounded browser sample use the existing bundled Playwright module (obtain its actual path from Codex workspace dependencies) and installed Chrome:

```powershell
node scripts/debug/debug.mjs browser http://127.0.0.1:3720/ 'C:\Users\DELL\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\playwright\index.mjs'
```

This opens a fresh headless browser, captures console errors, page exceptions, failed requests and HTTP 4xx/5xx for two seconds, then closes it. Only same-origin loopback GET/HEAD requests are allowed; external/mutating requests and WebSockets are blocked. Blocked requests are collector restrictions, not proof of product faults. Only use against an approved local read-only page; GET alone cannot guarantee application-side absence of writes. No authenticated state, headers, bodies, HAR or screenshots are collected. Network failure does not prove provider failure or database persistence. Use existing opt-in native integration runners for actual authorized integration acceptance.

## Workflow and test economy

1. Search the error code/signature here and in Brain. Confirm the old record applies to the current version/environment.
2. Read the exact error, stack and affected source. Record root cause as Confirmed, Suspected or Unknown and name the evidence. Use Graphify only for needed dependency/impact mapping, checking indexed SHA/date first; stale graphs are not current-source evidence.
3. Preserve other agents' edits, coordinate affected paths, and make the smallest causal fix. No automatic fixes based on text matching. The agent performs the diagnosis and repair; the CLI standardizes evidence and runs checks.
4. Run the named test first, then directly affected regression/security checks. Use explicit affected test files and the existing CI configuration; apply the existing offline network guard where required. Zero tests/failing/time-limited processes are not successful acceptance.
5. Before a repeat, compare source/config/lockfile/tool version, command and relevant environment against the previous receipt. If inputs and evidence are unchanged, cite the prior result rather than rerun. A failure requires a changed input or new evidence; record that reason. Do not automatically reuse runtime/browser/DB results: external state is an input. No new test-result cache is introduced because the dependency/environment closure is not generally provable. Existing compiler/framework caches remain untouched; isolated `check types` disables incremental writes to avoid another writer's tsbuildinfo. TypeScript is project-wide, not falsely presented as a per-file typecheck.
6. Full build/full suite are not part of each debug cycle. Independent CI and applicable secrets, RLS, and security checks remain mandatory for delivery; custom pre-push gates are not mandatory. This task does not publish and does not claim those gates ran. Payment/identity/RLS changes need their applicable security tests and separate authority; no mock proves a real integration.
7. Save the confirmed fix below with actual verification, affected files, date/commit and evidence limits. If reproduction/fix fails, save new evidence and change the hypothesis instead of blind retry. Stop after verified repair.

## Environment inventory — 2026-10-26

| Tool | Actual evidence / readiness |
|---|---|
| TypeScript | Installed 6.0.3; strict/noEmit, incremental project config; real temporary compiler red/green probe |
| ESLint | Installed 10.12.0; existing Next/TypeScript configs; targeted JSON diagnostics |
| Vitest | Installed 4.1.12; source tests and offline `vitest.ci.config.ts`, one worker |
| Next / React | Installed dependencies 16.4.2 / 19.3.0; existing build/typecheck/CI commands; inspect existing server terminal/stack first |
| Pino / browser logging | Installed Pino 10.4.0; `src/lib/logging/logger.mjs`, `browser.mjs`, shared redaction; no global logging refactor |
| Playwright | Not a repository dependency; available in Codex bundle. Bundled headless-shell executable absent; use installed Chrome channel, no download |
| Supabase | SDK 2.117.2 / SSR 0.12.7 and CLI 2.54.11 present (CLI reported newer version available; no upgrade required for log analysis). Local stack runner exists but has other-agent WIP. Docker info did not finish; this task's info process was stopped. Local DB health/integration acceptance UNKNOWN; no DB access or mutation |
| Cursor | Existing always-applied `.cursor/rules/velora-canonical.mdc` points to AGENTS. Global MCP names `graphify`, `notebooklm-mcp-2026` configured without disabled flags; runtime connectivity from Cursor UNVERIFIED |
| Codex / MCP | AGENTS is shared entrypoint; Graphify MCP actual list/stats succeeded. Supabase and browser tools exposed in this session, not proof of live DB/client health. No credentials read |
| Graphify | Ready, build `2d641501-748a-4f0f-805e-547097a3a0c9`, indexed `edb17b018ce0a635f2dd20c2453294453f129a97` at `2026-10-26T07:00:09.012977Z`; behind local HEAD `35f7df0fbd3c40b444c9e59b0b3d526857f92935`. Do not use as a fresh dependency map |

## SETUP-READ-REUSE-20261030 — local implementation, acceptance pending

- Cause: the branch reader only reused in-flight requests, so knowledge and language were fetched again on step entry; a 15-second slow-read callback could report failure before the request completed.
- Local changes: branch-scoped knowledge/language reuse for 30 seconds, five-minute read-only preview during revalidation, and bounded prefetch after the authenticated shell; resource invalidation on mutations and a fence for invalidated cached results; actual failed reads exit loading, while slow reads remain pending. Errors distinguish session, scope, network and availability; failure logs carry only safe stage, resource and request ID. Channel proof checks remain unchanged.
- Verification: targeted hours, workspace, loading, step-host and reader tests 54/54; scoped ESLint and source-only typecheck passed. Project typecheck failed in existing `scripts/setup-journey-qa/action-adapter.ts` on `companyLabel` and `persona`. Authenticated local `/setup`: knowledge and language were visible again after navigation with correct branch data; hours initially showed checking rather than falsely unset. Team and launch remained locked by prerequisites. Network timing and production acceptance NOT RUN. No commit, deployment, or live provider action. Root cause of the reported live failed request remains unknown.
## Confirmed records

### SETUP-STEP-BOUNCE-TRIAL-TO-HOURS-001 / sticky selection after refresh
- Signature: `/setup` returns from Test assistant to Business hours while the user stays on the page (after shell enrichment or refresh).
- Cause: checklist reapplied `nextWorkspaceSelection` on every read; workspace `useEffect` silently selected the first allowed step when active was `!allowed`.
- Fix: `resumeApplied` once per branch mount; no silent `onSelectStep`; blocked reason banner; draft leaf stays mounted. Files: `paid-assistant-checklist.tsx`, `paid-setup-workspace.tsx` (+ interaction/unit tests).
- Verification 2026-10-31: workspace selection tests 29/29 PASS on local HEAD `e94c7c4` + uncommitted fix. Live authenticated `/setup` NOT_RUN.

### SETUP-TRIAL-SAFE-RETRY-FALSE-UNLOCK-001 / Send+آمنة after unresolved hours ask
- Signature: Trial shows «طلب سابق لم يُحسم» then later Send + «إعادة محاولة آمنة» with 0/10 and generic UNAVAILABLE copy for «ما مواعيد العمل؟».
- Evidence (read-only): TAG CITY branch `a268f9d8…`; hold `25bb9e66` → `rejected`/`setup_trial_timeout_no_provider_evidence` at 18:56:16Z (**review needed: zero cost without provider request/response/usage — no new financial write here**); follow-ups `068f8753`,`396c6d8a`,`170d2bab` rejected ~1s, `latency_ms=0`, null provider `request_id`, cost 0, `SETUP_TRIAL_PROVIDER_RESULT`.
- Cause: post-start adapter failure (reach or claimed non-attempt) was settled `rejected` when `retrySafe||providerAttempted===false`; UI treated that as Send/retry authority. Key presence previously bypassed explicit `AI_LIVE_ANSWERING=false`.
- Fix: classify by provider-reach evidence; adapter `retrySafe` alone never unlocks; kill switch off wins over key; live gate before reserve; Send only ready; sticky trial step retained.
- Verification 2026-10-31: 141 PASS (guards/trial/workspace/adapters). C15 not closed without live successful answer.

### C15-TRIAL-ASK-PRE-RESERVE-001 / countTokens shape + hard block

- Date: 2026-10-31. Status: LOCAL PARTIAL (code fixed unstaged; live re-ask / Commit / Push NOT_RUN). Base HEAD `5ac7229`.
- Symptom: `/setup` assistant trial after C15.2 unlock returns UNAVAILABLE («تعذّر الحصول على رد الآن»), safe retry disabled, allowance stays 0/10, no new `ai_usage_ledger` row.
- Confirmed cause: `GeminiAnswerAdapter.countInputTokens` passed system+user as `contents` array; CountTokens API expects user `contents` + `config.systemInstruction` (same as `complete()`). Null count then hard-returned UNAVAILABLE before reserve despite economics UTF-8 upper bound.
- Fix: align countTokens request; fall back to UTF-8 reserve with warn log; propagate CONTEXT_OVERFLOW/NO_KNOWLEDGE/APPROVAL_* from `loadApprovedBranchKnowledgeContext`; reject combined hours overflow before spend.
- Files: `src/lib/answers/adapters/gemini.ts`, `src/lib/tenancy/paid-assistant-trial-actions.ts`, `src/lib/tenancy/paid-branch-knowledge-actions.ts`, matching tests.
- Verification: 121 scoped Vitest PASS; authored-file ESLint clean. Production data still has TAG CITY bound to velorahelper.com homepage scrape (owner data cleanup separate).
- Recurrence: never diverge countTokens request shape from complete(); never hard-block trial solely because provider token counting failed when a proven UTF-8 bound exists.

### LOCAL-DEBUG-WINDOWS-PRELOAD-001 / MODULE_NOT_FOUND

- Date: 2026-10-26. Status: FIXED-VERIFIED locally. Base commit `35f7df0fbd3c40b444c9e59b0b3d526857f92935`; no commit created.
- Symptom/signature: targeted Vitest stopped before tests with `Cannot find module 'C:UsersDELLDesktopVelora newscriptscioffline-network-guard.cjs'`; diagnostic signature `48b27aad600dbf4c`.
- Confirmed cause: Windows backslashes inside quoted NODE_OPTIONS were consumed by Node option parsing. Existing CI runner already uses forward slashes.
- Fix: normalize the preload path with `replaceAll('\\', '/')` before starting the isolated child. The offline network guard remains enforced.
- Files: `scripts/debug/debug.mjs`.
- Verification: original real failure exit 1; after correction the same targeted `check test src/lib/logging/ingress-projection.test.ts` returned exit 0, 3/3 PASS.
- Scope/recurrence: local launcher only, no application change. Check preload quoting before diagnosing test/application code when the process fails before collection.

### Safe acceptance probes (not product incidents)

- Temporary TS2322: assign a string to number, detect real compiler error/file/line, replace with number and require exit 0. Temporary OS file removed in `finally`.
- Temporary ESLint unused variable via stdin: require exit 1 and real rule/location; export the value and require exit 0. No repository fixture left behind.
- Temporary local HTTP page: real Chrome emits a console error, uncaught exception and fetches an endpoint returning 503. Captures must contain all three; server/browser close in `finally`. This is collector acceptance, not a real provider integration.
- Parser/command safety tests: signature lookup, unknown cause, redaction, location parsing, explicit targets and loopback restriction.
- Run: `node --test scripts/debug/debug.test.mjs scripts/debug/acceptance.test.mjs`; set `VELORA_DEBUG_PLAYWRIGHT` to the existing module path to include the browser test. Without it the browser test explicitly SKIPs, never implies PASS.
- Actual results 2026-10-26: 3/3 real acceptance probes PASS (including Chrome, zero skipped); 6/6 parser/command regressions and 9/9 existing logger safety tests PASS; 3/3 existing Vitest ingress-projection tests PASS through the new launcher. Targeted ESLint on all three new scripts PASS. No full build/full suite or live Supabase acceptance claimed.

### LOCAL-DEBUG-FALSE-POSITIVE-001

- Date: 2026-10-26; FIXED-VERIFIED locally, uncommitted on the same base above.
- Symptom: passing logger test names containing `error` and the summary `fail 0` appeared as findings.
- Confirmed cause: keyword filtering ignored test success markers.
- Fix/file: `scripts/debug/debug.mjs` excludes success-marked lines and zero-failure summaries; regression in `scripts/debug/debug.test.mjs`.
- Verification: focused new regression failed with 3 findings instead of 0 before correction; after correction 15/15 parser plus logger safety tests passed through the launcher with `records: []`. ESLint PASS. No broader product claim.

### New confirmed problem template

ID/code/signature; status; first/last date; environment and commit (or uncommitted base); symptoms; sanitized evidence; Confirmed/Suspected/Unknown cause; smallest fix; files; exact command/expected/actual/exit; affected regression/security evidence; remaining limits; reason for any rerun. Never store secrets, customer payloads or invented causes. Link this record from the task's PROJECT_STATE entry.

### LOCAL-LOGIN-NOT-RUNNING-20261026 / ECONNREFUSED

- Status: FIXED-VERIFIED for local password Login; 2026-10-26, uncommitted. Diagnosis measured 07:32:51–07:40:57 UTC (11:32:51–11:40:57 Muscat), 8m06s. 15 terminal inspection/test batches through first complete acceptance (including two browser runs; excludes process polling, writes and launch). No prior comparable baseline, so no numeric speedup claim.
- Evidence: no app listener; GET 127.0.0.1:3720/login refused; only .env.example present. Docker live check succeeded (29.8.2), so the old Docker-unavailable finding no longer applied.
- Confirmed cause/fix: local application and local Auth services were not running/configured. Reused existing startStack with the bounded wp01a-auth native migration scope, isolated local credentials and existing local-only network guard; launched Next on 3720. No authentication bypass/product fix/Production mutation.
- Actual acceptance: authorized synthetic local account submitted through real Login form; auth.broker.login.committed; readBrokerSessionStatus OK; HttpOnly session cookie; /setup 200. Second browser run tested additional retention criterion: refresh stayed /setup and rendered business setup form with the test identity. Two browser journeys; no full suites/build.
- Files: ignored artifacts/local-login/run.mjs and browser.mjs, plus this record and PROJECT_STATE. Access credentials are only in ignored artifacts/local-login/access.json, never in this record. Runtime left active for owner testing; restarting Docker or stopping the launcher ends availability.
- Reuse benefit: existing local fixture/guard avoided building a mock, altering product auth, reinstalling tools or rerunning whole CI. Known-error lookup had no matching ECONNREFUSED record. No measured comparative speed benefit claimed.
- Next approved item C01.1: real email-confirmation/provider acceptance remains BLOCKED on an authorized receiving test mailbox and nonproduction Auth mail-provider configuration. Current native password-login acceptance does not prove email/Google delivery or full business migrations. No live email/provider test or production change authorized/performed.

### LOCAL-LOGIN-CREDENTIAL-FILE-DRIFT-20261026
- Confirmed recurrence: local AUTH_ERROR at provider stage; real browser retry also failed. Read-only local database comparison returned exists=true, confirmed=true, password_matches=false against access.json. File last-write 07:44:00 UTC; Auth account last update 07:38:55 UTC. Editing the credential note does not change the account password; no attribution to who edited it.
- Later runtime interruption: original Next/launcher absent, and the coordinating agent confirmed owner-approved Docker restart. No claim that restart caused the earlier password mismatch.
- Recovery: fresh isolated native test stack on 3320/3330/3340/3341 using the existing runner; current access.json regenerated together with the actual test account. Hidden standalone launcher process preserves availability independently of command-session lifetime. Old fixture data untouched. No product auth edits, Production, commit/push/deploy.
- Verification: real browser form sign-in PASS, /setup identity/form visible, HttpOnly session cookie, reload retains /setup. browser.mjs now asserts these conditions. Evidence artifacts/local-login/browser-result.json; current credentials private in access.json. Copy the password value without surrounding JSON quotes; do not edit the note to reset credentials.

### LOCAL-SETUP-DRAFT-MIGRATION-MISSING-20261026
- Confirmed cause: wp01a-auth local fixture omits account prep draft migration; public.read_account_prep_draft(uuid) absent. Initial hydration failed, intentionally disabling fieldset and Next.
- Fix: applied existing 20261025012958_account_prep_draft.sql once to isolated local c1_ui_integration and notified pgrst to reload schema. RPC now present and RLS enabled. Future ignored run.mjs startup includes migration.
- Actual acceptance: Brave private /setup refreshed, name input and Next enabled; synthetic name entry reflected in summary. Subsequently observed team/plan screen as user interacted. Durable persistence NOT VERIFIED: zero rows at bounded DB check. No full-suite/payment/production acceptance claimed.
- Files: ignored artifacts/local-login/run.mjs, PROJECT_STATE.md, this record; no application source edits. Date 2026-10-26, uncommitted. Existing local runner reused; no tools installed.


### PREP-LOCAL-FIRST-20261026 / server hydration disabled all input
- Owner-approved correction: local draft checkpoints scoped by authenticated account; enable after local initialization without waiting for server. Keep latest typing when delayed reads/writes complete; require explicit conflict resolution, real server confirmation before final submit. Native CAS and auth unchanged.
- Files: use-account-prep-draft.ts, prepayment-preparation.tsx and existing hydration regression test. No added package/service/migration. Local cache expiry 30 days from last persisted snapshot, validated on restore; storage quota/private-mode failure leaves editing available and warns honestly. Network writes remain at step save/reconnect, not every keystroke.
- Targeted evidence: 4 requested regressions initially failed; early-step-before-read race additionally failed then fixed. Final 24 hook tests +38 form tests PASS, 9 server action authorization tests PASS; scoped lint PASS and TypeScript PASS during implementation. Covers cross-account recovery, quota errors, corrupt/expired cache, online retry, late hydration, latest-edit retention, CAS/concurrency and no order creation during local step navigation.
- Live browser limit: local session bootstrap returned TRANSPORT and 35.5s POST /setup (21s compilation); account screen failed before draft controller mounted. Native UI screenshot capture also timed out. No real-browser offline/reload PASS claimed; do not confuse mocked action regressions with live Supabase acceptance.
- Next verification: once local session is responsive, type an incomplete form, refresh to confirm local recovery, complete first step, and verify the real draft RPC receipt. No Production/Commit/Push/Deploy performed.


## STATUS_LOCKED — stale quarantine on a new auth journey (2026-10-31)

Signature: new signup verification is blocked before OTP dispatch while an old session quarantine persists and broker returns UNAUTHENTICATED. Reproduced locally on fe5fed5 + WIP. Public auth entries may start a guest journey only after authoritative unauthenticated evidence; never erase quarantine or bypass the verification fence. Reject late restoration of the old boundary before private profile reads. Tests: account-session-response.test.tsx, verification-quarantine-journey.test.tsx, verify-email-fence.test.tsx. Hosted acceptance remains open; original browser storage was not captured. See Brain08 STATUS-LOCKED-STALE-QUARANTINE-20261031.
