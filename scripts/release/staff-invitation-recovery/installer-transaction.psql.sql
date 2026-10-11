-- PREPARED ONLY. Run ONLY through the existing TLS-verified postgres connection
-- with psql -X --no-password -v ON_ERROR_STOP=1 -v ON_ERROR_ROLLBACK=off --single-transaction --file this-file.
-- No explicit transaction-control commands belong in this file.
set local lock_timeout='5s';
set local statement_timeout='60s';
set local idle_in_transaction_session_timeout='30s';
set local search_path='';
do $invitation_guard$
begin
 if current_user<>'postgres' or current_database()<>'postgres' then raise exception 'INVITATION_WRONG_OPERATOR_OR_DATABASE';end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='20261011160000')
 or to_regclass('private.staff_invitation_recipients') is not null
 or to_regclass('private.staff_invitation_operations') is not null
 or to_regprocedure('private.staff_invitation_projection(uuid)') is not null
 or to_regprocedure('public.mutate_staff_invitation(uuid,uuid,text,text,text,uuid,integer,text)') is not null
 then raise exception 'INVITATION_ALREADY_OR_PARTIALLY_INSTALLED';end if;
 if exists(select 1 from pg_catalog.pg_attribute where attrelid=to_regclass('private.staff_invitations') and not attisdropped and attname in ('cancelled_at','cancelled_by','superseded_by','legacy_duplicate'))
 then raise exception 'INVITATION_COLUMN_COLLISION';end if;
 if exists(select 1 from (values
('private.staff_invitation_actor(boolean)','5226c121c788d403864720285661d429'),
('private.write_admin_audit(uuid,uuid,text,jsonb,jsonb)','4808bed3a919f923e9fe409cb8a30699'),
('public.create_staff_invitation(uuid,text,text,text)','17a3eee91f8abd8e1d9ee3a25d3a4351'),
('public.read_staff_invitation(text)','54651a6e109e922f85cc4e7b09931714'),
('public.accept_staff_invitation(text)','b0bd645a2d58a14295f3522c56535753'),
('public.list_company_team(uuid)','4be5fdb04ff38b3135b7a63a3c577b25')
 )v(signature,pin) left join pg_catalog.pg_proc p on p.oid=to_regprocedure(v.signature)
 where p.oid is null or md5(pg_get_functiondef(p.oid))<>v.pin)
 then raise exception 'INVITATION_BASELINE_FUNCTION_DRIFT';end if;
end;
$invitation_guard$;
-- Forward-only invitation recovery. Apply transactionally after exact security review.
-- No token plaintext, direct table grants, membership promotion, or email delivery.
-- Exclusive installer locks order the old creation/acceptance paths with backfill.
lock table private.staff_invitations in access exclusive mode;
alter table private.staff_invitations
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users(id),
  add column superseded_by uuid references private.staff_invitations(id),
  add column legacy_duplicate boolean not null default false,
  add constraint staff_invitation_cancel_pair check ((cancelled_at is null) = (cancelled_by is null)),
  add constraint staff_invitation_terminal_state check (accepted_at is null or cancelled_at is null);

-- Retain every legacy row/hash. Duplicate groups are contained, never silently
-- picked, deleted, or accepted. Owner replacement/cancellation resolves the group.
update private.staff_invitations i set legacy_duplicate = true
where i.accepted_at is null and exists (
  select 1 from private.staff_invitations d where d.company_id=i.company_id
    and d.email=i.email and d.accepted_at is null and d.id<>i.id
);
create unique index staff_invitations_pending_recipient_idx
  on private.staff_invitations(company_id,email)
  where accepted_at is null and cancelled_at is null and not legacy_duplicate;
create index staff_invitations_pending_lookup_idx
  on private.staff_invitations(company_id,email)
  where accepted_at is null and cancelled_at is null;

-- A unique recipient row also serializes legacy groups and their shared revision.
create table private.staff_invitation_recipients (
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null check (email=lower(btrim(email))),
  revision integer not null default 1 check (revision>0),
  primary key(company_id,email)
);
insert into private.staff_invitation_recipients(company_id,email)
  select distinct company_id,email from private.staff_invitations;
alter table private.staff_invitations add constraint staff_invitation_recipient_fk
  foreign key(company_id,email) references private.staff_invitation_recipients(company_id,email);
create table private.staff_invitation_operations (
  operation_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  company_id uuid not null references public.companies(id) on delete cascade,
  payload jsonb not null,
  invitation_id uuid not null references private.staff_invitations(id),
  outcome text not null check (outcome in ('created','existing','replaced','cancelled')),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.staff_invitation_recipients enable row level security;
alter table private.staff_invitation_operations enable row level security;
revoke all on private.staff_invitation_recipients, private.staff_invitation_operations from public, anon, authenticated;
-- No permissive RLS policies: these tables are accessible only through gated RPCs.

create function private.staff_invitation_projection(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',i.id,'name',i.member_name,'email',i.email,
    'status',case when i.accepted_at is not null then 'accepted'
      when i.cancelled_at is not null then 'cancelled'
      when (select count(*) from private.staff_invitations d where d.company_id=i.company_id
        and d.email=i.email and d.accepted_at is null and d.cancelled_at is null)>1 then 'conflicted'
      when i.expires_at<=statement_timestamp() then 'expired' else 'invited' end,
    'expiresAt',i.expires_at,'revision',r.revision)
  from private.staff_invitations i join private.staff_invitation_recipients r
    on r.company_id=i.company_id and r.email=i.email where i.id=p_id;
$$;
revoke all on function private.staff_invitation_projection(uuid) from public, anon, authenticated;

-- Preserve the old signature/ACL, while closing the unbound operation bypass.
create or replace function public.create_staff_invitation(p_company_id uuid,p_email text,p_name text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.staff_invitation_actor(true);
  return jsonb_build_object('ok',false,'code','UPGRADE_REQUIRED');
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',SQLERRM);
end; $$;

create function public.mutate_staff_invitation(
  p_company_id uuid,p_operation_id uuid,p_action text,p_email text,p_name text,
  p_invitation_id uuid,p_expected_revision integer,p_token_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; email_key text; payload_key jsonb; previous private.staff_invitation_operations%rowtype;
  invite private.staff_invitations%rowtype; recipient_revision integer; pending_count integer;
  saved_id uuid; saved_outcome text; invalidated jsonb:='[]'::jsonb;
begin
  uid:=private.staff_invitation_actor(true);
  if p_operation_id is null or p_action is null or p_action not in ('create','replace','cancel')
    or (p_action in ('create','replace') and (p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$'))
    or (p_action='cancel' and p_token_hash is not null) then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  if p_action='create' then
    email_key:=lower(btrim(p_email));
    if email_key is null or char_length(email_key)>254 or email_key!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or p_name is null or char_length(btrim(p_name)) not between 2 and 120
      or p_invitation_id is not null or p_expected_revision is not null then
      return jsonb_build_object('ok',false,'code','INVALID_INPUT');
    end if;
  elsif p_email is not null or p_name is not null or p_invitation_id is null
    or p_expected_revision is null or p_expected_revision<1 then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  -- Same order across create/replace/cancel/accept: company, authorizing owner,
  -- recipient, invitation, recipient membership. No invitation-first inversion.
  perform 1 from public.companies where id=p_company_id and status in ('setup','active') for share;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  perform 1 from public.company_members where company_id=p_company_id and user_id=uid and role='owner' and status='active' for share;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  payload_key:=jsonb_build_object('action',p_action,'email',email_key,'name',case when p_action='create' then btrim(p_name) else null end,
    'invitationId',p_invitation_id,'expectedRevision',p_expected_revision);
  -- Hash is intentionally excluded: a fresh server request generates new random
  -- material, and replay cannot claim to reconstruct the original link.
  perform pg_advisory_xact_lock(hashtextextended('staff-operation:'||p_operation_id::text,0));
  select * into previous from private.staff_invitation_operations where operation_id=p_operation_id;
  if found and (previous.actor_id<>uid or previous.company_id<>p_company_id or previous.payload<>payload_key) then
    return jsonb_build_object('ok',false,'code','OPERATION_CONFLICT');
  end if;
  if p_action<>'create' then
    select * into invite from private.staff_invitations where id=p_invitation_id and company_id=p_company_id;
    if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
    email_key:=invite.email;
  end if;
  insert into private.staff_invitation_recipients(company_id,email,revision) values(p_company_id,email_key,1) on conflict do nothing;
  select revision into recipient_revision from private.staff_invitation_recipients
    where company_id=p_company_id and email=email_key for update;
  if previous.operation_id is not null then
    return jsonb_build_object('ok',true,'outcome',previous.outcome,'replayed',true,'tokenMatched',false,
      'invitation',private.staff_invitation_projection(previous.invitation_id));
  end if;
  if p_action<>'create' then
    if recipient_revision<>p_expected_revision then return jsonb_build_object('ok',false,'code','STALE_REVISION'); end if;
    select * into invite from private.staff_invitations where id=p_invitation_id for update;
    if invite.accepted_at is not null or invite.cancelled_at is not null then
      return jsonb_build_object('ok',false,'code','INVITE_NOT_PENDING');
    end if;
  end if;
  if p_action in ('create','replace') and exists(select 1 from public.company_members m join auth.users u on u.id=m.user_id
    where m.company_id=p_company_id and lower(u.email)=email_key) then
    return jsonb_build_object('ok',false,'code','MEMBER_EXISTS');
  end if;
  select count(*) into pending_count from private.staff_invitations where company_id=p_company_id and email=email_key
    and accepted_at is null and cancelled_at is null;
  if p_action='create' then
    if pending_count>1 then return jsonb_build_object('ok',false,'code','LEGACY_CONFLICT'); end if;
    if pending_count=1 then
      select id into saved_id from private.staff_invitations where company_id=p_company_id and email=email_key and accepted_at is null and cancelled_at is null;
      saved_outcome:='existing';
    else
      insert into private.staff_invitations(company_id,invited_by,email,member_name,token_hash)
        values(p_company_id,uid,email_key,btrim(p_name),p_token_hash) returning id into saved_id;
      saved_outcome:='created';
    end if;
  else
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into invalidated from private.staff_invitations
      where company_id=p_company_id and email=email_key and accepted_at is null and cancelled_at is null;
    -- This is the explicitly confirmed group invalidation, including old expired
    -- duplicates. Accepted rows and memberships are never modified here.
    update private.staff_invitations set cancelled_at=clock_timestamp(),cancelled_by=uid
      where company_id=p_company_id and email=email_key and accepted_at is null and cancelled_at is null;
    if p_action='replace' then
      insert into private.staff_invitations(company_id,invited_by,email,member_name,token_hash)
        values(p_company_id,uid,email_key,invite.member_name,p_token_hash) returning id into saved_id;
      update private.staff_invitations set superseded_by=saved_id where company_id=p_company_id and id in
        (select value::uuid from jsonb_array_elements_text(invalidated));
      saved_outcome:='replaced';
    else saved_id:=invite.id; saved_outcome:='cancelled'; end if;
  end if;
  if saved_outcome<>'existing' then
    update private.staff_invitation_recipients set revision=revision+1 where company_id=p_company_id and email=email_key;
  end if;
  perform private.write_admin_audit(uid,p_company_id,'staff_invitation.'||saved_outcome,
    jsonb_build_object('recipientRevision',recipient_revision,'invalidatedInvitationIds',invalidated),
    jsonb_build_object('operationId',p_operation_id,'invitationId',saved_id,
      'recipientRevision',(select revision from private.staff_invitation_recipients where company_id=p_company_id and email=email_key)));
  insert into private.staff_invitation_operations(operation_id,actor_id,company_id,payload,invitation_id,outcome)
    values(p_operation_id,uid,p_company_id,payload_key,saved_id,saved_outcome);
  return jsonb_build_object('ok',true,'outcome',saved_outcome,'replayed',false,
    'tokenMatched',saved_outcome in ('created','replaced'),'invitation',private.staff_invitation_projection(saved_id));
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',SQLERRM);
end; $$;
revoke all on function public.mutate_staff_invitation(uuid,uuid,text,text,text,uuid,integer,text) from public,anon;
grant execute on function public.mutate_staff_invitation(uuid,uuid,text,text,text,uuid,integer,text) to authenticated;

create or replace function public.read_staff_invitation(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare invite private.staff_invitations%rowtype; business text;
begin
  if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'code','INVITE_INVALID'); end if;
  select i.* into invite from private.staff_invitations i
    join public.companies c on c.id=i.company_id and c.status in ('setup','active')
    join public.company_members m on m.company_id=i.company_id and m.user_id=i.invited_by and m.role='owner' and m.status='active'
    where i.token_hash=p_token_hash and i.expires_at>statement_timestamp() and i.accepted_at is null and i.cancelled_at is null;
  if not found or (select count(*) from private.staff_invitations d where d.company_id=invite.company_id
    and d.email=invite.email and d.accepted_at is null and d.cancelled_at is null)<>1 then
    return jsonb_build_object('ok',false,'code','INVITE_INVALID');
  end if;
  select display_name into business from public.companies where id=invite.company_id;
  return jsonb_build_object('ok',true,'business',business,'maskedEmail',left(invite.email,1)||'***@'||split_part(invite.email,'@',2),'expiresAt',invite.expires_at);
end; $$;

create or replace function public.accept_staff_invitation(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; invite private.staff_invitations%rowtype; caller_email text; member public.company_members%rowtype; recipient_revision integer;
begin
  uid:=private.staff_invitation_actor(true);
  if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'code','INVITE_INVALID'); end if;
  select * into invite from private.staff_invitations where token_hash=p_token_hash;
  if not found then return jsonb_build_object('ok',false,'code','INVITE_INVALID'); end if;
  perform 1 from public.companies where id=invite.company_id and status in ('setup','active') for share;
  if not found then return jsonb_build_object('ok',false,'code','INVITE_INVALID'); end if;
  perform 1 from public.company_members where company_id=invite.company_id and user_id=invite.invited_by and role='owner' and status='active' for share;
  if not found then return jsonb_build_object('ok',false,'code','INVITE_INVALID'); end if;
  select lower(email) into caller_email from auth.users where id=uid and email_confirmed_at is not null for share;
  if caller_email is distinct from invite.email then return jsonb_build_object('ok',false,'code','EMAIL_MISMATCH'); end if;
  select revision into recipient_revision from private.staff_invitation_recipients where company_id=invite.company_id and email=invite.email for update;
  select * into invite from private.staff_invitations where id=invite.id for update;
  select * into member from public.company_members where company_id=invite.company_id and user_id=uid for update;
  if invite.accepted_at is not null then
    if invite.accepted_by=uid and member.status='active' and member.role='staff' then
      return jsonb_build_object('ok',true,'companyId',invite.company_id);
    end if;
    return jsonb_build_object('ok',false,'code','INVITE_INVALID');
  end if;
  if invite.cancelled_at is not null or invite.expires_at<=clock_timestamp()
    or (select count(*) from private.staff_invitations d where d.company_id=invite.company_id and d.email=invite.email
      and d.accepted_at is null and d.cancelled_at is null)<>1 then
    return jsonb_build_object('ok',false,'code','INVITE_INVALID');
  end if;
  if member.user_id is not null and (member.status<>'active' or member.role<>'staff') then
    return jsonb_build_object('ok',false,'code','MEMBER_EXISTS');
  end if;
  if member.user_id is null then
    insert into public.company_members(company_id,user_id,role,status,member_name)
      values(invite.company_id,uid,'staff','active',invite.member_name);
  end if;
  update private.staff_invitations set accepted_at=clock_timestamp(),accepted_by=uid where id=invite.id;
  update private.staff_invitation_recipients set revision=revision+1 where company_id=invite.company_id and email=invite.email;
  perform private.write_admin_audit(uid,invite.company_id,'staff_invitation.accepted',
    jsonb_build_object('invitationId',invite.id,'recipientRevision',recipient_revision),
    jsonb_build_object('invitationId',invite.id,'recipientRevision',recipient_revision+1));
  return jsonb_build_object('ok',true,'companyId',invite.company_id);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',SQLERRM);
end; $$;

create or replace function public.list_company_team(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; members jsonb; invitations jsonb;
begin
  uid:=private.staff_invitation_actor(false);
  perform 1 from public.companies where id=p_company_id and status in ('setup','active') for share;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  perform 1 from public.company_members where company_id=p_company_id and user_id=uid and role='owner' and status='active' for share;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',m.member_name,'email',coalesce(u.email,''),'role',m.role,'status',m.status) order by m.created_at),'[]'::jsonb)
    into members from public.company_members m join auth.users u on u.id=m.user_id where m.company_id=p_company_id;
  select coalesce(jsonb_agg(private.staff_invitation_projection(i.id) order by i.created_at desc,i.id),'[]'::jsonb)
    into invitations from private.staff_invitations i where i.company_id=p_company_id;
  return jsonb_build_object('ok',true,'companyId',p_company_id,'members',members,'invitations',invitations);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',SQLERRM);
end; $$;
-- CREATE OR REPLACE retains the exact existing RPC ACLs. No existing table,
-- membership, capability, platform-team or audit-reader grant is expanded.
notify pgrst,'reload schema';

-- Same psql transaction: exact reviewed source stored as the sole history statement.
insert into supabase_migrations.schema_migrations(version,name,statements) values
('20261011160000','velora_staff_invitation_recovery_23748387',array[$invitation_source$-- Forward-only invitation recovery. Apply transactionally after exact security review.
-- No token plaintext, direct table grants, membership promotion, or email delivery.
-- Exclusive installer locks order the old creation/acceptance paths with backfill.
lock table private.staff_invitations in access exclusive mode;
alter table private.staff_invitations
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users(id),
  add column superseded_by uuid references private.staff_invitations(id),
  add column legacy_duplicate boolean not null default false,
  add constraint staff_invitation_cancel_pair check ((cancelled_at is null) = (cancelled_by is null)),
  add constraint staff_invitation_terminal_state check (accepted_at is null or cancelled_at is null);

-- Retain every legacy row/hash. Duplicate groups are contained, never silently
-- picked, deleted, or accepted. Owner replacement/cancellation resolves the group.
update private.staff_invitations i set legacy_duplicate = true
where i.accepted_at is null and exists (
  select 1 from private.staff_invitations d where d.company_id=i.company_id
    and d.email=i.email and d.accepted_at is null and d.id<>i.id
);
create unique index staff_invitations_pending_recipient_idx
  on private.staff_invitations(company_id,email)
  where accepted_at is null and cancelled_at is null and not legacy_duplicate;
create index staff_invitations_pending_lookup_idx
  on private.staff_invitations(company_id,email)
  where accepted_at is null and cancelled_at is null;

-- A unique recipient row also serializes legacy groups and their shared revision.
create table private.staff_invitation_recipients (
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null check (email=lower(btrim(email))),
  revision integer not null default 1 check (revision>0),
  primary key(company_id,email)
);
insert into private.staff_invitation_recipients(company_id,email)
  select distinct company_id,email from private.staff_invitations;
alter table private.staff_invitations add constraint staff_invitation_recipient_fk
  foreign key(company_id,email) references private.staff_invitation_recipients(company_id,email);
create table private.staff_invitation_operations (
  operation_id uuid primary key,
  actor_id uuid not null references auth.users(id),
  company_id uuid not null references public.companies(id) on delete cascade,
  payload jsonb not null,
  invitation_id uuid not null references private.staff_invitations(id),
  outcome text not null check (outcome in ('created','existing','replaced','cancelled')),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.staff_invitation_recipients enable row level security;
alter table private.staff_invitation_operations enable row level security;
revoke all on private.staff_invitation_recipients, private.staff_invitation_operations from public, anon, authenticated;
-- No permissive RLS policies: these tables are accessible only through gated RPCs.

create function private.staff_invitation_projection(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',i.id,'name',i.member_name,'email',i.email,
    'status',case when i.accepted_at is not null then 'accepted'
      when i.cancelled_at is not null then 'cancelled'
      when (select count(*) from private.staff_invitations d where d.company_id=i.company_id
        and d.email=i.email and d.accepted_at is null and d.cancelled_at is null)>1 then 'conflicted'
      when i.expires_at<=statement_timestamp() then 'expired' else 'invited' end,
    'expiresAt',i.expires_at,'revision',r.revision)
  from private.staff_invitations i join private.staff_invitation_recipients r
    on r.company_id=i.company_id and r.email=i.email where i.id=p_id;
$$;
revoke all on function private.staff_invitation_projection(uuid) from public, anon, authenticated;

-- Preserve the old signature/ACL, while closing the unbound operation bypass.
create or replace function public.create_staff_invitation(p_company_id uuid,p_email text,p_name text,p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.staff_invitation_actor(true);
  return jsonb_build_object('ok',false,'code','UPGRADE_REQUIRED');
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',SQLERRM);
end; $$;

create function public.mutate_staff_invitation(
  p_company_id uuid,p_operation_id uuid,p_action text,p_email text,p_name text,
  p_invitation_id uuid,p_expected_revision integer,p_token_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; email_key text; payload_key jsonb; previous private.staff_invitation_operations%rowtype;
  invite private.staff_invitations%rowtype; recipient_revision integer; pending_count integer;
  saved_id uuid; saved_outcome text; invalidated jsonb:='[]'::jsonb;
begin
  uid:=private.staff_invitation_actor(true);
  if p_operation_id is null or p_action is null or p_action not in ('create','replace','cancel')
    or (p_action in ('create','replace') and (p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$'))
    or (p_action='cancel' and p_token_hash is not null) then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  if p_action='create' then
    email_key:=lower(btrim(p_email));
    if email_key is null or char_length(email_key)>254 or email_key!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      or p_name is null or char_length(btrim(p_name)) not between 2 and 120
      or p_invitation_id is not null or p_expected_revision is not null then
      return jsonb_build_object('ok',false,'code','INVALID_INPUT');
    end if;
  elsif p_email is not null or p_name is not null or p_invitation_id is null
    or p_expected_revision is null or p_expected_revision<1 then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  -- Same order across create/replace/cancel/accept: company, authorizing owner,
  -- recipient, invitation, recipient membership. No invitation-first inversion.
  perform 1 from public.companies where id=p_company_id and status in ('setup','active') for share;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  perform 1 from public.company_members where company_id=p_company_id and user_id=uid and role='owner' and status='active' for share;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  payload_key:=jsonb_build_object('action',p_action,'email',email_key,'name',case when p_action='create' then btrim(p_name) else null end,
    'invitationId',p_invitation_id,'expectedRevision',p_expected_revision);
  -- Hash is intentionally excluded: a fresh server request generates new random
  -- material, and replay cannot claim to reconstruct the original link.
  perform pg_advisory_xact_lock(hashtextextended('staff-operation:'||p_operation_id::text,0));
  select * into previous from private.staff_invitation_operations where operation_id=p_operation_id;
  if found and (previous.actor_id<>uid or previous.company_id<>p_company_id or previous.payload<>payload_key) then
    return jsonb_build_object('ok',false,'code','OPERATION_CONFLICT');
  end if;
  if p_action<>'create' then
    select * into invite from private.staff_invitations where id=p_invitation_id and company_id=p_company_id;
    if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
    email_key:=invite.email;
  end if;
  insert into private.staff_invitation_recipients(company_id,email,revision) values(p_company_id,email_key,1) on conflict do nothing;
  select revision into recipient_revision from private.staff_invitation_recipients
    where company_id=p_company_id and email=email_key for update;
  if previous.operation_id is not null then
    return jsonb_build_object('ok',true,'outcome',previous.outcome,'replayed',true,'tokenMatched',false,
      'invitation',private.staff_invitation_projection(previous.invitation_id));
  end if;
  if p_action<>'create' then
    if recipient_revision<>p_expected_revision then return jsonb_build_object('ok',false,'code','STALE_REVISION'); end if;
    select * into invite from private.staff_invitations where id=p_invitation_id for update;
    if invite.accepted_at is not null or invite.cancelled_at is not null then
      return jsonb_build_object('ok',false,'code','INVITE_NOT_PENDING');
    end if;
  end if;
  if p_action in ('create','replace') and exists(select 1 from public.company_members m join auth.users u on u.id=m.user_id
    where m.company_id=p_company_id and lower(u.email)=email_key) then
    return jsonb_build_object('ok',false,'code','MEMBER_EXISTS');
  end if;
  select count(*) into pending_count from private.staff_invitations where company_id=p_company_id and email=email_key
    and accepted_at is null and cancelled_at is null;
  if p_action='create' then
    if pending_count>1 then return jsonb_build_object('ok',false,'code','LEGACY_CONFLICT'); end if;
    if pending_count=1 then
      select id into saved_id from private.staff_invitations where company_id=p_company_id and email=email_key and accepted_at is null and cancelled_at is null;
      saved_outcome:='existing';
    else
      insert into private.staff_invitations(company_id,invited_by,email,member_name,token_hash)
        values(p_company_id,uid,email_key,btrim(p_name),p_token_hash) returning id into saved_id;
      saved_outcome:='created';
    end if;
  else
    select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into invalidated from private.staff_invitations
      where company_id=p_company_id and email=email_key and accepted_at is null and cancelled_at is null;
    -- This is the explicitly confirmed group invalidation, including old expired
    -- duplicates. Accepted rows and memberships are never modified here.
    update private.staff_invitations set cancelled_at=clock_timestamp(),cancelled_by=uid
      where company_id=p_company_id and email=email_key and accepted_at is null and cancelled_at is null;
    if p_action='replace' then
      insert into private.staff_invitations(company_id,invited_by,email,member_name,token_hash)
        values(p_company_id,uid,email_key,invite.member_name,p_token_hash) returning id into saved_id;
      update private.staff_invitations set superseded_by=saved_id where company_id=p_company_id and id in
        (select value::uuid from jsonb_array_elements_text(invalidated));
      saved_outcome:='replaced';
    else saved_id:=invite.id; saved_outcome:='cancelled'; end if;
  end if;
  if saved_outcome<>'existing' then
    update private.staff_invitation_recipients set revision=revision+1 where company_id=p_company_id and email=email_key;
  end if;
  perform private.write_admin_audit(uid,p_company_id,'staff_invitation.'||saved_outcome,
    jsonb_build_object('recipientRevision',recipient_revision,'invalidatedInvitationIds',invalidated),
    jsonb_build_object('operationId',p_operation_id,'invitationId',saved_id,
      'recipientRevision',(select revision from private.staff_invitation_recipients where company_id=p_company_id and email=email_key)));
  insert into private.staff_invitation_operations(operation_id,actor_id,company_id,payload,invitation_id,outcome)
    values(p_operation_id,uid,p_company_id,payload_key,saved_id,saved_outcome);
  return jsonb_build_object('ok',true,'outcome',saved_outcome,'replayed',false,
    'tokenMatched',saved_outcome in ('created','replaced'),'invitation',private.staff_invitation_projection(saved_id));
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',SQLERRM);
end; $$;
revoke all on function public.mutate_staff_invitation(uuid,uuid,text,text,text,uuid,integer,text) from public,anon;
grant execute on function public.mutate_staff_invitation(uuid,uuid,text,text,text,uuid,integer,text) to authenticated;

create or replace function public.read_staff_invitation(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare invite private.staff_invitations%rowtype; business text;
begin
  if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'code','INVITE_INVALID'); end if;
  select i.* into invite from private.staff_invitations i
    join public.companies c on c.id=i.company_id and c.status in ('setup','active')
    join public.company_members m on m.company_id=i.company_id and m.user_id=i.invited_by and m.role='owner' and m.status='active'
    where i.token_hash=p_token_hash and i.expires_at>statement_timestamp() and i.accepted_at is null and i.cancelled_at is null;
  if not found or (select count(*) from private.staff_invitations d where d.company_id=invite.company_id
    and d.email=invite.email and d.accepted_at is null and d.cancelled_at is null)<>1 then
    return jsonb_build_object('ok',false,'code','INVITE_INVALID');
  end if;
  select display_name into business from public.companies where id=invite.company_id;
  return jsonb_build_object('ok',true,'business',business,'maskedEmail',left(invite.email,1)||'***@'||split_part(invite.email,'@',2),'expiresAt',invite.expires_at);
end; $$;

create or replace function public.accept_staff_invitation(p_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; invite private.staff_invitations%rowtype; caller_email text; member public.company_members%rowtype; recipient_revision integer;
begin
  uid:=private.staff_invitation_actor(true);
  if p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' then return jsonb_build_object('ok',false,'code','INVITE_INVALID'); end if;
  select * into invite from private.staff_invitations where token_hash=p_token_hash;
  if not found then return jsonb_build_object('ok',false,'code','INVITE_INVALID'); end if;
  perform 1 from public.companies where id=invite.company_id and status in ('setup','active') for share;
  if not found then return jsonb_build_object('ok',false,'code','INVITE_INVALID'); end if;
  perform 1 from public.company_members where company_id=invite.company_id and user_id=invite.invited_by and role='owner' and status='active' for share;
  if not found then return jsonb_build_object('ok',false,'code','INVITE_INVALID'); end if;
  select lower(email) into caller_email from auth.users where id=uid and email_confirmed_at is not null for share;
  if caller_email is distinct from invite.email then return jsonb_build_object('ok',false,'code','EMAIL_MISMATCH'); end if;
  select revision into recipient_revision from private.staff_invitation_recipients where company_id=invite.company_id and email=invite.email for update;
  select * into invite from private.staff_invitations where id=invite.id for update;
  select * into member from public.company_members where company_id=invite.company_id and user_id=uid for update;
  if invite.accepted_at is not null then
    if invite.accepted_by=uid and member.status='active' and member.role='staff' then
      return jsonb_build_object('ok',true,'companyId',invite.company_id);
    end if;
    return jsonb_build_object('ok',false,'code','INVITE_INVALID');
  end if;
  if invite.cancelled_at is not null or invite.expires_at<=clock_timestamp()
    or (select count(*) from private.staff_invitations d where d.company_id=invite.company_id and d.email=invite.email
      and d.accepted_at is null and d.cancelled_at is null)<>1 then
    return jsonb_build_object('ok',false,'code','INVITE_INVALID');
  end if;
  if member.user_id is not null and (member.status<>'active' or member.role<>'staff') then
    return jsonb_build_object('ok',false,'code','MEMBER_EXISTS');
  end if;
  if member.user_id is null then
    insert into public.company_members(company_id,user_id,role,status,member_name)
      values(invite.company_id,uid,'staff','active',invite.member_name);
  end if;
  update private.staff_invitations set accepted_at=clock_timestamp(),accepted_by=uid where id=invite.id;
  update private.staff_invitation_recipients set revision=revision+1 where company_id=invite.company_id and email=invite.email;
  perform private.write_admin_audit(uid,invite.company_id,'staff_invitation.accepted',
    jsonb_build_object('invitationId',invite.id,'recipientRevision',recipient_revision),
    jsonb_build_object('invitationId',invite.id,'recipientRevision',recipient_revision+1));
  return jsonb_build_object('ok',true,'companyId',invite.company_id);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',SQLERRM);
end; $$;

create or replace function public.list_company_team(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid; members jsonb; invitations jsonb;
begin
  uid:=private.staff_invitation_actor(false);
  perform 1 from public.companies where id=p_company_id and status in ('setup','active') for share;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  perform 1 from public.company_members where company_id=p_company_id and user_id=uid and role='owner' and status='active' for share;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',m.member_name,'email',coalesce(u.email,''),'role',m.role,'status',m.status) order by m.created_at),'[]'::jsonb)
    into members from public.company_members m join auth.users u on u.id=m.user_id where m.company_id=p_company_id;
  select coalesce(jsonb_agg(private.staff_invitation_projection(i.id) order by i.created_at desc,i.id),'[]'::jsonb)
    into invitations from private.staff_invitations i where i.company_id=p_company_id;
  return jsonb_build_object('ok',true,'companyId',p_company_id,'members',members,'invitations',invitations);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code',SQLERRM);
end; $$;
-- CREATE OR REPLACE retains the exact existing RPC ACLs. No existing table,
-- membership, capability, platform-team or audit-reader grant is expanded.
notify pgrst,'reload schema';
$invitation_source$]);
