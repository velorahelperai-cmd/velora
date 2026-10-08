-- C2 documents this C1 read-contract dependency: the original no-argument RPC
-- selects the first owned company. Preserve it, add an explicit scoped reader.
-- CLI-created file ordered after the existing future-dated prerequisite chain.
begin;
create function public.list_owner_company_review_events_for_company(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or p_company_id is null then raise exception 'not_authenticated' using errcode='42501';end if;
 if public.app_session_is_valid() is distinct from true or not exists(
  select 1 from private.app_session_activity a join auth.sessions s on s.id=a.session_id and s.user_id=a.user_id
  where a.user_id=auth.uid() and a.session_id::text=auth.jwt()->>'session_id' and a.expired_at is null
  and a.last_activity_at<=clock_timestamp() and a.last_activity_at>clock_timestamp()-interval '2 hours')
 then raise exception 'session_expired' using errcode='42501';end if;
 if not exists(select 1 from auth.users u where u.id=auth.uid() and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null))
 or not exists(select 1 from public.company_members m join public.companies c on c.id=m.company_id
 where m.company_id=p_company_id and m.user_id=auth.uid() and m.role='owner' and m.status='active' and c.status<>'suspended')
 then raise exception 'forbidden' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('action',a.action,
  'revision',coalesce((a.after_data->>'revision')::integer,0),'created_at',a.created_at,
  'owner_note',coalesce(a.after_data->>'owner_note','')) order by a.created_at desc,a.id),'[]'::jsonb)
 from public.admin_audit_logs a where a.company_id=p_company_id
 and a.action in ('review.submit','review.resubmit','review.request_changes','review.approve'));
end;$$;
revoke all on function public.list_owner_company_review_events_for_company(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_owner_company_review_events_for_company(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
