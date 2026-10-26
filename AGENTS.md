# Velora shared execution entrypoint

Local debugging (owner request 2026-10-26): use [the on-demand troubleshooting entrypoint](docs/TROUBLESHOOTING.md), search prior signatures before diagnosis, then run only affected checks. Graphify is needed for dependency/impact questions, with freshness verified. Keep mandatory security/delivery gates and existing file leases. This scoped instruction adds no background service or publication authority.

## PROJECT-BRAIN-READ-FIRST

The owner-approved sole Project Brain is [Velora / 00-INDEX](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/00-INDEX.md>). Read the approved task, sequence and applicable rules there before every task. [Project rules](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/10-PROJECT-RULES.md>), [decisions](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/01-DECISIONS.md>), [acceptance](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/02-ACCEPTANCE.md>) and [error knowledge / LOG-001](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/08-LESSONS.md>) are active there. Follow the current Engineering Constitution links from the Brain; do not copy that constitution here.

1. Prove actual Brain access in the current agent/environment. If unavailable or an approved decision conflicts, block the affected task, record the exact missing access/decision and do not substitute an old plan. Codex access does not prove Cursor or Antigravity access. Claude is currently unused (N/A), not a closure requirement.
2. **GRAPHIFY-FIRST:** after Brain, use Graphify as the primary and mandatory starting point for technical discovery and analysis: identify target files, dependencies, impact and related tests. Verify repository, indexed commit and date against Git HEAD. Do not browse the project or history in bulk or at random. Read only the relevant current code sections and necessary instructions/safeguards to verify and implement the scoped task. If the index is unavailable, stale or of unknown freshness, record the specific blocker; do not automatically substitute a broad filesystem scan. Graphify is not a source of approved decisions or a replacement for current-code verification.
3. Inspect current code and GitHub evidence. Read only the first Current Session Index of [PROJECT_STATE.md](PROJECT_STATE.md), and the current **file leases**, for writers/evidence/blockers on the paths you will touch. Do not reread the entire history before each task.
4. Consult only a historical section explicitly marked unmapped in the Brain source register or required by an authorized scoped review. Matched MASTER_PLAN/decision/error files remain evidence, never a second active plan; do not reread their full history.
5. Treat STRUCTURAL, MAPPED, SPEC_READY and RUNTIME_VERIFIED as distinct. Follow task-specific acceptance and the review dispositions in [Brain coverage](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/06-COVERAGE.md#review-findings>); a count or migration checklist is not product acceptance. Historical proposals never become approved architecture, policy or performance limits merely by being mapped.
6. Execute only the authorized task in its approved sequence with applicable security, logging and tests. After proven success update its Brain task with commit/test evidence and the concise execution index. Checkbox completion alone is not DONE. Before any DONE claim, follow the Engineering Constitution [task-closure rule](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Engineering Constitution/02-WORKFLOW-RULES.md#task-closure>) (WORK-13): update proven status, release this task’s leases with the lease owner’s identity via `writer:release`, then read `.git/velora-path-reservations.json` and confirm they are gone. Keep local work; release is not delete and not publication. On release failure declare `HANDOFF_BLOCKED` with the reason — never impersonate another writer or wipe their lock. On stop or quota exhaustion, save the resume point, stop writing, then release per that same rule.

## Technical safeguards

Canonical repository root: `C:\Users\DELL\Desktop\Velora new`; origin `velorahelperai-cmd/velora`; allowed GitHub account `velorahelperai-cmd`. Use `GIT_OPTIONAL_LOCKS=0` for read-only Git inspection.

### PARALLEL-FILES-001 — file-scoped parallel work (owner 2026-10-25)

**APPROVED and ACTIVE for agent behavior.** Whole-repository exclusive writer is **SUPERSEDED**.

1. **Lock files actually used, not the whole project or stage.** Before writing, list the paths you will modify (code, tests, generated output, and any Brain notes for that task). Record those leases in the first Current Session Index and in `.git/velora-writer-lock.json` (or its documented multi-lease successor). Do not claim unrelated paths.
2. **Any agent may start an independent task immediately** when its file set does not overlap an active lease — including while C01 or any other task is running. Finishing or handing off another independent task is **not** a prerequisite.
3. **Same project, same `main` only.** All agents work in the canonical checkout `C:\Users\DELL\Desktop\Velora new` on `main`. **No Worktrees, no separate branches, no clones** as parallel workspaces. Isolation is by file lease, not by tree/branch.
4. **On path conflict, stop only the conflicting files.** Non-overlapping work on the same `main` checkout continues. Re-negotiate or wait only for the overlapping paths.
5. **Security approvals stay mandatory.** No Commit or Push to `main` without explicit owner permission for that delivery. No force push, reset/clean that discards others' work, hook/CI bypass, secret reads/prints, provider/env/production mutations, or destructive DB actions without their specific approvals.
6. **Delivery:** after owner-authorized commit/push, mandatory gates, exact-SHA CI/Vercel evidence, and post-deployment receipts outside Git still apply. Follow [guarded delivery](scripts/ci/README.md#main-delivery-and-exclusive-ownership).

**Delivery coordination:** independent file-scoped development continues during immutable-snapshot delivery; one publication coordinator owns index/HEAD changes. Follow the current [guarded delivery contract](scripts/ci/README.md#main-delivery-and-exclusive-ownership).

Preserve unrelated work in the shared tree; stage only your leased paths.

Current MASTER-PLAN-001 documentation limits remain: no unauthorized feature/SQL/provider/env changes under a docs-only charter. Owner-authorized product tasks follow their own Brain scope.

For quota exhaustion or disconnection, follow [HANDOFF-LIMIT-001](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Velora/10-PROJECT-RULES.md#handoff-limit>) and the Constitution [task-closure](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/Engineering Constitution/02-WORKFLOW-RULES.md#task-closure>) lease-release steps. Record actual saved progress, Task ID/order, **leased files**, Git state, checks/results, running or uncertain operations, blocker/next step and writer; then release your task leases after writing stops. A successor verifies reality, prior inactivity on those leases, then receives explicit handoff of **those files** (and related Brain notes). No automatic takeover of unrelated leases; no restart from zero.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
