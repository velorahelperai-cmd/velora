-- Avoid planning proof joins that cannot match a missing subscription field.
-- Payment/session/refund predicates and the fully populated path are unchanged.
begin;
set local lock_timeout='5s';
do $guard$
declare p record;
begin
 select *,pg_get_userbyid(proowner) as owner_name into p from pg_proc where oid='public.billing_read_company_display_evidence(uuid)'::regprocedure;
 if not found or md5(replace(p.prosrc,chr(13),'')) is distinct from 'a9092c08d3b1cfc25d7647a500f8154e'
 or p.owner_name is distinct from 'postgres' or p.prosecdef is distinct from true
 or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
 or p.proconfig is distinct from array['search_path=""']::text[]
 then raise exception 'DASHBOARD_BILLING_GUARD_PREREQUISITE_DRIFT'; end if;
end;$guard$;
CREATE OR REPLACE FUNCTION public.billing_read_company_display_evidence(p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare journey jsonb;usage jsonb;s public.billing_subscriptions%rowtype;paid boolean;current_proof boolean;eligible boolean;bound boolean;
 sid text:=auth.jwt()->>'session_id';
 period timestamptz:=date_trunc('month',statement_timestamp() at time zone 'Asia/Muscat') at time zone 'Asia/Muscat';accepted bigint;held bigint;unperioded bigint;cap jsonb;
begin
 if current_setting('role',true)<>'authenticated' or not private.billing_ui_company_owner(p_company_id) then return jsonb_build_object('ok',false,'code','forbidden');end if;
 if sid is null or sid !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  or not exists(select 1 from auth.users u join auth.sessions ses on ses.user_id=u.id join private.app_session_activity a on a.session_id=ses.id and a.user_id=u.id
   where u.id=auth.uid() and ses.id=sid::uuid and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
   and a.expired_at is null and a.last_activity_at<=statement_timestamp() and a.last_activity_at>statement_timestamp()-interval '2 hours')
 then return jsonb_build_object('ok',false,'code','forbidden');end if;
 select * into s from public.billing_subscriptions where company_id=p_company_id and environment='live';
 paid:=exists(select 1 from private.billing_proven_entitlement_grants g where g.company_id=p_company_id and g.provider_environment='live' and private.billing_service_receipt_eligible(g.id));
 if s.id is null or s.plan_version_id is null or s.paid_through is null then
  current_proof:=false;
  bound:=false;
 else
 current_proof:=exists(select 1 from private.billing_proven_entitlement_grants g where g.company_id=p_company_id and g.subscription_id=s.id and g.plan_version_id=s.plan_version_id and g.applied_paid_through=s.paid_through and g.provider_environment='live' and private.billing_service_receipt_eligible(g.id));
 bound:=exists(select 1 from private.billing_proven_entitlement_grants g join private.billing_service_order_offers so on so.order_id=g.order_id and so.plan_version_id=g.plan_version_id
 join private.billing_service_grants sg on sg.entitlement_application_id=g.id and sg.order_id=g.order_id
 where g.company_id=p_company_id and g.subscription_id=s.id and g.plan_version_id=s.plan_version_id and g.applied_paid_through=s.paid_through
 and g.provider_environment='live' and so.environment='live' and so.service_code='noura' and so.tier in('basic','premium') and so.capabilities=array['noura.knowledge.read']::text[]);
 end if;
 eligible:=current_proof and bound and s.status in('active','cancel_at_period_end') and s.paid_through>statement_timestamp()
 and exists(select 1 from public.companies where id=p_company_id and status='active');
 journey:=jsonb_build_object('subscription',case when s.id is null then null else jsonb_build_object('id',s.id,'company_id',p_company_id,'status',s.status,'cancel_at_period_end',s.cancel_at_period_end,
  'paid_through',case when current_proof then s.paid_through else null end,'plan_version_id',case when current_proof then s.plan_version_id else null end) end);
 -- Job-period counters remain authoritative; standalone receipts require an
 -- actual acceptance observation. Missing dependencies and unknown periods stay unavailable.
 begin
  select count(*) filter(where j.usage_status='accepted'),count(*) filter(where j.usage_status in('reserved','unknown')) into accepted,held
  from public.whatsapp_inbound_jobs j where j.company_id=p_company_id and j.usage_period_start=period;
  -- The observation column is optional on the deployed worker schema.
  -- Never substitute intent creation, attempt or display/retry time for acceptance.
  select accepted+count(*) filter(where i.outcome='accepted'
   and nullif(btrim(i.wa_message_id),'') is not null
   and i.receipt_observed_at>=period and i.receipt_observed_at<=statement_timestamp()),
   held+count(*) filter(where i.outcome in('ready','attempting','unknown')
    and i.created_at>=period and i.created_at<=statement_timestamp()),
   count(*) filter(where i.outcome='accepted' and (
    nullif(btrim(i.wa_message_id),'') is null or i.receipt_observed_at is null
    or i.receipt_observed_at>statement_timestamp() or i.receipt_observed_at<i.created_at))
   into accepted,held,unperioded
  from (
   select intent.*,(to_jsonb(intent)->>'acceptance_observed_at')::timestamptz as receipt_observed_at
   from public.whatsapp_send_intents intent
   where intent.company_id=p_company_id and intent.sender_kind='assistant' and intent.original_job_id is null
  ) i;
  if unperioded>0 then usage:=null;
  else
  select v.limits->'automated_outbound_per_month' into cap from public.billing_plan_versions v where v.id=s.plan_version_id;
  usage:=jsonb_build_object('company_id',p_company_id,'month_start',to_char(period at time zone 'Asia/Muscat','YYYY-MM-DD'),
   'successful_automated_outbound',accepted,'held_outbound_capacity',held,'cap',cap);
  end if;
 exception when undefined_table or undefined_column then usage:=null;end;
 return jsonb_build_object('ok',true,'data',jsonb_build_object('company_id',p_company_id,'environment','live','journey',journey,'usage',usage,
  'billing_paid',paid,'operational_eligible',coalesce(eligible,false),'qualified_paid_through',case when current_proof then s.paid_through else null end));
end;$function$
;
do $postcheck$
declare p record;
begin
 select *,pg_get_userbyid(proowner) as owner_name into p from pg_proc where oid='public.billing_read_company_display_evidence(uuid)'::regprocedure;
 if not found or md5(replace(p.prosrc,chr(13),'')) is distinct from 'ef6979ec7e369ef8cc1fa0a7d7193056'
 or p.owner_name is distinct from 'postgres' or p.prosecdef is distinct from true
 or p.proacl::text is distinct from '{postgres=X/postgres,authenticated=X/postgres}'
 or p.proconfig is distinct from array['search_path=""']::text[]
 then raise exception 'DASHBOARD_BILLING_GUARD_POSTFLIGHT_DRIFT'; end if;
end;$postcheck$;
commit;
