-- Record the human-confirmed platform owner using the existing verified admin.
-- Do not create an admin from an email match or trust editable user metadata.
alter table public.platform_admins
 add column if not exists role text,
 add column if not exists status text,
 add column if not exists revision integer,
 add column if not exists updated_at timestamptz;
update public.platform_admins set
 role=coalesce(role,'delegated'),status=coalesce(status,'active'),
 revision=coalesce(revision,1),updated_at=coalesce(updated_at,granted_at,now());
alter table public.platform_admins
 alter column role set default 'delegated',alter column role set not null,
 alter column status set default 'active',alter column status set not null,
 alter column revision set default 1,alter column revision set not null,
 alter column updated_at set default now(),alter column updated_at set not null;
do $$
declare owner_id uuid;
begin
 select u.id into owner_id from auth.users u
 join public.platform_admins a on a.user_id=u.id
 where lower(u.email)='velorahelperai@gmail.com' and u.email_confirmed_at is not null;
 if owner_id is null then raise exception 'Verified existing platform admin required';end if;
 if exists(select 1 from public.platform_admins where role='owner' and status='active' and user_id<>owner_id) then
  raise exception 'Another active platform owner exists';
 end if;
 update public.platform_admins set role='owner',status='active',revision=revision+1,updated_at=now()
 where user_id=owner_id and (role<>'owner' or status<>'active');
end;$$;
alter table public.platform_admins drop constraint if exists platform_admins_role_check;
alter table public.platform_admins add constraint platform_admins_role_check check(role in ('owner','delegated'));
alter table public.platform_admins drop constraint if exists platform_admins_status_check;
alter table public.platform_admins add constraint platform_admins_status_check check(status in ('active','disabled'));
create unique index if not exists platform_admins_one_active_owner
 on public.platform_admins(role) where role='owner' and status='active';
create or replace function public.is_platform_owner()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.platform_admins a
 where a.user_id=(select auth.uid()) and a.role='owner' and a.status='active');
$$;
revoke all on function public.is_platform_owner() from public,anon;
grant execute on function public.is_platform_owner() to authenticated;
notify pgrst,'reload schema';
