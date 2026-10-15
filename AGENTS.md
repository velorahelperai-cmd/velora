<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Permanent ban: Obsidian

Do **not** open, read, search, or modify anything under Obsidian (including Handoffs and decision files). Rely only on the user request and this project codebase.

## Delivery priority

The user's goal is to make Velora ready for real business use as soon as possible. Build reusable production paths with real persistence, enforced authorization, and actual integrations. Do not deliver disposable mock implementations that must be rebuilt for launch. Keep tests focused on material failures and continue authorized work through deployment. Administrative AI trials use real model calls with a separately enforced total budget of 1 OMR; customer/WhatsApp activation remains a separate rollout.

## Paid verification

Do not run additional paid AI verification calls without a new explicit user request. Offline unit tests and read-only checks do not authorize provider execution. The real owner console remains available for the user's own deliberate trials within the approved lifetime cap.

## Execution continuity — EXEC-001

- Read PROJECT_STATE.md's Quick Session Index, then only the current Flow/Stage resources, contracts and acceptance. Preserve all approved scope; never substitute an MVP or silently defer features.
- **Highest priority — FLOW-LOCK-001:** remain in the approved Active Flow/Stage/Task, starting FLOW-001's earliest incomplete required Stage. Advance only after complete acceptance and its transition are verified; historical tests, UI and Build are insufficient. Record active IDs, acceptance, next Stage, dependencies, queued requests and actual evidence in PROJECT_STATE.md.
- Schedule new approved requests with stable IDs/Flow/Stage/dependencies/priority/acceptance after the active Flow. Only critical security/data-loss risks, defects blocking that Flow or explicit immediate user reprioritisation permit an exception; record its approval/reason. Never silently change the lock or abandon a requirement.
- Plan minimally, reuse implementation, test identity/permissions/isolation/persistence and integration boundaries, preserve diagnosable error references, update state and integrate completed safe increments through mandatory CI; then begin the exact next authorised Stage. If blocked, work only on an authorised prerequisite or genuinely independent support task.
- Use 2–4 parallel streams only when they improve delivery without shared Auth/schema/billing/API conflicts. Reuse a suitable clean worktree, record actual task/owner/contracts, and serialize integration; do not assume other chats communicate.
- OPS-001 requires enforceable pre-main quality gates and exact-SHA postflight, not local tests alone. Prepare CI locally while protection is blocked; never bypass protection or make an unprotected Push. Sensitive Production changes and paid calls keep their separate authorization requirements.
- Keep the existing Flow/Stage/Feature and maintenance maps current with actual tests, affected files/contracts and diagnosis entry points. Distinguish Implemented, Integrated, Verified and Production Ready; never close work from UI/Build alone.
- Keep Customer Launch Readiness distinct from Full Approved Scope Completion. Launch requires proven identity/recovery, tenant/branch authority, interruption-safe persistence, finance/activation, authorised channels/AI limits, whole journeys, enforced CI/deployment, diagnosis/monitoring/recovery and no release-blocking defects. No readiness or zero-defect promise from simulations.
- Add tested CI metadata checks where feasible for task mapping, state updates, evidence and duplicate/missing IDs; manual PR review remains necessary for actual acceptance, scope and authorisation. Never claim external enforcement until its controls are installed and proven. Report current Flow/Stage, transition result, exact next Stage/reason and external blockers without asking the user to choose a predetermined task.
- Do not add management tools, duplicate reports or issues for minor edits. When blocked, continue independent approved work and report only the concrete blocker.

## Mandatory production logging — LOG-001

- Apply the user's Production Logging Playbook to every future code/infrastructure change and review. Existing coverage is not presumed compliant. Full-repository migration/audit starts only on the explicit "Apply the Logging Playbook to this repo" request; otherwise keep the Flow lock and register required logging prerequisites.
- Use one shared established structured logger: Node/TypeScript pino + pino-http or winston; Python structlog/contextvars; Go slog JSONHandler/zap/zerolog; Java/Kotlin Logback + logstash-encoder or Log4j2/MDC; .NET Serilog; PHP Monolog JsonFormatter. No ad-hoc console/print/interpolated input logs. Production/staging single-line JSON to stdout/stderr only; local pretty/color output.
- Every event carries UTC ISO timestamp with milliseconds, level, service, env, release/Git version, request_id, authenticated user_id/tenant_id (never raw email), stable dot-separated event and trace_id/span_id when applicable. HTTP events also carry route template/method/status/duration_ms/client_ip; failures carry error.type/full stack with secrets redacted.
- Validate incoming X-Request-ID or generate a UUID, return it in response headers and propagate request/authenticated tenant context through async context automatically. Read LOG_LEVEL dynamically; default info in Production and debug locally. TRACE/DEBUG off in Production; validation/retries/handled anomalies WARN, impacted operations ERROR, unrecoverable startup FATAL.
- Log exceptions once at the handling boundary, never log-and-rethrow. Register uncaughtException/unhandledRejection boundary handlers without duplicating framework reporting. Distinguish application/access/audit/security records by field or stream.
- Cover one inbound request summary; DB/provider calls (target/duration/outcome); jobs start/end/retries/failure; startup/nonsecret version/config and graceful shutdown; key business events; login/logout/MFA/reset/403/permission/admin/rate-limit/key/export audit events with who/what/when.
- Native logger redaction must exclude passwords, tokens/JWTs/keys/OAuth secrets/cookies/Authorization/Set-Cookie, sensitive financial/identity/health data, encryption keys and credential-bearing DB URLs; no raw request/response bodies by default. Mask strictly necessary email/phone references. Serialize input as fields to escape control characters; redact secrets embedded in error stacks too.
- When setting up deployment/Docker/Kubernetes/observability, provide a buffered TLS collector and central store. Loki labels only service/env/level; request/user/trace/IP stay in payload. Do not ship DEBUG; drop/sample noisy healthy/static events, never errors. Alerts: >5x baseline errors, >2% 5xx/5m, new error.type, dependency failure, >10 failed logins/5m, zero logs/10m. Retention: hot 7–30d, warm 30–90d, immutable audit archive >=1y.
- Explicit full audit order: discover stack/entry points/providers/deployment and present a plan; implement shared logger/context/coverage/redaction and replace ad-hoc logs; then collector/Loki/Grafana/alerts, request_id test-error verification and LOGGING.md. Do not create that guide or claim operational compliance before that scope is actually executed and verified.

## Concise delivery and token economy

Provide short summaries only. Do not create unsolicited written reports, status documents, or duplicate handoffs. Create an artifact only when explicitly requested or necessary for a concrete approval, release gate, or safe recovery, and keep it minimal. Minimize token use, tool calls, repeated reads, and repeated tests. Perform only work needed for the current objective; defer optional polish and unrelated tasks. Preserve necessary authorization, persistence, security, and deployment checks.

## Cost ledger

When Velora work discovers or changes a cost, read and follow `.cursor/rules/cost-ledger.mdc` to update the user's existing desktop cost ledger.
