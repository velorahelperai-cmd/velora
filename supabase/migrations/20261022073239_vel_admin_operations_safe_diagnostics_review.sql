-- OPS-01 REVIEW ONLY / NOT APPLIED. New permission surface requires exact approval.
-- No change to existing table grants, RLS, provider ingress, payments or worker behavior.
begin;
create function public.admin_read_operations_snapshot(
  p_correlation_id text default null,p_service text default null,p_severity text default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_now timestamptz:=statement_timestamp();
  v_start timestamptz:=v_now-interval '24 hours';
  v_result jsonb;
begin
  if auth.uid() is null
     or not public.app_session_is_valid()
     or not public.is_platform_owner() then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if char_length(coalesce(p_correlation_id,''))>120
    or p_service is not null and p_service not in ('all','billing_paymob','webhook_meta')
    or p_severity is not null and p_severity not in ('all','info','warning','error','critical') then
    raise exception 'invalid_input' using errcode='22023';
  end if;
  -- Only application metadata is selected; no body, raw_summary, provider IDs,
  -- sender/recipient, account IDs, hashes, secrets or arbitrary messages leave SQL.
  -- These stores currently lack native request/trace IDs. Do not invent them.
  with events as materialized (
    select 'paymob'::text as source,e.id,e.company_id,e.received_at as occurred_at,
      'billing_paymob'::text as service,
      case when e.event_status='failed' then 'warning' else 'info' end as severity,
      case when e.event_status='failed' then 'PAYMOB_PROVIDER_REPORTED_FAILURE' else 'PAYMOB_EVENT_RECORDED' end as error_code
    from public.billing_provider_events e where e.received_at>=v_start and e.received_at<=v_now
    union all
    select 'whatsapp',j.id,j.company_id,j.created_at,'webhook_meta','info','WHATSAPP_INBOUND_JOB_RECORDED'
    from public.whatsapp_inbound_jobs j where j.created_at>=v_start and j.created_at<=v_now
    union all
    select 'instagram',r.id,r.company_id,r.received_at,'webhook_meta','info','INSTAGRAM_RECEIPT_RECORDED'
    from private.instagram_webhook_receipts r where r.received_at>=v_start and r.received_at<=v_now
  ), sources as (
    select s.source,count(e.id) as count,max(e.occurred_at) as last_at
    from (values('paymob'),('whatsapp'),('instagram')) s(source)
    left join events e on e.source=s.source group by s.source
  ), selected as (
    select e.* from events e
    where (p_service is null or p_service='all' or e.service=p_service)
      and (p_severity is null or p_severity='all' or e.severity=p_severity)
      and (nullif(btrim(p_correlation_id),'') is null or e.company_id::text=p_correlation_id or e.error_code=p_correlation_id)
    order by e.occurred_at desc,e.id desc limit 100
  )
  select jsonb_build_object('ok',true,'windowStart',v_start,'windowEnd',v_now,
    'traceCoverage','NOT_RECORDED','ingressRatesMeasured',false,
    'sources',(select jsonb_agg(jsonb_build_object('source',source,'count',count,'lastActiveAt',last_at) order by source) from sources),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'companyId',company_id,'service',service,
      'severity',severity,'errorCode',error_code,'message',error_code,'createdAt',occurred_at,
      'traceId','UNKNOWN','requestId','UNKNOWN') order by occurred_at desc,id desc) from selected),'[]'::jsonb)) into v_result;
  return v_result;
end;
$$;
alter function public.admin_read_operations_snapshot(text,text,text) owner to postgres;
revoke all on function public.admin_read_operations_snapshot(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_read_operations_snapshot(text,text,text) to authenticated;
commit;
