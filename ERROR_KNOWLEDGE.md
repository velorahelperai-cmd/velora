# Historical source — Project Brain migration

The only active Velora planning/rules/decisions/lessons authority is [Obsidian Project Brain](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/08-LESSONS.md>), reached through AGENTS.md / PROJECT-BRAIN-READ-FIRST. This original body is preserved as read-only historical evidence, not a second editable plan or solution register. Do not append new tasks or decisions here. Relevant source requirements were matched in Brain09-SOURCE-REGISTER; access/decision/publication blockers remain explicit in Brain06-COVERAGE. Do not read this entire history before every task or fall back to it when Brain access fails.

<details>
<summary>Preserved original source at 6acb1413d935531e9069dc607a1d0c4b6d9286c1 — historical, not execution instructions</summary>

# Error knowledge

This file records observed errors and evidence-bound fixes, not runtime logs or a copy of the Engineering Constitution. Search by error code/fingerprint, read existing evidence, confirm the current version/environment/contract, test narrowly, then update the same record. Reopen broad diagnosis only when new evidence invalidates the old cause or scope.

## Record protocol

Each significant record includes ID/status (OPEN, INVESTIGATING, BLOCKED, FIXED-VERIFIED, REOPENED), first/last seen, environment/source version, task/Flow/Stage, error code/fingerprint, affected files/functions, symptoms, redacted trace/evidence and evidence limits. Separate Root Cause (Confirmed/Suspected/Unknown), Proposed Fix, Verified Solution, targeted verification (how/expected/actual/result), regression prevention, relevant files/commit and recurrence notes. Unknown causes stay Unknown; untested proposals never become Verified Solutions. Record provider outcome and internal persistence outcome separately. Store no tokens, raw sensitive payloads or invented historical incidents.

## Logging contract and LOG-001 limits

LOG-001 remains in force. Sources: [logger.mjs](src/lib/logging/logger.mjs), [logger.test.mjs](src/lib/logging/logger.test.mjs), and the constitution's LOGGING-PROTOCOL. The complete historical LOG-001 definition is not established by these sources; the old conventions reference is missing. This is a source mapping, not complete compliance or application-wide adoption.

| Required concept | Existing field / behavior | Evidence limit |
|---|---|---|
| UTC timestamp | timestamp from toISOString(), ISO 8601 Z | Automatic at emission |
| severity | level; trace/debug/info/warn/error/fatal | No automatic separate severity field |
| service | service | Configured name or velora default |
| request identity | request_id | Async context; fallback is process-wide, not proof of a unique ID per HTTP request |
| event code | event through logEvent, dotted format | No automatic separate event_code; distinct from error_code |
| correlation | trace_id / span_id | May be null; propagation must be proven per boundary |
| environment/version | env / version | version may be unknown |
| error/Flow/Stage/operation | Caller fields such as error_code and stage | Not automatically complete across routes |
| duration | Caller duration_ms | No fabricated measurement |
| outcome/provider/persistence | Caller-specific fields | Provider acceptance is distinct from delivery and persistence |
| retries/failure reason | Actual caller context | Unknown stays Unknown; no automatic retry of an uncertain external effect |

Keep trusted context, recursive redaction and production level restrictions. Do not rename the logging schema, add collectors/alerts/retention policies or perform a repository-wide logging refactor here. Runtime coverage, durable trace propagation and operational monitoring remain separately evidence-bound.

## ERROR-001 — legacy workspace policy rejects authorized main

- Status: FIXED-VERIFIED (focused policy scope; release gates tracked separately).
- First/last seen: 2026-10-23. Environment: canonical Windows original, Node 24.18.0.
- Task: ENGINEERING-CONSTITUTION-20261023. Baseline: fb03d613991d53c928fa73e3716e936660764a25.
- Code/fingerprint: BRANCH_MISMATCH from node scripts/consolidation/guard.mjs on authorized main.
- Evidence: old guard exited 1 after the preservation-proven transition. Source pinned the obsolete consolidation branch and one old Codex session.
- Root Cause: Confirmed by direct source reading and actual rejection; old policy conflicted with the approved main-only/exclusive-writer transition.
- Verified Solution: main-only guard, explicit repository-wide writer receipt, dynamic identity, preserved root/origin/account/permission/conflict safeguards and GitHub/Vercel source validation. No bypass or impersonation.
- Targeted verification: real local guard returned mode=local, branch=main, error_code=null; node --test scripts/consolidation/guard.test.mjs scripts/ci/pre-push.test.mjs passed 22/22. Negatives cover foreign root/origin/account/writer, missing/released/partial lock, old branch, conflicts and forged cloud metadata.
- Regression: guard and pre-push tests are included in mandatory safety. They verify every mandatory category, fail-closed command results, candidate drift and receipt identity.
- Files: scripts/consolidation/guard.mjs, guard.test.mjs, writer.mjs; scripts/ci/pre-push.mjs and pre-push.test.mjs.
- Commit/release evidence: final report and private .git/velora-pre-push receipts; no deployment-receipt commit loop.
- Recurrence: inspect actual root/main/account/writer and current policy before changing protection. No customer incident or complete LOG-001 acceptance is claimed.

## ERROR-002 — mandatory dependency audit rejects the existing Next pin

- Status: FIXED-VERIFIED for locked dependency audit; final installed-runtime release gates remain required. First/last seen: 2026-10-23; task ENGINEERING-CONSTITUTION-20261023.
- Fingerprint: PRE_PUSH_GATE_FAILED:dependencies/audit; npm audit --audit-level=moderate exited 1 for next 16.3.8. The prior source tree was 4426d6b21fa4c4de3564693237e0aedecd7ef05c.
- Confirmed cause: existing exact Next pin is within the published affected 16.0.0–16.4.0 range. Advisories: GHSA-2464-fhr4-w9xw (critical), GHSA-p3m5-59mp-jv5r (high), GHSA-673q-mjm6-r5xr (critical). No exploit attempt or observed compromise is claimed.
- Official sources: https://github.com/advisories/GHSA-2464-fhr4-w9xw ; https://github.com/advisories/GHSA-p3m5-59mp-jv5r ; https://github.com/advisories/GHSA-673q-mjm6-r5xr ; https://github.com/vercel/next.js/releases/tag/v16.4.2 .
- Fix candidate: exact next and eslint-config-next 16.4.2 plus their lockfile closure, without force or audit suppression. Official registry peers accept current Node 24.18.0, React/React DOM 19.3.0, ESLint 10.12.0 and TypeScript 6.0.3. No major framework or application architecture change.
- Verified Solution (audit scope): exact next/eslint-config-next 16.4.2 and the reviewed lock closure. npm audit --package-lock-only --audit-level=moderate returned zero vulnerabilities. Official peer metadata matches the existing runtime; full installed-runtime compatibility/build/release validation remains mandatory. Receipt: .git/velora-transition/bounded-security-fix.json.

## ERROR-003 — static synthetic redaction fixture triggers Gitleaks

- Status: FIXED-VERIFIED for the fixture and scanner scope; final release gates remain required. First/last seen: 2026-10-23; same task.
- Fingerprint: pinned Gitleaks 8.24.3 tree scan, generic-api-key at src/lib/tenancy/audit-contracts.test.ts:235; one finding. Values were never printed or stored in receipts.
- Confirmed context: the value is an inline state.auditLogsMock redaction fixture; the test asserts password, token and nested api_key become the redacted marker. This is not evidence of a live credential or runtime disclosure.
- Fix candidate: generate three synthetic UUID inputs at runtime; retain every existing redaction assertion. No scanner rule, exclusion, baseline or success threshold is weakened.
- Verified Solution: three runtime-generated UUID fixture inputs, with every redaction assertion unchanged. The affected audit contract file passed 6/6 offline tests and pinned Gitleaks tree scanning passed 1868 paths with zero findings. No scan suppression or threshold change. Receipt: .git/velora-transition/bounded-security-fix.json.


</details>
