-- Customer organizations only. No billing/channel/platform mutation.
-- Local review package; NOT authorized for production application.
begin;
set local lock_timeout='3s';

create table public.company_branches (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 name text not null check(char_length(btrim(name)) between 1 and 120),
 timezone text not null default 'UTC',
 status text not null default 'setup' check(status in ('setup','active','suspended')),
 is_primary boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 unique(company_id,id)
);
create unique index company_branches_primary on public.company_branches(company_id) where is_primary;
insert into public.company_branches(company_id,name,is_primary,status)
 select id,display_name,true,'active' from public.companies;

-- A permanent account/branch binding survives termination and a new invitation.
create table private.enterprise_employee_identities (
 user_id uuid primary key references auth.users(id),
 company_id uuid not null,branch_id uuid not null,
 foreign key(company_id,branch_id) references public.company_branches(company_id,id)
);
create table public.company_branch_accounts (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,
 user_id uuid not null references auth.users(id),
 customer_role text not null check(customer_role in ('employee','manager')),
 branch_id uuid,
 status text not null default 'active' check(status in ('active','suspended','terminated')),
 session_epoch timestamptz not null default '-infinity',
 reactivation_requested_at timestamptz,
 last_work_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 terminated_at timestamptz,
 foreign key(company_id,user_id) references public.company_members(company_id,user_id),
 foreign key(company_id,branch_id) references public.company_branches(company_id,id),
 unique(company_id,id),
 check((customer_role='employee' and branch_id is not null) or (customer_role='manager' and branch_id is null)),
 check((status='terminated')=(terminated_at is not null))
);
create unique index company_branch_accounts_current on public.company_branch_accounts(company_id,user_id) where status<>'terminated';
create index company_branch_accounts_user on public.company_branch_accounts(user_id,company_id,status);
create table public.company_branch_grants (
 company_id uuid not null,branch_id uuid not null,account_id uuid not null,
 capabilities text[] not null default '{}',delegable_capabilities text[] not null default '{}',
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default clock_timestamp(),updated_by uuid references auth.users(id),
 primary key(account_id,branch_id),
 foreign key(company_id,branch_id) references public.company_branches(company_id,id),
 foreign key(company_id,account_id) references public.company_branch_accounts(company_id,id),
 check(delegable_capabilities <@ capabilities)
);
create table public.company_branch_audit (
 id bigint generated always as identity primary key,
 company_id uuid not null references public.companies(id),branch_id uuid,
 actor_id uuid references auth.users(id),account_id uuid,
 action text not null,detail jsonb not null default '{}',created_at timestamptz not null default clock_timestamp(),
 foreign key(company_id,branch_id) references public.company_branches(company_id,id)
);
create index company_branch_audit_scope on public.company_branch_audit(company_id,branch_id,id desc);
create table private.enterprise_session_revocations (
 company_id uuid not null references public.companies(id),session_id uuid not null,user_id uuid not null references auth.users(id),
 revoked_at timestamptz not null default clock_timestamp(),primary key(company_id,session_id)
);
create table private.enterprise_branch_operations (
 operation_id uuid primary key,actor_id uuid not null references auth.users(id),company_id uuid not null references public.companies(id),
 payload jsonb not null,branch_id uuid not null references public.company_branches(id),created_at timestamptz not null default clock_timestamp()
);

-- Reuse the reviewed identity-bound invitation/token store and its history.
alter table private.staff_invitations add column enterprise_role text check(enterprise_role in ('employee','manager')),
 add column enterprise_branches uuid[],add column enterprise_capabilities text[];

create function private.enterprise_catalog() returns text[] language sql immutable set search_path='' as $$
 select private.access_company_capabilities() || array['ig.conversations.read','ig.conversations.assign','ig.conversations.reply',
 'conversation.internal_note.create','conversation.internal_note.edit_own','conversation.internal_note.manage',
 'conversation.tags.apply','conversation.tags.manage','customer.read','customer.contact_full.read','customer.update',
 'customer.export','customer.delete','reports.read','reports.export','reports.financial.read',
 'staff.schedule.read','staff.schedule.update','staff.permissions.update','staff.permissions.sensitive_update',
 'staff.sessions.revoke','staff.read']::text[]
$$;
create function private.enterprise_identity_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.company_id is distinct from old.company_id or new.user_id is distinct from old.user_id
  or new.branch_id is distinct from old.branch_id or new.customer_role is distinct from old.customer_role) then
  raise exception 'IMMUTABLE_BRANCH_ACCOUNT' using errcode='23514';
 end if;
 if tg_op='INSERT' and new.customer_role='employee' then
  insert into private.enterprise_employee_identities(user_id,company_id,branch_id) values(new.user_id,new.company_id,new.branch_id) on conflict do nothing;
  if not exists(select 1 from private.enterprise_employee_identities where user_id=new.user_id and company_id=new.company_id and branch_id=new.branch_id) then
   raise exception 'SEPARATE_BRANCH_ACCOUNT_REQUIRED' using errcode='23514';
  end if;
 end if;
 return new;
end; $$;
create trigger enterprise_account_identity before insert or update on public.company_branch_accounts for each row execute function private.enterprise_identity_guard();
-- A conflicting legacy multi-company account aborts the migration for review.
insert into public.company_branch_accounts(company_id,user_id,customer_role,branch_id,status)
 select m.company_id,m.user_id,'employee',b.id,case when m.status='active' then 'active' else 'suspended' end
 from public.company_members m join public.company_branches b on b.company_id=m.company_id and b.is_primary where m.role='staff';

create function private.enterprise_new_company() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.company_branches(company_id,name,is_primary,status) values(new.id,new.display_name,true,'active');return new;end; $$;
create trigger enterprise_primary_branch after insert on public.companies for each row execute function private.enterprise_new_company();

create function private.enterprise_legacy_member_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare bid uuid;
begin
 if new.role<>'staff' or exists(select 1 from public.company_branch_accounts where company_id=new.company_id and user_id=new.user_id and status<>'terminated') then return new;end if;
 -- The enterprise acceptance RPC creates the explicitly scoped identity itself.
 if exists(select 1 from private.staff_invitations i join auth.users u on lower(u.email)=i.email and u.id=new.user_id
  where i.company_id=new.company_id and i.enterprise_role is not null and i.accepted_at is null and i.cancelled_at is null and i.expires_at>clock_timestamp()) then return new;end if;
 select id into bid from public.company_branches where company_id=new.company_id and is_primary;
 insert into public.company_branch_accounts(company_id,user_id,customer_role,branch_id,status)
 values(new.company_id,new.user_id,'employee',bid,case when new.status='active' then 'active' else 'suspended' end);
 return new;
end; $$;
create trigger enterprise_legacy_member_insert after insert on public.company_members for each row execute function private.enterprise_legacy_member_insert();

create function private.enterprise_invitation_lifetime() returns trigger language plpgsql set search_path='' as $$
begin new.expires_at:=least(new.expires_at,new.created_at+interval '72 hours');return new;end; $$;
create trigger enterprise_invitation_lifetime before insert on private.staff_invitations for each row execute function private.enterprise_invitation_lifetime();
alter table private.staff_invitations alter column expires_at set default (clock_timestamp()+interval '72 hours');

create function private.enterprise_actor() returns uuid language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;s auth.sessions%rowtype;
begin
 if uid is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then return null;end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return null;end;
 select * into s from auth.sessions where id=sid and user_id=uid for share nowait;
 if not found or coalesce((to_jsonb(s)->>'not_after')::timestamptz,'infinity')<=clock_timestamp()
  or coalesce((auth.jwt()->>'exp')::numeric,0)<=extract(epoch from clock_timestamp()) then return null;end if;
 if (public.check_app_session(false)->>'ok') is distinct from 'true' then return null;end if;
 if not exists(select 1 from auth.users u where u.id=uid and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
   and coalesce((to_jsonb(u)->>'banned_until')::timestamptz,'-infinity')<=clock_timestamp()) then return null;end if;
 return uid;
exception when lock_not_available then return null;
end; $$;
create function private.enterprise_customer_session(cid uuid,uid uuid,sid uuid) returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if cid is null or uid is null or sid is null then return false;end if;
 -- Shared customer authority lock is held until commit, including legacy RLS
 -- reads and sends. Customer revocation/grant changes take the exclusive lock.
 perform pg_advisory_xact_lock_shared(hashtextextended('enterprise-authority:'||cid::text,0));
 return exists(select 1 from auth.sessions s where s.id=sid and s.user_id=uid
 and coalesce((to_jsonb(s)->>'not_after')::timestamptz,'infinity')>clock_timestamp()
 and not exists(select 1 from private.enterprise_session_revocations r where r.company_id=cid and r.session_id=s.id));
end; $$;
create or replace function private.staff_invitation_actor(p_touch boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_actor();checked jsonb;
begin
 if uid is null then raise exception 'UNAUTHENTICATED' using errcode='42501';end if;
 if p_touch then checked:=public.check_app_session(true);if checked->>'ok' is distinct from 'true' then raise exception 'UNAUTHENTICATED' using errcode='42501';end if;end if;
 -- Issuers can use a native verified phone or email. Acceptance still separately
 -- requires the invite's exact confirmed target email in both acceptance paths.
 return uid;
end; $$;
create function private.enterprise_authorize(cid uuid) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=private.enterprise_actor();sid uuid;
begin
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return null;end;
 if uid is null or not private.enterprise_customer_session(cid,uid,sid) then return null;end if;
 return uid;
end; $$;
create function private.enterprise_owner(cid uuid,uid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id
 where m.company_id=cid and m.user_id=uid and m.role='owner' and m.status='active' and c.status<>'suspended')
$$;
create function private.enterprise_commit(cid uuid,uid uuid) returns void language plpgsql volatile security definer set search_path='' as $$
begin
 if private.enterprise_authorize(cid) is distinct from uid then raise exception 'AUTHORITY_CHANGED' using errcode='42501';end if;
end; $$;
create function private.enterprise_table_access(cid uuid,cap text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;member_role text;
begin
 -- Preserve the original capability-scoped platform path separately.
 if private.can_admin_company(cid,cap) then return true;end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return false;end;
 select role into member_role from public.company_members where company_id=cid and user_id=uid and status='active';
 if not found or not private.enterprise_customer_session(cid,uid,sid) then return false;end if;
 return member_role='owner' or private.enterprise_account_current(cid,uid,sid);
end; $$;
create policy enterprise_customer_session on public.companies as restrictive for all to authenticated
 using(private.enterprise_table_access(id,'company.profile.read')) with check(private.enterprise_table_access(id,'company.profile.write'));
create policy enterprise_customer_session on public.company_members as restrictive for select to authenticated
 using(private.enterprise_table_access(company_id,'company.staff.manage'));
create policy enterprise_customer_session on public.company_member_grants as restrictive for select to authenticated
 using(private.enterprise_table_access(company_id,'company.staff.manage'));
create function private.enterprise_account_current(cid uuid,uid uuid,sid uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.company_branch_accounts a join public.company_members m on m.company_id=a.company_id and m.user_id=a.user_id
 join auth.sessions s on s.user_id=a.user_id and s.id=sid
 where a.company_id=cid and a.user_id=uid and a.status='active' and m.status='active'
 and s.created_at>a.session_epoch and s.created_at>clock_timestamp()-interval '30 days'
 and private.enterprise_customer_session(cid,uid,sid))
$$;
create function private.enterprise_can(cid uuid,bid uuid,uid uuid,cap text) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare a public.company_branch_accounts%rowtype;g public.company_branch_grants%rowtype;sid uuid;ceiling_account uuid;ceiling_allowed boolean;
begin
 if uid is null or cap is null or not cap=any(private.enterprise_catalog()) then return false;end if;
 perform 1 from public.companies where id=cid and status<>'suspended' for share nowait;if not found then return false;end if;
 perform 1 from public.company_branches where company_id=cid and id=bid and status='active' for share nowait;if not found then return false;end if;
 perform 1 from public.company_members where company_id=cid and user_id=uid and status='active' for share nowait;if not found then return false;end if;
 if private.enterprise_owner(cid,uid) then return true;end if;
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return false;end;
 if auth.uid() is distinct from uid or not private.enterprise_account_current(cid,uid,sid) then return false;end if;
 select * into a from public.company_branch_accounts where company_id=cid and user_id=uid and status='active' for share nowait;
 if not found or (a.customer_role='employee' and a.branch_id is distinct from bid) then return false;end if;
 if a.customer_role='employee' and cap=any(array['wa.conversations.assign','ig.conversations.assign','company.staff.manage',
 'conversation.internal_note.manage','conversation.tags.manage','staff.schedule.update','staff.permissions.update','staff.permissions.sensitive_update','staff.sessions.revoke']) then return false;end if;
 select * into g from public.company_branch_grants where account_id=a.id and branch_id=bid for share nowait;
 if found then
  if not cap=any(g.capabilities) then return false;end if;
  -- A manager-issued grant remains bounded by the manager's CURRENT ceiling,
  -- including after permission, membership or branch delegation revocation.
  if g.updated_by is not null and not private.enterprise_owner(cid,g.updated_by) then
   select manager.id into ceiling_account from public.company_branch_accounts manager
    join public.company_members m on m.company_id=manager.company_id and m.user_id=manager.user_id and m.status='active'
    where manager.company_id=cid and manager.user_id=g.updated_by and manager.customer_role='manager' and manager.status='active' for share of manager,m nowait;
   if not found then return false;end if;
   select cap=any(delegable_capabilities) into ceiling_allowed from public.company_branch_grants where account_id=ceiling_account and branch_id=bid for share nowait;
   return coalesce(ceiling_allowed,false);
  end if;
  return true;
 end if;
 -- Only legacy employees inherit existing grants, in the original branch.
 if a.customer_role='employee' and exists(select 1 from public.company_branches where id=bid and is_primary) then
  return private.enterprise_legacy_user_capability(uid,cid,cap);
 end if;
 return false;
exception when lock_not_available then return false;
end; $$;

-- Legacy company-wide operations have no branch parameter. Deny them for staff
-- once multiple branches exist; owners and platform administration keep their paths.
do $$ begin
 execute replace(pg_get_functiondef('private.user_has_company_capability(uuid,uuid,text)'::regprocedure),
 'private.user_has_company_capability(', 'private.enterprise_legacy_user_capability(');
end; $$;
create or replace function private.user_has_company_capability(p_user_id uuid,p_company_id uuid,p_capability text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock_shared(hashtextextended('enterprise-authority:'||p_company_id::text,0));
 if auth.uid()=p_user_id and not exists(select 1 from auth.sessions s
 where s.id::text=auth.jwt()->>'session_id' and s.user_id=p_user_id
 and coalesce((to_jsonb(s)->>'not_after')::timestamptz,'infinity')>statement_timestamp()
 and not exists(select 1 from private.enterprise_session_revocations r where r.company_id=p_company_id and r.session_id=s.id)
 and not exists(select 1 from private.app_session_activity activity where activity.session_id=s.id and activity.expired_at is not null)) then return false;end if;
 if not private.enterprise_legacy_user_capability(p_user_id,p_company_id,p_capability) then return false;end if;
 if private.enterprise_owner(p_company_id,p_user_id) then return true;end if;
 if p_capability=any(array['wa.conversations.assign','ig.conversations.assign','company.staff.manage']) then return false;end if;
 if p_capability=any(array['wa.conversations.reply','wa.conversations.take_over','ig.conversations.reply']) then
  if to_regprocedure('private.enterprise_employee_eligible(uuid,uuid)') is null then return false;end if;
  if not private.enterprise_employee_eligible(p_company_id,p_user_id) then return false;end if;
  if p_capability='wa.conversations.take_over' and not private.enterprise_legacy_user_capability(p_user_id,p_company_id,'wa.conversations.reply') then return false;end if;
 end if;
 if exists(select 1 from public.company_branch_accounts a join public.company_branch_grants g on g.account_id=a.id
 where a.company_id=p_company_id and a.user_id=p_user_id and a.status='active' and g.updated_by is not null and not private.enterprise_owner(p_company_id,g.updated_by)
 and not exists(select 1 from public.company_branch_accounts manager
 join public.company_members m on m.company_id=manager.company_id and m.user_id=manager.user_id and m.status='active'
 join public.company_branch_grants ceiling on ceiling.account_id=manager.id and ceiling.branch_id=g.branch_id
 where manager.company_id=p_company_id and manager.user_id=g.updated_by and manager.customer_role='manager' and manager.status='active'
 and p_capability=any(ceiling.delegable_capabilities))) then return false;end if;
 return (select count(*) from public.company_branches where company_id=p_company_id and status='active')=1
 and exists(select 1 from public.company_branch_accounts where company_id=p_company_id and user_id=p_user_id and status='active' and customer_role='employee')
 and (auth.uid() is distinct from p_user_id or exists(select 1 from auth.sessions s join public.company_branch_accounts a on a.company_id=p_company_id and a.user_id=p_user_id and a.status='active'
 where s.id::text=auth.jwt()->>'session_id' and s.user_id=p_user_id and s.created_at>a.session_epoch and s.created_at>statement_timestamp()-interval '30 days'
 and not exists(select 1 from private.enterprise_session_revocations r where r.company_id=p_company_id and r.session_id=s.id)));
end; $$;
do $$ begin
 execute replace(pg_get_functiondef('public.has_company_capability(uuid,text)'::regprocedure),
 'public.has_company_capability(', 'private.enterprise_legacy_company_capability(');
end; $$;
create or replace function public.has_company_capability(p_company_id uuid,p_capability text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 return private.enterprise_legacy_company_capability(p_company_id,p_capability)
 and private.user_has_company_capability(auth.uid(),p_company_id,p_capability);
end; $$;
revoke all on function private.enterprise_legacy_company_capability(uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.enterprise_legacy_user_capability(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.has_company_capability(uuid,text) from public,anon;
grant execute on function public.has_company_capability(uuid,text) to authenticated;

create function public.enterprise_workspace(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);owner boolean;a public.company_branch_accounts%rowtype;branches jsonb;accounts jsonb;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 owner:=private.enterprise_owner(p_company_id,uid);
 if not owner then
  if not private.enterprise_account_current(p_company_id,uid,(auth.jwt()->>'session_id')::uuid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  select * into a from public.company_branch_accounts where company_id=p_company_id and user_id=uid and status='active';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'timezone',b.timezone,'status',b.status,'primary',b.is_primary) order by b.created_at),'[]') into branches
 from public.company_branches b where b.company_id=p_company_id and (owner or (a.customer_role='employee' and b.id=a.branch_id)
 or exists(select 1 from public.company_branch_grants g where g.account_id=a.id and g.branch_id=b.id and cardinality(g.capabilities)>0));
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'userId',x.user_id,'name',m.member_name,'role',x.customer_role,'branchId',x.branch_id,'status',x.status,
 'reactivationRequested',x.reactivation_requested_at is not null) order by x.created_at),'[]') into accounts
 from public.company_branch_accounts x join public.company_members m on m.company_id=x.company_id and m.user_id=x.user_id
 where x.company_id=p_company_id and (owner or x.user_id=uid or (x.branch_id is not null and private.enterprise_can(p_company_id,x.branch_id,uid,'staff.read')));
 perform private.enterprise_commit(p_company_id,uid);
 return jsonb_build_object('ok',true,'companyId',p_company_id,'userId',uid,'role',case when owner then 'owner' else a.customer_role end,'branches',branches,'accounts',accounts);
end; $$;
create function public.enterprise_create_branch(p_company_id uuid,p_name text,p_timezone text,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);bid uuid;previous private.enterprise_branch_operations%rowtype;payload jsonb;
begin
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid for share;
 if uid is null or not private.enterprise_owner(p_company_id,uid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_operation_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 120 or not exists(select 1 from pg_timezone_names where name=p_timezone) then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 payload:=jsonb_build_object('name',btrim(p_name),'timezone',p_timezone);
 perform pg_advisory_xact_lock(hashtextextended('enterprise-branch:'||p_operation_id::text,0));
 select * into previous from private.enterprise_branch_operations where operation_id=p_operation_id;
 if found then
  if previous.actor_id<>uid or previous.company_id<>p_company_id or previous.payload<>payload then return jsonb_build_object('ok',false,'code','OPERATION_CONFLICT');end if;
  return jsonb_build_object('ok',true,'branchId',previous.branch_id);
 end if;
 insert into public.company_branches(company_id,name,timezone) values(p_company_id,btrim(p_name),p_timezone) returning id into bid;
 insert into private.enterprise_branch_operations(operation_id,actor_id,company_id,payload,branch_id) values(p_operation_id,uid,p_company_id,payload,bid);
 insert into public.company_branch_audit(company_id,branch_id,actor_id,action) values(p_company_id,bid,uid,'branch.created');
 perform private.enterprise_commit(p_company_id,uid);
 return jsonb_build_object('ok',true,'branchId',bid);
end; $$;
create function public.enterprise_invite(p_company_id uuid,p_branch_ids uuid[],p_role text,p_email text,p_name text,p_capabilities text[],p_token_hash text,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);iid uuid;issued timestamptz:=clock_timestamp();email_key text:=lower(btrim(p_email));payload jsonb;previous private.staff_invitation_operations%rowtype;i private.staff_invitations%rowtype;
begin
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid for share;
 if uid is null or not private.enterprise_owner(p_company_id,uid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_operation_id is null or p_role is null or p_role not in ('employee','manager') or p_branch_ids is null or cardinality(p_branch_ids)<1
 or array_position(p_branch_ids,null) is not null or (p_role='employee' and cardinality(p_branch_ids)<>1)
 or p_capabilities is null or array_position(p_capabilities,null) is not null or not p_capabilities <@ private.enterprise_catalog()
 or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or email_key is null or email_key !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or char_length(email_key)>254 or p_name is null or char_length(btrim(p_name)) not between 2 and 120
 or exists(select 1 from unnest(p_branch_ids) bid where not exists(select 1 from public.company_branches where id=bid and company_id=p_company_id and status='active'))
 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 payload:=jsonb_build_object('enterprise',true,'role',p_role,'branches',p_branch_ids,'email',email_key,'name',btrim(p_name),'capabilities',p_capabilities);
 perform pg_advisory_xact_lock(hashtextextended('staff-operation:'||p_operation_id::text,0));
 select * into previous from private.staff_invitation_operations where operation_id=p_operation_id;
 if found then
  if previous.actor_id<>uid or previous.company_id<>p_company_id or previous.payload<>payload then return jsonb_build_object('ok',false,'code','OPERATION_CONFLICT');end if;
  select * into i from private.staff_invitations where id=previous.invitation_id;
  return jsonb_build_object('ok',true,'id',i.id,'createdAt',i.created_at,'expiresAt',i.expires_at,'replayed',true,'tokenMatched',false);
 end if;
 -- Same lock as legacy invitation mutations, so replacement invalidates both paths.
 insert into private.staff_invitation_recipients(company_id,email) values(p_company_id,email_key) on conflict do nothing;
 perform 1 from private.staff_invitation_recipients where company_id=p_company_id and email=email_key for update;
 update private.staff_invitations set cancelled_at=issued,cancelled_by=uid where company_id=p_company_id and email=email_key and accepted_at is null and cancelled_at is null;
 insert into private.staff_invitations(company_id,email,member_name,token_hash,invited_by,created_at,expires_at,enterprise_role,enterprise_branches,enterprise_capabilities)
 values(p_company_id,email_key,btrim(p_name),p_token_hash,uid,issued,issued+interval '72 hours',p_role,p_branch_ids,p_capabilities) returning id into iid;
 update private.staff_invitation_recipients set revision=revision+1 where company_id=p_company_id and email=email_key;
 insert into public.company_branch_audit(company_id,actor_id,action,detail) values(p_company_id,uid,'invitation.created',jsonb_build_object('id',iid,'role',p_role,'branches',p_branch_ids));
 insert into private.staff_invitation_operations(operation_id,actor_id,company_id,payload,invitation_id,outcome) values(p_operation_id,uid,p_company_id,payload,iid,'created');
 perform private.enterprise_commit(p_company_id,uid);
 return jsonb_build_object('ok',true,'id',iid,'createdAt',issued,'expiresAt',issued+interval '72 hours','replayed',false,'tokenMatched',true);
end; $$;
create function public.enterprise_accept_invite(p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_actor();i private.staff_invitations%rowtype;a uuid;email text;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 select * into i from private.staff_invitations where token_hash=p_token_hash;
 if not found or i.enterprise_role is null then return jsonb_build_object('ok',false,'code','INVITE_INVALID');end if;
 if not private.enterprise_customer_session(i.company_id,uid,(auth.jwt()->>'session_id')::uuid) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 perform 1 from public.companies where id=i.company_id and status<>'suspended' for share;
 if not found then return jsonb_build_object('ok',false,'code','INVITE_INVALID');end if;
 perform 1 from public.company_members where company_id=i.company_id and user_id=i.invited_by and role='owner' and status='active' for share;
 if not found then return jsonb_build_object('ok',false,'code','INVITE_INVALID');end if;
 select lower(auth.users.email) into email from auth.users where id=uid and email_confirmed_at is not null for share;
 if email is distinct from i.email then return jsonb_build_object('ok',false,'code','EMAIL_MISMATCH');end if;
 perform 1 from private.staff_invitation_recipients where company_id=i.company_id and staff_invitation_recipients.email=i.email for update;
 select * into i from private.staff_invitations where id=i.id for update;
 if i.accepted_at is not null or i.cancelled_at is not null or i.expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','INVITE_INVALID');end if;
 if exists(select 1 from public.company_branch_accounts where company_id=i.company_id and user_id=uid and status<>'terminated')
 or exists(select 1 from public.company_members where company_id=i.company_id and user_id=uid and role='owner')
 or exists(select 1 from private.enterprise_employee_identities where user_id=uid and (i.enterprise_role<>'employee' or company_id<>i.company_id or branch_id<>i.enterprise_branches[1]))
 then return jsonb_build_object('ok',false,'code','SEPARATE_BRANCH_ACCOUNT_REQUIRED');end if;
 if exists(select 1 from unnest(i.enterprise_branches) bid where not exists(select 1 from public.company_branches where id=bid and company_id=i.company_id and status='active')) then return jsonb_build_object('ok',false,'code','INVITE_INVALID');end if;
 insert into public.company_members(company_id,user_id,role,status,member_name) values(i.company_id,uid,'staff','active',i.member_name)
 on conflict(company_id,user_id) do update set status='active',member_name=excluded.member_name;
 insert into public.company_branch_accounts(company_id,user_id,customer_role,branch_id)
 values(i.company_id,uid,i.enterprise_role,case when i.enterprise_role='employee' then i.enterprise_branches[1] end) returning id into a;
 insert into public.company_branch_grants(company_id,branch_id,account_id,capabilities,updated_by)
 select i.company_id,bid,a,i.enterprise_capabilities,i.invited_by from unnest(i.enterprise_branches) bid;
 update private.staff_invitations set accepted_at=clock_timestamp(),accepted_by=uid where id=i.id;
 insert into public.company_branch_audit(company_id,actor_id,account_id,action,detail) values(i.company_id,uid,a,'invitation.accepted',jsonb_build_object('invitationId',i.id));
 perform private.enterprise_commit(i.company_id,uid);
 return jsonb_build_object('ok',true,'companyId',i.company_id,'accountId',a);
exception when unique_violation then return jsonb_build_object('ok',false,'code','INVITE_INVALID');
end; $$;
do $$ begin
 execute replace(pg_get_functiondef('public.accept_staff_invitation(text)'::regprocedure),
 'public.accept_staff_invitation(', 'private.enterprise_legacy_accept_invitation(');
end; $$;
create or replace function public.accept_staff_invitation(p_token_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.staff_invitations where token_hash=p_token_hash and enterprise_role is not null) then return public.enterprise_accept_invite(p_token_hash);end if;
 return private.enterprise_legacy_accept_invitation(p_token_hash);
end; $$;
revoke all on function private.enterprise_legacy_accept_invitation(text) from public,anon,authenticated,service_role;
revoke all on function public.accept_staff_invitation(text) from public,anon;
grant execute on function public.accept_staff_invitation(text) to authenticated;

-- Existing owner invitation UI can replace enterprise links. Preserve their
-- role, branch scope and initial grants instead of silently creating a legacy
-- employee in the primary branch. Keep the existing operation/CAS contract.
do $$ begin
 execute replace(pg_get_functiondef('public.mutate_staff_invitation(uuid,uuid,text,text,text,uuid,integer,text)'::regprocedure),
 'public.mutate_staff_invitation(', 'private.enterprise_legacy_mutate_invitation(');
end; $$;
create or replace function public.mutate_staff_invitation(
 p_company_id uuid,p_operation_id uuid,p_action text,p_email text,p_name text,
 p_invitation_id uuid,p_expected_revision integer,p_token_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);source private.staff_invitations%rowtype;result jsonb;replacement uuid;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 -- Metadata is immutable after issuance. Do not lock the invitation before
 -- the legacy company/owner/recipient/invitation lock order or introduce cycles.
 if p_action='replace' then select * into source from private.staff_invitations where id=p_invitation_id and company_id=p_company_id;end if;
 result:=private.enterprise_legacy_mutate_invitation(p_company_id,p_operation_id,p_action,p_email,p_name,p_invitation_id,p_expected_revision,p_token_hash);
 if result->>'ok'='true' and p_action='replace' and source.enterprise_role is not null then
  replacement:=(result->'invitation'->>'id')::uuid;
  update private.staff_invitations set enterprise_role=source.enterprise_role,enterprise_branches=source.enterprise_branches,
  enterprise_capabilities=source.enterprise_capabilities where id=replacement and company_id=p_company_id;
  if not coalesce((result->>'replayed')::boolean,false) then
   insert into public.company_branch_audit(company_id,actor_id,action,detail) values(p_company_id,uid,'invitation.replaced',jsonb_build_object('source',source.id,'replacement',replacement,'role',source.enterprise_role));
  end if;
 end if;
 perform private.enterprise_commit(p_company_id,uid);
 return result;
end; $$;
revoke all on function private.enterprise_legacy_mutate_invitation(uuid,uuid,text,text,text,uuid,integer,text) from public,anon,authenticated,service_role;

create function public.enterprise_set_grants(p_company_id uuid,p_branch_id uuid,p_user_id uuid,p_capabilities text[],p_delegable text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);a public.company_branch_accounts%rowtype;actor public.company_branch_accounts%rowtype;g public.company_branch_grants%rowtype;owner boolean;prior_caps text[];
begin
 if not pg_try_advisory_xact_lock(hashtextextended('enterprise-authority:'||p_company_id::text,0)) then return jsonb_build_object('ok',false,'code','AUTHORITY_BUSY');end if;
 if uid is null then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.companies where id=p_company_id and status<>'suspended' for share;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid and status='active' for share;
 owner:=private.enterprise_owner(p_company_id,uid);
 if p_capabilities is null or p_delegable is null or array_position(p_capabilities,null) is not null or array_position(p_delegable,null) is not null
 or not p_capabilities <@ private.enterprise_catalog() or not p_delegable <@ p_capabilities then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 if not owner then
  if p_user_id=uid or cardinality(p_delegable)>0 or not private.enterprise_can(p_company_id,p_branch_id,uid,'staff.permissions.update') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  select * into actor from public.company_branch_accounts where company_id=p_company_id and user_id=uid and status='active' and customer_role='manager' for share;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  select * into g from public.company_branch_grants where account_id=actor.id and branch_id=p_branch_id for share;
  if not found or not p_capabilities <@ g.delegable_capabilities then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 end if;
 select * into a from public.company_branch_accounts where company_id=p_company_id and user_id=p_user_id and status='active' for update;
 if not found or (a.customer_role='employee' and a.branch_id<>p_branch_id) or (not owner and a.customer_role<>'employee')
 or not exists(select 1 from public.company_branches where company_id=p_company_id and id=p_branch_id and status='active') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if a.customer_role='employee' and cardinality(p_delegable)>0 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select capabilities into prior_caps from public.company_branch_grants where account_id=a.id and branch_id=p_branch_id for update;
 if not owner and ((p_capabilities||coalesce(prior_caps,'{}'::text[])) && array['customer.delete','customer.export','customer.contact_full.read','reports.export','reports.financial.read','staff.sessions.revoke','staff.permissions.update','staff.permissions.sensitive_update'])
 and not private.enterprise_can(p_company_id,p_branch_id,uid,'staff.permissions.sensitive_update') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 -- Manager edits may not remove permissions outside the owner-given ceiling.
 if not owner and exists(select 1 from public.company_branch_grants where account_id=a.id and branch_id=p_branch_id
 and not capabilities <@ g.delegable_capabilities) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 insert into public.company_branch_grants(company_id,branch_id,account_id,capabilities,delegable_capabilities,updated_by)
 values(p_company_id,p_branch_id,a.id,p_capabilities,p_delegable,uid)
 on conflict(account_id,branch_id) do update set capabilities=excluded.capabilities,delegable_capabilities=excluded.delegable_capabilities,
 revision=company_branch_grants.revision+1,updated_at=clock_timestamp(),updated_by=uid;
 insert into public.company_branch_audit(company_id,branch_id,actor_id,account_id,action,detail) values(p_company_id,p_branch_id,uid,a.id,'permissions.updated',jsonb_build_object('capabilities',p_capabilities,'delegable',p_delegable));
 perform private.enterprise_commit(p_company_id,uid);
 return jsonb_build_object('ok',true);
end; $$;

create function public.enterprise_set_member_status(p_company_id uuid,p_user_id uuid,p_status text) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);a public.company_branch_accounts%rowtype;t timestamptz:=clock_timestamp();
begin
 if not pg_try_advisory_xact_lock(hashtextextended('enterprise-authority:'||p_company_id::text,0)) then return jsonb_build_object('ok',false,'code','AUTHORITY_BUSY');end if;
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid for share;
 if uid is null or not private.enterprise_owner(p_company_id,uid) or p_user_id=uid then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select * into a from public.company_branch_accounts where company_id=p_company_id and user_id=p_user_id order by created_at desc limit 1 for update;
 if not found or a.status='terminated' or p_status is null or p_status not in ('active','suspended','terminated') then return jsonb_build_object('ok',false,'code','INVALID_TRANSITION');end if;
 if p_status='active' and (a.status<>'suspended' or a.reactivation_requested_at is null) then return jsonb_build_object('ok',false,'code','REACTIVATION_REQUIRED');end if;
 if p_status='active' and exists(select 1 from public.company_branch_grants where account_id=a.id and not capabilities <@ private.enterprise_catalog()) then return jsonb_build_object('ok',false,'code','POLICY_CHANGED');end if;
 update public.company_branch_accounts set status=p_status,session_epoch=t,reactivation_requested_at=null,terminated_at=case when p_status='terminated' then t end where id=a.id;
 update public.company_members set status=case when p_status='active' then 'active' else 'disabled' end where company_id=p_company_id and user_id=p_user_id;
 insert into private.enterprise_session_revocations(company_id,session_id,user_id) select p_company_id,id,user_id from auth.sessions where user_id=p_user_id on conflict do nothing;
 -- Record denial independently of JWT expiry. Preserve native sessions to avoid
 -- altering platform sessions for dual-role users; customer guards check revocations.
 insert into public.company_branch_audit(company_id,branch_id,actor_id,account_id,action) values(p_company_id,a.branch_id,uid,a.id,'membership.'||p_status);
 perform private.enterprise_commit(p_company_id,uid);
 return jsonb_build_object('ok',true);
end; $$;
create function public.enterprise_request_reactivation(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();sid uuid;
begin
 -- Recovery request requires a NEW, verified native login; old revoked sessions
 -- cannot request restoration. This is the only suspended-account operation.
 begin sid:=(auth.jwt()->>'session_id')::uuid;exception when invalid_text_representation then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end;
 if uid is null or coalesce((auth.jwt()->>'exp')::numeric,0)<=extract(epoch from clock_timestamp()) or not exists(select 1 from auth.users where id=uid and email_confirmed_at is not null)
 or not exists(select 1 from auth.sessions s join public.company_branch_accounts a on a.user_id=s.user_id
 where s.id=sid and s.user_id=uid and a.company_id=p_company_id and a.status='suspended' and s.created_at>a.session_epoch
 and not exists(select 1 from private.enterprise_session_revocations r where r.company_id=p_company_id and r.session_id=sid)) then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 update public.company_branch_accounts set reactivation_requested_at=clock_timestamp() where company_id=p_company_id and user_id=uid and status='suspended';
 insert into public.company_branch_audit(company_id,actor_id,action) values(p_company_id,uid,'membership.reactivation_requested');
 return jsonb_build_object('ok',true);
end; $$;

create function public.enterprise_branch_permission(p_company_id uuid,p_branch_id uuid,p_capability text) returns boolean language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);begin
 return uid is not null and private.enterprise_can(p_company_id,p_branch_id,uid,p_capability);
end; $$;

create function public.enterprise_rename_branch(p_company_id uuid,p_branch_id uuid,p_name text,p_operation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);previous private.enterprise_branch_operations%rowtype;payload jsonb;
begin
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid for share;
 if uid is null or not private.enterprise_owner(p_company_id,uid) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_operation_id is null or p_name is null or char_length(btrim(p_name)) not between 1 and 120 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 payload:=jsonb_build_object('action','rename','branchId',p_branch_id,'name',btrim(p_name));
 perform pg_advisory_xact_lock(hashtextextended('enterprise-branch:'||p_operation_id::text,0));
 select * into previous from private.enterprise_branch_operations where operation_id=p_operation_id;
 if found then
  if previous.actor_id<>uid or previous.company_id<>p_company_id or previous.payload<>payload then return jsonb_build_object('ok',false,'code','OPERATION_CONFLICT');end if;
  return jsonb_build_object('ok',true,'branchId',previous.branch_id);
 end if;
 update public.company_branches set name=btrim(p_name) where company_id=p_company_id and id=p_branch_id;
 if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 insert into private.enterprise_branch_operations(operation_id,actor_id,company_id,payload,branch_id) values(p_operation_id,uid,p_company_id,payload,p_branch_id);
 insert into public.company_branch_audit(company_id,branch_id,actor_id,action) values(p_company_id,p_branch_id,uid,'branch.renamed');
 perform private.enterprise_commit(p_company_id,uid);
 return jsonb_build_object('ok',true,'branchId',p_branch_id);
end; $$;

create function public.enterprise_sessions(p_company_id uuid,p_user_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);a public.company_branch_accounts%rowtype;items jsonb;
begin
 if uid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if uid<>p_user_id and not private.enterprise_owner(p_company_id,uid) then
  if not exists(select 1 from public.company_branch_accounts where company_id=p_company_id and user_id=uid and status='active' and customer_role='manager') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  select * into a from public.company_branch_accounts where company_id=p_company_id and user_id=p_user_id and customer_role='employee' and status<>'terminated';
  if not found or not private.enterprise_can(p_company_id,a.branch_id,uid,'staff.sessions.revoke') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 end if;
 if not exists(select 1 from public.company_members where company_id=p_company_id and user_id=p_user_id)
 or (uid=p_user_id and not private.enterprise_owner(p_company_id,uid) and not private.enterprise_account_current(p_company_id,uid,(auth.jwt()->>'session_id')::uuid)) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'current',s.id::text=auth.jwt()->>'session_id','createdAt',s.created_at,
 'lastActivityAt',activity.last_activity_at,'device',left(coalesce(to_jsonb(s)->>'user_agent','Unknown'),200)) order by s.created_at desc),'[]') into items
 from auth.sessions s left join private.app_session_activity activity on activity.session_id=s.id
 where s.user_id=p_user_id and s.created_at>clock_timestamp()-interval '30 days'
 and coalesce((to_jsonb(s)->>'not_after')::timestamptz,'infinity')>clock_timestamp()
 and activity.expired_at is null and not exists(select 1 from private.enterprise_session_revocations r where r.company_id=p_company_id and r.session_id=s.id);
 perform private.enterprise_commit(p_company_id,uid);
 return jsonb_build_object('ok',true,'sessions',items);
end; $$;
create function public.enterprise_revoke_sessions(p_company_id uuid,p_user_id uuid,p_session_id uuid,p_other_devices boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=private.enterprise_authorize(p_company_id);a public.company_branch_accounts%rowtype;count_revoked integer;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('enterprise-authority:'||p_company_id::text,0)) then return jsonb_build_object('ok',false,'code','AUTHORITY_BUSY');end if;
 if uid is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if exists(select 1 from public.company_members where company_id=p_company_id and user_id=p_user_id and role='owner') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.company_members where company_id=p_company_id and user_id=uid for share;
 if uid<>p_user_id and not private.enterprise_owner(p_company_id,uid) then
  if not exists(select 1 from public.company_branch_accounts where company_id=p_company_id and user_id=uid and status='active' and customer_role='manager') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
  select * into a from public.company_branch_accounts where company_id=p_company_id and user_id=p_user_id and customer_role='employee' and status<>'terminated' for share;
  if not found or not private.enterprise_can(p_company_id,a.branch_id,uid,'staff.sessions.revoke') then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 end if;
 if not exists(select 1 from public.company_members where company_id=p_company_id and user_id=p_user_id)
 or (uid=p_user_id and not private.enterprise_owner(p_company_id,uid) and not private.enterprise_account_current(p_company_id,uid,(auth.jwt()->>'session_id')::uuid)) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 -- A manager can revoke branch employees only; never an owner or another manager.
 insert into private.enterprise_session_revocations(company_id,session_id,user_id)
 select p_company_id,id,user_id from auth.sessions where user_id=p_user_id and (p_session_id is null or id=p_session_id)
 and (not p_other_devices or id::text<>auth.jwt()->>'session_id') on conflict do nothing;
 get diagnostics count_revoked=row_count;
 insert into public.company_branch_audit(company_id,actor_id,action,detail) values(p_company_id,uid,'sessions.revoked',jsonb_build_object('userId',p_user_id,'count',count_revoked));
 -- Self-revocation deliberately removes the current customer authority; native
 -- identity still needs to be live to commit. Other-user revocation rechecks scope.
 if uid=p_user_id then
  if private.enterprise_actor() is distinct from uid then raise exception 'AUTHORITY_CHANGED' using errcode='42501';end if;
 else perform private.enterprise_commit(p_company_id,uid);end if;
 return jsonb_build_object('ok',true,'count',count_revoked);
end; $$;

-- Read-only table exposure, RLS and session verification. All writes use RPCs.
alter table public.company_branches enable row level security;
alter table public.company_branch_accounts enable row level security;
alter table public.company_branch_grants enable row level security;
alter table public.company_branch_audit enable row level security;
alter table private.enterprise_employee_identities enable row level security;
alter table private.enterprise_session_revocations enable row level security;
alter table private.enterprise_branch_operations enable row level security;
revoke all on public.company_branches,public.company_branch_accounts,public.company_branch_grants,public.company_branch_audit,
 private.enterprise_employee_identities,private.enterprise_session_revocations,private.enterprise_branch_operations from public,anon,authenticated,service_role;
-- Customer reads use the bounded workspace projection rather than broad SELECT.
do $$ declare f regprocedure;begin
 for f in select oid::regprocedure from pg_proc where pronamespace='private'::regnamespace and proname like 'enterprise_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'enterprise_%' and proname not like 'enterprise_legacy_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  execute format('grant execute on function %s to authenticated',f);
 end loop;
end; $$;
grant execute on function private.enterprise_table_access(uuid,text) to authenticated;
revoke all on function private.user_has_company_capability(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on sequence public.company_branch_audit_id_seq from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
