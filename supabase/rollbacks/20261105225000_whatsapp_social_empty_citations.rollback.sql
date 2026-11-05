-- Rollback: restore strict positive citation length requirement

ALTER TABLE public.ai_usage_ledger DROP CONSTRAINT IF EXISTS ai_attempt_authorization_binding;
ALTER TABLE public.ai_usage_ledger ADD CONSTRAINT ai_attempt_authorization_binding
CHECK ((((worker_job_id IS NULL) AND (worker_claim_token IS NULL) AND (automation_generation IS NULL) AND (actor_user_id IS NOT NULL) AND (actor_session_id IS NOT NULL)) OR ((worker_job_id IS NOT NULL) AND (worker_claim_token IS NOT NULL) AND (automation_generation >= 0) AND (automation_generation IS NOT NULL) AND (usage_mode = 'company_live'::text) AND (actor_user_id IS NULL) AND (actor_session_id IS NULL) AND
CASE
    WHEN (jsonb_typeof(source_citations) = 'array'::text) THEN ((jsonb_array_length(source_citations) >= 1) AND (jsonb_array_length(source_citations) <= 40))
    ELSE false
END)));
