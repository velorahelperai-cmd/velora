-- VEL-005D-R2-FIX: protect owner membership inside admin_set_member_status

create or replace function public.admin_set_member_status(
  p_company_id uuid,
  p_user_id uuid,
  p_status text,
  p_role text default null,
  p_member_name text default null
)
returns public.company_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid;
  before_row public.company_members;
  after_row public.company_members;
begin
  actor := private.require_platform_admin();

  if coalesce(p_status, '') not in ('active', 'disabled') then
    raise exception 'invalid_member_status' using errcode = '22023';
  end if;
  if p_role is not null and p_role not in ('owner', 'staff') then
    raise exception 'invalid_member_role' using errcode = '22023';
  end if;

  select * into before_row
  from public.company_members as m
  where m.company_id = p_company_id and m.user_id = p_user_id
  for update;

  if before_row.user_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Owner membership cannot be disabled or demoted via this RPC.
  if before_row.role = 'owner' then
    if p_status = 'disabled' then
      raise exception 'owner_membership_protected' using errcode = '42501';
    end if;
    if p_role is not null and p_role is distinct from 'owner' then
      raise exception 'owner_membership_protected' using errcode = '42501';
    end if;
  end if;

  update public.company_members as m
  set
    status = p_status,
    role = coalesce(p_role, m.role),
    member_name = coalesce(nullif(btrim(coalesce(p_member_name, '')), ''), m.member_name)
  where m.company_id = p_company_id and m.user_id = p_user_id
  returning * into after_row;

  perform private.write_admin_audit(
    actor,
    p_company_id,
    'member.update',
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return after_row;
end;
$$;

revoke all on function public.admin_set_member_status(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.admin_set_member_status(uuid, uuid, text, text, text) to authenticated;
