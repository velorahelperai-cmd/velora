-- Stable RPCs and GET requests use read-only transactions in PostgREST.
-- Only writable requests may initialize or mark a session expired.
create or replace function public.app_session_pre_request()
returns void language plpgsql security definer set search_path='' as $$
declare checked jsonb;
begin
 if coalesce(auth.jwt()->>'role','') <> 'authenticated' then return;end if;
 if not (select enabled from private.app_session_settings where singleton) then return;end if;
 if current_setting('transaction_read_only')::boolean then
  if not public.app_session_is_valid() then
   raise exception 'APP_SESSION_EXPIRED' using errcode='42501';
  end if;
  return;
 end if;
 checked:=public.check_app_session(false);
 if not coalesce((checked->>'ok')::boolean,false) then
  raise exception 'APP_SESSION_EXPIRED' using errcode='42501';
 end if;
end;$$;
revoke all on function public.app_session_pre_request() from public;
grant execute on function public.app_session_pre_request() to authenticated,service_role,anon;
notify pgrst,'reload schema';
