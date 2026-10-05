-- VEL-A10-01 (A10 / A11 / P03)
-- Active membership alone must not grant tenant reads when the company is suspended.
-- Dependent SELECT policies already call this helper (knowledge, storage, WhatsApp).
-- Platform admins continue to bypass via public.is_platform_admin() in those policies.

create or replace function private.is_active_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members as m
    join public.companies as c on c.id = m.company_id
    where m.company_id = p_company_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and c.status <> 'suspended'
  );
$$;

revoke all on function private.is_active_company_member(uuid) from public, anon;
grant execute on function private.is_active_company_member(uuid) to authenticated;

comment on function private.is_active_company_member(uuid) is
  'True when the caller is an active member of a non-suspended company. Admins bypass via is_platform_admin() in policies.';
