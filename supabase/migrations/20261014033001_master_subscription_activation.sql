-- Local candidate. Inactive by default. Financial settlement/grants stay immutable.
-- Native operational gates must adopt the effective-end and can-operate helpers
-- before enabling this policy; deployment/approved configuration is separate.
begin;
create table private.master_activation_policy(
 singleton boolean primary key default true check(singleton),enabled boolean not null default false,
 enabled_at timestamptz,approval_reference text,
 check(not enabled or(enabled_at is not null and isfinite(enabled_at) and approval_reference is not null and length(btrim(approval_reference))>0))
);
insert into private.master_activation_policy(singleton) values(true);
create table private.master_subscription_activation(
 receipt_id uuid primary key references public.billing_entitlement_applications(id),
 company_id uuid not null references public.companies(id),subscription_id uuid not null references public.billing_subscriptions(id),
 plan_version_id uuid not null references public.billing_plan_versions(id),
 payment_confirmed_at timestamptz not null,entitlement_created_at timestamptz not null,
 activation_deadline timestamptz not null,subscription_started_at timestamptz,expires_at timestamptz,
 receipt_paid_through timestamptz not null,bonus_days integer not null default 0 check(bonus_days in(0,7)),
 legacy_preserved boolean not null default false,last_checked_at timestamptz,start_reason text check(start_reason in('ready','deadline','legacy')),
 check(isfinite(payment_confirmed_at) and isfinite(entitlement_created_at) and isfinite(activation_deadline) and isfinite(receipt_paid_through)),
 check((subscription_started_at is null and expires_at is null and start_reason is null) or(subscription_started_at is not null and isfinite(subscription_started_at) and expires_at is not null and isfinite(expires_at) and start_reason is not null)),
 check(legacy_preserved or expires_at is null or expires_at=subscription_started_at+make_interval(hours=>720+bonus_days*24))
);
create index master_activation_company on private.master_subscription_activation(company_id,entitlement_created_at desc);
create table private.master_activation_bonus_claims(
 user_id uuid primary key references auth.users(id),trusted_phone_sha256 text not null unique check(trusted_phone_sha256~'^[0-9a-f]{64}$'),
 receipt_id uuid not null unique references private.master_subscription_activation(receipt_id),claimed_at timestamptz not null default clock_timestamp()
);
create table private.master_activation_outages(
 receipt_id uuid not null references private.master_subscription_activation(receipt_id),evidence_reference text not null check(length(btrim(evidence_reference)) between 1 and 200),
 source text not null check(source in('velora','meta')),started_at timestamptz not null default clock_timestamp(),ended_at timestamptz,
 primary key(receipt_id,evidence_reference),check(isfinite(started_at) and(ended_at is null or isfinite(ended_at) and ended_at>=started_at))
);
create unique index master_activation_one_open_outage on private.master_activation_outages(receipt_id) where ended_at is null;
-- No seed or browser writer. Approval and the owner's pre-payment acceptance
-- must be attested by the approved checkout integration before two-channel
-- partial activation is enabled. A reference alone is never auto-populated.
create table private.master_activation_partial_disclosures(
 order_id uuid primary key references public.billing_orders(id),approval_reference text not null check(length(btrim(approval_reference))>0),
 accepted_by uuid not null references auth.users(id),accepted_at timestamptz not null check(isfinite(accepted_at))
);
alter table private.master_activation_partial_disclosures enable row level security;
revoke all on private.master_activation_partial_disclosures from public,anon,authenticated,service_role;
alter table private.master_activation_policy enable row level security;
alter table private.master_subscription_activation enable row level security;
alter table private.master_activation_bonus_claims enable row level security;
alter table private.master_activation_outages enable row level security;
revoke all on private.master_activation_policy,private.master_subscription_activation,private.master_activation_bonus_claims,private.master_activation_outages from public,anon,authenticated,service_role;
create function private.master_activation_setup_destroyed(cid uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.companies c where c.id=cid and to_jsonb(c)->>'setup_file_destruction_at' is not null)
$$;
revoke all on function private.master_activation_setup_destroyed(uuid) from public,anon,authenticated,service_role;

-- Native persisted evidence only, bound to the current connection generation.
-- A channel selection/Connected badge/payment alone never proves readiness.
create function private.master_native_activation_channel_ready(cid uuid,ch text) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
 if ch='whatsapp' then return exists(select 1 from public.whatsapp_company_links l
  where l.company_id=cid and l.status='verified' and l.authorization_status='active'
  and(l.authorization_expires_at>clock_timestamp() or l.authorization_expires_at is null and l.authorization_non_expiring)
  and l.inbound_tested_at is not null and l.inbound_tested_at<=clock_timestamp()
  and l.outbound_tested_at is not null and l.outbound_tested_at<=clock_timestamp()
  -- Cloud mode has no native fresh-outbound proof producer yet. Its readiness
  -- remains unavailable until that producer is implemented and verified.
  and l.keep_on_phone and exists(select 1 from public.whatsapp_send_intents i
   join public.whatsapp_messages m on (m.company_id,m.conversation_id,m.id,m.wa_message_id)=(i.company_id,i.conversation_id,i.message_id,i.wa_message_id)
   join public.whatsapp_delivery_statuses s on (s.company_id,s.message_id,s.wa_message_id,s.phone_number_id,s.recipient_wa_id)=(i.company_id,i.message_id,i.wa_message_id,i.phone_number_id,i.recipient_wa_id)
   where i.company_id=cid and i.link_id=l.id and i.link_generation=l.generation and i.phone_number_id=l.provider_phone_number_id
    and i.outcome='accepted' and i.sender_kind='staff' and m.direction='outbound' and m.sender='staff' and m.body=i.body
    and m.delivery_state in('delivered','read') and lower(s.status) in('delivered','read') and s.link_state in('applied','ignored_stale')
    and s.occurred_at=l.outbound_tested_at and i.attempt_started_at<=s.occurred_at+interval '1 second'));end if;
 if ch='instagram' then return exists(select 1 from private.instagram_company_links l
  join private.instagram_company_generations g on g.company_id=l.company_id and g.generation=l.generation and g.bound_account_id=l.account_id
  where l.company_id=cid and l.status='active' and l.authorization_expires_at>clock_timestamp()
  and l.permissions @> array['instagram_business_basic','instagram_business_manage_messages']::text[]
  and exists(select 1 from private.instagram_messages m join private.instagram_inbound_signatures s on s.message_id=m.id and s.raw_body_sha256=m.raw_body_sha256
   where m.company_id=cid and m.link_id=l.id and m.generation=l.generation and m.account_id=l.account_id and m.direction='inbound' and s.verified_at<=clock_timestamp())
  and exists(select 1 from private.instagram_send_intents i where i.company_id=cid and i.link_id=l.id and i.generation=l.generation and i.account_id=l.account_id
   and i.state='accepted' and nullif(btrim(i.provider_mid),'') is not null and i.accepted_at<=clock_timestamp()));end if;
 return false;
end;$$;
create function private.master_activation_ready(cid uuid,pv uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$declare channels text[];slots integer;ch text;begin
 if not exists(select 1 from public.companies where id=cid and status='active') or private.master_activation_setup_destroyed(cid) then return false;end if;
 select channel_count into slots from private.plan_channel_entitlements where plan_version_id=pv;
 select s.channels into channels from private.company_selected_channels s where company_id=cid and plan_version_id=pv;
 if slots is null or channels is null or cardinality(channels)<>slots or not(channels in(array['whatsapp'],array['instagram'],array['whatsapp','instagram'])) then return false;end if;
 if slots=2 and not exists(select 1 from private.billing_proven_entitlement_grants g join public.billing_orders o on o.id=g.order_id and o.company_id=g.company_id
  join public.billing_provider_events e on e.id=g.provider_event_id join private.master_activation_partial_disclosures d on d.order_id=o.id
  where g.company_id=cid and g.plan_version_id=pv and private.master_activation_receipt_current(g.id) and d.accepted_by=o.created_by and d.accepted_at<=e.created_at) then return false;end if;
 foreach ch in array channels loop if private.master_native_activation_channel_ready(cid,ch) then return true;end if;end loop;
 return false;
end;$$;
create function private.master_activation_receipt_current(rid uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from private.billing_proven_entitlement_grants g join public.billing_subscriptions s on s.id=g.subscription_id and s.company_id=g.company_id
  where g.id=rid and g.provider_environment='live' and s.environment='live' and s.status in('active','cancel_at_period_end')
  and s.plan_version_id=g.plan_version_id and s.paid_through=g.applied_paid_through and private.billing_service_receipt_eligible(g.id))
$$;
create function private.master_activation_receipt_state(rid uuid) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare a private.master_subscription_activation%rowtype;paused boolean;ready boolean;deadline timestamptz;begin
 select * into a from private.master_subscription_activation where receipt_id=rid;if not found then return null;end if;
 select started_at into deadline from private.master_activation_outages where receipt_id=rid and ended_at is null;
 paused:=deadline is not null and a.subscription_started_at is null;
 deadline:=a.activation_deadline+case when paused then clock_timestamp()-deadline else interval '0' end;
 ready:=private.master_activation_receipt_current(rid) and private.master_activation_ready(a.company_id,a.plan_version_id)
  and not exists(select 1 from private.master_activation_outages where receipt_id=rid and ended_at is null);
 return jsonb_build_object('companyId',a.company_id,'state',case when a.subscription_started_at is null then 'waiting' when clock_timestamp()>=a.expires_at then 'ended' when a.legacy_preserved then 'legacy' else 'active' end,
 'paymentConfirmedAt',a.payment_confirmed_at,'entitlementCreatedAt',a.entitlement_created_at,'activationDeadline',deadline,
 'subscriptionStartedAt',a.subscription_started_at,'expiresAt',a.expires_at,'operationalReady',ready and a.subscription_started_at is not null and clock_timestamp()<a.expires_at,
 'bonusDays',a.bonus_days,'paused',paused,'legacy',a.legacy_preserved);
end;$$;
create function private.master_activation_effective_end(rid uuid) returns timestamptz language sql volatile security definer set search_path='' as $$
 select case when a.receipt_id is not null then a.expires_at else g.applied_paid_through end
 from private.billing_proven_entitlement_grants g left join private.master_subscription_activation a on a.receipt_id=g.id where g.id=rid
$$;
create function private.master_activation_can_operate(cid uuid) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare a private.master_subscription_activation%rowtype;begin
 if private.master_activation_setup_destroyed(cid) then return false;end if;
 select x.* into a from private.master_subscription_activation x where x.company_id=cid and private.master_activation_receipt_current(x.receipt_id)
 order by x.entitlement_created_at desc,x.receipt_id limit 1;
 if found then
  if a.legacy_preserved then return clock_timestamp()<a.expires_at;end if;
  return coalesce((private.master_activation_receipt_state(a.receipt_id)->>'operationalReady')::boolean,false);
 end if;
 -- Old customers retain their native gates. A new receipt omitted by integration
 -- fails closed once the policy is enabled rather than bypassing its capture.
 return not exists(select 1 from private.billing_proven_entitlement_grants g cross join private.master_activation_policy p
  where g.company_id=cid and g.provider_environment='live' and p.enabled and g.applied_at>=p.enabled_at);
end;$$;
create function private.master_reconcile_activation_locked(cid uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.master_subscription_activation%rowtype;now_at timestamptz;begin
 perform 1 from public.companies where id=cid for update;
 select x.* into a from private.master_subscription_activation x where x.company_id=cid and private.master_activation_receipt_current(x.receipt_id)
 order by x.entitlement_created_at desc,x.receipt_id limit 1 for update;
 if not found then return jsonb_build_object('ok',false,'code','ACTIVATION_UNAVAILABLE');end if;
 now_at:=clock_timestamp();
 update private.master_subscription_activation set last_checked_at=now_at where receipt_id=a.receipt_id;
 if a.subscription_started_at is null and not exists(select 1 from private.master_activation_outages where receipt_id=a.receipt_id and ended_at is null) then
  if now_at>=a.activation_deadline then a.subscription_started_at:=a.activation_deadline;a.start_reason:='deadline';
  elsif private.master_activation_ready(cid,a.plan_version_id) then a.subscription_started_at:=now_at;a.start_reason:='ready';end if;
  if a.subscription_started_at is not null then
   update private.master_subscription_activation set subscription_started_at=a.subscription_started_at,start_reason=a.start_reason,
    expires_at=a.subscription_started_at+make_interval(hours=>720+a.bonus_days*24) where receipt_id=a.receipt_id;
  end if;
 end if;
 return jsonb_build_object('ok',true,'data',private.master_activation_receipt_state(a.receipt_id));
end;$$;
create function public.master_capture_subscription_activation(p_company_id uuid,p_receipt_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare g record;p private.master_activation_policy%rowtype;confirmed timestamptz;actor uuid;phone text;phone_hash text;bonus integer:=0;legacy boolean;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 perform 1 from public.companies where id=p_company_id for update;
 if exists(select 1 from private.master_subscription_activation where receipt_id=p_receipt_id and company_id=p_company_id) then return private.master_reconcile_activation_locked(p_company_id);end if;
 select * into p from private.master_activation_policy where singleton;
 if not p.enabled then return jsonb_build_object('ok',false,'code','ACTIVATION_DISABLED');end if;
 select proof.*,o.created_by,o.purchase_purpose,e.created_at as confirmed_at into g
  from private.billing_proven_entitlement_grants proof join public.billing_orders o on o.id=proof.order_id and o.company_id=proof.company_id
  join public.billing_provider_events e on e.id=proof.provider_event_id
  where proof.id=p_receipt_id and proof.company_id=p_company_id and proof.provider_environment='live' and private.master_activation_receipt_current(proof.id);
 if not found or g.confirmed_at is null or not isfinite(g.confirmed_at) or g.confirmed_at>clock_timestamp() or g.applied_at is null or not isfinite(g.applied_at) or g.applied_at>clock_timestamp() then return jsonb_build_object('ok',false,'code','PAYMENT_PROOF_REQUIRED');end if;
 legacy:=g.applied_at<p.enabled_at;confirmed:=g.confirmed_at;actor:=g.created_by;
 insert into private.master_subscription_activation(receipt_id,company_id,subscription_id,plan_version_id,payment_confirmed_at,entitlement_created_at,activation_deadline,receipt_paid_through,legacy_preserved,subscription_started_at,expires_at,start_reason)
 values(g.id,g.company_id,g.subscription_id,g.plan_version_id,confirmed,g.applied_at,confirmed+interval '336 hours',g.applied_paid_through,legacy,
  case when legacy then g.applied_at end,case when legacy then g.applied_paid_through end,case when legacy then 'legacy' end);
 if not legacy and g.purchase_purpose='initial' then
  select case when u.phone~'^\+[1-9][0-9]{7,14}$' then u.phone when u.phone~'^[1-9][0-9]{7,14}$' then '+'||u.phone end into phone from auth.users u
   where u.id=actor and u.email_confirmed_at is not null and u.phone_confirmed_at is not null and u.deleted_at is null
    and(u.banned_until is null or u.banned_until<=clock_timestamp())
    and exists(select 1 from public.company_members m where m.company_id=p_company_id and m.user_id=u.id and m.role='owner' and m.status='active') for update;
  if phone is not null and not exists(select 1 from private.billing_verified_collection_history h join public.billing_orders o on o.id=h.order_id and o.company_id=h.company_id
   where h.provider_environment='live' and h.id<>g.id and o.created_by=actor) then
   phone_hash:=encode(sha256(convert_to(phone,'UTF8')),'hex');
   insert into private.master_activation_bonus_claims(user_id,trusted_phone_sha256,receipt_id) values(actor,phone_hash,g.id) on conflict do nothing;
   if found then bonus:=7;end if;
  end if;
 end if;
 update private.master_subscription_activation set bonus_days=bonus where receipt_id=g.id;
 return private.master_reconcile_activation_locked(p_company_id);
end;$$;
create function public.master_reconcile_subscription_activation(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 return private.master_reconcile_activation_locked(p_company_id);
end;$$;
create function public.master_read_subscription_activation(p_company_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if not private.billing_ui_company_owner(p_company_id) then raise insufficient_privilege;end if;
 perform 1 from public.companies where id=p_company_id for update;
 perform 1 from public.company_members where company_id=p_company_id and user_id=auth.uid() and role='owner' and status='active' for share;
 if not found then raise insufficient_privilege;end if;
 perform 1 from auth.sessions where id=(auth.jwt()->>'session_id')::uuid and user_id=auth.uid() for share;
 if not found then raise insufficient_privilege;end if;
 if not private.billing_ui_company_owner(p_company_id) then raise insufficient_privilege;end if;
 return private.master_reconcile_activation_locked(p_company_id);
end;$$;
-- Trusted server incident attestation only. No customer supplied timestamps,
-- no inference from incomplete setup, no retrospective deadline revival.
create function public.master_record_activation_outage(p_company_id uuid,p_receipt_id uuid,p_source text,p_evidence_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$declare a private.master_subscription_activation%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 perform 1 from public.companies where id=p_company_id for update;
 select * into a from private.master_subscription_activation where receipt_id=p_receipt_id and company_id=p_company_id for update;
 if not found or not private.master_activation_receipt_current(p_receipt_id) then return jsonb_build_object('ok',false,'code','ACTIVATION_UNAVAILABLE');end if;
 if exists(select 1 from private.master_activation_outages where receipt_id=p_receipt_id and evidence_reference=p_evidence_reference) then return jsonb_build_object('ok',true,'code','REPLAY');end if;
 if a.subscription_started_at is not null or a.activation_deadline<=clock_timestamp() then return jsonb_build_object('ok',false,'code','ACTIVATION_ALREADY_DUE');end if;
 if p_source is null or p_source not in('velora','meta') or p_evidence_reference is null or length(btrim(p_evidence_reference)) not between 1 and 200 then return jsonb_build_object('ok',false,'code','INVALID_EVIDENCE');end if;
 if exists(select 1 from private.master_activation_outages where receipt_id=p_receipt_id and ended_at is null) then return jsonb_build_object('ok',false,'code','OUTAGE_ALREADY_OPEN');end if;
 insert into private.master_activation_outages(receipt_id,evidence_reference,source) values(p_receipt_id,p_evidence_reference,p_source);
 return jsonb_build_object('ok',true,'code','PAUSED');
end;$$;
create function public.master_close_activation_outage(p_company_id uuid,p_receipt_id uuid,p_evidence_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$declare o private.master_activation_outages%rowtype;ended timestamptz;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 perform 1 from public.companies where id=p_company_id for update;
 perform 1 from private.master_subscription_activation where receipt_id=p_receipt_id and company_id=p_company_id for update;
 if not found then return jsonb_build_object('ok',false,'code','ACTIVATION_UNAVAILABLE');end if;
 select * into o from private.master_activation_outages where receipt_id=p_receipt_id and evidence_reference=p_evidence_reference for update;
 if not found then return jsonb_build_object('ok',false,'code','OUTAGE_NOT_FOUND');end if;
 if o.ended_at is null then
  ended:=clock_timestamp();update private.master_activation_outages set ended_at=ended where receipt_id=p_receipt_id and evidence_reference=p_evidence_reference;
  update private.master_subscription_activation set activation_deadline=activation_deadline+(ended-o.started_at) where receipt_id=p_receipt_id and subscription_started_at is null;
 end if;
 return private.master_reconcile_activation_locked(p_company_id);
end;$$;
-- No automatic backfill: capture accepts only current, unambiguous native proof,
-- preserving receipts from before enabled_at without resetting paid dates.
revoke all on function private.master_native_activation_channel_ready(uuid,text),private.master_activation_ready(uuid,uuid),private.master_activation_receipt_current(uuid),private.master_activation_receipt_state(uuid),private.master_activation_effective_end(uuid),private.master_activation_can_operate(uuid),private.master_reconcile_activation_locked(uuid),public.master_capture_subscription_activation(uuid,uuid),public.master_reconcile_subscription_activation(uuid),public.master_read_subscription_activation(uuid),public.master_record_activation_outage(uuid,uuid,text,text),public.master_close_activation_outage(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.master_capture_subscription_activation(uuid,uuid),public.master_reconcile_subscription_activation(uuid),public.master_record_activation_outage(uuid,uuid,text,text),public.master_close_activation_outage(uuid,uuid,text) to service_role;
grant execute on function public.master_read_subscription_activation(uuid) to authenticated;
create function private.master_activation_company_end(cid uuid) returns timestamptz language sql volatile security definer set search_path='' as $$
 select private.master_activation_effective_end(g.id) from private.billing_proven_entitlement_grants g where g.company_id=cid and private.master_activation_receipt_current(g.id) order by g.applied_at desc,g.id desc limit 1
$$;
create function private.master_activation_waiting(cid uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from private.master_subscription_activation a where a.company_id=cid and a.subscription_started_at is null and private.master_activation_receipt_current(a.receipt_id))
$$;
revoke all on function private.master_activation_company_end(uuid),private.master_activation_waiting(uuid) from public,anon,authenticated,service_role;
create function private.master_activation_managed(cid uuid) returns boolean language sql volatile security definer set search_path='' as $$
 select exists(select 1 from private.master_subscription_activation a where a.company_id=cid and not a.legacy_preserved and private.master_activation_receipt_current(a.receipt_id))
$$;
create function private.master_activation_channel_gate(cid uuid,ch text,op text) returns boolean language plpgsql volatile security definer set search_path='' as $$begin
 if private.master_activation_setup_destroyed(cid) then return false;end if;
 if not private.master_activation_managed(cid) then return true;end if;
 return private.channel_operation_allowed(cid,ch,op);
end;$$;
-- Human/setup authorization is separate from AI readiness. The native sender
-- still verifies session, member scope, provider link, signed inbound window,
-- recipient, claim and acceptance. This supplies only its paid deadline.
create function private.master_activation_human_deadline(cid uuid,ch text,rid uuid) returns timestamptz
language plpgsql volatile security definer set search_path='' as $$declare a private.master_subscription_activation%rowtype;deadline timestamptz;incident_at timestamptz;begin
 if private.master_activation_setup_destroyed(cid) then return null;end if;
 if rid is null or not private.master_activation_receipt_current(rid) then return null;end if;
 select * into a from private.master_subscription_activation where company_id=cid and receipt_id=rid;
 if not found or a.legacy_preserved then return private.master_activation_effective_end(rid);end if;
 if ch is null then
  if not exists(select 1 from private.company_selected_channels s,unnest(s.channels) chosen where s.company_id=cid and private.channel_operation_allowed(cid,chosen,'send')) then return null;end if;
 elsif not private.channel_operation_allowed(cid,ch,'send') then return null;end if;
 select started_at into incident_at from private.master_activation_outages where receipt_id=rid and ended_at is null;
 -- Human dispatch reads its paid setup lease. Accepted native outbound evidence
 -- and the bounded worker reconcile readiness; reads need not mutate/recheck it.
 if a.subscription_started_at is null and incident_at is null and clock_timestamp()>=a.activation_deadline then
  perform private.master_reconcile_activation_locked(cid);
  select * into a from private.master_subscription_activation where company_id=cid and receipt_id=rid;
 end if;
 deadline:=a.expires_at;
 if a.subscription_started_at is null then deadline:=a.activation_deadline+case when incident_at is not null then clock_timestamp()-incident_at else interval '0' end;end if;
 return deadline;
end;$$;
revoke all on function private.master_activation_managed(uuid),private.master_activation_channel_gate(uuid,text,text),private.master_activation_human_deadline(uuid,text,uuid) from public,anon,authenticated,service_role;
create function private.master_activation_human_paid_snapshot(cid uuid,ch text) returns jsonb language plpgsql volatile security definer set search_path='' as $$declare g record;deadline timestamptz;begin
 select proof.id,proof.plan_version_id into g from private.billing_proven_entitlement_grants proof where proof.company_id=cid and private.master_activation_receipt_current(proof.id) order by proof.applied_at desc,proof.id desc limit 1;
 if not found then return jsonb_build_object('ok',true,'active',false,'environment','live');end if;
 deadline:=private.master_activation_human_deadline(cid,ch,g.id);
 return jsonb_build_object('ok',true,'active',deadline>clock_timestamp(),'environment','live','plan_version_id',g.plan_version_id,'paid_through',deadline);
end;$$;
revoke all on function private.master_activation_human_paid_snapshot(uuid,text) from public,anon,authenticated,service_role;
create function private.master_activation_blocks_purchase(cid uuid) returns boolean language plpgsql security definer set search_path='' as $$begin
 if not(select enabled from private.master_activation_policy where singleton) then return false;end if;
 perform 1 from public.companies where id=cid for update;
 return private.master_activation_waiting(cid) or coalesce(private.master_activation_company_end(cid)>clock_timestamp(),false);
end;$$;
revoke all on function private.master_activation_blocks_purchase(uuid) from public,anon,authenticated,service_role;
-- The proven financial view is intentionally comprehensive. Repeated setup
-- guards must not recompile its expanded joins with JIT on each nested lookup.
-- This changes query execution only; every immutable proof predicate remains.
do $$declare f record;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public') and p.proname like 'master_%activation%' loop execute format('alter function %s set jit=off',f.oid::regprocedure);end loop;
end;$$;
-- Block BEFORE order/attempt allocation and hosted provider commit. No recurring
-- collection path exists yet; manual initial/renewal cannot bypass this fence.
do $$declare sig text;f regprocedure;d text;anchor text;guard text;begin
 foreach sig in array array[
 'public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)',
 'public.billing_create_test_checkout_order(jsonb,integer)',
 'public.billing_claim_test_checkout(uuid,uuid,uuid)',
 'public.billing_create_live_checkout_order(uuid,uuid,uuid,uuid,text,bigint,bigint,text,integer)',
 'public.billing_claim_live_checkout(uuid,uuid,uuid,uuid,uuid)'
 ] loop
  f:=to_regprocedure(sig);
  if f is null then if sig like '%live_checkout%' then continue;else raise exception 'ACTIVATION_PURCHASE_DEPENDENCY_MISSING: %',sig;end if;end if;
  d:=replace(pg_get_functiondef(f),chr(13),'');
  if sig like '%create_or_reuse_subscription_order%' then anchor:='  -- D3: Atomically verify plan and version publication status and lock catalog row';
  elsif sig like '%create_test_checkout_order%' then anchor:=' perform set_config(''velora.test_omr_units'', p_units_per_omr::text, true);';
  elsif sig like '%claim_test_checkout%' then anchor:=' select * into ord from public.billing_orders';
  elsif sig like '%create_live_checkout_order%' then anchor:=' select revision into r from public.billing_catalog_revision';
  else anchor:=' select * into o from public.billing_orders';end if;
  if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'ACTIVATION_PURCHASE_BODY_UNSUPPORTED: %',sig;end if;
  if sig like '%create_test_checkout_order%' then
   guard:=' if current_setting(''role'',true) is distinct from ''service_role'' then raise insufficient_privilege;end if; if private.master_activation_blocks_purchase((p_input->>''p_company_id'')::uuid) then return jsonb_build_object(''ok'',false,''code'',''SUBSCRIPTION_CYCLE_NOT_ENDED'',''block_new_collection'',true);end if;';
  elsif sig like '%claim_%' then
   guard:=' if current_setting(''role'',true) is distinct from ''service_role'' then raise insufficient_privilege;end if; if private.master_activation_blocks_purchase(p_company_id) then return jsonb_build_object(''kind'',''rejected'',''code'',''SUBSCRIPTION_CYCLE_NOT_ENDED'');end if;';
  else guard:=' if current_setting(''role'',true) is distinct from ''service_role'' then raise insufficient_privilege;end if; if private.master_activation_blocks_purchase(p_company_id) then return jsonb_build_object(''ok'',false,''code'',''SUBSCRIPTION_CYCLE_NOT_ENDED'',''block_new_collection'',true);end if;';end if;
  execute replace(d,anchor,guard||E'\n'||anchor);
 end loop;
end;$$;

-- Checked source anchors preserve financial equality, historical receipts and
-- each native role/session/RBAC/provider check. Unsupported versions abort this
-- entire migration rather than installing a partial operational authority.
do $$declare sig text;f regprocedure;d text;before text;pair text[];begin
 foreach sig in array array[
 'private.billing_lifecycle_receipt(uuid)','private.billing_chat_access(uuid,text)','private.billing_chat_send(uuid)',
 'public.billing_read_company_operational_entitlement(uuid)','public.billing_read_company_journey(uuid)','public.billing_cancel_at_period_end(uuid)',
 'public.billing_activate_service_grant(uuid,boolean)','public.billing_read_service_access(uuid,text)',
 'private.wa_noura_authority(uuid,uuid)','private.instagram_manual_paid(uuid,uuid)',
 'public.billing_run_expiry_company(uuid)','private.billing_cancel_old_expiry(uuid)',
 'private.company_channel_contract(uuid)','public.select_company_channels(uuid,uuid,bigint,text[])','private.channel_operation_allowed(uuid,text,text)'
 ] loop
  f:=to_regprocedure(sig);if f is null then raise exception 'ACTIVATION_NATIVE_DEPENDENCY_MISSING: %',sig;end if;
  d:=replace(pg_get_functiondef(f),chr(13),'');before:=d;
  case sig
  when 'private.billing_lifecycle_receipt(uuid)' then d:=replace(d,'''expiredAt'',g.applied_paid_through','''expiredAt'',private.master_activation_effective_end(g.id)');
  when 'private.billing_chat_access(uuid,text)' then d:=replace(d,'r:=private.billing_lifecycle_receipt(cid);','if not private.master_activation_channel_gate(cid,channel,''read'') then return false;end if; r:=private.billing_lifecycle_receipt(cid);');
  when 'private.billing_chat_send(uuid)' then d:=replace(d,'g.applied_paid_through>statement_timestamp()','private.master_activation_human_deadline(cid,null,g.id)>clock_timestamp()');
  when 'public.billing_read_company_operational_entitlement(uuid)' then
   d:=replace(d,'s.paid_through>statement_timestamp()','private.master_activation_company_end(p_company_id)>clock_timestamp() and private.master_activation_can_operate(p_company_id)');
   d:=replace(d,'case when trusted then s.paid_through else null end','case when trusted then private.master_activation_company_end(p_company_id) else null end');
  when 'public.billing_read_company_journey(uuid)' then
   d:=replace(d,'case when g.id is not null then s.paid_through else null end','case when g.id is not null then private.master_activation_effective_end(g.id) else null end');
   d:=replace(d,'s.paid_through>statement_timestamp()','private.master_activation_effective_end(g.id)>clock_timestamp()');
  when 'public.billing_cancel_at_period_end(uuid)' then d:=replace(d,'s.paid_through<=clock_timestamp()','(not private.master_activation_waiting(p_company_id) and (private.master_activation_company_end(p_company_id) is null or private.master_activation_company_end(p_company_id)<=clock_timestamp()))');
  when 'public.billing_activate_service_grant(uuid,boolean)' then
   -- Native settlement creates/activates the paid SERVICE grant before capture.
   -- This is entitlement, not readiness; actual service reads are gated below.
   d:=replace(d,'g.applied_paid_through>clock_timestamp()','coalesce(private.master_activation_effective_end(g.id),g.applied_paid_through)>clock_timestamp()');
  when 'public.billing_read_service_access(uuid,text)' then
   d:=replace(d,'''expires_at'',g.applied_paid_through','''expires_at'',private.master_activation_effective_end(g.id)');
   d:=replace(d,'g.applied_paid_through>clock_timestamp()','private.master_activation_effective_end(g.id)>clock_timestamp() and private.master_activation_can_operate(p_company_id)');
  when 'private.wa_noura_authority(uuid,uuid)' then
   d:=replace(d,'proof.plan_version_id,proof.applied_paid_through,v.limits','proof.plan_version_id,private.master_activation_effective_end(proof.id) as applied_paid_through,v.limits');
   d:=replace(d,'proof.applied_paid_through>clock_timestamp()','private.master_activation_effective_end(proof.id)>clock_timestamp() and private.master_activation_can_operate(j.company_id)');
   d:=replace(d,' -- Shared established order:', ' if not exists(select 1 from public.whatsapp_inbound_jobs w where w.id=p_job_id and private.master_activation_channel_gate(w.company_id,''whatsapp'',''automate'')) then return jsonb_build_object(''ok'',false,''code'',''CHANNEL_NOT_READY'');end if; -- Shared established order:');
  when 'private.instagram_manual_paid(uuid,uuid)' then
   d:=replace(d,'g private.billing_proven_entitlement_grants%rowtype;begin','g private.billing_proven_entitlement_grants%rowtype;operational_deadline timestamptz;begin');
   d:=replace(d,'if not private.billing_service_receipt_eligible(g.id) or not exists(', 'operational_deadline:=private.master_activation_human_deadline(cid,''instagram'',g.id); if not private.billing_service_receipt_eligible(g.id) or not exists(');
   d:=replace(d,'s.paid_through is null or s.paid_through<=clock_timestamp()','s.paid_through is null');
   d:=replace(d,'or s.paid_through<=clock_timestamp()','or operational_deadline is null or operational_deadline<=clock_timestamp()');
   d:=replace(d,'''entitlement_deadline'',s.paid_through','''entitlement_deadline'',operational_deadline');
  when 'public.billing_run_expiry_company(uuid)' then
   d:=replace(d,'perform private.billing_cancel_old_expiry(p_company_id);','if exists(select 1 from private.master_subscription_activation where company_id=p_company_id) then perform private.master_reconcile_activation_locked(p_company_id);end if; perform private.billing_cancel_old_expiry(p_company_id);');
   d:=replace(d,'expiry:=(r->>''expiredAt'')::timestamptz;','expiry:=(r->>''expiredAt'')::timestamptz; if expiry is null then return jsonb_build_object(''ok'',true,''code'',''AWAITING_ACTIVATION'');end if;');
  when 'private.billing_cancel_old_expiry(uuid)' then d:=replace(d,'expired_at<>(r->>''expiredAt'')::timestamptz','(expired_at<>(r->>''expiredAt'')::timestamptz or r->>''expiredAt'' is null)');
  when 'private.company_channel_contract(uuid)' then
   d:=replace(d,'when expires is null then ''none''','when expires is null then case when private.master_activation_waiting(cid) then ''awaiting_activation'' else ''none'' end');
   d:=replace(d,'''expiresAt'',expires)', '''expiresAt'',expires,''operationalReady'',coalesce(expires>clock_timestamp() and private.master_activation_can_operate(cid),false),''operationalReadyChannels'',case when expires>clock_timestamp() and private.master_activation_can_operate(cid) then (select coalesce(jsonb_agg(chosen),''[]''::jsonb) from unnest(selection.channels) chosen where not private.master_activation_managed(cid) or private.master_native_activation_channel_ready(cid,chosen)) else ''[]''::jsonb end)');
  when 'public.select_company_channels(uuid,uuid,bigint,text[])' then d:=replace(d,'if c->''subscription''->>''expiresAt'' is null or clock_timestamp()>=(c->''subscription''->>''expiresAt'')::timestamptz then','if not private.master_activation_waiting(p_company_id) and (c->''subscription''->>''expiresAt'' is null or clock_timestamp()>=(c->''subscription''->>''expiresAt'')::timestamptz) then');
  when 'private.channel_operation_allowed(uuid,text,text)' then
   if strpos(d,'c:=private.company_channel_contract(cid)')=0 or strpos(d,'and (slots=1 or selected @> ''["whatsapp","instagram"]''::jsonb)')=0 then raise exception 'ACTIVATION_CHANNEL_BODY_UNSUPPORTED';end if;
   -- Authorization must not build the owner UI projection. That projection
   -- includes readiness and repeatedly expands the comprehensive receipt view.
   -- Read the exact native receipt once, then enforce the same approved selection.
   d:=$body$create or replace function private.channel_operation_allowed(cid uuid,ch text,op text) returns boolean language plpgsql volatile security definer set search_path='' set jit=off as $fn$
   declare g record;a private.master_subscription_activation%rowtype;selected text[];slots integer;ends timestamptz;managed boolean;begin
    if ch is null or op is null or ch not in('whatsapp','instagram') or op not in('read','send','connect','automate') or private.master_activation_setup_destroyed(cid) then return false;end if;
    select proof.id,proof.plan_version_id,proof.applied_paid_through into g from private.billing_proven_entitlement_grants proof join public.billing_subscriptions s on s.id=proof.subscription_id and s.company_id=proof.company_id
     where s.company_id=cid and s.environment='live' and proof.provider_environment='live' and s.plan_version_id=proof.plan_version_id and s.paid_through=proof.applied_paid_through
     and private.billing_service_receipt_eligible(proof.id) order by proof.applied_at desc,proof.id desc limit 1;
    if not found then return false;end if;
    select channel_count into slots from private.plan_channel_entitlements where plan_version_id=g.plan_version_id;
    select channels into selected from private.company_selected_channels where company_id=cid and plan_version_id=g.plan_version_id;
    if slots is null or selected is null or cardinality(selected)<>slots or not(selected in(array['whatsapp'],array['instagram'],array['whatsapp','instagram'])) or not(ch=any(selected)) then return false;end if;
    select * into a from private.master_subscription_activation where receipt_id=g.id and company_id=cid;
    managed:=found and not a.legacy_preserved;ends:=case when found then a.expires_at else g.applied_paid_through end;
    if managed and a.subscription_started_at is null then return op in('read','send','connect');end if;
    if op='automate' and managed and (not private.master_activation_can_operate(cid) or not private.master_native_activation_channel_ready(cid,ch)) then return false;end if;
    return ends>clock_timestamp() or op='read' and ends+interval '720 hours'>clock_timestamp();
   end;$fn$;$body$;
  end case;
  if d=before then raise exception 'ACTIVATION_NATIVE_BODY_UNSUPPORTED: %',sig;end if;
  if sig='public.billing_read_company_operational_entitlement(uuid)' and (strpos(d,'private.master_activation_can_operate(p_company_id)')=0 or strpos(d,'case when trusted then private.master_activation_company_end(p_company_id)')=0)
   or sig='private.wa_noura_authority(uuid,uuid)' and (strpos(d,'private.master_activation_effective_end(proof.id) as applied_paid_through')=0 or strpos(d,'private.master_activation_can_operate(j.company_id)')=0 or strpos(d,'s.paid_through=proof.applied_paid_through')=0)
   or sig='private.instagram_manual_paid(uuid,uuid)' and (strpos(d,'''entitlement_deadline'',operational_deadline')=0 or strpos(d,'operational_deadline:=private.master_activation_human_deadline(cid,''instagram'',g.id)')=0 or strpos(d,'or s.paid_through<=clock_timestamp()')>0)
   or sig='public.billing_run_expiry_company(uuid)' and (strpos(d,'private.master_reconcile_activation_locked(p_company_id)')=0 or strpos(d,'''AWAITING_ACTIVATION''')=0)
   then raise exception 'ACTIVATION_NATIVE_ANCHOR_INCOMPLETE: %',sig;end if;
  d:=regexp_replace(d,'\mSTABLE\M','VOLATILE','g');execute d;
  execute format('alter function %s set jit=off',f);
 end loop;
end;$$;

-- Native provider/recipient/session checks remain authoritative. These wrappers
-- add selected-channel fences to human writers and inbound producers; they do
-- not substitute Connected for send/receive evidence or unlock automation.
do $$declare f regprocedure;d text;before text;begin
 f:=to_regprocedure('private.instagram_send_actor(uuid,uuid,uuid)');
 if f is not null then
  d:=replace(pg_get_functiondef(f),chr(13),'');before:=d;
  d:=replace(d,'member:=private.instagram_inbox_member(cid,uid);','if not private.master_activation_channel_gate(cid,''instagram'',''send'') then raise insufficient_privilege;end if; member:=private.instagram_inbox_member(cid,uid);');
  if d=before then raise exception 'ACTIVATION_IG_ACTOR_BODY_UNSUPPORTED';end if;execute d;execute format('alter function %s set jit=off',f);
 end if;
 f:=to_regprocedure('public.instagram_ingest_webhook(jsonb)');
 if f is not null then
  d:=replace(pg_get_functiondef(f),chr(13),'');before:=d;
  d:=replace(d,'valid_link:=found and generation=l.generation','valid_link:=found and generation=l.generation and private.master_activation_channel_gate(l.company_id,''instagram'',''read'')');
  if d=before then raise exception 'ACTIVATION_IG_INGRESS_BODY_UNSUPPORTED';end if;execute d;execute format('alter function %s set jit=off',f);
 end if;
end;$$;

do $$declare f regprocedure;d text;begin
 f:=to_regprocedure('private.whatsapp_meta_asset_binding(text,text)');
 if f is not null then
  alter function private.whatsapp_meta_asset_binding(text,text) rename to master_pre_whatsapp_meta_asset_binding;
  revoke all on function private.master_pre_whatsapp_meta_asset_binding(text,text) from public,anon,authenticated,service_role;
  d:=$body$create function private.whatsapp_meta_asset_binding(p_waba_id text,p_phone_number_id text) returns jsonb language plpgsql security definer set search_path='' as $fn$declare gate jsonb;cid uuid;begin
   gate:=private.master_pre_whatsapp_meta_asset_binding(p_waba_id,p_phone_number_id);
   if gate->>'ok'='true' then
    cid:=(gate->>'company_id')::uuid;
    if cid is not null and not private.master_activation_channel_gate(cid,'whatsapp','read') then return jsonb_build_object('ok',false,'eligible',false,'code','CHANNEL_NOT_SELECTED');end if;
   end if;return gate;
  end;$fn$;$body$;execute d;
  revoke all on function private.whatsapp_meta_asset_binding(text,text) from public,anon,authenticated,service_role;
 end if;
end;$$;

-- Backing WhatsApp profile/cost/staff functions retain their native proof and
-- claim equality. Replace only operational clock checks and returned deadlines.
do $$declare f record;d text;before text;begin
 for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in('private','public') and (p.proname like 'wa_%' or p.proname like '%whatsapp%')
  and (p.prosrc like '%s.paid_through<=clock_timestamp()%' or p.prosrc like '%sub.paid_through<=clock_timestamp()%' or p.prosrc like '%manual_paid_entitlement%' or p.prosrc like '%proof->>''paid_through''%') loop
  d:=replace(pg_get_functiondef(f.oid),chr(13),'');before:=d;
  d:=replace(d,'sub.paid_through<=clock_timestamp()','(not private.master_activation_can_operate(sub.company_id) or private.master_activation_company_end(sub.company_id) is null or private.master_activation_company_end(sub.company_id)<=clock_timestamp())');
  if f.proname='ai_lock_authorized_whatsapp_job' then
   if strpos(d,'(entitlement->>''paid_through'')::timestamptz is distinct from sub.paid_through')=0 then raise exception 'ACTIVATION_MODEL_OPERATIONAL_LEASE_BODY_UNSUPPORTED';end if;
   -- The returned operational lease includes deferred start/earned bonus.
   -- Native financial receipt equality remains on the raw subscription row.
   d:=replace(d,'(entitlement->>''paid_through'')::timestamptz is distinct from sub.paid_through','(entitlement->>''paid_through'')::timestamptz is distinct from private.master_activation_company_end(sub.company_id)');
  end if;
  if f.proname='whatsapp_authorize_staff_dispatch' then
   d:=replace(d,'s.paid_through<=clock_timestamp()','(private.master_activation_human_deadline(s.company_id,''whatsapp'',g.id) is null or private.master_activation_human_deadline(s.company_id,''whatsapp'',g.id)<=clock_timestamp())');
  else d:=replace(d,'s.paid_through<=clock_timestamp()','(private.master_activation_company_end(s.company_id) is null or private.master_activation_company_end(s.company_id)<=clock_timestamp())');end if;
  d:=replace(d,'proof:=public.billing_read_company_operational_entitlement(i.company_id);','proof:=private.master_activation_human_paid_snapshot(i.company_id,''whatsapp'');');
  -- Stored staff claim keeps its original immutable FINANCIAL receipt deadline.
  -- Its returned send lease uses the separately calculated human/setup deadline.
  d:=replace(d,'staff_claim_paid_through=(r->''manual_paid_entitlement''->>''paid_through'')::timestamptz','staff_claim_paid_through=(select s.paid_through from public.billing_subscriptions s where s.company_id=i.company_id and s.environment=''live'')');
  d:=replace(d,'(proof->>''paid_through'')::timestamptz is distinct from s.paid_through','(proof->>''paid_through'')::timestamptz is distinct from private.master_activation_company_end(s.company_id)');
  d:=replace(d,'''paid_through'',s.paid_through','''paid_through'',private.master_activation_company_end(s.company_id)');
  if before<>d then execute d;execute format('alter function %s set jit=off',f.oid::regprocedure);end if;
 end loop;
end;$$;

create or replace function public.billing_expiry_candidates(p_limit integer default 10) returns jsonb language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_limit not between 1 and 50 then raise exception 'INVALID_LIMIT';end if;
 return coalesce((select jsonb_agg(company_id) from(select s.company_id from public.billing_subscriptions s
  left join lateral(select private.master_activation_effective_end(g.id) as effective_end from private.billing_proven_entitlement_grants g where g.company_id=s.company_id and g.subscription_id=s.id and g.provider_environment='live' and g.applied_paid_through=s.paid_through and g.plan_version_id=s.plan_version_id order by g.applied_at desc,g.id desc limit 1) g on true
  left join private.billing_expiry_episodes e on e.company_id=s.company_id and e.expired_at=g.effective_end
  left join lateral(select a.last_checked_at from private.master_subscription_activation a where a.company_id=s.company_id and private.master_activation_receipt_current(a.receipt_id) order by a.entitlement_created_at desc,a.receipt_id desc limit 1)a on true
  where s.environment='live' and (private.master_activation_waiting(s.company_id) or g.effective_end<=clock_timestamp() and isfinite(g.effective_end)) and e.purged_at is null
  order by coalesce(a.last_checked_at,e.last_checked_at,'-infinity'::timestamptz),s.company_id limit p_limit)s),'[]'::jsonb);
end;$$;

-- Preserve original result and financial engine in the SAME transaction. Failed
-- activation capture raises, rolling back financial changes rather than falsely
-- returning paid success without its required authority. Policy-off is inert.
do $$declare name text;backing text;signature regprocedure;definition text;begin
 foreach name in array array['billing_settle_paymob_hmac_verified','billing_settle_live_paymob_hmac_verified'] loop
  signature:=to_regprocedure('public.'||name||'(jsonb)');
  if signature is null then if name='billing_settle_paymob_hmac_verified' then raise exception 'ACTIVATION_SETTLEMENT_MISSING';else continue;end if;end if;
  if not exists(select 1 from pg_proc where oid=signature and prosecdef) then raise exception 'ACTIVATION_SETTLEMENT_BODY_UNSUPPORTED';end if;
  backing:=name||'_pre_master_activation';
  execute format('alter function public.%I(jsonb) set schema private',name);
  execute format('alter function private.%I(jsonb) rename to %I',name,backing);
  execute format('revoke all on function private.%I(jsonb) from public,anon,authenticated,service_role',backing);
  definition:=format($wrapper$create function public.%I(p_evidence jsonb) returns jsonb language plpgsql security definer set search_path='' as $body$
   declare result jsonb;activation jsonb;cid uuid;rid uuid;begin
    if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
    result:=private.%I(p_evidence);
    if result->>'ok'='true' and result->>'outcome' in('granted','idempotent_replay') and (select enabled from private.master_activation_policy where singleton) then
     rid:=(result->>'entitlement_application_id')::uuid;
     if rid is null then raise exception 'ACTIVATION_RECEIPT_MISSING';end if;
     -- The existing engine has already adjudicated this historic transaction.
     -- A newer current cycle must not turn its paid replay into capture failure,
     -- or mutate/regrant current activation, bonus or financial evidence.
     if result->>'outcome'='idempotent_replay' and not private.master_activation_receipt_current(rid) then return result;end if;
     select company_id into cid from private.billing_proven_entitlement_grants where id=rid and provider_environment='live';
     if cid is not null then
      activation:=public.master_capture_subscription_activation(cid,rid);
      if activation->>'ok' is distinct from 'true' then raise exception 'ACTIVATION_CAPTURE_FAILED: %%',activation->>'code';end if;
     elsif not exists(select 1 from private.billing_proven_entitlement_grants where id=rid and provider_environment='test') then
      raise exception 'ACTIVATION_PROVEN_RECEIPT_MISSING';
     end if;
    end if;
    return result;
   end;$body$;$wrapper$,name,backing);execute definition;
  execute format('revoke all on function public.%I(jsonb) from public,anon,authenticated,service_role',name);
  execute format('grant execute on function public.%I(jsonb) to service_role',name);
 end loop;
end;$$;
notify pgrst,'reload schema';
commit;
