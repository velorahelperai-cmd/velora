-- Read-only Production function catalog snapshot, 2026-10-29.
-- Exact bodies, no customer rows or credentials. This is test evidence only.
-- Installation disables function-body checks because unused billing/legacy
-- company branches depend on a larger graph deliberately outside this fixture.
CREATE OR REPLACE FUNCTION auth.jwt()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$function$;

CREATE OR REPLACE FUNCTION auth.uid()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;

CREATE OR REPLACE FUNCTION private.access_company_capabilities()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$select array[
 'wa.conversations.read','wa.conversations.reply','wa.conversations.take_over','wa.conversations.resume','wa.conversations.close','wa.conversations.assign',
 'knowledge.read','knowledge.write','knowledge.delete','company.profile.read','company.profile.write','company.staff.manage',
 'ig.conversations.read','ig.conversations.assign','ig.conversations.reply']::text[]$function$;

CREATE OR REPLACE FUNCTION private.ad_native_session_valid()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$select private.master_identity_pre_session_is_valid() and exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=auth.uid() and private.master_identity_session_current(user_id,id))$function$;

CREATE OR REPLACE FUNCTION private.ad_not_deleting(p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select not exists(select 1 from private.ad_operations where target=p_user and fenced);
$function$;

CREATE OR REPLACE FUNCTION private.billing_chat_access(cid uuid, channel text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$declare r jsonb;e timestamptz;begin
 if current_setting('role',true)='authenticated' and not exists(select 1 from public.company_members where company_id=cid and user_id=auth.uid() and status='active') then return false;end if;
 r:=private.billing_lifecycle_receipt(cid);if r is null then return not exists(select 1 from public.billing_subscriptions where company_id=cid and environment='live' and paid_through is not null);end if;
 e:=(r->>'expiredAt')::timestamptz;
 if statement_timestamp()>=e+interval '720 hours' then return false;end if;
 if statement_timestamp()<e and exists(select 1 from private.billing_expiry_episodes where company_id=cid and disconnected_at is not null) then
  if channel='instagram' then return exists(select 1 from private.instagram_company_links l join private.instagram_company_generations g on g.company_id=l.company_id and g.bound_account_id=l.account_id and g.generation=l.generation where l.company_id=cid and l.status='active' and l.authorization_expires_at>statement_timestamp());end if;
  if channel='whatsapp' then return exists(select 1 from public.whatsapp_company_links where company_id=cid and status='verified' and authorization_status='active' and (authorization_expires_at>statement_timestamp() or (authorization_expires_at is null and authorization_non_expiring)));end if;
 end if;return true;
end;$function$;

CREATE OR REPLACE FUNCTION private.billing_chat_send(cid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when private.billing_lifecycle_receipt(cid) is null then
  not exists(select 1 from public.billing_subscriptions where company_id=cid and environment='live' and paid_through is not null)
 else exists(select 1 from public.billing_subscriptions s join private.billing_proven_entitlement_grants g on g.subscription_id=s.id and g.company_id=s.company_id and g.plan_version_id=s.plan_version_id
  where s.company_id=cid and s.environment='live' and g.provider_environment='live' and s.paid_through=g.applied_paid_through
   and s.status in ('active','cancel_at_period_end') and g.applied_paid_through>statement_timestamp() and private.billing_service_receipt_eligible(g.id)) end
$function$;

CREATE OR REPLACE FUNCTION private.manager_delegation_covers(p_manager uuid, p_company_id uuid, p_capability text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.platform_admins as a
    join public.platform_admin_scopes as s
      on s.admin_user_id = a.user_id
    where a.user_id = p_manager
      and a.status = 'active'
      and a.role = 'delegated'
      and s.company_id = p_company_id
      and p_capability = any (s.delegable_capabilities)
  );
$function$;

CREATE OR REPLACE FUNCTION private.master_identity_pre_session_is_valid()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(private.master_password_native_session_is_valid(),false)
 and exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id
  left join private.master_account_session_revocations r on r.user_id=u.id
  where s.id::text=auth.jwt()->>'session_id' and s.user_id=auth.uid()
  and (s.not_after is null or s.not_after>clock_timestamp())
  and u.deleted_at is null and (u.banned_until is null or u.banned_until<=clock_timestamp())
  and (r.revoked_before is null or s.created_at>r.revoked_before));
$function$;

CREATE OR REPLACE FUNCTION private.master_identity_session_current(uid uuid, sid uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from auth.sessions s where s.id=sid and s.user_id=uid
  and not exists(select 1 from private.master_account_session_revocations r where r.user_id=uid and s.created_at<=r.revoked_before)
  and not exists(select 1 from private.master_identity_session_boundaries b where b.user_id=uid and s.id<>b.survivor_session_id and s.created_at<=b.revoked_before));
$function$;

CREATE OR REPLACE FUNCTION private.master_password_native_session_is_valid()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when not (select enabled from private.app_session_settings where singleton) then true else exists(
 select 1 from private.app_session_activity a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id
 where a.user_id=auth.uid() and a.session_id=(auth.jwt()->>'session_id')::uuid and a.expired_at is null
 and a.last_activity_at<=clock_timestamp() and a.last_activity_at>clock_timestamp()-interval '2 hours'
 ) end;
$function$;

CREATE OR REPLACE FUNCTION public.app_session_is_valid()
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select private.ad_not_deleting(auth.uid()) and private.ad_native_session_valid();
$function$;

CREATE OR REPLACE FUNCTION public.es02_has_branch_capability(p_company_id uuid, p_branch_id uuid, p_capability text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select public.app_session_is_valid() and exists(select 1 from public.companies c join public.company_branches b on b.company_id=c.id
 join public.company_members m on m.company_id=c.id and m.user_id=auth.uid()
 where c.id=p_company_id and c.status in ('setup','active') and b.id=p_branch_id and b.status in ('setup','active') and
 ((m.status='active' and public.has_company_capability(p_company_id,p_capability)) or (m.es02_branch_only and m.status='branch_active' and exists(
 select 1 from private.es02_branch_member_grants g where g.company_id=c.id and g.user_id=m.user_id and g.branch_id=b.id and g.status='active' and p_capability=any(g.capabilities)))))
$function$;

CREATE OR REPLACE FUNCTION public.has_company_capability(p_company_id uuid, p_capability text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$select public.lifecycle_native_has_company_capability(p_company_id,p_capability)
 and case when p_capability like 'wa.conversations.%' then private.billing_chat_access(p_company_id,'whatsapp') and (p_capability='wa.conversations.read' or private.billing_chat_send(p_company_id))
 when p_capability like 'ig.conversations.%' then private.billing_chat_access(p_company_id,'instagram') and (p_capability='ig.conversations.read' or private.billing_chat_send(p_company_id)) else true end$function$;

CREATE OR REPLACE FUNCTION public.lifecycle_native_has_company_capability(p_company_id uuid, p_capability text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := auth.uid();
  cap text := btrim(coalesce(p_capability, ''));
  member_role text;
  member_status text;
  g_caps text[];
  g_status text;
  g_manager uuid;
begin
  if actor is null or p_company_id is null or cap = '' then
    return false;
  end if;
  if not (cap = any (private.access_company_capabilities())) then
    return false;
  end if;

  select m.role, m.status
  into member_role, member_status
  from public.company_members as m
  where m.company_id = p_company_id
    and m.user_id = actor;

  if member_role is null or member_status <> 'active' then
    return false;
  end if;

  if member_role = 'owner' then
    return true;
  end if;

  select g.capabilities, g.status, g.manager_user_id
  into g_caps, g_status, g_manager
  from public.company_member_grants as g
  where g.company_id = p_company_id
    and g.user_id = actor;

  if g_status is distinct from 'active' or g_caps is null or not (cap = any (g_caps)) then
    return false;
  end if;

  -- Independent (owner-issued) when manager_user_id is null.
  if g_manager is null then
    return true;
  end if;

  return private.manager_delegation_covers(g_manager, p_company_id, cap);
end;
$function$;
