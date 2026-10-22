# VELORA — SHARED PROJECT RULES

## Active consolidation override — 2026-10-22

This section supersedes older worktree/parallel-writer instructions and historical locks for the explicitly authorized consolidation. Shared authority for Codex, Cursor and Antigravity: this file and the first Current Session Index in PROJECT_STATE.md.

- Only edit, run and test in `C:\Users\DELL\Desktop\Velora new`, on the existing persistent development branch `codex/desktop-consolidation-20261015`. `main` is the verified release destination.
- Do not create task branches, worktrees, project copies or alternate test websites. Old worktrees are read-only preservation sources until recoverable retirement.
- One writer: Codex chat `01a160e9-558f-7183-88ac-89307520f011`; all other executors have stopped, confirmed by the user. Coordinate generated test files too. Ownership transfer must be explicit and recorded.
- Before mutation, verify Git top-level, origin, branch, status and task owner with `node scripts/consolidation/guard.mjs`. Stop on mismatch. The guard is a workflow check, not a security boundary against tools that bypass it.
- Sequence: preserve and consolidate above latest main; enforce shared rules; repair and test the real combined app; review/apply required compatible Supabase migrations; verified main integration/deployment; recoverably retire old copies only after proving unique work and secrets preserved.
- Keep one remaining-work list in the Current Session Index. Do not run `85-worker-trial-ports.review.sql` or resume its cancelled operation. Incomplete drafts remain explicitly parked.
- Real application acceptance is required; mocks/unit tests are supporting evidence only. Log trace/request IDs, failure stage and stable error codes with secret redaction. Unknown outcomes and costs must stay unknown.
- No force push, hard reset, clean, indiscriminate staging, new containers, paid AI verification, live payments/messages, keys, secret uploads or access-denial bypass. Keep Live payment disabled.
- Production permission is bounded: verify actual deployment-to-Supabase binding, backup/recovery evidence and migration compatibility first. Access/RLS/grants/auth/key changes and irreversible deletion require a specific disclosed approval.

## 1. Canonical Project
All agents work on the same canonical repository:

`C:\Users\DELL\Desktop\Velora new`

Use the single approved directory and persistent branch above. No additional worktrees or project copies.

## 2. Mandatory Execution Lock
- Read `PROJECT_STATE.md` Quick Session Index before working.
- Strictly follow `FLOW → STAGE → TASK` and `FLOW-LOCK-001`.
- Never skip stages or silently change approved business requirements.
- Queue out-of-stage requests for later.
- Combine related work into practical, substantial tasks without unnecessary fragmentation.

## 3. Agent Responsibilities
- **Cursor:** Full-stack implementation using parallel agents. No test execution or GitHub pushes.
- **Antigravity:** UI/UX, responsive design, animations, and assigned frontend implementation.
- **Codex:** Architecture, research, planning, Chrome/local testing, security review, CI verification, safe integration, GitHub commits and pushes.

No agent may overwrite another agent's unfinished work.

## 4. Complete Production Implementation
Deliver all approved functionality, not merely an MVP.

No fake integrations, placeholder behavior, disconnected mockups, or incomplete functionality presented as finished.

Preserve authorization, tenant/branch isolation, real persistence, idempotency, and existing integrations.

## 5. Logging — LOG-001
Use centralized structured production logging with UTC timestamps, severity, service, environment, release, request_id, trace_id when applicable, stable event/error codes, relevant operation context, and diagnostic stack traces where safe.

Propagate request context, log provider/DB failures, protect secrets through native redaction, and avoid ad-hoc console logging.

Keep logs searchable and useful for Codex diagnosis. Do not initiate a full-repository logging migration without explicit authorization.

## 6. Security and Production
Never expose credentials or sensitive customer data.

Never run unauthorized paid AI calls, real charges, destructive Production tests, or risky database/provider changes.

Respect mandatory CI, branch protection, backup, release verification, and rollback requirements under OPS-001.

## 7. Verification and Completion
Codex independently verifies functionality, security, data persistence, integration, regression risks, and relevant complete system journeys.

Test the real application's authorized pages and workflows using approved test accounts, without creating unnecessary duplicate test pages or repositories.

Do not claim unverified work is complete.

Distinguish Implemented, Integrated, Verified, and Production Ready.

## 8. Project Traceability
Keep `PROJECT_STATE.md` concise and accurate with active task IDs, implementation paths, shared contracts, logging/debug entry points, verification evidence, blockers, and exact next authorized work.

Avoid duplicate reports and unnecessary documentation.

## 9. Efficient Execution
Inspect only relevant files and code sections after reading the project state.

Reuse existing solutions, avoid repeated full-repository scans, and minimize unnecessary tools, steps, and token consumption without reducing quality.

Follow `.cursor/rules/cost-ledger.mdc` when relevant costs change.

## 10. Coordination and Continuation
Respect each agent's specialized instructions.

Autonomous sequential work requires the user's explicit authorization.

Routine technical decisions within approved scope may proceed independently.

Only interrupt for material blockers, business decisions, or separately required approvals.

Keep responses concise and actionable.

## 11. Next.js Compatibility
This project may use a Next.js version with breaking changes.

Before modifying Next.js APIs or conventions, consult the relevant installed documentation under `node_modules/next/dist/docs/` and respect deprecation warnings.

Preserve any Next.js-generated agent instructions when regenerated by the framework.

## 12. Graphify-first change context

Before every implementation prompt and after each task, inspect relevant dependencies, impact and linked tests using the existing authorized Graphify index. Compare its indexed commit with the current local commit and read changed or unindexed local source directly. Graph output is static scope guidance, not runtime verification or an automatic blocker when stale/unavailable. Do not install, reindex, upload repository content or change Graphify configuration without explicit authorization. Preserve all existing security, execution-lock and verification gates.

## 13. Evidence-bound Cursor handoffs and release batches

- Before a migration handoff, record the actual hosted baseline/project, Postgres version and relevant owner/role/inheritance/default-grant metadata. Match these in the isolated fixture; do not infer platform defaults.
- State intended explicit ACLs for functions, tables and sequences. Collect all affected package ACL differences together, including grantors, grant options and effective inherited rights. Keep install guards fail-closed.
- Freeze the exact artifact fingerprint and test those bytes. After changes rerun affected verification plus required CI; never relabel prior receipts as a new candidate PASS.
- Verify env presence using the full exact name and scope. Truncated labels or absent evidence mean Unverified, not missing. Do not inspect, copy or expose key values. Presence alone does not prove runtime validity.
- Each handoff records evidence source/path and actual PASS/FAIL/NotRun result; no inferred or unexecuted success claims.
- Prefer smaller coherent implementation/release batches over accumulated publication. This grants no new publication permission and changes no existing approval boundary. Separate owner-deferred commercial-prelaunch requirements from proven current runtime blockers.
## 14. Lean delivery workflow (user instruction, 2026-10-20)

- Give each request one concrete outcome. Reuse or edit existing files first; add a file only when it has a justified independent responsibility.
- Keep one writer for the repository, including tests generating files. Others read/review only.
- Run focused affected checks and a direct smoke of the changed flow; do not repeat unchanged test matrices. Retain required checks and truthful PASS/FAIL/NotRun evidence.
- Defer unrelated improvements unless they are actual blockers or prevent direct harm. Do not introduce unrequested refactors or rebuilds.
- Show the working result before starting another package. Existing permissions, secret redaction, access guards and production restrictions remain in force.
