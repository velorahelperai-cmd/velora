-- REVIEW ONLY: target vmpifljyozsbtssxhoxd, published c36f2286. No live execution authorized.
begin;
set local role postgres;
set local search_path='';
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ begin if exists(select 1 from information_schema.columns where table_schema='public' and table_name='knowledge_sources' and column_name in ('usage_role','prepared_file_sha256','prepared_text_sha256','prepared_content_version')) or to_regclass('private.g03_company_inputs') is not null or to_regprocedure('public.g03_read_review_request(uuid)') is not null then raise exception 'ALREADY_UPGRADED_OR_PARTIAL_BASELINE';end if;
 if coalesce((select md5(prosrc) from pg_proc where oid=to_regprocedure('public.transition_company_review(text,uuid,integer,text,text,boolean,text)')),'') not in ('59ad4b24f323db4a7233f4661de0c7bc','03086efcb7e3cce72920575e21d2d99d') then raise exception 'LEGACY_WRITER_MISMATCH';end if;
 end $$;
create or replace function public.transition_company_review(p_action text,p_company_id uuid,p_expected_revision integer default null,p_number_ownership text default null,p_whatsapp_number text default null,p_readiness_confirmed boolean default null,p_owner_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_company_id is null or p_action is null or p_action not in ('submit','resubmit','approve','request_changes') then raise exception 'invalid_input' using errcode='22023';end if;
 if p_action in ('submit','resubmit') then perform private.require_active_owner(p_company_id);
 elsif auth.uid() is null or not private.actor_may_review_company(p_company_id) then raise exception 'forbidden' using errcode='42501';end if;
 return jsonb_build_object('ok',false,'code','UPGRADE_PENDING');
end; $$;
revoke all on function public.transition_company_review(text,uuid,integer,text,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.transition_company_review(text,uuid,integer,text,text,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;
