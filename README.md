# Velora

Velora includes Supabase-backed Auth, company workspaces, knowledge approval, billing and catalog records, WhatsApp Inbox/control paths, Meta Embedded Signup, and an owner-only real AI trial console. Their production paths require the matching deployed schema, server configuration, and authorization. Local acceptance does not establish Cloud readiness or real provider delivery.

## Local preview

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm run start -- --hostname 127.0.0.1 --port 3108
```

Open `http://127.0.0.1:3108/` or `http://127.0.0.1:3108/login`. For development, `npm run dev -- --hostname 127.0.0.1 --port 3108` uses the same local address.

Keep provider keys absent and `WHATSAPP_ALLOW_EXTERNAL_SEND`, `WHATSAPP_WORKER_ENABLED`, and `WHATSAPP_EMBEDDED_SIGNUP` unset or false for offline preview. The customer-live source guards remain disabled. Protected routes fail closed without Supabase Auth configuration; the disposable PostgreSQL acceptance harness stubs Auth/Storage infrastructure and cannot provide a manual browser login.

Manual protected-page testing needs a separate local Supabase Auth/REST environment with the matching project schema and synthetic users/company memberships. Configure local `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_SITE_URL` securely outside Git. Server-only features also need a local service-role key; never expose it through a public variable. Follow [local testing instructions](docs/integration/overnight-local-testing.md) for the isolated offline checks.

## Cloud configuration and rollout

Cloud deployment must verify the existing migration history and apply the compatible forward chain, including Auth/session, billing, AI budget/ledger, Inbox, Meta authorization, routing and answer-profile prerequisites. Supabase service-role access and functioning Vault are required for the server-only integration paths.

Meta setup requires an approved app/configuration, explicitly pinned Graph version, allowed HTTPS domains, business authorization scopes and webhook subscription, plus the documented server credentials. Connecting and storing a business authorization does not activate customer replies. Standard Cloud API signup is implemented; Business App coexistence/keeping WhatsApp on the phone remains a separate unsupported setup dependency. See [Meta implementation and launch dependencies](docs/integration/p4-meta-multitenant-report.md).

Published catalog data does not approve production purchase. Paymob Test requires Test credentials, create/webhook/settle configuration, verified OMR conversion and an HTTPS callback origin; new Live checkout remains refused. See [billing readiness](docs/billing/p2-readiness-report.md).

The real owner AI console requires configured provider keys and its separate persisted lifetime budget of 1 OMR. Customer/WhatsApp answering remains separately disabled. Offline tests do not authorize paid verification or customer rollout. See [AI runtime evidence](docs/real-ai-runtime-verification.md) and [integrated acceptance](docs/integration/overnight-final-report.md).
