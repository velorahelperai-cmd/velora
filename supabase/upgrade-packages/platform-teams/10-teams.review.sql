-- Forward migration, LOCAL REVIEW ONLY. No production installation is authorized.
begin;
set local search_path = '';
set local lock_timeout = '2s';
set local statement_timeout = '30s';
do $preflight$
begin
 if current_user <> 'postgres' then raise exception 'TEAM_INSTALLER_REQUIRED';end if;
 if to_regclass('public.platform_admins') is null or to_regclass('public.platform_admin_scopes') is null
  or to_regclass('public.profiles') is null or to_regclass('public.admin_audit_logs') is null
  or to_regclass('auth.users') is null or to_regclass('auth.sessions') is null
  or to_regclass('private.app_session_activity') is null
  or to_regprocedure('public.is_platform_owner()') is null
  or to_regprocedure('public.app_session_is_valid()') is null
  or to_regprocedure('private.write_admin_audit(uuid,uuid,text,jsonb,jsonb)') is null
 then raise exception 'TEAM_DEPENDENCY_MISSING';end if;
 if exists(select 1 from pg_namespace where nspname in ('public','private','auth') and pg_get_userbyid(nspowner) not in ('postgres','pg_database_owner','supabase_admin','supabase_auth_admin'))
 then raise exception 'TEAM_NAMESPACE_OWNER_MISMATCH';end if;
 if exists(select 1 from pg_proc where oid in (to_regprocedure('public.is_platform_owner()'),to_regprocedure('public.app_session_is_valid()'),to_regprocedure('private.write_admin_audit(uuid,uuid,text,jsonb,jsonb)'))
  and (not prosecdef or pg_get_userbyid(proowner)<>'postgres' or not ('search_path=""'=any(coalesce(proconfig,'{}')))))
 then raise exception 'TEAM_SECURITY_DEPENDENCY_MISMATCH';end if;
end;$preflight$;

create table public.platform_teams(
 id uuid primary key,
 name text not null check(length(btrim(name)) between 2 and 120 and name=btrim(name)),
 status text not null default 'active' check(status in ('active','disabled')),
 manager_user_id uuid references auth.users(id) on delete restrict,
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(status='disabled' or manager_user_id is not null)
);
create table public.platform_team_members(
 team_id uuid not null references public.platform_teams(id) on delete restrict,
 user_id uuid not null references auth.users(id) on delete restrict,
 status text not null default 'active' check(status in ('active','disabled')),
 revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(team_id,user_id)
);
create unique index platform_team_one_active_membership on public.platform_team_members(user_id) where status='active';
create index platform_team_members_user_history on public.platform_team_members(user_id,team_id);
alter table public.platform_teams add constraint platform_team_manager_member
 foreign key(id,manager_user_id) references public.platform_team_members(team_id,user_id) deferrable initially deferred;
create table private.platform_team_operations(
 actor_user_id uuid not null references auth.users(id) on delete restrict,
 operation_id uuid not null,
 request jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(actor_user_id,operation_id)
);
alter table public.platform_teams enable row level security;
alter table public.platform_team_members enable row level security;
alter table private.platform_team_operations enable row level security;
revoke all on public.platform_teams,public.platform_team_members,private.platform_team_operations from public,anon,authenticated,service_role;
grant select on public.platform_teams,public.platform_team_members to authenticated;

-- Always validate the stored Auth user/session; user-editable JWT metadata is never authority.
create function private.platform_team_actor() returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();sid uuid;u auth.users%rowtype;deadline timestamptz;now_at timestamptz;token_exp numeric;
begin
 if actor is null then raise exception 'UNAUTHENTICATED' using errcode='42501';end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;token_exp:=(auth.jwt()->>'exp')::numeric;
 exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'UNAUTHENTICATED' using errcode='42501';end;
 select * into u from auth.users where id=actor;
 if not found then raise exception 'UNAUTHENTICATED' using errcode='42501';end if;
 select not_after into deadline from auth.sessions where id=sid and user_id=actor;
 if not found then raise exception 'UNAUTHENTICATED' using errcode='42501';end if;
 now_at:=clock_timestamp();
 if u.deleted_at is not null or u.banned_until>now_at or sid is null or token_exp is null
  or token_exp<=extract(epoch from now_at) or token_exp::text in ('NaN','Infinity','-Infinity')
  or deadline<=now_at or not coalesce(public.app_session_is_valid(),false)
  or not exists(select 1 from private.app_session_activity where session_id=sid and user_id=actor
    and expired_at is null and last_activity_at<=now_at and last_activity_at>now_at-interval '2 hours')
 then raise exception 'UNAUTHENTICATED' using errcode='42501';end if;
 if u.email_confirmed_at is null and u.phone_confirmed_at is null then raise exception 'UNVERIFIED' using errcode='42501';end if;
 return actor;
end;$$;
revoke all on function private.platform_team_actor() from public,anon,authenticated,service_role;

-- Business locks precede authority locks. NOWAIT prevents a cycle with session pre-request work.
create function private.platform_team_lock_owner() returns uuid
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=private.platform_team_actor();sid uuid:=(auth.jwt()->>'session_id')::uuid;
begin
 perform 1 from auth.users where id=actor for share nowait;
 perform 1 from auth.sessions where id=sid and user_id=actor for share nowait;
 perform 1 from private.app_session_activity where session_id=sid and user_id=actor for share nowait;
 perform 1 from public.platform_admins where user_id=actor for share nowait;
 actor:=private.platform_team_actor();
 if not public.is_platform_owner() then raise exception 'FORBIDDEN' using errcode='42501';end if;
 return actor;
end;$$;
revoke all on function private.platform_team_lock_owner() from public,anon,authenticated,service_role;

create function private.platform_team_visible(p_team uuid,p_user uuid default null) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare actor uuid;
begin
 actor:=private.platform_team_actor();
 if public.is_platform_owner() then return true;end if;
 return exists(select 1 from public.platform_teams t join public.platform_team_members own on own.team_id=t.id
  where t.id=p_team and t.status='active' and own.user_id=actor and own.status='active'
  and (p_user is null or p_user=actor or t.manager_user_id=actor));
exception when insufficient_privilege then return false;
end;$$;
revoke all on function private.platform_team_visible(uuid,uuid) from public,anon,authenticated,service_role;
-- Policy execution uses the stored function OID; no schema USAGE or other private access is granted.
grant execute on function private.platform_team_visible(uuid,uuid) to authenticated;
create policy platform_team_select on public.platform_teams for select to authenticated using(private.platform_team_visible(id));
create policy platform_team_member_select on public.platform_team_members for select to authenticated using(private.platform_team_visible(team_id,user_id) and (status='active' or (select public.is_platform_owner())));

create function private.platform_team_manager_consistency() returns trigger
language plpgsql security definer set search_path='' as $$
declare team uuid;
begin
 if tg_table_name='platform_teams' then team:=new.id;else team:=coalesce(new.team_id,old.team_id);end if;
 if exists(select 1 from public.platform_teams t where t.id=team and t.status='active'
  and not exists(select 1 from public.platform_team_members m where m.team_id=t.id and m.user_id=t.manager_user_id and m.status='active'))
 then raise exception 'TEAM_MANAGER_MUST_BE_ACTIVE';end if;
 return null;
end;$$;
revoke all on function private.platform_team_manager_consistency() from public,anon,authenticated,service_role;
create constraint trigger platform_team_consistency after insert or update on public.platform_teams deferrable initially deferred for each row execute function private.platform_team_manager_consistency();
create constraint trigger platform_team_member_consistency after insert or update or delete on public.platform_team_members deferrable initially deferred for each row execute function private.platform_team_manager_consistency();

create function private.platform_team_read_self() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid;member jsonb;team jsonb;manager jsonb;
begin
 actor:=private.platform_team_actor();
 select jsonb_build_object('team_id',m.team_id,'user_id',m.user_id,'status',m.status,'revision',m.revision,'role',case when t.manager_user_id=actor then 'manager' else 'employee' end),
  jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'revision',t.revision,'manager_user_id',t.manager_user_id),
  case when t.manager_user_id=actor then null else jsonb_build_object('user_id',t.manager_user_id,'full_name',coalesce(p.full_name,'')) end
 into member,team,manager from public.platform_team_members m join public.platform_teams t on t.id=m.team_id
 left join public.profiles p on p.user_id=t.manager_user_id
 where m.user_id=actor and m.status='active' and t.status='active';
 return jsonb_build_object('ok',true,'membership',member,'team',team,'manager',manager);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',sqlerrm);
end;$$;
revoke all on function private.platform_team_read_self() from public,anon,authenticated,service_role;
create function public.platform_team_read_self() returns jsonb
language sql stable security definer set search_path='' as $$select private.platform_team_read_self()$$;
revoke all on function public.platform_team_read_self() from public,anon,authenticated,service_role;
grant execute on function public.platform_team_read_self() to authenticated;

create function private.platform_team_read_directory(p_team uuid,p_after uuid,p_revision integer,p_size integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid;owner boolean;managed uuid;rows jsonb;total integer;next_cursor jsonb;team jsonb;
begin
 actor:=private.platform_team_actor();owner:=public.is_platform_owner();
 select t.id into managed from public.platform_teams t join public.platform_team_members m on m.team_id=t.id and m.user_id=actor and m.status='active'
 where t.manager_user_id=actor and t.status='active';
 if not owner and (managed is null or p_team is not null and p_team<>managed) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_size is null or p_size<1 or p_size>100 or (p_after is null)<>(p_revision is null) or p_revision<1 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if p_team is null then
  if p_after is not null and not exists(select 1 from public.platform_teams where id=p_after and revision=p_revision and (owner or id=managed)) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  select count(*) into total from public.platform_teams where owner or id=managed;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into rows from (
   select t.id,t.name,t.status,t.manager_user_id,t.revision,(select count(*) from public.platform_team_members m where m.team_id=t.id and m.status='active')::integer member_count
   from public.platform_teams t where (owner or t.id=managed) and (p_after is null or t.id>p_after) order by t.id limit p_size+1
  )x;
 else
  select jsonb_build_object('id',id,'name',name,'status',status,'revision',revision,'manager_user_id',manager_user_id) into team from public.platform_teams where id=p_team;
  if team is null then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
  if p_after is not null and not exists(select 1 from public.platform_team_members where team_id=p_team and user_id=p_after and revision=p_revision and (owner or status='active')) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  select count(*) into total from public.platform_team_members where team_id=p_team and (owner or status='active');
  select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id),'[]') into rows from (
   select m.team_id,m.user_id,m.status,m.revision,coalesce(p.full_name,'')full_name,case when t.manager_user_id=m.user_id then 'manager' else 'employee' end role
   from public.platform_team_members m join public.platform_teams t on t.id=m.team_id left join public.profiles p on p.user_id=m.user_id
   where m.team_id=p_team and (owner or m.status='active') and (p_after is null or m.user_id>p_after) order by m.user_id limit p_size+1
  )x;
 end if;
 if jsonb_array_length(rows)>p_size then
  rows:=rows-(jsonb_array_length(rows)-1);next_cursor:=jsonb_build_object('id',case when p_team is null then rows->(p_size-1)->'id' else rows->(p_size-1)->'user_id' end,'revision',rows->(p_size-1)->'revision');
 end if;
 return jsonb_build_object('ok',true,'kind',case when p_team is null then 'teams' else 'members' end,'rows',rows,'total',total,'next_cursor',next_cursor,'team',team);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',sqlerrm);
end;$$;
revoke all on function private.platform_team_read_directory(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
create function public.platform_team_read_directory(p_team_id uuid default null,p_after_id uuid default null,p_after_revision integer default null,p_page_size integer default 25) returns jsonb
language sql stable security definer set search_path='' as $$select private.platform_team_read_directory(p_team_id,p_after_id,p_after_revision,p_page_size)$$;
revoke all on function public.platform_team_read_directory(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.platform_team_read_directory(uuid,uuid,integer,integer) to authenticated;

-- Shared transfer preview validates every expected revision, including an inactive destination row.
create function private.platform_team_transfer_preview(p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare source uuid:=(p_input->>'source_team_id')::uuid;destination uuid:=(p_input->>'destination_team_id')::uuid;person uuid:=(p_input->>'user_id')::uuid;
 src public.platform_teams%rowtype;dst public.platform_teams%rowtype;m public.platform_team_members%rowtype;dm public.platform_team_members%rowtype;
begin
 if source is null or destination is null or person is null or source=destination then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into src from public.platform_teams where id=source;select * into dst from public.platform_teams where id=destination;
 if src.id is null or dst.id is null then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
 select * into m from public.platform_team_members where team_id=source and user_id=person;
 select * into dm from public.platform_team_members where team_id=destination and user_id=person;
 if (p_input->>'expected_source_revision')::integer is distinct from src.revision or (p_input->>'expected_destination_revision')::integer is distinct from dst.revision
  or (p_input->>'expected_member_revision')::integer is distinct from coalesce(m.revision,0) or (p_input->>'expected_destination_member_revision')::integer is distinct from coalesce(dm.revision,0)
 then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
 if m.user_id is null or m.status<>'active' or dst.status<>'active' then return jsonb_build_object('ok',false,'code','INVALID_MEMBER');end if;
 if src.status='active' and src.manager_user_id=person then return jsonb_build_object('ok',false,'code','MANAGER_REQUIRED');end if;
 if not exists(select 1 from auth.users where id=person and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) and (email_confirmed_at is not null or phone_confirmed_at is not null)) then return jsonb_build_object('ok',false,'code','INVALID_MEMBER');end if;
 return jsonb_build_object('ok',true,'source_team',to_jsonb(src),'destination_team',to_jsonb(dst),'source_member',to_jsonb(m),'destination_member',case when dm.user_id is null then null else to_jsonb(dm) end,
  'manager_before',jsonb_build_object('user_id',src.manager_user_id),'manager_after',jsonb_build_object('user_id',dst.manager_user_id));
end;$$;
revoke all on function private.platform_team_transfer_preview(jsonb) from public,anon,authenticated,service_role;
create function public.platform_team_preview_transfer(p_input jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.platform_team_actor();if not public.is_platform_owner() then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if jsonb_typeof(p_input)<>'object' or p_input->>'op' is distinct from 'transfer' or (p_input->>'operation_id')::uuid is null or length(btrim(coalesce(p_input->>'reason',''))) not between 2 and 240 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 return private.platform_team_transfer_preview(p_input);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',sqlerrm);
 when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('ok',false,'code','INVALID_INPUT');
end;$$;
revoke all on function public.platform_team_preview_transfer(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.platform_team_preview_transfer(jsonb) to authenticated;

create function private.platform_team_mutate(p_input jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid;operation uuid;op text;reason text;team uuid;person uuid;manager uuid;source uuid;destination uuid;
 name_v text;status_v text;expected integer;member_expected integer;t public.platform_teams%rowtype;m public.platform_team_members%rowtype;
 old_manager uuid;existing private.platform_team_operations%rowtype;before_state jsonb;result jsonb;preview jsonb;allowed text[];
begin
 -- Order: hierarchy lock, ordered teams/members, ordered Auth rows NOWAIT, terminal authority locks NOWAIT.
 -- All writes are small and owner-only; serialization avoids graph/transfer write skew.
 perform pg_advisory_xact_lock(864210111);
 actor:=private.platform_team_actor();
 if not public.is_platform_owner() then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 operation:=(p_input->>'operation_id')::uuid;op:=p_input->>'op';reason:=btrim(coalesce(p_input->>'reason',''));
 if operation is null or op is null or length(reason) not between 2 and 240 or op not in ('create','update','set_member','transfer') then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 allowed:=case op when 'create' then array['op','operation_id','reason','team_id','name','manager_user_id','expected_team_revision']
  when 'update' then array['op','operation_id','reason','team_id','name','status','manager_user_id','expected_team_revision']
  when 'set_member' then array['op','operation_id','reason','team_id','user_id','status','expected_team_revision','expected_member_revision']
  else array['op','operation_id','reason','source_team_id','destination_team_id','user_id','expected_source_revision','expected_destination_revision','expected_member_revision','expected_destination_member_revision'] end;
 if exists(select 1 from jsonb_object_keys(p_input) k where not k=any(allowed)) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into existing from private.platform_team_operations where actor_user_id=actor and operation_id=operation;
 if found then
  if existing.request is distinct from p_input then return jsonb_build_object('ok',false,'code','OPERATION_CONFLICT');end if;
  perform private.platform_team_lock_owner();
  return existing.result;
 end if;
 if op='transfer' then
  source:=(p_input->>'source_team_id')::uuid;destination:=(p_input->>'destination_team_id')::uuid;person:=(p_input->>'user_id')::uuid;
  perform 1 from public.platform_teams where id in (source,destination) order by id for update;
  perform 1 from public.platform_team_members where team_id in (source,destination) and user_id=person order by team_id,user_id for update;
  perform 1 from auth.users where id in (actor,person) order by id for share nowait;
  perform private.platform_team_lock_owner();
  preview:=private.platform_team_transfer_preview(p_input);if not coalesce((preview->>'ok')::boolean,false) then return preview;end if;
  before_state:=preview-'ok';
  update public.platform_team_members set status='disabled',revision=revision+1,updated_at=now() where team_id=source and user_id=person;
  insert into public.platform_team_members(team_id,user_id,status)values(destination,person,'active') on conflict(team_id,user_id) do update set status='active',revision=public.platform_team_members.revision+1,updated_at=now();
  update public.platform_teams set revision=revision+1,updated_at=now() where id in (source,destination);
  result:=jsonb_build_object('ok',true,'operation_id',operation,'op',op,'source_team_id',source,'destination_team_id',destination,'user_id',person,
   'source_revision',(select revision from public.platform_teams where id=source),'destination_revision',(select revision from public.platform_teams where id=destination),
   'source_member_revision',(select revision from public.platform_team_members where team_id=source and user_id=person),'destination_member_revision',(select revision from public.platform_team_members where team_id=destination and user_id=person));
  result:=result||jsonb_build_object('source_team',(select to_jsonb(st) from public.platform_teams st where id=source),'destination_team',(select to_jsonb(dt) from public.platform_teams dt where id=destination),
   'source_member',(select to_jsonb(sm) from public.platform_team_members sm where team_id=source and user_id=person),'destination_member',(select to_jsonb(dm) from public.platform_team_members dm where team_id=destination and user_id=person));
 else
  team:=(p_input->>'team_id')::uuid;person:=(p_input->>'user_id')::uuid;manager:=(p_input->>'manager_user_id')::uuid;
  expected:=(p_input->>'expected_team_revision')::integer;member_expected:=(p_input->>'expected_member_revision')::integer;
  name_v:=btrim(p_input->>'name');status_v:=p_input->>'status';
  if team is null or expected is null or expected<0 or op in ('create','update') and (name_v is null or length(name_v) not between 2 and 120)
   or op in ('update','set_member') and (status_v is null or status_v not in ('active','disabled'))
   or op='create' and manager is null or op='update' and status_v='active' and manager is null
   or op='set_member' and (person is null or member_expected is null or member_expected<0)
  then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
  select * into t from public.platform_teams where id=team for update;
  perform 1 from public.platform_team_members where team_id=team order by team_id,user_id for update;
  perform 1 from auth.users where id in (actor,manager,person) order by id for share nowait;
  perform private.platform_team_lock_owner();
  if expected is distinct from coalesce(t.revision,0) then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
  before_state:=case when t.id is null then null else to_jsonb(t) end;
  if op='create' then
   if t.id is not null then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
   if not exists(select 1 from auth.users where id=manager and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) and (email_confirmed_at is not null or phone_confirmed_at is not null)) then return jsonb_build_object('ok',false,'code','INVALID_MEMBER');end if;
   if exists(select 1 from public.platform_team_members where user_id=manager and status='active') then return jsonb_build_object('ok',false,'code','TRANSFER_REQUIRED');end if;
   insert into public.platform_teams(id,name,manager_user_id)values(team,name_v,manager);
   insert into public.platform_team_members(team_id,user_id)values(team,manager);
  elsif op='update' then
   if t.id is null then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
   if status_v='active' and not exists(select 1 from public.platform_team_members cm join auth.users u on u.id=cm.user_id where cm.team_id=team and cm.user_id=manager and cm.status='active' and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp()) and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)) then return jsonb_build_object('ok',false,'code','INVALID_MEMBER');end if;
   if status_v='disabled' and manager is not null then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
   old_manager:=t.manager_user_id;
   update public.platform_teams set name=name_v,status=status_v,manager_user_id=manager,revision=revision+1,updated_at=now() where id=team;
   if old_manager is distinct from manager then update public.platform_team_members set revision=revision+1,updated_at=now() where team_id=team and user_id in (old_manager,manager);end if;
  else
   if t.id is null then return jsonb_build_object('ok',false,'code','NOT_FOUND');end if;
   select * into m from public.platform_team_members where team_id=team and user_id=person;
   if member_expected is distinct from coalesce(m.revision,0) then return jsonb_build_object('ok',false,'code','CONFLICT');end if;
   if person=t.manager_user_id and status_v='disabled' and t.status='active' then return jsonb_build_object('ok',false,'code','MANAGER_REQUIRED');end if;
   if status_v='active' then
    if t.status<>'active' or not exists(select 1 from auth.users where id=person and deleted_at is null and (banned_until is null or banned_until<=clock_timestamp()) and (email_confirmed_at is not null or phone_confirmed_at is not null)) then return jsonb_build_object('ok',false,'code','INVALID_MEMBER');end if;
    if exists(select 1 from public.platform_team_members where user_id=person and team_id<>team and public.platform_team_members.status='active') then return jsonb_build_object('ok',false,'code','TRANSFER_REQUIRED');end if;
   elsif not exists(select 1 from auth.users where id=person) then return jsonb_build_object('ok',false,'code','INVALID_MEMBER');end if;
   before_state:=jsonb_build_object('team',to_jsonb(t),'member',case when m.user_id is null then null else to_jsonb(m) end);
   insert into public.platform_team_members(team_id,user_id,status)values(team,person,status_v)
    on conflict(team_id,user_id)do update set status=excluded.status,revision=public.platform_team_members.revision+1,updated_at=now();
   update public.platform_teams set revision=revision+1,updated_at=now()where id=team;
  end if;
  result:=jsonb_build_object('ok',true,'operation_id',operation,'op',op,'team_id',team,'revision',(select revision from public.platform_teams where id=team),'team',(select to_jsonb(ct) from public.platform_teams ct where id=team));
  if op='set_member' then result:=result||jsonb_build_object('user_id',person,'member_revision',(select revision from public.platform_team_members where team_id=team and user_id=person),'member',(select to_jsonb(cm) from public.platform_team_members cm where team_id=team and user_id=person));end if;
 end if;
 perform private.write_admin_audit(actor,null,'platform.team.'||op,before_state,result||jsonb_build_object('reason',reason));
 insert into private.platform_team_operations(actor_user_id,operation_id,request,result)values(actor,operation,p_input,result);
 return result;
exception when lock_not_available then return jsonb_build_object('ok',false,'code','UNAVAILABLE');
 when insufficient_privilege then return jsonb_build_object('ok',false,'code',sqlerrm);
 when invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('ok',false,'code','INVALID_INPUT');
end;$$;
revoke all on function private.platform_team_mutate(jsonb) from public,anon,authenticated,service_role;
create function public.platform_team_mutate(p_input jsonb) returns jsonb
language sql volatile security definer set search_path='' as $$select private.platform_team_mutate(p_input)$$;
revoke all on function public.platform_team_mutate(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.platform_team_mutate(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
