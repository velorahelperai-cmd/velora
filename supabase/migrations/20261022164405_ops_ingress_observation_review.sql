-- REVIEW ONLY. No production application or rollout flag authorization implied.
begin;
create table private.ops_ingress_attempt_observations (
  request_id uuid not null,
  trace_id uuid not null,
  source text not null check (source in ('whatsapp','instagram','paymob')),
  stage text not null check (stage in ('started','finished','exception')),
  http_status integer,
  duration_ms integer,
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(request_id,stage),
  check (trace_id=request_id), -- HTTP root only; not a business-event trace binding.
  check ((stage='started' and http_status is null and duration_ms is null)
    or (stage='finished' and http_status is not null and http_status between 100 and 599 and duration_ms is not null and duration_ms>=0)
    or (stage='exception' and http_status is null and duration_ms is not null and duration_ms>=0))
);
alter table private.ops_ingress_attempt_observations enable row level security;
revoke all on private.ops_ingress_attempt_observations from public,anon,authenticated,service_role;
create index ops_ingress_recorded_at on private.ops_ingress_attempt_observations(recorded_at desc);
create function private.ops_ingress_append_only() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'append_only' using errcode='42501'; end $$;
revoke all on function private.ops_ingress_append_only() from public,anon,authenticated,service_role;
create trigger ops_ingress_append_only before update or delete on private.ops_ingress_attempt_observations
for each row execute function private.ops_ingress_append_only();

create function public.ops_record_ingress_attempt(
  p_request_id uuid,p_trace_id uuid,p_source text,p_stage text,p_http_status integer,p_duration_ms integer
) returns boolean language plpgsql security definer set search_path='' as $$
declare prior private.ops_ingress_attempt_observations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_request_id is null or p_trace_id is distinct from p_request_id or p_source is null
     or p_source not in ('whatsapp','instagram','paymob') or p_stage is null or p_stage not in ('started','finished','exception')
     or (p_stage='started' and (p_http_status is not null or p_duration_ms is not null))
     or (p_stage='finished' and (p_http_status is null or p_http_status not between 100 and 599 or p_duration_ms is null or p_duration_ms<0))
     or (p_stage='exception' and (p_http_status is not null or p_duration_ms is null or p_duration_ms<0)) then
    raise exception 'invalid_input' using errcode='22023';
  end if;
  -- Serialize all phases of one attempt, including mutually exclusive terminals.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into prior from private.ops_ingress_attempt_observations where request_id=p_request_id limit 1;
  if found and prior.source is distinct from p_source then raise exception 'binding_conflict' using errcode='22023'; end if;
  if p_stage<>'started' and exists(select 1 from private.ops_ingress_attempt_observations
    where request_id=p_request_id and stage<>'started' and stage<>p_stage) then
    raise exception 'terminal_conflict' using errcode='22023';
  end if;
  insert into private.ops_ingress_attempt_observations(request_id,trace_id,source,stage,http_status,duration_ms)
    values(p_request_id,p_trace_id,p_source,p_stage,p_http_status,p_duration_ms) on conflict do nothing;
  select * into prior from private.ops_ingress_attempt_observations where request_id=p_request_id and stage=p_stage;
  if prior.http_status is distinct from p_http_status or prior.duration_ms is distinct from p_duration_ms then
    raise exception 'observation_conflict' using errcode='22023';
  end if;
  return true;
end $$;

create function public.admin_read_ingress_attempts(p_request_id uuid default null,p_service text default null,p_severity text default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if public.billing_admin_authorized_session() is distinct from true then raise exception 'forbidden' using errcode='42501'; end if;
  if p_service is not null and p_service not in ('all','billing_paymob','webhook_meta')
    or p_severity is not null and p_severity not in ('all','info','warning','error','critical') then
    raise exception 'invalid_input' using errcode='22023';
  end if;
  return jsonb_build_object('version',1,'coverage','PARTIAL','successRate','UNKNOWN',
    'windowStart',statement_timestamp()-interval '24 hours','windowEnd',statement_timestamp(),
    'attempts',coalesce((select jsonb_agg(to_jsonb(q)) from (
      select request_id,trace_id,source,stage,http_status,duration_ms,recorded_at
      from private.ops_ingress_attempt_observations
      where recorded_at>=statement_timestamp()-interval '24 hours' and recorded_at<=statement_timestamp()
      and (p_request_id is null or request_id=p_request_id)
      and (p_service is null or p_service='all' or (p_service='billing_paymob' and source='paymob') or (p_service='webhook_meta' and source in ('whatsapp','instagram')))
      and (p_severity is null or p_severity='all' or p_severity=case when stage='exception' or http_status>=400 then 'warning' else 'info' end)
      order by recorded_at desc,request_id,stage limit 100
    ) q),'[]'::jsonb));
end $$;
alter function public.ops_record_ingress_attempt(uuid,uuid,text,text,integer,integer) owner to postgres;
alter function public.admin_read_ingress_attempts(uuid,text,text) owner to postgres;
revoke all on function public.ops_record_ingress_attempt(uuid,uuid,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.ops_record_ingress_attempt(uuid,uuid,text,text,integer,integer) to service_role;
revoke all on function public.admin_read_ingress_attempts(uuid,text,text) from public,anon,service_role;
grant execute on function public.admin_read_ingress_attempts(uuid,text,text) to authenticated;
commit;
