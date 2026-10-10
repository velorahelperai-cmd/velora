# Same-company setup refresh correction

Navigation restoration in c7ec1ab was scoped correctly, but profile hydration shared that once-per-scope guard. Fresh server records therefore updated `savedCompany` without reconciling the mounted profile draft. Hours and language also retained their initial input baselines.

The correction separates server facts from navigation restoration. A three-way comparison between input, last server baseline, and fresh server record adopts untouched fields and preserves edited fields. Overlapping changes remain visible and block submission until the owner uses the latest conflicting values. Resolving conflicts leaves unrelated edits intact. Confirmed saves adopt their returned records. This addresses observed refreshes; it does not add a database compare-and-swap guarantee for an unseen concurrent write after refresh.

Verification commands:

- `node node_modules/vitest/vitest.mjs run src/components/app/draft-refresh.test.ts src/components/app/setup-navigation.test.ts src/components/app/c2-onboarding-contracts.test.tsx src/lib/company-draft.test.ts src/lib/tenancy/review-proof.test.ts src/lib/tenancy/review-file-proof.test.ts`
- `node node_modules/vitest/vitest.mjs run`
- `node node_modules/typescript/bin/tsc --noEmit`
- `node node_modules/eslint/bin/eslint.js .`
- `node scripts/internal-ui/setup-refresh.mjs`
- `node node_modules/next/dist/bin/next build`
- `git diff --check`

The browser harness uses isolated synthetic PostgreSQL/Auth/REST and the historical migration cutoff `20261009215520_g03_verified_review.sql`. Its development-only Next router refresh hook exercises mounted client state with actual new server props. External network calls, billing and WhatsApp provider execution are disabled. Evidence is written to ignored `artifacts/internal-ui/refresh-result.json`. No production SQL, push, deployment, real customer changes, or paid calls are included. Live acceptance remains unavailable without an existing authorized session.

Results: 57 focused tests passed; 1,428 aggregate tests passed and 42 opt-in tests skipped. TypeScript and lint passed (the existing `billing/paymob/reconcile.ts:344` unused `_result` warning remains). The isolated browser passed all listed cases. Initial browser runs asserted before streamed RSC bodies finished; the harness now waits for the full response. No passing browser result is inferred from those failed runs.
`next build` passed all 34 generated pages; final TypeScript and diff checks passed. Cleanup retained only the pre-existing `velora-c2-runtime-13861eb` container.
