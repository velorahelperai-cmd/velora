# Local testing of the unified candidate

Worktree: `C:\Users\DELL\.codex\worktrees\overnight-velora-integration\Velora new`. Branch: `integration/overnight-velora`. Keep provider keys absent and `WHATSAPP_ALLOW_EXTERNAL_SEND`, `WHATSAPP_WORKER_ENABLED`, `WHATSAPP_EMBEDDED_SIGNUP` unset or false. The customer-live source guards remain false (`src/lib/answers/guards.ts` and `src/lib/whatsapp/config.ts`).

## Public preview

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run start -- --hostname 127.0.0.1 --port 3108
```

Open `http://127.0.0.1:3108/` or `/login`. Protected routes fail closed without Auth configuration. No `.env` or real credentials were copied into the worktree. This preview does not simulate successful authentication: provision a separate local Supabase Auth/REST environment with the matching project schema, synthetic users and company memberships for manual protected-page login. The disposable SQL harness below stubs Auth/Storage infrastructure and cannot provide that browser login. Configure local `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_SITE_URL` securely outside Git; server-only paths also need a local `SUPABASE_SERVICE_ROLE_KEY`. Retain all live switches off.

`node scripts/integration/preview-smoke.mjs http://127.0.0.1:3108` uses bundled Playwright with headless installed Chrome, blocks external browser traffic, records four anonymous/public checks and writes screenshots under ignored `artifacts/overnight-preview`. Python Playwright was unavailable; the bundled Node runtime was verified instead. The script never submits credentials or invokes real providers.

## Offline database/application verification

Existing helpers refuse anything except container `velora-c2-runtime-13861eb`, task label `c2-runtime-integration`, network none, data tmpfs `/var/lib/postgresql/data`, no published ports or persistent mounts. Create that disposable Supabase PostgreSQL image locally with a generated test-only password and local Vault encryption prerequisite. No database URL/cloud credentials are accepted. Use synthetic fixtures only.

When creating the scratch container, pass an explicit nonempty tmpfs option such as `--tmpfs /var/lib/postgresql/data:rw,size=1g`; the safety guard intentionally refuses an empty option string. Do not publish ports or attach volumes. Do not replace an existing container without checking its exact task label and isolation metadata. Initialize the image's local `pgsodium_getkey.sh` prerequisite with its output suppressed before Vault tests; never log generated keys or copy customer credentials into this harness.

Run serially per database:

```powershell
node scripts/billing-acceptance/run-postgres.mjs
node scripts/security-foundation/billing-immutability-cases.mjs
node scripts/security-foundation/billing-races.mjs
node scripts/whatsapp-integration/run.mjs --legacy-preflight
node scripts/security-foundation/ai-security.mjs
node scripts/security-foundation/ai-concurrency.mjs
```

The full WhatsApp runner includes `staff-paid-entitlement.sql` and the two observed staff entitlement-expiry/revocation races. After bootstrap, rerun only those races with `node scripts/whatsapp-integration/staff-paid-concurrency.mjs` when needed. These fixtures check new dispatch denial and retained accepted/unknown history; they do not send messages or change payment business policies.

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

## Cloud dependencies remain separate

The repository implements persisted Auth/session, company, knowledge, billing, AI accounting, Inbox and Meta paths. Cloud schema parity is unverified by this offline preview. Before deployment, verify the existing migration history and compatible forward chain, server-only service-role access and Vault; configure the intended Auth redirects/site origin and provider settings.

Meta requires its approved app/configuration, pinned Graph version, allowed HTTPS domains, authorization scopes and subscribed webhook, with the server settings listed in [P4 launch dependencies](p4-meta-multitenant-report.md). `WHATSAPP_EMBEDDED_SIGNUP` enables deliberate onboarding only after these prerequisites; a verified connection, current authorization and message-test evidence are distinct from customer-live activation. Coexistence/keeping WhatsApp on the phone is not implemented by the standard signup path.

Paymob Test requires Test credentials, all three create/webhook/settle switches, verified OMR conversion and an HTTPS callback origin. New Live checkout is refused. Catalog publication and setup-review approval do not activate payment or WhatsApp AI. The real owner AI console separately uses provider keys and the persisted lifetime cap of 1 OMR; do not run additional paid checks from this offline workflow. Customer-live source guards remain disabled even if host flags are set.
