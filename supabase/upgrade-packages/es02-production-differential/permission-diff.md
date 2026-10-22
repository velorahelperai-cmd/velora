# Exact permission diff

SQL SHA256: a81eccfa37a256f9acd609de4d2c08a4ffa0d438acec31efdb39a323759a8d6f

Roles below describe effective EXECUTE for anon/authenticated/service_role. PUBLIC EXECUTE is revoked on all package functions. No new schema, column, table, role membership or default privilege grants.

- `private.es02_branch_knowledge_revision(uuid,uuid)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `public.es02_read_owned_branch_answer_context(uuid,uuid,uuid)` — create; before: absent; after: {"anon":false,"authenticated":true,"service_role":false}; SECURITY DEFINER.
- `public.es02_read_owned_branch_knowledge(uuid,uuid,uuid)` — create; before: absent; after: {"anon":false,"authenticated":true,"service_role":false}; SECURITY DEFINER.
- `public.es02_add_owned_branch_website(uuid,uuid,uuid,integer,text)` — create; before: absent; after: {"anon":false,"authenticated":true,"service_role":false}; SECURITY DEFINER.
- `public.es02_page_action_owned_branch_knowledge(uuid,uuid,uuid,uuid,text)` — create; before: absent; after: {"anon":false,"authenticated":true,"service_role":false}; SECURITY DEFINER.
- `public.es02_read_owned_branch_reply_language(uuid,uuid,uuid)` — create; before: absent; after: {"anon":false,"authenticated":true,"service_role":false}; SECURITY DEFINER.
- `public.es02_confirm_owned_branch_reply_language(uuid,uuid,uuid,bigint,text)` — create; before: absent; after: {"anon":false,"authenticated":true,"service_role":false}; SECURITY DEFINER.
- `private.es02_trial_context_current(private.es02_branch_trial_operations)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `public.es02_reserve_branch_trial(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,numeric,text,jsonb,jsonb)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER.
- `public.es02_start_branch_trial(uuid)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER.
- `public.es02_read_owned_branch_assistant_trial(uuid,uuid,uuid)` — create; before: absent; after: {"anon":false,"authenticated":true,"service_role":false}; SECURITY DEFINER.
- `public.es02_record_owned_branch_assistant_trial(uuid,uuid,uuid,text,text,text,bigint,text,text,text,uuid)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER.
- `public.es02_read_owned_branch_launch_summary(uuid,uuid,uuid)` — create; before: absent; after: {"anon":false,"authenticated":true,"service_role":false}; SECURITY DEFINER.
- `public.es02_confirm_owned_branch_launch(uuid,uuid,uuid,bigint,text,uuid,boolean)` — create; before: absent; after: {"anon":false,"authenticated":true,"service_role":false}; SECURITY DEFINER.
- `public.es02_index_branch_website_page(uuid,uuid,uuid,uuid,text,text,text,text,integer,text)` — create; before: absent; after: {"anon":false,"authenticated":true,"service_role":false}; SECURITY DEFINER.
- `private.ai_settle_admin(uuid,text,numeric,numeric,jsonb,text,text,integer,text,text,boolean)` — replace; before: {"anon":false,"service_role":false,"authenticated":false}; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY INVOKER → INVOKER.
- `private.es02_reply_credit_hold_guard()` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `private.es02_hold_reply_credit(uuid,uuid,uuid)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `private.es02_settle_reply_credit(uuid,text)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `private.es02_acceptance_evidence_immutable()` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY INVOKER.
- `private.es02_initial_clock_receipt_guard()` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY INVOKER.
- `public.es02_classify_claimed_reply(uuid,uuid,text,text,text[])` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER.
- `private.es02_start_on_accepted_reply(uuid)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `private.es02_native_usage_credit_settlement()` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `private.es02_paid_branch_readiness(uuid,uuid)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `private.es02_claimed_reply_authority(uuid,uuid)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `public.es02_reconcile_activation_readiness(uuid,uuid)` — replace; before: {"anon":false,"service_role":false,"authenticated":true}; after: {"anon":false,"authenticated":true,"service_role":false}; SECURITY DEFINER → DEFINER.
- `private.es02_worker_cost_binding_guard()` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `private.es02_whatsapp_citations_current(uuid,uuid,jsonb)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER.
- `private.es02_start_whatsapp_attempt(uuid,uuid)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `private.es02_native_reply_outcome_proven(uuid,text)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `private.es02_reconcile_native_reply_credit(uuid)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `public.billing_finalize_automated_usage(uuid,uuid)` — replace; before: {"anon":false,"service_role":true,"authenticated":false}; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER → DEFINER.
- `private.es02_job_scope(uuid)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `private.whatsapp_answer_profile(uuid,uuid)` — replace; before: {"anon":false,"service_role":false,"authenticated":false}; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER → DEFINER.
- `public.billing_load_worker_frame(uuid,uuid)` — replace; before: {"anon":false,"service_role":true,"authenticated":false}; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER → DEFINER.
- `public.whatsapp_reserve_job_usage(uuid,uuid)` — replace; before: {"anon":false,"service_role":true,"authenticated":false}; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER → DEFINER.
- `public.ai_start_whatsapp_attempt(uuid,uuid)` — replace; before: {"anon":false,"service_role":true,"authenticated":false}; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER → DEFINER.
- `private.es02_successful_worker_attempt(uuid,uuid,uuid)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":false}; SECURITY DEFINER.
- `public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb)` — replace; before: {"anon":false,"service_role":true,"authenticated":false}; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER → DEFINER.
- `public.whatsapp_claim_assistant_job_send(uuid,uuid)` — replace; before: {"anon":false,"service_role":true,"authenticated":false}; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER → DEFINER.
- `public.es02_verify_claimed_reply_citations(uuid,uuid,jsonb)` — create; before: absent; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER.
- `public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text)` — replace; before: {"anon":false,"service_role":true,"authenticated":false}; after: {"anon":false,"authenticated":false,"service_role":true}; SECURITY DEFINER → DEFINER.

Native aliases: original bodies retained, runtime direct EXECUTE denied.

- `private.es02_pre_usage_settlement(uuid,uuid)`.
- `private.es02_pre_answer_profile(uuid,uuid)`.
- `private.es02_pre_load_worker_frame(uuid,uuid)`.
- `private.es02_pre_reserve_job_usage(uuid,uuid)`.
- `private.es02_pre_start_whatsapp_attempt(uuid,uuid)`.
- `private.es02_pre_stage_job_reply(uuid,uuid,uuid,jsonb)`.
- `private.es02_pre_claim_assistant_job_send(uuid,uuid)`.
- `private.es02_pre_retrieve_approved_knowledge(uuid,uuid,uuid,text)`.

New private tables: RLS enabled, no runtime direct table/column privileges.

- `private.es02_branch_knowledge_sources`.
- `private.es02_branch_website_pages`.
- `private.es02_branch_reply_language_confirmations`.
- `private.es02_branch_assistant_trials`.
- `private.es02_branch_launch_confirmations`.
- `private.es02_branch_trial_operations`.
- `private.es02_reply_credit_holds`.
- `private.es02_operational_recipient_proofs`.
- `private.es02_initial_acceptance_receipts`.

Other DDL / runtime effects

- public.ai_usage_ledger: usage-mode constraint expands admin_test/company_live to admin_test/company_live/setup_trial, with no row conversion.
- public.ai_usage_ledger: five ES02 provenance columns, complete-binding constraint and immutable binding trigger.
- public.whatsapp_inbound_jobs: native usage settlement trigger.
- private.es02_activation_foundation: initial-clock receipt guard trigger.
- Trial-session snapshot keeps historical UUID; current session link can become NULL. No Auth mutation.
- Scoped launch confirmations are invalidated by branch-setting RPCs. New dependent join rows carry explicit cascade relationships. No immediate existing business data deletion.
- See README for independent Paymob and admin uncertainty liabilities and deferred functional verification.
