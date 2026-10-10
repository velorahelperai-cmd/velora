-- Bounded prerequisite extracted from the approved company-answer-profile contract.
-- Not in migrations/: explicit reviewed package only, no automatic deployment.
alter table public.knowledge_sources add column usage_role text not null default 'knowledge'
  check (usage_role in ('knowledge','business_instructions'));
comment on column public.knowledge_sources.usage_role is
  'Approved source purpose. Business instructions are lower-trust context and never system policy.';
grant insert(usage_role),update(usage_role) on public.knowledge_sources to authenticated;
create function private.knowledge_sources_usage_role_approval() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if new.usage_role is distinct from old.usage_role then
  new.content_version:=greatest(new.content_version,old.content_version+1);
  new.approved_for_answers:=false;new.approved_version:=null;new.approved_at:=null;new.approved_by:=null;
 end if;
 return new;
end; $$;
revoke all on function private.knowledge_sources_usage_role_approval() from public,anon,authenticated,service_role;
create trigger knowledge_sources_z_usage_role_approval before update on public.knowledge_sources
 for each row execute function private.knowledge_sources_usage_role_approval();
