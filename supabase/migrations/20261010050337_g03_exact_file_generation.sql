-- Local additive fix. Production application requires separate exact-bundle approval.
-- Metadata only: retain database microseconds; never round the publication guard.
begin;
set local lock_timeout='2s';
set local statement_timeout='30s';
do $$ begin
  if (select md5(prosrc) from pg_proc where oid=to_regprocedure('private.g03_lock_actor(uuid,text,uuid)')) is distinct from '6a7e552989ce5f3e980d11ca320c4683'
    or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.g03_publish_prepared_file(uuid,uuid,uuid,uuid,integer,text,text,text,bigint,uuid,timestamp with time zone)')) is distinct from '5e0dccd905f383e1b4ba541cff94b0bf'
    then raise exception 'G03_EXACT_READ_PREREQUISITE_MISMATCH';end if;
end $$;
create function public.g03_read_file_generation(
  p_source_id uuid,p_company_id uuid,p_storage_path text,p_action text default 'publish'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if p_source_id is null or p_company_id is null or p_storage_path is null
    or p_action is null or p_action not in ('publish','submit','resubmit','approve')
    or p_storage_path not like p_company_id::text||'/'||p_source_id::text||'/%'
    or position(chr(92) in p_storage_path)>0 or p_storage_path ~ '(^|/)[.]{1,2}(/|$)'
    then raise exception 'invalid_input' using errcode='22023';end if;
  perform 1 from public.companies where id=p_company_id and status<>'suspended' for share nowait;
  if not found then raise exception 'forbidden' using errcode='42501';end if;
  -- Reuse current confirmed-email/session/idle/actor authorization and locks.
  -- A requested review action grants only existing owner/reviewer permissions.
  perform private.g03_lock_actor(p_company_id,p_action);
  select jsonb_build_object('status','ok','object_id',o.id,
    'updated_at',to_char(o.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
    into result from storage.objects o join public.knowledge_sources k
      on k.id=p_source_id and k.company_id=p_company_id and k.kind='file'
      and k.storage_path=p_storage_path
    where o.bucket_id='company-knowledge' and o.name=p_storage_path
      and o.updated_at is not null
    for share of o nowait;
  return coalesce(result,jsonb_build_object('status','missing'));
exception when lock_not_available then return jsonb_build_object('status','error');
end; $$;
revoke all on function public.g03_read_file_generation(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.g03_read_file_generation(uuid,uuid,text,text) to authenticated;
comment on function public.g03_read_file_generation(uuid,uuid,text,text) is
  'Actor-scoped file object generation, canonical UTC microseconds; bytes must still be bounded/downloaded and generation checked before and after extraction.';
notify pgrst,'reload schema';
commit;
