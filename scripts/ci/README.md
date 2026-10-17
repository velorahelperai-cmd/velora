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
