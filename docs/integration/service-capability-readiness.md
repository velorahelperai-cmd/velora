# Service capability readiness groundwork

The session adapter and `/api/company/service-access?capability=noura.knowledge.read` expose an explicit, uncached readiness decision. They use the selected company from `getCompanyAccess`, active confirmed membership, and the existing authoritative `has_company_capability` RPC. Compat null never grants access. Only after actor authorization does the adapter read the existing trusted live billing RPC. The endpoint returns no business data or provider output, and accepts no company, persona, plan or entitlement supplied by a caller.

**Live multi-service entitlement is NOT READY.** Every result currently has `allowed: false`. A trusted paid subscription is not an immutable service capability grant. `feature_availability` in catalog version limits is `target`/`not_verified`, not activation. Plan-name prefixes and persona choices cannot grant reports, POS, Lina or Dana. Unsupported capabilities return `UNSUPPORTED_CAPABILITY` before billing reads; proven active legacy paid evidence returns `SERVICE_CONTRACT_MISSING`. Inactive, unavailable and unauthorized states remain distinct.

This boundary does not replace current human inbox authorization or the existing claimed Noura knowledge worker. It does not advertise or activate new capabilities. No financial history is rewritten, no SQL is introduced or applied, and no model/payment/message call is made. Existing single-subscription behavior remains intact.

## Required database contract before any allow decision

A separately reviewed additive contract must return tenant-bound immutable purchased service and Basic/Premium capability grants, with original offer/version evidence, independent activation/readiness and live environment. It must support independent per-service subscriptions without inferring service from merchant financial records or mutating original paid evidence. Access must intersect the existing actor/session/RBAC checks. Reports remain internal actor-only, and must use real tenant merchant business data rather than platform subscription payments.

Automation needs a separate claim-bound adapter that rechecks service grants and activation inside retrieval/reservation/start/send transactions; the human session adapter is not usable by end customers or a service-role caller. No future tool/data handler may grant access using this readiness response or bypass authorization on unavailable evidence. Atomic idempotent usage reservation remains mandatory before model/tool execution. That database work and production approval are outside this slice.

## Offline verification

Tests exercise the actual session adapter and HTTP GET handler with synthetic transport responses. They verify no billing reads for rejected actors/RBAC or unsupported capabilities, tenant selection independent of caller parameters, and deny responses for expired/unproven subscriptions and persona/catalog claims. These are offline boundary tests, not live multi-service acceptance or isolated PostgreSQL proof of a new grant contract. There is no new SQL to test in PostgreSQL.

Verified locally on the connected Windows desktop:

- `node node_modules/vitest/vitest.mjs run src/lib/services src/lib/billing/wiring/subscription-read.test.ts src/lib/whatsapp/integration-store.test.ts`: 56 passed, four files.
- `node node_modules/vitest/vitest.mjs run`: 1404 passed, 42 skipped; 122 files passed, 11 opt-in suites skipped.
- `node node_modules/typescript/bin/tsc --noEmit`: exit 0.
- `node node_modules/eslint/bin/eslint.js .`: exit 0, existing `_result` warning at `src/lib/billing/paymob/reconcile.ts:344`.
- `node node_modules/next/dist/bin/next build`: exit 0, Next 16.3.8; new endpoint rendered as dynamic route.

Commands used the existing `vitest.config.ts`, no config changes or loader flags, in `C:/Users/DELL/.codex/worktrees/main-consolidation/Velora new`, PowerShell with `login: false`. Test transport/model fixtures were synthetic; no paid or live provider execution. Initial focused test invocation failed to import the not-yet-created adapter (zero executed cases); after implementation, all new cases passed. The default opt-in PostgreSQL suites remain skipped in this slice, because it introduces no database grant contract or SQL change.
