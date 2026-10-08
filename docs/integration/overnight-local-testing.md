# Local testing of the unified candidate

Worktree: `C:\Users\DELL\.codex\worktrees\overnight-velora-integration\Velora new`. Branch: `integration/overnight-velora`. Keep provider keys absent and `WHATSAPP_ALLOW_EXTERNAL_SEND`, `WHATSAPP_WORKER_ENABLED`, `WHATSAPP_EMBEDDED_SIGNUP_ENABLED` disabled. The customer-live source guard remains false.

## Public preview

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run start -- --hostname 127.0.0.1 --port 3108
```

Open `http://127.0.0.1:3108/` or `/login`. Protected routes fail closed without Auth configuration. No `.env` or real credentials were copied into the worktree. This preview does not simulate successful authentication: provision a separate local Supabase Auth/REST environment for manual protected-page login. Configure local public values securely outside Git; retain all live switches off.

`node scripts/integration/preview-smoke.mjs http://127.0.0.1:3108` uses bundled Playwright with headless installed Chrome, blocks external browser traffic, records four anonymous/public checks and writes screenshots under ignored `artifacts/overnight-preview`. Python Playwright was unavailable; the bundled Node runtime was verified instead. The script never submits credentials or invokes real providers.

## Offline database/application verification

Existing helpers refuse anything except container `velora-c2-runtime-13861eb`, task label `c2-runtime-integration`, network none, data tmpfs `/var/lib/postgresql/data`, no published ports or persistent mounts. Create that disposable Supabase PostgreSQL image locally with a generated test-only password and local Vault encryption prerequisite. No database URL/cloud credentials are accepted. Use synthetic fixtures only.

Run serially per database:

```powershell
node scripts/billing-acceptance/run-postgres.mjs
node scripts/security-foundation/billing-immutability-cases.mjs
node scripts/security-foundation/billing-races.mjs
node scripts/whatsapp-integration/run.mjs --legacy-preflight
node scripts/security-foundation/ai-security.mjs
node scripts/security-foundation/ai-concurrency.mjs
```

Billing helpers use `billing_acceptance`; WhatsApp helpers use `whatsapp_integration`. Do not run another suite during a same-database bootstrap or administrative-budget contention test. The two database bootstraps are independent.

After schema/fixtures exist, execute `scripts/integration/review-scope.sql` with the verified local harness and run the opt-in application suites:

```powershell
$env:BILLING_ACCEPTANCE_POSTGRES_TESTS='1'
$env:C1_SECURITY_POSTGRES_TESTS='1'
$env:WHATSAPP_INTEGRATION_POSTGRES_TESTS='1'
npx vitest run src/lib/billing/wiring/acceptance-postgres-app.test.ts src/lib/answers/runtime/security-postgres-app.test.ts src/lib/whatsapp/integration-postgres-app.test.ts
node scripts/whatsapp-integration/run-worker-local.mjs --fixtures-only
$env:C2_RUNTIME_POSTGRES_TESTS='1'
npx vitest run src/lib/whatsapp/company-journey-postgres.test.ts
```

The offline consumer verifies HMAC/reception and actual worker HTTP handler, FIFO/dedup, saved response/quotas/cost, accepted/read delivery and unknown-send fencing. Its test-only setup quarantines leftover runnable synthetic jobs from preceding suites while retaining history; it never deletes financial evidence or creates a competing queue. Model/Graph calls remain mocks. The final company journey uses synthetic authenticated transport with real session/RLS and executes the actual Inbox/control readers/actions and accounting.

For a default unit run, unset all four opt-in test variables above, then run `npx vitest run --reporter=dot`. Typecheck: `npm run typecheck`; lint: `npm run lint`. A staged/real-provider journey requires separate owner authorization; these instructions do not authorize cloud SQL, payment, model or WhatsApp activation.
