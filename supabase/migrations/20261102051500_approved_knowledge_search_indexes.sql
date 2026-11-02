-- Read-path foundations for current permission-checked retrieval.
-- Exact expressions/predicates match the deployed native retrieval functions.
-- No authority, approval, content-selection or public API changes.
-- Abort quickly if an active writer prevents acquiring the small-table lock.
set local lock_timeout = '2s';
set local statement_timeout = '30s';

create index knowledge_sources_approved_search_idx
 on public.knowledge_sources using gin (
  to_tsvector('simple'::regconfig, title || ' ' || content)
 ) where status='ready' and approved_for_answers
  and approved_version=content_version and length(btrim(content))>0;

-- Allows the mandatory-instructions OR branch to participate in BitmapOr.
create index knowledge_sources_approved_instructions_idx
 on public.knowledge_sources(company_id,id)
 where status='ready' and approved_for_answers
  and approved_version=content_version and usage_role='business_instructions';

create index es02_branch_website_pages_search_idx
 on private.es02_branch_website_pages using gin (
  to_tsvector('simple'::regconfig, coalesce(title,url) || ' ' || extracted_text)
 ) where status='indexed' and length(btrim(extracted_text))>0;
