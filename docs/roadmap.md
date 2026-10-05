# Roadmap

Canonical roadmap and backlog are maintained in Obsidian:

- [Roadmap](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/01 - Projects AI/Velora/13_ROADMAP.md>)
- [Backlog](<C:/Users/DELL/Desktop/Obsidian/AI Workspace/01 - Projects AI/Velora/Tasks/BACKLOG.md>)

## VEL-RELEASE-VERIFY-01

Closed 2026-10-05. Published commit `217eafb33a1e381c71bde2a0cd47c8d4c82ad270` on `origin/main`; site https://velorahelper.com (Netlify 200, client bundle includes `motion-theater` / `scrollToScene`). `vel_knowledge_storage_object_invalidation` (`20261005193102`) remains applied; trigger `knowledge_invalidate_storage_objects` enabled; `20261005160000` not applied. Live answering and external WhatsApp send stay off. Public pages checked (home AR/EN, `#how`, login/signup as view, privacy/terms/deletion, phone menu). No authorized admin session: `/app` and `/admin` redirect to login only. WhatsApp control/outbound/tenant-link SQL and admin-account journey still unavailable on the live schema.

## VEL-WA-TENANT-ROUTING-01

W01–W12 registry path wired in code, not live. Default `WHATSAPP_ROUTING_MODE` is `single_tenant` (env mapping). `tenant_registry` uses `resolveWhatsappCompanyByProviderPhone` per event; resolver failure does not fall back to env. `resolveWhatsappOutboundSecret` is `NEEDS_SETUP` (no vault, no env-token reuse). Embedded Signup / per-number secrets / applying `20261005140000` (+ WA 103000/120000) still required before live multi-tenant receive/send. AI and `WHATSAPP_ALLOW_EXTERNAL_SEND` stay off. Isolated unit tests only — not Meta/RLS/browser.

## VEL-PRODUCT-INTEGRATION-01

Closed in code 2026-10-06. Not applied, not published, not live Meta/AI.

Implemented: intent `link_id`/`link_generation` reuse (RPC + TS callers); pre-Graph finalize=`rejected` vs Graph-unknown; workspace picker (no first-company auto-pick); platform admin `/app` only with membership; Embedded Signup v4 contract default-off; access-secret lookup `NEEDS_SETUP`; AI isolation key + worker plan (unscheduled); entitlement always `not_configured`.

Reused: `resolveWhatsappCompanyByProviderPhone`, send intents 120000, registry 140000, `AnswerProvider`/`askCompanyAnswer`/`channel-adapter`, `getCustomerReadiness`/`adminGetOverviewStats`.

New unapplied SQL: `supabase/migrations/20261006010000_vel_wa_intent_link_generation.sql` (after 101500→103000→120000→140000). Do not apply `20261005160000` with this package.

Blocked: vault backend choice; Embedded Signup persist table; payment provider; model/budget; live OAuth. Stay off: `WHATSAPP_ALLOW_EXTERNAL_SEND`, live answering, `WHATSAPP_EMBEDDED_SIGNUP`, `WHATSAPP_ROUTING_MODE=tenant_registry` until 103000/120000/140000 + 06010000 applied.

## Launch: Meta/AI integration-ready (live off)

Meta and AI server paths are ready to plug (`pathReady`); live Graph/OAuth/paid answers stay off (`liveReady=false`). Product surface: account, company, knowledge, review, `/app`, `/admin`. Snapshot: `readIntegrationReadiness()`. Report: `docs/handoff-report-2026-10-06.md`. Do not apply 101500→06020000 or 160000 without separate approval.
