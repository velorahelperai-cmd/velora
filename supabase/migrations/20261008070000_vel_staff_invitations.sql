-- Token material never enters persistence. Only SHA256 hashes of 256-bit tokens.
-- Private storage, no direct client access; narrow RPCs enforce native Auth/session checks.
create table private.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  invited_by uuid not null references auth.users(id),
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 254),
  member_name text not null check (char_length(btrim(member_name)) between 2 and 120),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  check ((accepted_at is null) = (accepted_by is null))
);
create index staff_invitations_company_idx on private.staff_invitations(company_id, created_at desc);
alter table private.staff_invitations enable row level security;
revoke all on private.staff_invitations from public, anon, authenticated;
create policy velora_active_session on private.staff_invitations as restrictive for all to authenticated
  using ((select public.app_session_is_valid())) with check ((select public.app_session_is_valid()));
-- There is deliberately no permissive policy or table grant. Definer RPCs below
-- need access to auth.users/auth.sessions and private records and enforce every gate.

create function private.staff_invitation_actor(p_touch boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); checked jsonb;
begin
  if uid is null then raise exception 'UNAUTHENTICATED' using errcode = '42501'; end if;
  checked := public.check_app_session(p_touch);
  if not coalesce((checked->>'ok')::boolean, false) then
    raise exception 'UNAUTHENTICATED' using errcode = '42501';
  end if;
  if not exists(select 1 from auth.users where id = uid and email_confirmed_at is not null and email is not null) then
    raise exception 'UNVERIFIED' using errcode = '42501';
  end if;
  return uid;
end; $$;
revoke all on function private.staff_invitation_actor(boolean) from public, anon, authenticated;

create function public.create_staff_invitation(p_company_id uuid, p_email text, p_name text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid; expiry timestamptz; cleaned_email text := lower(btrim(p_email));
begin
  uid := private.staff_invitation_actor(true);
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or cleaned_email is null or char_length(cleaned_email) > 254 or cleaned_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_name is null or char_length(btrim(p_name)) not between 2 and 120 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;
  -- Locks keep company suspension and owner revocation ordered with creation.
  perform 1 from public.companies where id = p_company_id and status in ('setup', 'active') for share;
  if not found then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  perform 1 from public.company_members where company_id = p_company_id and user_id = uid and role = 'owner' and status = 'active' for share;
  if not found then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  if exists(select 1 from public.company_members m join auth.users u on u.id = m.user_id
    where m.company_id = p_company_id and lower(u.email) = cleaned_email) then
    return jsonb_build_object('ok', false, 'code', 'MEMBER_EXISTS');
  end if;
  insert into private.staff_invitations(company_id, invited_by, email, member_name, token_hash)
    values(p_company_id, uid, cleaned_email, btrim(p_name), p_token_hash) returning expires_at into expiry;
  return jsonb_build_object('ok', true, 'expiresAt', expiry);
exception when insufficient_privilege then
  return jsonb_build_object('ok', false, 'code', SQLERRM);
end; $$;
revoke all on function public.create_staff_invitation(uuid, text, text, text) from public, anon;
grant execute on function public.create_staff_invitation(uuid, text, text, text) to authenticated;

-- Bearer-link preview reveals only business name and a masked mailbox.
create function public.read_staff_invitation(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare invite private.staff_invitations%rowtype; business text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'code', 'INVITE_INVALID'); end if;
  select i.* into invite from private.staff_invitations i
    join public.companies c on c.id = i.company_id and c.status in ('setup', 'active')
    join public.company_members m on m.company_id = i.company_id and m.user_id = i.invited_by and m.role = 'owner' and m.status = 'active'
    where i.token_hash = p_token_hash and i.expires_at > statement_timestamp() and i.accepted_at is null;
  if not found then return jsonb_build_object('ok', false, 'code', 'INVITE_INVALID'); end if;
  select display_name into business from public.companies where id = invite.company_id;
  return jsonb_build_object('ok', true, 'business', business,
    'maskedEmail', left(invite.email, 1) || '***@' || split_part(invite.email, '@', 2), 'expiresAt', invite.expires_at);
end; $$;
revoke all on function public.read_staff_invitation(text) from public;
grant execute on function public.read_staff_invitation(text) to anon, authenticated;

create function public.accept_staff_invitation(p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid; invite private.staff_invitations%rowtype; caller_email text; member public.company_members%rowtype;
begin
  uid := private.staff_invitation_actor(true);
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'code', 'INVITE_INVALID'); end if;
  select * into invite from private.staff_invitations where token_hash = p_token_hash for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'INVITE_INVALID'); end if;
  perform 1 from public.companies where id = invite.company_id and status in ('setup', 'active') for share;
  if not found then return jsonb_build_object('ok', false, 'code', 'INVITE_INVALID'); end if;
  perform 1 from public.company_members where company_id = invite.company_id and user_id = invite.invited_by and role = 'owner' and status = 'active' for share;
  if not found then return jsonb_build_object('ok', false, 'code', 'INVITE_INVALID'); end if;
  select lower(email) into caller_email from auth.users where id = uid and email_confirmed_at is not null for share;
  if caller_email is distinct from invite.email then return jsonb_build_object('ok', false, 'code', 'EMAIL_MISMATCH'); end if;
  -- Serialize acceptance of multiple invitations for the same account/company.
  perform pg_advisory_xact_lock(hashtextextended(invite.company_id::text || ':' || uid::text, 0));
  select * into member from public.company_members where company_id = invite.company_id and user_id = uid for update;
  if invite.accepted_at is not null then
    if invite.accepted_by = uid and member.status = 'active' and member.role = 'staff' then
      return jsonb_build_object('ok', true, 'companyId', invite.company_id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'INVITE_INVALID');
  end if;
  if invite.expires_at <= clock_timestamp() then return jsonb_build_object('ok', false, 'code', 'INVITE_INVALID'); end if;
  if member.user_id is not null and (member.status <> 'active' or member.role <> 'staff') then
    return jsonb_build_object('ok', false, 'code', 'MEMBER_EXISTS');
  end if;
  if member.user_id is null then
    insert into public.company_members(company_id, user_id, role, status, member_name)
      values(invite.company_id, uid, 'staff', 'active', invite.member_name);
  end if;
  update private.staff_invitations set accepted_at = clock_timestamp(), accepted_by = uid where id = invite.id;
  return jsonb_build_object('ok', true, 'companyId', invite.company_id);
exception when insufficient_privilege then
  return jsonb_build_object('ok', false, 'code', SQLERRM);
end; $$;
revoke all on function public.accept_staff_invitation(text) from public, anon;
grant execute on function public.accept_staff_invitation(text) to authenticated;

create function public.list_company_team(p_company_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid; members jsonb; invitations jsonb;
begin
  uid := private.staff_invitation_actor(false);
  perform 1 from public.companies where id = p_company_id and status in ('setup', 'active') for share;
  if not found then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  perform 1 from public.company_members where company_id = p_company_id and user_id = uid and role = 'owner' and status = 'active' for share;
  if not found then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'name', m.member_name, 'email', coalesce(u.email, ''), 'role', m.role, 'status', m.status) order by m.created_at), '[]'::jsonb)
    into members from public.company_members m join auth.users u on u.id = m.user_id where m.company_id = p_company_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.member_name, 'email', i.email,
    'status', case when i.expires_at > clock_timestamp() then 'invited' else 'expired' end, 'expiresAt', i.expires_at) order by i.created_at desc), '[]'::jsonb)
    into invitations from private.staff_invitations i where i.company_id = p_company_id and i.accepted_at is null;
  return jsonb_build_object('ok', true, 'companyId', p_company_id, 'members', members, 'invitations', invitations);
exception when insufficient_privilege then
  return jsonb_build_object('ok', false, 'code', SQLERRM);
end; $$;
revoke all on function public.list_company_team(uuid) from public, anon;
grant execute on function public.list_company_team(uuid) to authenticated;
notify pgrst, 'reload schema';
