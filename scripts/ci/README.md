# Velora local CI receipts (WP10A)

Honest, redacted verification receipts for the existing offline checks in `run.mjs`.  
This package does **not** close ES01, prove Production readiness, hosted branch protection, secret-history cleanup, or external acceptance.

## Checks (unchanged commands)

```bash
npm run ci:typecheck   # node scripts/ci/run.mjs typecheck
npm run ci:lint
npm run ci:unit
npm run ci:contracts
npm run ci:build
npm run ci:safety
```

Exit codes keep their previous meaning. Receipts are written only when `VELORA_CI_RECEIPT_DIR` is set.

```bash
# Example: clean tree required (no developer .env* at repo root — files are never read or deleted)
set VELORA_CI_RECEIPT_DIR=.ci-receipts
node scripts/ci/run.mjs lint
```

Each receipt records: `runId`, check/scope, candidate identity (`headSha` + content-aware clean/dirty fingerprint), start/end/duration, `exitStatus`, outcome (`Pass` | `Fail` | `Blocked` | `NotRun`), redacted `reasonCode`, and local `evidenceRef`.  
Dirty identity hashes safe staged/unstaged/untracked source bytes plus index state for the same HEAD; private `.env*`, receipt dirs, and unsafe paths are excluded before any byte read. Incomplete or >200-path snapshots fail closed (`workingTreeState=unknown`, no Pass aggregate).  
Raw stdout/stderr are never stored. Parent secrets and `.env*` values are never passed into the check process (`isolatedEnvironment`).

## Aggregate

```bash
node scripts/ci/aggregate-receipts.mjs --dir .ci-receipts --match-live-candidate
# optional university gate shape (does not invent security/secrets Pass):
node scripts/ci/aggregate-receipts.mjs --dir .ci-receipts --match-live-candidate --gate --security-result success --secrets-result success
```

Aggregate **rejects** missing checks, mixed/stale-content candidates, stale receipts, and treats `NotRun` / `Blocked` / non-zero exit as non-success.  
Skipped fixtures or absent integration environments are never success evidence. Local receipts never prove hosted branch protection, Production, or secret-history cleanup. The required GitHub gate still needs `quality` + `security` + `secrets` (pinned Gitleaks).

## Limits (always listed on receipts)

- secret history not proven  
- hosted enforcement not proven  
- Production not proven  
- external acceptance not proven  

Gitleaks / `security.mjs` remain separate jobs. Do not upload receipt directories as artifacts if they may contain operator paths you do not want shared.

## Codex test commands (Cursor does not run these)

```bash
node --test scripts/ci/receipt.test.mjs
node --test scripts/ci/safety.test.mjs scripts/ci/required-gate.test.mjs
# or via the safety check entrypoint:
node scripts/ci/run.mjs safety
```

<a id="main-delivery-and-exclusive-ownership"></a>
## Main delivery and file-scoped parallel ownership

AGENTS.md is the shared entrypoint. Canonical Windows root: `C:\Users\DELL\Desktop\Velora new` on `main` only; GitHub account `velorahelperai-cmd`. **PARALLEL-FILES-001 (owner 2026-10-25, corrected):** lock only the files actually used; independent agents may work in parallel on non-overlapping paths in the **same** checkout and **same** `main`. No Worktrees, no separate branches, no clones for parallel work. Do not require finishing or handing off another independent task to start. Read-only Git uses `GIT_OPTIONAL_LOCKS=0`. Never use force, reset, clean, stash or deletion to discard another agent's leased files or bypass a reservation.

**Commit / Push** to `main` still require explicit owner permission for that delivery. No hook/CI bypass, force push, or secret/provider/production mutations without their approvals.

The active schema-v2 registry is `.git/velora-path-reservations.json`; the old `.git/velora-writer-lock.json` is preserved evidence, never ownership or publication authority. Identity is `VELORA_WRITER_ID`, with `CODEX_THREAD_ID` as Codex fallback; no historical session is pinned. `VELORA_TASK_ID` selects one of the current owner's explicit task leases. Each lease records its publication baseline. Existing v2 leases missing that field require an explicit same-owner re-reservation after approval; do not guess another owner's status or transfer its paths. Record leased paths/task in the first PROJECT_STATE index.

Acquire only listed paths with `npm run writer:acquire -- --task=TASK --paths=src/example.ts,src/example.test.ts`; release only that current owner's task with `npm run writer:release -- --task=TASK`. A legacy handoff-only acquire fails closed. Independent non-overlapping tasks do not require another task's handoff.

Before authorized aggregate gates/staging, coordinate other writers and claim delivery using `node scripts/consolidation/guard.mjs delivery-start --task=TASK`; this requires all active leases to belong to the delivery owner. Pre-push requires that exact owner/task claim and binds receipts to task, publication baseline and a deterministic registry fingerprint. Any ownership/lease change during a gate blocks reuse/delivery. `delivery-end` clears only the current owner's claim. No command grants commit/push approval or permits staging another agent's WIP.

Run npm run hooks:install in this checkout. Git core.hooksPath must be .githooks, with an executable pre-push index entry. An npm script alone does not register a Git hook. Stage only reviewed task files. The owner-approved staged-snapshot delivery (2026-10-25) preserves other work in place and tests the exact Git index tree, including staged deletions. This replaces rejection of unrelated unstaged/untracked files with approved-manifest, source, ownership and preservation checks; no gate is reduced.

Before prepush, save the reviewed publication allowlist in .git/velora-pre-push/approved.json: schemaVersion1, owner, task, publicationBase, exact paths array, and blobs mapping each path to its candidate Git blob OID (null for staged deletion). All candidate changes relative to remote main must belong to this explicit allowlist and to the selected delivery lease. Unexpected paths or changed approved blobs block publication. Never populate the allowlist from an unreviewed blanket git add.

The controller stays in the canonical checkout under verifyWorkspace. It creates a new external temporary files-only snapshot from stage0 blobs; there is no .git, clone, branch, worktree or link to original node_modules. Extraction preserves worktree/index bytes while mktree adds Git objects. Drivers must match indexed sources. Independently installed snapshot dependencies and all snapshot source bytes are checked around every gate, along with original HEAD/index, owner/leases and content fingerprints of preserved work, including unselected edits in staged paths and old generated preview cache. New or changed excluded work blocks the run. The existing environment/private-file protections remain active; private credentials are never opened for preservation hashing.

npm run prepush runs twelve live tree gates: npm ci without lifecycle scripts, Typecheck, Lint, Unit, Contracts, Build, Safety, static Security, moderate-or-higher dependency audit, pinned Gitleaks install/self-test/tree. Tests and builds use the snapshot cwd; driver ownership remains canonical. Security and Gitleaks tree enumerate candidate entries, while the actual Git hook scans base..HEAD in the canonical repository. The snapshot is an execution artifact, not OS isolation for malicious test code.

Run receipts under .git/velora-pre-push/<tree>/<run> bind tree, remote base, head, writer/task, registry, Node/platform and snapshot install fingerprint. They document results and cannot skip a gate. The actual Git hook requires HEAD^{tree} to match the candidate, then re-runs all13 live gates including the exact commit-range scan. There is no receipt-reuse/bypass flag. This cooperative local hook does not prove hosted branch protection. Keep snapshot evidence until publication verification; never delete or relocate original work to satisfy the gate.

The workflow retains all mandatory jobs and aggregate quality-gate. Post-push CI alone does not stop Vercel auto-deploy; no sensitive hosting/protection setting is changed. Follow CI, deployment source SHA, remote main SHA and published smoke. Keep post-deployment receipts outside Git; no commit solely for the previous deployment. Native DB/security/financial/provider acceptance remains separately authorized.

Guard regressions cover local main ownership and GitHub/Vercel modes, including rejection of forged cloud mode on Windows. Pre-push regressions cover all required categories, each failure/signal/start error, drift and receipt mismatch. Prove real invocation with git hook run pre-push and controlled stdin; no test push is needed. These tests are in safety and do not label simulated gates as product-gate passes.

For the real-hook proof, pass the controlled ref file with git hook run --to-stdin=<path> pre-push -- origin <approved-origin>. On the installed Git 2.51.2, piping stdin to git hook run alone does not forward it to the hook; its default input is empty. No push is sent by this proof.


### Delivery status, resume and safe pause

Use `node scripts/consolidation/guard.mjs status` with your own writer/task environment before acting on a reservation report. The receipt includes a fresh UTC observation, canonical registry path, exact-byte SHA256, delivery owner/task and observer classification. An open task or historical legacy lock is not an active reservation. Nonempty reservations may be the delivery owner's own files; they do not mean delivery acquisition failed. Re-read status after release; never reuse a cached message as ownership evidence.

`delivery-start --task=TASK` acquires under the existing registry mutex. Repeating it for the exact owner/task resumes only when the protected scope/base/ownership fingerprint still matches. Other claims fail closed. Acquisition cannot add files or tasks while delivery is held, even for its owner. End delivery before changing reservations and rerun all required gates for the new candidate. A legacy claim without a protected fingerprint cannot silently upgrade through resume.

The Git hook accepts canonical main or the literal HEAD alias only when symbolic HEAD is main and local SHA, HEAD and refs/heads/main agree. The target must be existing remote main and exactly one update. Approved blobs, candidate tree, HEAD/index, preserved work and delivery ownership remain checked around live gates; saved receipts never skip gates. Verify the approved manifest against the current candidate after any commit/source change. Use PowerShell-compatible commands in this Windows checkout; Bash here-string syntax is not PowerShell receipt evidence.

Before a pause or completion, save a concise checkpoint in the first PROJECT_STATE index: task/writer, leased paths, saved source/evidence, Git state, verification and remaining operations. Stop source/staging writes, end your delivery claim if held, release your task through `writer:release`, then read fresh status to verify absence. Release preserves work and does not close unfinished product acceptance.

For an apparently abandoned lease, first establish that its writer and delivery operations have stopped and preserve its work/checkpoint. Age alone is never proof. Resume the original owning task to perform supported owner-scoped end/release; never impersonate it or delete registry/mutex files. If that identity cannot resume, or an interrupted mutex remains, report RECOVERY_BLOCKED with owner, task, saved evidence and exact lock; request a separately authorized supported recovery path. This repair adds no time-based stealing or manual-clear command.

Verified incident: reports confused own leases with competing writers; repeated acquisition rejected an already-held claim; bare status lacked freshness evidence; the hook rejected the HEAD alias. The atomic mutex, approved-blob checks and mandatory gates already existed and remain. Regressions are in guard-lifecycle.test.mjs and pre-push.test.mjs and run in mandatory safety. Follow Engineering Constitution WORK-19 and the existing Brain 08-LESSONS workflow for verified cause, proportional prevention and evidence; do not claim guaranteed nonrecurrence or create a parallel policy. External Brain updates require supported ownership access.
