-- VEL-005D-R2: include audit trail in admin_get_company (no re-apply of prior migrations)

create or replace function public.admin_get_company(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  company jsonb;
  members jsonb;
  audits jsonb;
begin
  actor := private.require_platform_admin();
  select to_jsonb(c) into company from public.companies as c where c.id = p_company_id;
  if company is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'company_id', m.company_id,
    'user_id', m.user_id,
    'role', m.role,
    'status', m.status,
    'member_name', m.member_name,
    'created_at', m.created_at,
    'email', u.email,
    'phone', u.phone
  ) order by m.created_at), '[]'::jsonb)
    into members
  from public.company_members as m
  left join auth.users as u on u.id = m.user_id
  where m.company_id = p_company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id,
    'action', l.action,
    'actor_user_id', l.actor_user_id,
    'actor_email', u.email,
    'created_at', l.created_at,
    'before_data', l.before_data,
    'after_data', l.after_data
  ) order by l.created_at desc), '[]'::jsonb)
    into audits
  from (
    select *
    from public.admin_audit_logs as al
    where al.company_id = p_company_id
    order by al.created_at desc
    limit 50
  ) as l
  left join auth.users as u on u.id = l.actor_user_id;

  return jsonb_build_object(
    'company', company,
    'members', members,
    'audits', audits,
    'viewer', actor
  );
end;
$$;

revoke all on function public.admin_get_company(uuid) from public, anon;
grant execute on function public.admin_get_company(uuid) to authenticated;
