-- Restore branch ownership missing from the deployed inbox schema. Bind only
-- an unambiguous verified channel that already existed when the conversation
-- began. Unmatched/ambiguous history remains unbound and cannot be answered.
begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
do $guard$ begin
 if exists(select 1 from pg_attribute where attrelid='public.whatsapp_conversations'::regclass and attname='branch_id' and not attisdropped)
  or to_regprocedure('private.whatsapp_resolve_conversation_branch(uuid,text,timestamptz)') is not null then
  raise exception 'CONVERSATION_BRANCH_PREREQUISITE_MISMATCH';
 end if;
end;$guard$;
alter table public.whatsapp_conversations add column branch_id uuid;
create function private.whatsapp_resolve_conversation_branch(p_company uuid,p_phone text,p_started timestamptz)
returns uuid language sql stable security definer set search_path='' as $$
 select case when count(distinct b.branch_id)=1 then (array_agg(distinct b.branch_id))[1] else null end
 from public.whatsapp_company_links w
 join private.es02_b3_connection_links b on b.company_id=w.company_id and b.legacy_link_id=w.id and b.legacy_generation=w.generation
 join public.company_branches branch on branch.company_id=b.company_id and branch.id=b.branch_id
 where w.company_id=p_company and w.provider_phone_number_id=p_phone and w.status='verified'
   and b.channel='whatsapp' and b.status='active' and b.verified and b.revoked_at is null and b.created_at<=p_started;
$$;
revoke all on function private.whatsapp_resolve_conversation_branch(uuid,text,timestamptz) from public,anon,authenticated,service_role;
update public.whatsapp_conversations c set branch_id=private.whatsapp_resolve_conversation_branch(c.company_id,c.phone_number_id,c.created_at)
 where private.whatsapp_resolve_conversation_branch(c.company_id,c.phone_number_id,c.created_at) is not null;
alter table public.whatsapp_conversations add constraint whatsapp_conversation_branch foreign key(company_id,branch_id) references public.company_branches(company_id,id);
create index whatsapp_conversation_branch_page on public.whatsapp_conversations(company_id,branch_id,inbox_sequence desc);
create function private.whatsapp_conversation_branch_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare resolved uuid;
begin
 if tg_op='UPDATE' then
  if new.company_id is distinct from old.company_id or new.phone_number_id is distinct from old.phone_number_id
    or new.created_at is distinct from old.created_at then raise exception 'IMMUTABLE_CONVERSATION_IDENTITY' using errcode='23514';end if;
  if old.branch_id is not null then
   if new.branch_id is distinct from old.branch_id then raise exception 'IMMUTABLE_CONVERSATION_BRANCH' using errcode='23514';end if;
   return new;
  end if;
 end if;
 resolved:=private.whatsapp_resolve_conversation_branch(new.company_id,new.phone_number_id,new.created_at);
 if new.branch_id is not null and new.branch_id is distinct from resolved then raise exception 'CONVERSATION_BRANCH_BINDING_INVALID' using errcode='23514';end if;
 new.branch_id:=resolved;
 return new;
end;$$;
revoke all on function private.whatsapp_conversation_branch_guard() from public,anon,authenticated,service_role;
create trigger whatsapp_conversation_branch_guard before insert or update on public.whatsapp_conversations
 for each row execute function private.whatsapp_conversation_branch_guard();
commit;
