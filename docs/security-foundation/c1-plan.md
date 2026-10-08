# C1 security foundation execution plan

- Branch: `overnight/security-foundation`; fixed base `a5b8d141ec629d3129e3fb57c00360b7a0cbba35`.
- Integration reference remains `485d21e`; its saved security corrections `61163a6` and completed P3/P4/inbox work are already ancestors. Reuse their findings and regressions instead of repeating closed reviews or merges.
- Investigate independent remaining Billing and AI-accounting boundaries. Reproduce material failures, implement minimal forward-only SQL/application corrections and review the shared contracts. Preserve unresolved commercial decisions as fail-closed gates.
- Verify populated legacy upgrade, real PostgreSQL sessions/lock waits and actual local RPC application paths. Run relevant/default application tests, TypeScript, lint and build. Distinguish synthetic Auth/processor transports from project SQL and never count skipped cases as passed.
- Scan changed files for credential patterns, save independent local commits and report exact SHA, remaining owner decisions and honest launch status.

Only the task-labelled `velora-c1-security-a5b8d14` local PostgreSQL container is allowed: network disabled, no exposed ports, tmpfs data, no persistent mounts. No cloud SQL, real provider/payment/WhatsApp requests, external worktree edits, push, deployment, merge to original branches or backup.
