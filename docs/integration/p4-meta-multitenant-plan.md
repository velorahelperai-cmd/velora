# Multi-tenant Meta WhatsApp implementation plan

> **For agentic workers:** Use superpowers:executing-plans. The user has authorized local implementation and tests; provider activation and cloud changes require separate approval.

**Goal:** Complete the existing P4 path so each company can authorize its own Meta assets and answer from its own approved knowledge.

**Architecture:** Extend the existing link registry, signup attempts, inbound jobs, send intents, knowledge sources and AI usage ledger. Preserve the paid entitlement, quota, budget, generation and idempotency gates from `7cff51c89da09293db4953b8af1b18060d745887`. No parallel queue, token store, billing ledger or knowledge base.

**Tech stack:** Next.js 16.3.8, TypeScript, Supabase/PostgreSQL, Supabase Vault, Meta Embedded Signup v4 and Graph API.

**Spec:** The user's mandatory ten-step multi-tenant Meta WhatsApp acceptance requirement in this conversation.

## Constraints

- Work exclusively on `codex/p4-meta-multitenant` in its isolated worktree.
- No cloud SQL, actual provider requests, paid models, actual messages, deployment, push or backups.
- Preserve original branches/worktrees and existing API contracts where possible; use new forward migrations only.
- Keep live AI and external send disabled. Browser IDs are selectors, never ownership evidence.
- Keep tokens server-only, encrypted and independently bound to each company/link generation.
- Company customization uses approved knowledge retrieval and instructions, without fine-tuning.

## Review focus

- Expired/replayed OAuth codes and changed sessions cannot authorize assets.
- A valid token for another app/WABA/phone/company cannot be installed.
- Revocation and expired credentials stop queued jobs without losing incurred cost evidence.
- Old/future/replayed inbound events cannot open a new customer service window.
- Style/plan/knowledge changes during generation cannot relabel previously generated text.

## Execution

- [x] Add failing signup tests, then implement durable session-bound attempts, server asset verification, Vault installation, disconnect and reauthorization. Add a minimal owner control to existing WhatsApp settings.
- [x] Add failing routing/policy tests, then require signed WABA+phone routing and enforce the customer service window before AI and free-form sends. Preserve dedupe, unknown-send reconciliation and human takeover.
- [x] Add failing company knowledge tests, then implement bounded approved retrieval and canonical paid-plan persona. Recheck cited versions before staging/sending.
- [x] Run focused application tests and typecheck; exercise all forward migrations and RPCs on a new isolated PostgreSQL instance, with independent sessions for material races.
- [x] Obtain a fresh code review, fix material findings, run final tests and scan changes for secrets. Save a local commit and an evidence report, distinguishing local readiness from launch approval.

## Primary contracts

- [Embedded Signup v4 implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation): configuration-based JS SDK authorization-code flow.
- [Tech Provider onboarding](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider): server-side code exchange, WABA subscription and phone registration.
- [Business app coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users): skip registration; verify business-app and Cloud API coexistence. History synchronization requires separate operational setup.
- [Service messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages): customer service window lasts 24 hours from the customer message; outside it, only pre-approved templates.

Read on 2026-10-08 using official HTML-wrapped Markdown endpoints. Provider configuration, permissions/app review and deployment remain separately verified prerequisites.
