-- Actual Production legacy read predicates captured 2026-10-29.
CREATE OR REPLACE FUNCTION private.conversation_readable(p_company_id uuid, p_assigned_to uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  scope text;
begin
  if actor is null or p_company_id is null then
    return false;
  end if;
  if private.can_admin_company(p_company_id, 'wa.conversations.read') then
    return true;
  end if;
  if not public.has_company_capability(p_company_id, 'wa.conversations.read') then
    return false;
  end if;
  scope := public.company_conversation_scope(p_company_id);
  if scope = 'all_company' then
    return true;
  end if;
  if scope = 'assigned_only' then
    return p_assigned_to is not distinct from actor;
  end if;
  return false;
end;
$function$;
CREATE OR REPLACE FUNCTION public.company_conversation_scope(p_company_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  member_role text;
  scope text;
  g_status text;
begin
  if actor is null or p_company_id is null then
    return null;
  end if;

  select m.role into member_role
  from public.company_members as m
  where m.company_id = p_company_id
    and m.user_id = actor
    and m.status = 'active';

  if member_role is null then
    return null;
  end if;
  if member_role = 'owner' then
    return 'all_company';
  end if;

  select g.conversation_scope, g.status into scope, g_status
  from public.company_member_grants as g
  where g.company_id = p_company_id
    and g.user_id = actor;

  if g_status is distinct from 'active' then
    return null;
  end if;
  return scope; -- never coalesce to all_company
end;
$function$;
CREATE OR REPLACE FUNCTION private.can_admin_company(p_company_id uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  cap text := btrim(coalesce(p_capability, ''));
begin
  if actor is null or p_company_id is null or cap = '' then
    return false;
  end if;
  if public.is_platform_owner() then
    return true;
  end if;
  -- Delegated: must have this company scope AND the required capability in usable[].
  return exists (
    select 1
    from public.platform_admins as a
    join public.platform_admin_scopes as s
      on s.admin_user_id = a.user_id
    where a.user_id = actor
      and a.status = 'active'
      and a.role = 'delegated'
      and s.company_id = p_company_id
      and cap = any (s.usable_capabilities)
  );
end;
$function$;
CREATE OR REPLACE FUNCTION public.is_platform_owner()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.platform_admins as a
    where a.user_id = (select auth.uid())
      and a.role = 'owner'
      and a.status = 'active'
  );
$function$;
