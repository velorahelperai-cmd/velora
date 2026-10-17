-- Restore the missing shared contract before its billing/Instagram consumers.
-- Reuse the established platform-owner + valid app-session gate. No new authority.
begin;
create function public.billing_admin_authorized_session() returns boolean
language sql stable security definer set search_path='' as $$
 select current_setting('role',true)='authenticated'
   and coalesce(private.billing_ui_owner(),false);
$$;
revoke all on function public.billing_admin_authorized_session() from public,anon,authenticated,service_role;
grant execute on function public.billing_admin_authorized_session() to authenticated;
commit;
