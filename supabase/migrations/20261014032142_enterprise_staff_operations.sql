-- Additive customer branch schedules, presence and private collaboration.
-- Apply only after enterprise_branch_authority; no provider or billing calls.
begin;
create table public.company_branch_schedules (
 account_id uuid primary key references public.company_branch_accounts(id),company_id uuid not null,branch_id uuid not null,
 weekly jsonb not null default '[]' check(jsonb_typeof(weekly)='array'),exceptions jsonb not null default '[]' check(jsonb_typeof(exceptions)='array'),
 revision integer not null default 1,updated_at timestamptz not null default clock_timestamp(),updated_by uuid references auth.users(id),
 foreign key(company_id,branch_id) references public.company_branches(company_id,id)
);
create table private.enterprise_presence (
 account_id uuid not null references public.company_branch_accounts(id),session_id uuid not null references auth.sessions(id) on delete cascade,
 heartbeat_at timestamptz not null default clock_timestamp(),primary key(account_id,session_id)
);
create table public.company_conversation_notes (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,branch_id uuid not null,
 conversation_id uuid not null references public.whatsapp_conversations(id),author_id uuid references auth.users(id),
 body text not null check(char_length(btrim(body)) between 1 and 10000),revision integer not null default 1,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,branch_id) references public.company_branches(company_id,id)
);
create table private.enterprise_note_history (
 note_id uuid not null references public.company_conversation_notes(id),revision integer not null,actor_id uuid not null references auth.users(id),
 body text not null,created_at timestamptz not null default clock_timestamp(),primary key(note_id,revision)
);
create index company_conversation_notes_thread on public.company_conversation_notes(company_id,branch_id,conversation_id,created_at);

-- Existing channel routing remains on the primary branch. No provider binding
-- can be relocated by changing an employee or a conversation request.
alter table public.whatsapp_conversations add column branch_id uuid;
update public.whatsapp_conversations c set branch_id=b.id from public.company_branches b where b.company_id=c.company_id and b.is_primary;
alter table public.whatsapp_conversations alter column branch_id set not null;
alter table public.whatsapp_conversations add constraint whatsapp_conversation_branch foreign key(company_id,branch_id) references public.company_branches(company_id,id);
create index whatsapp_conversation_branch_page on public.whatsapp_conversations(company_id,branch_id,inbox_sequence desc);
create function private.enterprise_conversation_branch() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.branch_id is null then select id into new.branch_id from public.company_branches where company_id=new.company_id and is_primary;end if;
  -- Until branch-specific channel routing is installed, all inbound provider
  -- identities are anchored to the primary branch, including service writes.
  if not exists(select 1 from public.company_branches where id=new.branch_id and company_id=new.company_id and is_primary) then raise exception 'BRANCH_CHANNEL_ROUTING_NOT_READY' using errcode='23514';end if;
 elsif new.branch_id is distinct from old.branch_id then raise exception 'IMMUTABLE_CONVERSATION_BRANCH' using errcode='23514';
 end if;
 return new;
end; $$;
create trigger enterprise_conversation_branch before insert or update on public.whatsapp_conversations for each row execute function private.enterprise_conversation_branch();

-- Keep the primary branch's existing inbox/send integration usable for newly
-- invited employees, using the reviewed capability store. Managers never inherit
-- a company-wide role; their scoped APIs use enterprise_can instead.
create function private.enterprise_primary_grant_sync() returns trigger language plpgsql security definer set search_path='' as $$
declare a public.company_branch_accounts%rowtype;
begin
 select * into a from public.company_branch_accounts where id=new.account_id;
 if a.customer_role='employee' and exists(select 1 from public.company_branches where id=new.branch_id and is_primary) then
  insert into public.company_member_grants(company_id,user_id,capabilities,conversation_scope,manager_user_id,status,updated_by)
  values(new.company_id,a.user_id,array(select cap from unnest(new.capabilities) cap where cap=any(private.access_company_capabilities())),'all_company',null,'active',new.updated_by)
  on conflict(company_id,user_id) do update set capabilities=excluded.capabilities,conversation_scope='all_company',manager_user_id=null,
  status='active',revision=company_member_grants.revision+1,updated_at=clock_timestamp(),updated_by=excluded.updated_by;
 end if;
 return new;
end; $$;
create trigger enterprise_primary_grant_sync after insert or update on public.company_branch_grants for each row execute function private.enterprise_primary_grant_sync();

create function private.enterprise_member_control_release() returns trigger language plpgsql security definer set search_path='' as $$
declare prior_setting text;count_released integer;
begin
 if new.status='active' or new.status=old.status then return new;end if;
 prior_setting:=current_setting('velora.conversation_control',true);
 perform set_config('velora.conversation_control','1',true);
 update public.whatsapp_conversations set assigned_to=null,status='open',automation_allowed=case when status='handed_over' then false else automation_allowed end,
 control_revision=control_revision+1,automation_generation=automation_generation+case when status='handed_over' then 1 else 0 end,control_actor_id=auth.uid(),control_acted_at=clock_timestamp()
 where company_id=new.company_id and assigned_to=new.user_id and status<>'resolved';
 get diagnostics count_released=row_count;
 perform set_config('velora.conversation_control',coalesce(prior_setting,''),true);
 if count_released>0 then insert into public.company_branch_audit(company_id,actor_id,account_id,action,detail)
 values(new.company_id,auth.uid(),new.id,'conversation.membership_release',jsonb_build_object('count',count_released,'reason',new.status,'waitingFor','eligible_control'));end if;
 return new;
end; $$;
create trigger enterprise_member_control_release after update on public.company_branch_accounts for each row execute function private.enterprise_member_control_release();

create function private.enterprise_shift_active(aid uuid,at_time timestamptz) returns boolean language plpgsql stable security definer set search_path='' as $$
declare s public.company_branch_schedules%rowtype;zone text;local_time timestamp;start_date date;day integer;r jsonb;exception_row jsonb;start_at time;end_at time;
begin
 select * into s from public.company_branch_schedules where account_id=aid;if not found then return false;end if;
 select timezone into zone from public.company_branches where id=s.branch_id and company_id=s.company_id and status='active';if not found then return false;end if;
 local_time:=at_time at time zone zone;
 -- Evaluate shifts beginning today and yesterday; overnight shifts use the
 -- start date's weekday/holiday override. The clock always comes from server.
 for start_date in select local_time::date union all select local_time::date-1 loop
  day:=extract(dow from start_date)::integer;
  select value into exception_row from jsonb_array_elements(s.exceptions) where value->>'date'=start_date::text limit 1;
  if found then
   if (exception_row->>'closed')::boolean then continue;end if;
   start_at:=(exception_row->>'start')::time;end_at:=(exception_row->>'end')::time;
   if local_time>=start_date+start_at and local_time<start_date+end_at+(case when end_at<=start_at then interval '1 day' else interval '0 day' end) then return true;end if;
  else
   for r in select value from jsonb_array_elements(s.weekly) where (value->>'day')::integer=day loop
    start_at:=(r->>'start')::time;end_at:=(r->>'end')::time;
    if local_time>=start_date+start_at and local_time<start_date+end_at+(case when end_at<=start_at then interval '1 day' else interval '0 day' end) then return true;end if;
   end loop;
  end if;
 end loop;
 return false;
end; $$;
create function public.enterprise_save_schedule(p_company_id uuid,p_branch_id uuid,p_user_id uuid,p_expected_revision integer,p_weekly jsonb,p_exceptions jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);a public.company_branch_accounts%rowtype;version integer;r jsonb;day integer;
begin
 if uid is null or not private.enterprise_can(p_company_id,p_branch_id,uid,'staff.schedule.update')
 or (not private.enterprise_owner(p_company_id,uid) and not exists(select 1 from public.company_branch_accounts where company_id=p_company_id and user_id=uid and customer_role='manager' and status='active')) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into a from public.company_branch_accounts where company_id=p_company_id and user_id=p_user_id and branch_id=p_branch_id and status<>'terminated' and customer_role='employee' for update;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_weekly is null or p_exceptions is null or jsonb_typeof(p_weekly)<>'array' or jsonb_typeof(p_exceptions)<>'array'
 or jsonb_array_length(p_weekly)>28 or jsonb_array_length(p_exceptions)>100 or p_expected_revision is null or p_expected_revision<0 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 for r in select value from jsonb_array_elements(p_weekly) loop
  if jsonb_typeof(r)<>'object' or not r ?& array['day','start','end'] or jsonb_typeof(r->'day')<>'number' or jsonb_typeof(r->'start')<>'string' or jsonb_typeof(r->'end')<>'string' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  day:=(r->>'day')::integer;
  if day not between 0 and 6 or r->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or r->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or r->>'start'=r->>'end' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 end loop;
 for r in select value from jsonb_array_elements(p_exceptions) loop
  if jsonb_typeof(r)<>'object' or not r ?& array['date','closed'] or jsonb_typeof(r->'date')<>'string' or jsonb_typeof(r->'closed')<>'boolean' or r->>'date' !~ '^\d{4}-\d{2}-\d{2}$' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  perform (r->>'date')::date;
  if not (r->>'closed')::boolean and (not r ?& array['start','end'] or jsonb_typeof(r->'start')<>'string' or jsonb_typeof(r->'end')<>'string' or r->>'start' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or r->>'end' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or r->>'start'=r->>'end') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 end loop;
 if (select count(distinct value->>'date') from jsonb_array_elements(p_exceptions))<>jsonb_array_length(p_exceptions) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select revision into version from public.company_branch_schedules where account_id=a.id for update;
 if coalesce(version,0)<>p_expected_revision then return jsonb_build_object('ok',false,'code','STALE_REVISION');end if;
 insert into public.company_branch_schedules(account_id,company_id,branch_id,weekly,exceptions,updated_by) values(a.id,p_company_id,p_branch_id,p_weekly,p_exceptions,uid)
 on conflict(account_id) do update set weekly=excluded.weekly,exceptions=excluded.exceptions,revision=company_branch_schedules.revision+1,updated_at=clock_timestamp(),updated_by=uid returning revision into version;
 insert into public.company_branch_audit(company_id,branch_id,actor_id,account_id,action,detail) values(p_company_id,p_branch_id,uid,a.id,'schedule.updated',jsonb_build_object('revision',version));
 perform private.enterprise_commit(p_company_id,uid);
 return jsonb_build_object('ok',true,'revision',version);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return jsonb_build_object('ok',false,'code','INVALID_INPUT');
end; $$;
create function private.enterprise_employee_eligible(cid uuid,uid uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.company_branch_accounts a join public.company_members m on m.company_id=a.company_id and m.user_id=a.user_id and m.status='active'
 where a.company_id=cid and a.user_id=uid and a.customer_role='employee' and a.status='active'
 and private.enterprise_shift_active(a.id,clock_timestamp()) and exists(
  select 1 from private.enterprise_presence p join auth.sessions s on s.id=p.session_id and s.user_id=uid
  join private.app_session_activity activity on activity.session_id=s.id and activity.user_id=uid
  where p.account_id=a.id and p.heartbeat_at>clock_timestamp()-interval '2 minutes'
  and s.created_at>a.session_epoch and s.created_at>clock_timestamp()-interval '30 days'
  and coalesce((to_jsonb(s)->>'not_after')::timestamptz,'infinity')>clock_timestamp()
  and activity.expired_at is null and activity.last_activity_at>clock_timestamp()-interval '2 hours'
  and not exists(select 1 from private.enterprise_session_revocations r where r.company_id=cid and r.session_id=s.id)
 ))
$$;
create function private.enterprise_release_member_control(cid uuid,uid uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare prior_setting text;released integer;
begin
 prior_setting:=current_setting('velora.conversation_control',true);perform set_config('velora.conversation_control','1',true);
 update public.whatsapp_conversations set assigned_to=null,status='open',automation_allowed=case when status='handed_over' then false else automation_allowed end,
 control_revision=control_revision+1,automation_generation=automation_generation+case when status='handed_over' then 1 else 0 end,control_actor_id=null,control_acted_at=clock_timestamp()
 where company_id=cid and assigned_to=uid and status<>'resolved';get diagnostics released=row_count;
 perform set_config('velora.conversation_control',coalesce(prior_setting,''),true);
 if released>0 then insert into public.company_branch_audit(company_id,action,detail)
 values(cid,'conversation.presence_release',jsonb_build_object('userId',uid,'count',released,'reason',reason,'waitingFor','eligible_control'));end if;
end; $$;
create function public.enterprise_presence_heartbeat(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);a public.company_branch_accounts%rowtype;sid uuid;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 sid:=(auth.jwt()->>'session_id')::uuid;
 select * into a from public.company_branch_accounts where company_id=p_company_id and user_id=uid and status='active' for share;
 if not found or not private.enterprise_account_current(p_company_id,uid,sid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if a.customer_role='employee' and not private.enterprise_employee_eligible(p_company_id,uid) then
  perform private.enterprise_release_member_control(p_company_id,uid,'shift_or_presence_expired');
 end if;
 insert into private.enterprise_presence(account_id,session_id) values(a.id,sid) on conflict(account_id,session_id) do update set heartbeat_at=clock_timestamp();
 perform private.enterprise_commit(p_company_id,uid);
 return jsonb_build_object('ok',true,'inShift',private.enterprise_shift_active(a.id,clock_timestamp()));
end; $$;

create function public.enterprise_notes(p_company_id uuid,p_branch_id uuid,p_conversation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);items jsonb;
begin
 if uid is null or not private.enterprise_can(p_company_id,p_branch_id,uid,'wa.conversations.read') or not exists(select 1 from public.whatsapp_conversations where company_id=p_company_id and branch_id=p_branch_id and id=p_conversation_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'authorId',author_id,'body',body,'revision',revision,'createdAt',created_at,'updatedAt',updated_at) order by created_at),'[]') into items
 from public.company_conversation_notes where company_id=p_company_id and branch_id=p_branch_id and conversation_id=p_conversation_id;
 return jsonb_build_object('ok',true,'notes',items);
end; $$;
create function public.enterprise_save_note(p_company_id uuid,p_branch_id uuid,p_conversation_id uuid,p_note_id uuid,p_expected_revision integer,p_body text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);n public.company_conversation_notes%rowtype;
begin
 if uid is null or not private.enterprise_can(p_company_id,p_branch_id,uid,'wa.conversations.read') or not exists(select 1 from public.whatsapp_conversations where company_id=p_company_id and branch_id=p_branch_id and id=p_conversation_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_note_id is null or p_body is null or char_length(btrim(p_body)) not between 1 and 10000 or p_expected_revision is null or p_expected_revision<0 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 perform pg_advisory_xact_lock(hashtextextended('enterprise-note:'||p_note_id::text,0));
 select * into n from public.company_conversation_notes where id=p_note_id for update;
 if found then
  if n.company_id<>p_company_id or n.branch_id<>p_branch_id or n.conversation_id<>p_conversation_id then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if not private.enterprise_can(p_company_id,p_branch_id,uid,'conversation.internal_note.manage') and (n.author_id is distinct from uid or not private.enterprise_can(p_company_id,p_branch_id,uid,'conversation.internal_note.edit_own')) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  if n.revision<>p_expected_revision then return jsonb_build_object('ok',false,'code','STALE_REVISION');end if;
  insert into private.enterprise_note_history(note_id,revision,actor_id,body) values(n.id,n.revision,uid,n.body);
  update public.company_conversation_notes set body=p_body,revision=revision+1,updated_at=clock_timestamp() where id=n.id returning * into n;
 else
  if p_expected_revision<>0 or not private.enterprise_can(p_company_id,p_branch_id,uid,'conversation.internal_note.create') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  insert into public.company_conversation_notes(id,company_id,branch_id,conversation_id,author_id,body) values(p_note_id,p_company_id,p_branch_id,p_conversation_id,uid,p_body) returning * into n;
 end if;
 insert into public.company_branch_audit(company_id,branch_id,actor_id,action,detail) values(p_company_id,p_branch_id,uid,'note.saved',jsonb_build_object('id',n.id,'revision',n.revision));
 perform private.enterprise_commit(p_company_id,uid);
 return jsonb_build_object('ok',true,'noteId',n.id,'revision',n.revision);
end; $$;

-- Isolate the old single-note field: staff cannot silently overwrite a different
-- author's history. New notes live outside every provider/context message path.
create function private.enterprise_legacy_note_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.internal_note is distinct from old.internal_note and auth.uid() is not null
 and not private.enterprise_can(new.company_id,new.branch_id,auth.uid(),'conversation.internal_note.manage')
 and not private.can_admin_company(new.company_id,'wa.conversations.read') then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return new;
end; $$;
create trigger enterprise_legacy_note_guard before update on public.whatsapp_conversations for each row execute function private.enterprise_legacy_note_guard();

alter table public.company_branch_schedules enable row level security;
alter table public.company_conversation_notes enable row level security;
alter table private.enterprise_presence enable row level security;
alter table private.enterprise_note_history enable row level security;
revoke all on public.company_branch_schedules,public.company_conversation_notes,private.enterprise_presence,private.enterprise_note_history from public,anon,authenticated,service_role;
do $$ declare f regprocedure;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='private'::regnamespace and proname like 'enterprise_%' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f);end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'enterprise_%' and proname not like 'enterprise_legacy_%' loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f);execute format('grant execute on function %s to authenticated',f);end loop;
end; $$;
notify pgrst,'reload schema';
grant execute on function private.enterprise_table_access(uuid,text) to authenticated;
commit;
