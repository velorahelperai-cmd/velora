-- VEL-SETUP-REVIEW-02-FIX
-- 1) Owners read review history via RPC only (no direct SELECT on admin_audit_logs).
-- 2) Revoke SETUP-01 column INSERT grants; mutations stay on transition_company_review.

-- ---------------------------------------------------------------------------
-- Owner audit: drop direct SELECT; expose limited RPC
-- ---------------------------------------------------------------------------

drop policy if exists admin_audit_logs_select_review_owner on public.admin_audit_logs;

create or replace function public.list_owner_company_review_events()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cid uuid;
  events jsonb;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  select m.company_id
    into cid
  from public.company_members as m
  join public.companies as c on c.id = m.company_id
  where m.user_id = (select auth.uid())
    and m.role = 'owner'
    and m.status = 'active'
    and c.status <> 'suspended'
  order by m.created_at
  limit 1;

  if cid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'action', al.action,
        'revision', coalesce((al.after_data ->> 'revision')::integer, 0),
        'created_at', al.created_at,
        'owner_note', coalesce(al.after_data ->> 'owner_note', '')
      )
      order by al.created_at desc
    ),
    '[]'::jsonb
  )
    into events
  from public.admin_audit_logs as al
  where al.company_id = cid
    and al.action in (
      'review.submit',
      'review.resubmit',
      'review.request_changes',
      'review.approve'
    );

  return events;
end;
$$;

revoke all on function public.list_owner_company_review_events() from public, anon;
grant execute on function public.list_owner_company_review_events() to authenticated;

comment on function public.list_owner_company_review_events() is
  'Owner-only: four review.* events for their company as action/revision/time/owner_note. No actor or raw admin payloads.';

-- ---------------------------------------------------------------------------
-- company_review_requests: no direct INSERT (column grants + policy)
-- ---------------------------------------------------------------------------

revoke insert (
  company_id,
  requested_by,
  number_ownership,
  whatsapp_number,
  readiness_confirmed
) on table public.company_review_requests from anon, authenticated, public;

revoke insert, update, delete on table public.company_review_requests from anon, authenticated, public;

drop policy if exists company_review_requests_insert on public.company_review_requests;

-- SELECT for owner/admin unchanged; mutations via public.transition_company_review only.
grant select on table public.company_review_requests to authenticated;
