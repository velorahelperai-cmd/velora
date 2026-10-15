-- CLI-generated local candidate. No provider calls, mandate/merchant approval,
-- legal policy seeds, or production application. Native finance stays native.
begin;
-- Approval must provide exact reviewable text within the accepted terms version.
-- Empty policy is deliberately UNCONFIGURED for a two-channel charge.
create table private.master_checkout_partial_disclosure_policy(plan_version_id uuid primary key references public.billing_plan_versions(id),terms_version text not null,disclaimer_text text not null check(length(btrim(disclaimer_text))>0),approval_reference text not null check(length(btrim(approval_reference))>0),approved_at timestamptz not null default clock_timestamp());
alter table private.master_checkout_partial_disclosure_policy enable row level security;
revoke all on private.master_checkout_partial_disclosure_policy from public,anon,authenticated,service_role;
create trigger master_checkout_partial_policy_immutable before update or delete on private.master_checkout_partial_disclosure_policy for each row execute function private.master_checkout_immutable();
create trigger master_checkout_partial_policy_no_truncate before truncate on private.master_checkout_partial_disclosure_policy for each statement execute function private.master_checkout_immutable();
create function private.master_checkout_partial_consent() returns trigger language plpgsql security definer set search_path='' set jit=off as $$declare q private.master_checkout_quotes%rowtype;p private.master_checkout_partial_disclosure_policy%rowtype;slots integer;begin
 select * into q from private.master_checkout_quotes where checkout_id=new.checkout_id;
 select channel_count into slots from private.plan_channel_entitlements where plan_version_id=(q.snapshot->>'planVersionId')::uuid;
 if slots=2 then
  select * into p from private.master_checkout_partial_disclosure_policy where plan_version_id=(q.snapshot->>'planVersionId')::uuid and terms_version=new.terms_version and approved_at<=clock_timestamp();
  if p.plan_version_id is null or position(p.disclaimer_text in coalesce(q.snapshot->>'termsText',''))=0 then raise exception 'PARTIAL_SERVICE_DISCLOSURE_UNCONFIGURED';end if;
  insert into private.master_activation_partial_disclosures(order_id,approval_reference,accepted_by,accepted_at) values(q.order_id,p.approval_reference,new.actor_id,clock_timestamp()) on conflict(order_id) do nothing;
 end if;return new;
end;$$;
create trigger master_checkout_partial_consent after insert on private.master_checkout_consents for each row execute function private.master_checkout_partial_consent();
create trigger master_checkout_partial_receipt_immutable before update or delete on private.master_activation_partial_disclosures for each row execute function private.master_checkout_immutable();
create trigger master_checkout_partial_receipt_no_truncate before truncate on private.master_activation_partial_disclosures for each statement execute function private.master_checkout_immutable();
revoke all on function private.master_checkout_partial_consent() from public,anon,authenticated,service_role;
create function private.master_checkout_channel_quote_ready(oid uuid) returns boolean language sql stable security definer set search_path='' set jit=off as $$
 select exists(select 1 from private.master_checkout_quotes q join public.billing_orders o on o.id=q.order_id and o.company_id=q.company_id join private.plan_channel_entitlements mapping on mapping.plan_version_id=o.plan_version_id
 where o.id=oid and mapping.approved_at<=q.quoted_at and mapping.approved_at<=clock_timestamp() and q.snapshot->>'planVersionId'=o.plan_version_id::text
 and q.snapshot->'channelEntitlements'->>'status'='approved' and q.snapshot->'channelEntitlements'->>'channelCount'=mapping.channel_count::text
 and q.snapshot->'channelEntitlements'->>'approvalReference'=mapping.approval_reference)
$$;
revoke all on function private.master_checkout_channel_quote_ready(uuid) from public,anon,authenticated,service_role;
do $$declare d text;anchor text;begin
 d:=pg_get_functiondef('public.master_read_checkout_terms(uuid,uuid,uuid,uuid)'::regprocedure);
 anchor:=' return jsonb_build_object(''ok'',true,''termsVersion''';
 if position(anchor in d)=0 then raise exception 'PARTIAL_SERVICE_TERMS_READ_ANCHOR_REQUIRED';end if;
 execute replace(d,anchor,' if not exists(select 1 from private.plan_channel_entitlements where plan_version_id=p_plan_version_id and approved_at<=clock_timestamp()) then return jsonb_build_object(''ok'',false,''code'',''CHANNEL_ENTITLEMENT_UNCONFIGURED'');end if;'||E'\n'||' if exists(select 1 from private.plan_channel_entitlements where plan_version_id=p_plan_version_id and channel_count=2) and not exists(select 1 from private.master_checkout_partial_disclosure_policy p where p.plan_version_id=p_plan_version_id and p.terms_version=t.terms_version and p.approved_at<=clock_timestamp() and position(p.disclaimer_text in t.terms_text)>0) then return jsonb_build_object(''ok'',false,''code'',''PARTIAL_SERVICE_DISCLOSURE_UNCONFIGURED'');end if;'||E'\n'||anchor);
 d:=pg_get_functiondef('private.master_checkout_pin_quote()'::regprocedure);anchor:=' insert into private.master_checkout_quotes';
 if position(anchor in d)=0 then raise exception 'PARTIAL_SERVICE_QUOTE_ANCHOR_REQUIRED';end if;
 execute replace(d,anchor,' if exists(select 1 from private.plan_channel_entitlements where plan_version_id=new.plan_version_id and channel_count=2) and not exists(select 1 from private.master_checkout_partial_disclosure_policy p where p.plan_version_id=new.plan_version_id and p.terms_version=t.terms_version and p.approved_at<=clock_timestamp() and position(p.disclaimer_text in t.terms_text)>0) then raise exception ''PARTIAL_SERVICE_DISCLOSURE_UNCONFIGURED'';end if;'||E'\n'||anchor);
 if to_regprocedure('public.billing_claim_live_checkout(uuid,uuid,uuid,uuid,uuid)') is not null then
  d:=pg_get_functiondef('public.billing_claim_live_checkout(uuid,uuid,uuid,uuid,uuid)'::regprocedure);anchor:=' if o.id is not null and a.id is not null then';
  if position(anchor in d)=0 then raise exception 'PARTIAL_SERVICE_CLAIM_ANCHOR_REQUIRED';end if;
  execute replace(d,anchor,anchor||E'\n'||' if a.status=''intent_created'' and not exists(select 1 from private.billing_live_checkouts where payment_attempt_id=a.id) and exists(select 1 from public.companies archive_company where archive_company.id=p_company_id and to_jsonb(archive_company)->>''archived_at'' is not null) and not(p_actor_session_id is null and private.master_recurring_actor_allowed(p_company_id,p_actor_id)) then return jsonb_build_object(''kind'',''rejected'',''code'',''FORBIDDEN'');end if;'||E'\n'||' if a.status=''intent_created'' and not exists(select 1 from private.billing_live_checkouts where payment_attempt_id=a.id) and not private.master_checkout_channel_quote_ready(o.id) then return jsonb_build_object(''kind'',''rejected'',''code'',''CHANNEL_ENTITLEMENT_UNCONFIGURED'');end if;'||E'\n'||' if exists(select 1 from private.plan_channel_entitlements where plan_version_id=o.plan_version_id and channel_count=2) and not exists(select 1 from private.master_activation_partial_disclosures where order_id=o.id and accepted_by=p_actor_id) then return jsonb_build_object(''kind'',''rejected'',''code'',''PARTIAL_SERVICE_DISCLOSURE_UNCONFIGURED'');end if;');
 end if;
end;$$;
create table private.master_wallet_legal_terms(terms_version text primary key check(length(btrim(terms_version)) between 1 and 128),terms_text text not null check(length(btrim(terms_text))>0),approval_reference text not null check(length(btrim(approval_reference))>0),approved_at timestamptz not null default clock_timestamp());
create table private.master_wallet_policy(singleton boolean primary key default true check(singleton),terms_version text references private.master_wallet_legal_terms(terms_version));
insert into private.master_wallet_policy(singleton) values(true);
create table private.master_excess_collections(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),order_id uuid not null references public.billing_orders(id),
 original_receipt_id uuid not null references public.billing_entitlement_applications(id),settlement_outcome_id uuid not null unique references public.billing_settlement_outcomes(id),
 provider_event_id uuid not null references public.billing_provider_events(id),provider text not null check(provider='paymob'),provider_account_ref text not null,
 provider_environment text not null check(provider_environment='live'),provider_transaction_id text not null,amount_baisa bigint not null check(amount_baisa>0),currency text not null check(currency='OMR'),
 created_at timestamptz not null default clock_timestamp(),unique(provider,provider_account_ref,provider_environment,provider_transaction_id)
);
create table private.master_wallet_conversion_consents(obligation_id uuid primary key references private.master_excess_collections(id),company_id uuid not null references public.companies(id),actor_id uuid not null references auth.users(id),actor_session_id uuid not null references auth.sessions(id),terms_version text not null references private.master_wallet_legal_terms(terms_version),client_op_id text not null check(length(btrim(client_op_id)) between 1 and 128),accepted_at timestamptz not null default clock_timestamp(),unique(company_id,client_op_id));
create table private.master_wallet_refund_requests(id uuid primary key default gen_random_uuid(),obligation_id uuid not null unique references private.master_excess_collections(id),company_id uuid not null references public.companies(id),actor_id uuid not null references auth.users(id),client_op_id text not null check(length(btrim(client_op_id)) between 1 and 128),requested_at timestamptz not null default clock_timestamp(),unique(company_id,client_op_id));
create table private.master_wallet_accounts(company_id uuid primary key references public.companies(id),frozen_at timestamptz,frozen_reason text);
create table private.master_wallet_ledger(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),delta_baisa bigint not null check(delta_baisa<>0),
 kind text not null check(kind in('conversion','renewal')),obligation_id uuid unique references private.master_excess_collections(id),order_id uuid unique references public.billing_orders(id),
 client_op_id text not null check(length(btrim(client_op_id)) between 1 and 128),created_at timestamptz not null default clock_timestamp(),unique(company_id,client_op_id),
 check((kind='conversion' and delta_baisa>0 and obligation_id is not null and order_id is null) or(kind='renewal' and delta_baisa<0 and order_id is not null and obligation_id is null))
);
create index master_wallet_ledger_company on private.master_wallet_ledger(company_id);

create table private.master_recurring_provider_contracts(id uuid primary key default gen_random_uuid(),provider text not null check(provider='paymob'),provider_account_ref text not null,provider_environment text not null check(provider_environment='live'),verified_recurring_reference text not null check(length(btrim(verified_recurring_reference))>0),verified_mandate_signature_reference text not null check(length(btrim(verified_mandate_signature_reference))>0),approval_reference text not null check(length(btrim(approval_reference))>0),approved_at timestamptz not null default clock_timestamp());
create table private.master_recurring_provider_status(contract_id uuid primary key references private.master_recurring_provider_contracts(id),enabled boolean not null default false);
-- Facts are written only by an approved future provider attestor/operator, not
-- an owner action or an arbitrary service RPC. Existing HMAC checkout proof is
-- mandatory correlation, but does not itself establish a recurring mandate.
create table private.master_recurring_mandates(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),actor_id uuid not null references auth.users(id),contract_id uuid not null references private.master_recurring_provider_contracts(id),source_receipt_id uuid not null references public.billing_entitlement_applications(id),provider_mandate_ref text not null check(length(btrim(provider_mandate_ref)) between 1 and 512),attestation_sha256 text not null check(attestation_sha256~'^[0-9a-f]{64}$'),verified_at timestamptz not null,expires_at timestamptz not null,check(isfinite(verified_at) and isfinite(expires_at) and expires_at>verified_at));
create table private.master_recurring_mandate_revocations(mandate_id uuid primary key references private.master_recurring_mandates(id),evidence_reference text not null check(length(btrim(evidence_reference))>0),revoked_at timestamptz not null default clock_timestamp());
create table private.master_autorenew_agreements(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),actor_id uuid not null references auth.users(id),actor_session_id uuid not null references auth.sessions(id),plan_version_id uuid not null references public.billing_plan_versions(id),amount_baisa bigint not null check(amount_baisa>0),currency text not null check(currency='OMR'),terms_version text not null,terms_snapshot jsonb not null,next_due_at timestamptz not null,accepted_at timestamptz not null default clock_timestamp());
create table private.master_autorenew_preferences(company_id uuid primary key references public.companies(id),agreement_id uuid references private.master_autorenew_agreements(id),requested boolean not null default false,enabled boolean not null default false,mandate_id uuid references private.master_recurring_mandates(id),updated_at timestamptz not null default clock_timestamp(),check(not enabled or requested and agreement_id is not null and mandate_id is not null));
create table private.master_renewal_cycles(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),source_cycle_receipt_id uuid not null references public.billing_entitlement_applications(id),subscription_id uuid not null references public.billing_subscriptions(id),due_at timestamptz not null,paid_receipt_id uuid unique references public.billing_entitlement_applications(id),created_at timestamptz not null default clock_timestamp(),unique(company_id,source_cycle_receipt_id,due_at));
create table private.master_renewal_order_cycles(order_id uuid primary key references public.billing_orders(id),billing_cycle_id uuid not null references private.master_renewal_cycles(id));
create table private.master_renewal_attempts(id uuid primary key default gen_random_uuid(),billing_cycle_id uuid not null references private.master_renewal_cycles(id),company_id uuid not null references public.companies(id),agreement_id uuid not null references private.master_autorenew_agreements(id),ordinal integer not null check(ordinal in(1,2)),due_at timestamptz not null,state text not null default 'prepared' check(state in('prepared','queued','claimed','committed','submitted','unknown','failed','paid','cancelled')),lease_token uuid,lease_expires_at timestamptz,order_id uuid unique references public.billing_orders(id),payment_attempt_id uuid unique references public.billing_payment_attempts(id),committed_at timestamptz,confirmed_failed_at timestamptz,failed_event_id uuid references public.billing_provider_events(id),unique(billing_cycle_id,ordinal));
create table private.master_renewal_notices(id uuid primary key default gen_random_uuid(),billing_cycle_id uuid not null references private.master_renewal_cycles(id),company_id uuid not null references public.companies(id),kind text not null check(kind in('before_charge','failed','retry')),ordinal integer not null check(ordinal in(1,2)),due_at timestamptz not null,detail jsonb not null,state text not null default 'pending' check(state in('pending','dispatching','accepted','unknown','cancelled')),claim_token uuid,provider_receipt text,accepted_at timestamptz,unique(billing_cycle_id,kind,ordinal));
do $$declare name text;begin foreach name in array array['master_wallet_legal_terms','master_wallet_policy','master_excess_collections','master_wallet_conversion_consents','master_wallet_refund_requests','master_wallet_accounts','master_wallet_ledger','master_recurring_provider_contracts','master_recurring_provider_status','master_recurring_mandates','master_recurring_mandate_revocations','master_autorenew_agreements','master_autorenew_preferences','master_renewal_cycles','master_renewal_order_cycles','master_renewal_attempts','master_renewal_notices'] loop
 execute format('alter table private.%I enable row level security',name);execute format('revoke all on private.%I from public,anon,authenticated,service_role',name);
 end loop;
 foreach name in array array['master_wallet_legal_terms','master_excess_collections','master_wallet_conversion_consents','master_wallet_refund_requests','master_wallet_ledger','master_recurring_provider_contracts','master_recurring_mandates','master_recurring_mandate_revocations','master_autorenew_agreements','master_renewal_order_cycles'] loop
 execute format('create trigger %I before update or delete on private.%I for each row execute function private.master_checkout_immutable()',name||'_immutable',name);
 execute format('create trigger %I before truncate on private.%I for each statement execute function private.master_checkout_immutable()',name||'_no_truncate',name);
 end loop;
end;$$;

create function private.master_native_payment_event(eid uuid) returns public.billing_provider_events language plpgsql security definer set search_path='' set jit=off as $$
declare e public.billing_provider_events%rowtype;o public.billing_orders%rowtype;a public.billing_payment_attempts%rowtype;begin
 select * into e from public.billing_provider_events where id=eid;if not found then return null;end if;
 select * into a from public.billing_payment_attempts where id=e.payment_attempt_id and company_id=e.company_id;
 select * into o from public.billing_orders where id=a.order_id and company_id=e.company_id;
 if o.id is null or o.provider_environment<>'live' or o.provider<>'paymob' then return null;end if;
 if not exists(select 1 from private.billing_live_order_bindings binding join private.billing_live_merchant_contracts merchant on merchant.id=binding.contract_id where binding.order_id=o.id and binding.plan_version_id=o.plan_version_id and merchant.integration_id::text=o.provider_account_ref and merchant.merchant_owner_id=e.raw_summary->>'signed_owner' and merchant.currency=o.currency and merchant.deadline_policy_approved and merchant.verified_at<=e.created_at and o.provider_amount::numeric=o.amount_baisa::numeric*merchant.units_per_omr/1000) then return null;end if;
 return private.billing_acceptance_hmac_event(jsonb_build_object('company_id',o.company_id,'order_id',o.id,'payment_attempt_id',a.id,'provider_event_id',e.id,
 'provider',o.provider,'provider_account_ref',o.provider_account_ref,'provider_environment',o.provider_environment,'provider_transaction_id',e.provider_transaction_id,'special_reference',o.special_reference,'currency_expected',o.currency,'amount_baisa',o.amount_baisa,'event_status',e.event_status,'observation_key',e.observation_key,
 'evidence_marker','VEL_PAYMOB_SERVER_HMAC_VERIFIED','authenticity',jsonb_build_object('source','server_adapter_attestation','verified',true,'method','paymob_hmac_sha512')));
end;$$;
create function private.master_capture_excess_collection(outcome_id uuid) returns uuid language plpgsql security definer set search_path='' set jit=off as $$
declare x public.billing_settlement_outcomes%rowtype;g record;e public.billing_provider_events%rowtype;o public.billing_orders%rowtype;saved uuid;begin
 select * into x from public.billing_settlement_outcomes where id=outcome_id and outcome='duplicate_collection_review' and provider_environment='live';if not found then return null;end if;
 perform 1 from public.companies where id=x.company_id for update;
 select * into g from private.billing_verified_collection_history where id=x.entitlement_application_id and company_id=x.company_id and provider_environment='live';
 if not found or g.provider_transaction_id=x.provider_transaction_id then return null;end if;
 if g.order_id<>x.order_id and not exists(select 1 from private.master_renewal_order_cycles original join private.master_renewal_order_cycles extra on extra.billing_cycle_id=original.billing_cycle_id join private.master_renewal_cycles cycle on cycle.id=original.billing_cycle_id and cycle.paid_receipt_id=g.id where original.order_id=g.order_id and extra.order_id=x.order_id and cycle.company_id=x.company_id) then return null;end if;
 select * into o from public.billing_orders where id=x.order_id and company_id=x.company_id;
 e:=private.master_native_payment_event(x.provider_event_id);
 if e.id is null or e.company_id<>x.company_id or e.payment_attempt_id<>x.payment_attempt_id or e.provider_transaction_id<>x.provider_transaction_id or e.provider_account_ref<>x.provider_account_ref
 or x.authenticity_method<>'paymob_hmac_verified' or x.evidence_marker<>'VEL_PAYMOB_SERVER_HMAC_VERIFIED'
 or e.event_status<>'success' or e.raw_summary->'pending'<>'false'::jsonb or e.raw_summary->'success'<>'true'::jsonb or e.raw_summary->'error_occured'<>'false'::jsonb
 or e.raw_summary->'is_auth'<>'false'::jsonb or e.raw_summary->'is_capture'<>'false'::jsonb or e.raw_summary->'is_refunded'<>'false'::jsonb or e.raw_summary->'is_voided'<>'false'::jsonb
 or e.raw_summary->'has_parent_transaction'<>'false'::jsonb or e.raw_summary->'is_standalone_payment'<>'true'::jsonb or e.raw_summary->'amount_cents'<>to_jsonb(o.provider_amount) then return null;end if;
 insert into private.master_excess_collections(company_id,order_id,original_receipt_id,settlement_outcome_id,provider_event_id,provider,provider_account_ref,provider_environment,provider_transaction_id,amount_baisa,currency)
 values(x.company_id,x.order_id,g.id,x.id,e.id,x.provider,x.provider_account_ref,x.provider_environment,x.provider_transaction_id,o.amount_baisa,o.currency)
 on conflict(provider,provider_account_ref,provider_environment,provider_transaction_id) do nothing;
 select id into saved from private.master_excess_collections where provider=x.provider and provider_account_ref=x.provider_account_ref and provider_environment=x.provider_environment and provider_transaction_id=x.provider_transaction_id;
 return saved;
end;$$;
create function private.master_wallet_balance(cid uuid) returns bigint language sql stable security definer set search_path='' as $$select coalesce(sum(delta_baisa),0)::bigint from private.master_wallet_ledger where company_id=cid$$;
create function private.master_wallet_ledger_guard() returns trigger language plpgsql security definer set search_path='' set jit=off as $$declare o public.billing_orders%rowtype;begin
 perform 1 from public.companies where id=new.company_id for update;
 if new.kind='conversion' then
  if not exists(select 1 from private.master_excess_collections x join private.master_wallet_conversion_consents c on c.obligation_id=x.id and c.company_id=x.company_id where x.id=new.obligation_id and x.company_id=new.company_id and x.amount_baisa=new.delta_baisa)
   or exists(select 1 from private.master_wallet_refund_requests where obligation_id=new.obligation_id) then raise exception 'WALLET_SOURCE_CONSENT_REQUIRED';end if;
 else
  select * into o from public.billing_orders where id=new.order_id and company_id=new.company_id;
  if o.id is null or o.purchase_purpose<>'renew' or o.provider<>'wallet' or o.currency<>'OMR' or new.delta_baisa<>-o.amount_baisa then raise exception 'WALLET_RENEWAL_ONLY';end if;
  if exists(select 1 from private.master_wallet_accounts where company_id=new.company_id and frozen_at is not null) then raise exception 'WALLET_REQUIRES_RECONCILIATION';end if;
 end if;
 if private.master_wallet_balance(new.company_id)+new.delta_baisa<0 then raise exception 'WALLET_INSUFFICIENT_BALANCE';end if;
 return new;
end;$$;
create trigger master_wallet_ledger_guard before insert on private.master_wallet_ledger for each row execute function private.master_wallet_ledger_guard();

create function public.master_convert_excess_to_wallet(p_company_id uuid,p_obligation_id uuid,p_actor_id uuid,p_actor_session_id uuid,p_terms_version text,p_accepted boolean,p_client_op_id text) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$declare t private.master_wallet_legal_terms%rowtype;x private.master_excess_collections%rowtype;c private.master_wallet_conversion_consents%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 perform 1 from public.companies archive_company where archive_company.id=p_company_id and archive_company.status in('setup','active') and to_jsonb(archive_company)->>'archived_at' is null for update;if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not private.billing_live_owner(p_company_id,p_actor_id,p_actor_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 select legal.* into t from private.master_wallet_legal_terms legal join private.master_wallet_policy policy on policy.terms_version=legal.terms_version where policy.singleton and legal.approved_at<=clock_timestamp();
 if not found then return jsonb_build_object('ok',false,'code','WALLET_TERMS_UNCONFIGURED');end if;
 if p_accepted is distinct from true then return jsonb_build_object('ok',false,'code','CONSENT_REQUIRED');end if;
 if p_terms_version is distinct from t.terms_version then return jsonb_build_object('ok',false,'code','WALLET_TERMS_CHANGED');end if;
 if p_client_op_id is null or length(btrim(p_client_op_id)) not between 1 and 128 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into x from private.master_excess_collections where id=p_obligation_id and company_id=p_company_id;
 if not found then return jsonb_build_object('ok',false,'code','EXCESS_COLLECTION_UNPROVEN');end if;
 if exists(select 1 from private.master_wallet_refund_requests where obligation_id=x.id) then return jsonb_build_object('ok',false,'code','REFUND_REVIEW_PENDING');end if;
 if private.master_capture_excess_collection(x.settlement_outcome_id) is distinct from x.id then return jsonb_build_object('ok',false,'code','EXCESS_COLLECTION_UNPROVEN');end if;
 select * into c from private.master_wallet_conversion_consents where obligation_id=x.id or(company_id=p_company_id and client_op_id=btrim(p_client_op_id));
 if found then
  if c.obligation_id<>x.id or c.client_op_id<>btrim(p_client_op_id) or c.actor_id<>p_actor_id or c.terms_version<>p_terms_version then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');end if;
 else
  insert into private.master_wallet_conversion_consents values(x.id,p_company_id,p_actor_id,p_actor_session_id,t.terms_version,btrim(p_client_op_id),clock_timestamp());
  insert into private.master_wallet_ledger(company_id,delta_baisa,kind,obligation_id,client_op_id) values(p_company_id,x.amount_baisa,'conversion',x.id,'convert:'||x.id);
 end if;
 return jsonb_build_object('ok',true,'balanceBaisa',private.master_wallet_balance(p_company_id),'currency','OMR','use','subscription_renewal_only','refundRightsPreserved',true);
end;$$;
create function public.master_request_excess_refund(p_company_id uuid,p_obligation_id uuid,p_actor_id uuid,p_actor_session_id uuid,p_client_op_id text) returns jsonb language plpgsql security definer set search_path='' as $$declare x private.master_excess_collections%rowtype;r private.master_wallet_refund_requests%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 perform 1 from public.companies where id=p_company_id for update;
 if not private.billing_live_owner(p_company_id,p_actor_id,p_actor_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_client_op_id is null or length(btrim(p_client_op_id)) not between 1 and 128 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into x from private.master_excess_collections where id=p_obligation_id and company_id=p_company_id;if not found then return jsonb_build_object('ok',false,'code','EXCESS_COLLECTION_UNPROVEN');end if;
 select * into r from private.master_wallet_refund_requests where obligation_id=x.id or(company_id=p_company_id and client_op_id=btrim(p_client_op_id));
 if found and(r.obligation_id<>x.id or r.actor_id<>p_actor_id or r.client_op_id<>btrim(p_client_op_id)) then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');end if;
 insert into private.master_wallet_refund_requests(obligation_id,company_id,actor_id,client_op_id) values(x.id,p_company_id,p_actor_id,btrim(p_client_op_id)) on conflict(obligation_id) do nothing;
 if exists(select 1 from private.master_wallet_conversion_consents where obligation_id=x.id) then insert into private.master_wallet_accounts values(p_company_id,clock_timestamp(),'converted_source_refund_requested') on conflict(company_id) do update set frozen_at=coalesce(private.master_wallet_accounts.frozen_at,excluded.frozen_at),frozen_reason=excluded.frozen_reason;end if;
 return jsonb_build_object('ok',true,'status','REFUND_REVIEW_REQUIRED','providerRefundExecuted',false,'refundRightsPreserved',true);
end;$$;
create function private.master_renewal_source(cid uuid) returns jsonb language plpgsql security definer set search_path='' set jit=off as $$declare s public.billing_subscriptions%rowtype;g record;canonical uuid;starts timestamptz;ends timestamptz;rows_count integer;begin
 select * into s from public.billing_subscriptions where company_id=cid and environment='live';if not found then return null;end if;
 select * into g from private.billing_proven_entitlement_grants where company_id=cid and subscription_id=s.id and plan_version_id=s.plan_version_id and applied_paid_through=s.paid_through and provider_environment='live' order by applied_at desc,id desc limit 1;
 if not found or not private.billing_service_receipt_eligible(g.id) then return null;end if;
 select b.cycle_receipt_id into canonical from private.master_checkout_upgrades b where b.order_id=g.order_id and b.company_id=cid;canonical:=coalesce(canonical,g.id);
 if not private.billing_service_receipt_eligible(canonical) then return null;end if;
 select subscription_started_at,expires_at into starts,ends from private.master_subscription_activation where receipt_id=canonical and company_id=cid;
 get diagnostics rows_count=row_count;
 if rows_count>0 and starts is null then return jsonb_build_object('state','waiting');end if;
 if rows_count=0 then
  if exists(select 1 from private.master_activation_policy where enabled and g.applied_at>=enabled_at) then return null;end if;
  starts:=g.applied_at;ends:=g.applied_paid_through;
 end if;
 return jsonb_build_object('state','ready','companyId',cid,'subscriptionId',s.id,'cycleReceiptId',canonical,'planVersionId',s.plan_version_id,'dueAt',ends,'startsAt',starts,'receiptId',g.id);
end;$$;
create function private.master_ensure_renewal_cycle(cid uuid) returns uuid language plpgsql security definer set search_path='' set jit=off as $$declare source jsonb;saved uuid;begin
 source:=private.master_renewal_source(cid);if source->>'state' is distinct from 'ready' then return null;end if;
 insert into private.master_renewal_cycles(company_id,source_cycle_receipt_id,subscription_id,due_at) values(cid,(source->>'cycleReceiptId')::uuid,(source->>'subscriptionId')::uuid,(source->>'dueAt')::timestamptz) on conflict(company_id,source_cycle_receipt_id,due_at) do nothing;
 select id into saved from private.master_renewal_cycles where company_id=cid and source_cycle_receipt_id=(source->>'cycleReceiptId')::uuid and due_at=(source->>'dueAt')::timestamptz;return saved;
end;$$;
create function private.master_bind_renewal_order() returns trigger language plpgsql security definer set search_path='' set jit=off as $$declare cycle uuid;begin
 if new.purchase_purpose not in('initial','renew') or new.provider_environment<>'live' then return new;end if;
 if new.purchase_purpose='initial' then
  if private.master_renewal_source(new.company_id)->>'state' is distinct from 'ready' or(private.master_renewal_source(new.company_id)->>'dueAt')::timestamptz>clock_timestamp() then return new;end if;
 end if;
 cycle:=private.master_ensure_renewal_cycle(new.company_id);if cycle is null then raise exception 'RENEWAL_CYCLE_PROOF_REQUIRED';end if;
 insert into private.master_renewal_order_cycles values(new.id,cycle);return new;
end;$$;
create function public.master_record_recurring_submission(p_attempt_id uuid,p_lease_token uuid,p_provider_order_id text,p_provider_intention_id text) returns boolean language plpgsql security definer set search_path='' as $$declare j private.master_renewal_attempts%rowtype;a public.billing_payment_attempts%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_provider_order_id is null or p_provider_order_id!~'^[1-9][0-9]{0,15}$' or p_provider_order_id::numeric>9007199254740991 or length(coalesce(p_provider_intention_id,''))>512 then return false;end if;
 select * into j from private.master_renewal_attempts where id=p_attempt_id and lease_token=p_lease_token and committed_at is not null;if not found then return false;end if;
 perform 1 from public.companies where id=j.company_id for update;
 select * into j from private.master_renewal_attempts where id=p_attempt_id and lease_token=p_lease_token for update;
 select * into a from public.billing_payment_attempts where id=j.payment_attempt_id and order_id=j.order_id and company_id=j.company_id for update;
 if j.state='submitted' then return a.provider_order_id=p_provider_order_id and a.provider_intention_id is not distinct from p_provider_intention_id;end if;
 if j.state not in('committed','unknown') or a.status<>'unresolved' or a.provider_order_id is not null then return false;end if;
 update public.billing_payment_attempts set provider_order_id=p_provider_order_id,provider_intention_id=p_provider_intention_id,status='provider_submitted',updated_at=clock_timestamp() where id=a.id;
 update public.billing_orders set status='submitted' where id=j.order_id and status='locked';
 update private.master_renewal_attempts set state='submitted' where id=j.id;return true;
end;$$;
create function public.master_record_recurring_unknown(p_attempt_id uuid,p_lease_token uuid) returns boolean language plpgsql security definer set search_path='' as $$declare cid uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select company_id into cid from private.master_renewal_attempts where id=p_attempt_id and lease_token=p_lease_token and committed_at is not null;if not found then return false;end if;
 perform 1 from public.companies where id=cid for update;
 update private.master_renewal_attempts set state='unknown' where id=p_attempt_id and lease_token=p_lease_token and state in('committed','submitted','unknown');return found;
end;$$;
create function public.master_record_recurring_failure(p_attempt_id uuid,p_provider_event_id uuid) returns jsonb language plpgsql security definer set search_path='' set jit=off as $$
declare j private.master_renewal_attempts%rowtype;e public.billing_provider_events%rowtype;o public.billing_orders%rowtype;confirmed jsonb;failed_time timestamptz;retry_allowed boolean;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into j from private.master_renewal_attempts where id=p_attempt_id;if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.companies where id=j.company_id for update;
 select * into j from private.master_renewal_attempts where id=p_attempt_id for update;
 e:=private.master_native_payment_event(p_provider_event_id);
 if e.id is null or e.payment_attempt_id is distinct from j.payment_attempt_id or e.company_id<>j.company_id or e.event_status<>'failed' or e.raw_summary->'pending'<>'false'::jsonb or e.raw_summary->'success'<>'false'::jsonb then return jsonb_build_object('ok',false,'code','CONFIRMED_FAILURE_PROOF_REQUIRED');end if;
 if exists(select 1 from private.master_renewal_cycles where id=j.billing_cycle_id and paid_receipt_id is not null) then return jsonb_build_object('ok',false,'code','CYCLE_ALREADY_PAID');end if;
 if j.state='failed' then return jsonb_build_object('ok',true,'retryScheduled',exists(select 1 from private.master_renewal_attempts where billing_cycle_id=j.billing_cycle_id and ordinal=2 and state='queued'),'manualRenewalRequired',j.ordinal=2);end if;
 if j.state not in('committed','submitted','unknown') then return jsonb_build_object('ok',false,'code','RENEWAL_ATTEMPT_NOT_COMMITTED');end if;
 confirmed:=public.billing_confirm_payment_attempt_failed(j.payment_attempt_id,j.company_id,jsonb_build_object('provider_event_id',e.id,'provider_transaction_id',e.provider_transaction_id,'observation_key',e.observation_key));
 if confirmed->>'ok' is distinct from 'true' then raise exception 'NATIVE_FAILURE_CONFIRMATION_REQUIRED';end if;
 failed_time:=clock_timestamp();update private.master_renewal_attempts set state='failed',confirmed_failed_at=failed_time,failed_event_id=e.id where id=j.id;
 -- Never reuse/extend the expired original quote for the day-later retry. A
 -- reconciled failure closes that collection; ordinal2 receives a fresh native
 -- quote for the same billing cycle, at the same approved price/currency.
 update public.billing_orders set status='cancelled' where id=j.order_id and status in('locked','submitted');
 insert into private.master_renewal_notices(billing_cycle_id,company_id,kind,ordinal,due_at,detail) values(j.billing_cycle_id,j.company_id,'failed',j.ordinal,failed_time,jsonb_build_object('paymentAttemptId',j.payment_attempt_id,'confirmedFailure',true,'manualRenewalRequired',j.ordinal=2)) on conflict do nothing;
 select exists(select 1 from private.master_autorenew_preferences where company_id=j.company_id and requested and enabled and agreement_id=j.agreement_id) into retry_allowed;
 if j.ordinal=1 then
  insert into private.master_renewal_attempts(billing_cycle_id,company_id,agreement_id,ordinal,due_at,state) values(j.billing_cycle_id,j.company_id,j.agreement_id,2,failed_time+interval '24 hours',case when retry_allowed then 'queued' else 'cancelled' end) on conflict do nothing;
  insert into private.master_renewal_notices(billing_cycle_id,company_id,kind,ordinal,due_at,detail) values(j.billing_cycle_id,j.company_id,'retry',2,failed_time,jsonb_build_object('retryDueAt',failed_time+interval '24 hours','managePath','/app/subscription')) on conflict do nothing;
 end if;
 return jsonb_build_object('ok',true,'retryScheduled',j.ordinal=1 and retry_allowed,'manualRenewalRequired',j.ordinal=2 or not retry_allowed);
end;$$;
create function public.master_claim_renewal_notice() returns jsonb language plpgsql security definer set search_path='' as $$declare n private.master_renewal_notices%rowtype;cid uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select notice.id,notice.company_id into n.id,cid from private.master_renewal_notices notice join private.master_autorenew_preferences pref on pref.company_id=notice.company_id and pref.enabled and pref.requested
 join private.master_renewal_cycles cycle on cycle.id=notice.billing_cycle_id and cycle.paid_receipt_id is null where notice.state='pending' and notice.due_at<=clock_timestamp() order by notice.due_at,notice.id limit 1;if not found then return null;end if;
 perform 1 from public.companies where id=cid for update;
 update private.master_renewal_notices notice set state='dispatching',claim_token=gen_random_uuid() where id=n.id and state='pending' and exists(select 1 from private.master_autorenew_preferences where company_id=cid and enabled and requested) and not exists(select 1 from private.master_renewal_cycles where id=notice.billing_cycle_id and paid_receipt_id is not null) returning * into n;
 if not found then return null;end if;
 return jsonb_build_object('id',n.id,'claimToken',n.claim_token,'companyId',n.company_id,'kind',n.kind,'scheduledAt',n.due_at,'detail',n.detail);
end;$$;
create function public.master_finish_renewal_notice(p_notice_id uuid,p_claim_token uuid,p_outcome text,p_provider_receipt text) returns boolean language plpgsql security definer set search_path='' as $$declare cid uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_outcome not in('accepted','unknown') or(p_outcome='accepted' and coalesce(length(btrim(p_provider_receipt)),0) not between 1 and 512) then return false;end if;
 select company_id into cid from private.master_renewal_notices where id=p_notice_id and claim_token=p_claim_token;if not found then return false;end if;
 perform 1 from public.companies where id=cid for update;
 update private.master_renewal_notices set state=p_outcome,provider_receipt=p_provider_receipt,accepted_at=case when p_outcome='accepted' then clock_timestamp() end where id=p_notice_id and claim_token=p_claim_token and state='dispatching';return found;
end;$$;

create function private.master_sync_auto_renew_locked(cid uuid) returns void language plpgsql security definer set search_path='' set jit=off as $$
declare source jsonb;pref private.master_autorenew_preferences%rowtype;a private.master_autorenew_agreements%rowtype;cycle uuid;begin
 select * into pref from private.master_autorenew_preferences where company_id=cid and enabled and requested;if not found then return;end if;
 select * into a from private.master_autorenew_agreements where id=pref.agreement_id;
 source:=private.master_renewal_source(cid);if source->>'state' is distinct from 'ready' then return;end if;
 if source->>'planVersionId'<>a.plan_version_id::text or not private.master_mandate_ready(cid,a.actor_id,pref.mandate_id) then update private.master_autorenew_preferences set enabled=false,updated_at=clock_timestamp() where company_id=cid;return;end if;
 cycle:=private.master_ensure_renewal_cycle(cid);
 insert into private.master_renewal_attempts(billing_cycle_id,company_id,agreement_id,ordinal,due_at,state) values(cycle,cid,a.id,1,(source->>'dueAt')::timestamptz,'queued') on conflict do nothing;
 insert into private.master_renewal_notices(billing_cycle_id,company_id,kind,ordinal,due_at,detail) values(cycle,cid,'before_charge',1,(source->>'dueAt')::timestamptz-interval '24 hours',jsonb_build_object('planVersionId',a.plan_version_id,'amountBaisa',a.amount_baisa,'currency',a.currency,'chargeDueAt',source->>'dueAt','managePath','/app/subscription','termsVersion',a.terms_version)) on conflict do nothing;
end;$$;
create function public.master_read_renewal_wallet(p_company_id uuid,p_actor_id uuid,p_actor_session_id uuid) returns jsonb language plpgsql security definer set search_path='' set jit=off as $$declare source jsonb;pref private.master_autorenew_preferences%rowtype;a private.master_autorenew_agreements%rowtype;legal private.master_wallet_legal_terms%rowtype;checkout private.master_checkout_terms%rowtype;amount bigint;obligations jsonb;frozen boolean;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.billing_live_owner(p_company_id,p_actor_id,p_actor_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 source:=private.master_renewal_source(p_company_id);select * into pref from private.master_autorenew_preferences where company_id=p_company_id;select * into a from private.master_autorenew_agreements where id=pref.agreement_id;
 select t.* into legal from private.master_wallet_legal_terms t join private.master_wallet_policy policy on policy.terms_version=t.terms_version where singleton and t.approved_at<=clock_timestamp();
 select * into checkout from private.master_checkout_terms where plan_version_id=(source->>'planVersionId')::uuid and approved_at<=clock_timestamp();select amount_baisa into amount from public.billing_plan_versions where id=(source->>'planVersionId')::uuid;
 select exists(select 1 from private.master_wallet_accounts where company_id=p_company_id and frozen_at is not null) into frozen;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'amountBaisa',x.amount_baisa,'currency',x.currency,'state',case when refund.obligation_id is not null then 'REFUND_REVIEW_REQUIRED' when consent.obligation_id is not null then 'converted' else 'conversion_or_refund_choice' end,'canConvert',consent.obligation_id is null and refund.obligation_id is null and legal.terms_version is not null and not private.master_excess_reversed(x.id),'refundRightsPreserved',true) order by x.created_at),'[]'::jsonb) into obligations from private.master_excess_collections x left join private.master_wallet_conversion_consents consent on consent.obligation_id=x.id left join private.master_wallet_refund_requests refund on refund.obligation_id=x.id where x.company_id=p_company_id;
 return jsonb_build_object('ok',true,'companyId',p_company_id,'wallet',jsonb_build_object('balanceBaisa',private.master_wallet_balance(p_company_id),'currency','OMR','frozen',frozen,'use','subscription_renewal_only'),
 'walletTerms',case when legal.terms_version is null then null else jsonb_build_object('version',legal.terms_version,'text',legal.terms_text) end,'excessCollections',obligations,
 'autoRenew',jsonb_build_object('enabled',coalesce(pref.enabled,false),'requested',coalesce(pref.requested,false),'status',case when not coalesce(pref.requested,false) then 'off' when not coalesce(pref.enabled,false) then 'UNCONFIGURED' else 'ready' end,'planVersionId',source->>'planVersionId','amountBaisa',amount,'currency','OMR','nextDueAt',source->>'dueAt','termsVersion',checkout.terms_version,'termsText',checkout.terms_text));
end;$$;
create trigger master_bind_renewal_order after insert on public.billing_orders for each row execute function private.master_bind_renewal_order();
create function private.master_mandate_ready(cid uuid,actor uuid,mid uuid) returns boolean language plpgsql security definer set search_path='' set jit=off as $$declare m private.master_recurring_mandates%rowtype;c private.master_recurring_provider_contracts%rowtype;g record;begin
 select * into m from private.master_recurring_mandates where id=mid and company_id=cid and actor_id=actor and verified_at<=clock_timestamp() and expires_at>clock_timestamp();if not found then return false;end if;
 if exists(select 1 from private.master_recurring_mandate_revocations where mandate_id=m.id) then return false;end if;
 select contract.* into c from private.master_recurring_provider_contracts contract join private.master_recurring_provider_status status on status.contract_id=contract.id and status.enabled where contract.id=m.contract_id and contract.approved_at<=clock_timestamp();if not found then return false;end if;
 select proof.*,o.created_by into g from private.billing_verified_collection_history proof join public.billing_orders o on o.id=proof.order_id and o.company_id=proof.company_id where proof.id=m.source_receipt_id and proof.company_id=cid and proof.provider='paymob' and proof.provider_environment='live' and proof.provider_account_ref=c.provider_account_ref and o.created_by=actor;
 return found and m.verified_at>=g.applied_at and (private.master_native_payment_event(g.provider_event_id)).id is not null and exists(select 1 from public.company_members where company_id=cid and user_id=actor and role='owner' and status='active');
end;$$;
create function public.master_set_auto_renew(p_company_id uuid,p_actor_id uuid,p_actor_session_id uuid,p_enabled boolean,p_terms_version text,p_accepted boolean,p_expected_plan_version_id uuid default null,p_expected_amount_baisa bigint default null,p_expected_currency text default null,p_expected_due_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' set jit=off as $$
declare source jsonb;pv public.billing_plan_versions%rowtype;t private.master_checkout_terms%rowtype;agreement uuid;cycle uuid;mandate uuid;ready boolean;reconcile boolean;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 perform 1 from public.companies where id=p_company_id for update;
 if not private.billing_live_owner(p_company_id,p_actor_id,p_actor_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_enabled is distinct from true then
  insert into private.master_autorenew_preferences(company_id) values(p_company_id) on conflict(company_id) do nothing;
  update private.master_autorenew_preferences set requested=false,enabled=false,updated_at=clock_timestamp() where company_id=p_company_id;
  update private.master_renewal_attempts set state='cancelled' where company_id=p_company_id and state in('prepared','queued','claimed');
  update private.master_renewal_notices set state='cancelled' where company_id=p_company_id and state='pending';
  update public.billing_subscriptions set cancel_at_period_end=true where company_id=p_company_id and environment='live';
  select exists(select 1 from private.master_renewal_attempts where company_id=p_company_id and state in('committed','submitted','unknown')) into reconcile;
  return jsonb_build_object('ok',true,'enabled',false,'requiresReconciliation',reconcile,'currentServicePreserved',true);
 end if;
 if not exists(select 1 from public.companies archive_company where archive_company.id=p_company_id and archive_company.status in('setup','active') and to_jsonb(archive_company)->>'archived_at' is null) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_accepted is distinct from true then return jsonb_build_object('ok',false,'code','CONSENT_REQUIRED');end if;
 source:=private.master_renewal_source(p_company_id);if source->>'state' is distinct from 'ready' or(source->>'dueAt')::timestamptz<=clock_timestamp() then return jsonb_build_object('ok',false,'code','ACTIVE_CYCLE_REQUIRED');end if;
 select * into pv from public.billing_plan_versions where id=(source->>'planVersionId')::uuid and status='published' and currency='OMR' for share;if not found then return jsonb_build_object('ok',false,'code','PLAN_NOT_PUBLISHED');end if;
 if p_expected_plan_version_id is distinct from pv.id or p_expected_amount_baisa is distinct from pv.amount_baisa or p_expected_currency is distinct from pv.currency or p_expected_due_at is distinct from(source->>'dueAt')::timestamptz then return jsonb_build_object('ok',false,'code','AUTORENEW_CONSENT_SNAPSHOT_CHANGED');end if;
 select * into t from private.master_checkout_terms where plan_version_id=pv.id and approved_at<=clock_timestamp();if not found then return jsonb_build_object('ok',false,'code','CHECKOUT_TERMS_UNCONFIGURED');end if;
 if p_terms_version is distinct from t.terms_version then return jsonb_build_object('ok',false,'code','CHECKOUT_TERMS_CHANGED');end if;
 insert into private.master_autorenew_agreements(company_id,actor_id,actor_session_id,plan_version_id,amount_baisa,currency,terms_version,terms_snapshot,next_due_at)
 values(p_company_id,p_actor_id,p_actor_session_id,pv.id,pv.amount_baisa,pv.currency,t.terms_version,to_jsonb(t),(source->>'dueAt')::timestamptz) returning id into agreement;
 select id into mandate from private.master_recurring_mandates m where m.company_id=p_company_id and m.actor_id=p_actor_id and private.master_mandate_ready(p_company_id,p_actor_id,m.id) order by verified_at desc,id desc limit 1;
 ready:=mandate is not null;
 insert into private.master_autorenew_preferences(company_id,agreement_id,requested,enabled,mandate_id) values(p_company_id,agreement,true,ready,mandate)
 on conflict(company_id) do update set agreement_id=excluded.agreement_id,requested=true,enabled=excluded.enabled,mandate_id=excluded.mandate_id,updated_at=clock_timestamp();
 cycle:=private.master_ensure_renewal_cycle(p_company_id);
 insert into private.master_renewal_attempts(billing_cycle_id,company_id,agreement_id,ordinal,due_at,state) values(cycle,p_company_id,agreement,1,(source->>'dueAt')::timestamptz,case when ready then 'queued' else 'prepared' end)
 on conflict(billing_cycle_id,ordinal) do update set agreement_id=excluded.agreement_id,state=excluded.state where private.master_renewal_attempts.state in('prepared','queued','cancelled') and private.master_renewal_attempts.order_id is null and private.master_renewal_attempts.committed_at is null;
 insert into private.master_renewal_notices(billing_cycle_id,company_id,kind,ordinal,due_at,detail) values(cycle,p_company_id,'before_charge',1,(source->>'dueAt')::timestamptz-interval '24 hours',jsonb_build_object('planVersionId',pv.id,'amountBaisa',pv.amount_baisa,'currency',pv.currency,'chargeDueAt',source->>'dueAt','managePath','/app/subscription','termsVersion',t.terms_version)) on conflict(billing_cycle_id,kind,ordinal) do nothing;
 if ready then update public.billing_subscriptions set cancel_at_period_end=false where company_id=p_company_id and environment='live';end if;
 return jsonb_build_object('ok',true,'enabled',ready,'requested',true,'status',case when ready then 'ready' else 'UNCONFIGURED' end,'billingCycleId',cycle,'amountBaisa',pv.amount_baisa,'currency',pv.currency,'dueAt',source->>'dueAt');
end;$$;
create function public.master_claim_renewal_candidate() returns jsonb language plpgsql security definer set search_path='' set jit=off as $$declare picked uuid;cid uuid;j private.master_renewal_attempts%rowtype;pref private.master_autorenew_preferences%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select attempt.id,attempt.company_id into picked,cid from private.master_renewal_attempts attempt join private.master_autorenew_preferences preferences on preferences.company_id=attempt.company_id and preferences.enabled and preferences.requested and preferences.agreement_id=attempt.agreement_id
 join private.master_renewal_cycles cycle on cycle.id=attempt.billing_cycle_id and cycle.paid_receipt_id is null
 where attempt.state='queued' and attempt.due_at<=clock_timestamp() order by attempt.due_at,attempt.id limit 1;
 if not found then return null;end if;
 perform 1 from public.companies where id=cid for update;
 select * into j from private.master_renewal_attempts where id=picked for update;select * into pref from private.master_autorenew_preferences where company_id=cid;
 if j.state<>'queued' or not pref.enabled or pref.agreement_id<>j.agreement_id or exists(select 1 from private.master_renewal_cycles where id=j.billing_cycle_id and paid_receipt_id is not null) then return null;end if;
 update private.master_renewal_attempts set state='claimed',lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '15 minutes' where id=j.id returning * into j;
 return jsonb_build_object('id',j.id,'leaseToken',j.lease_token);
end;$$;
-- Internal wallet funding uses the same native orders/attempts/applications and
-- outcomes, with an explicit source. It creates no Paymob event or HMAC claim.
do $$declare name text;constraint_row record;begin
 foreach name in array array['billing_orders','billing_payment_attempts','billing_entitlement_applications','billing_settlement_outcomes'] loop
  for constraint_row in select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid=('public.'||name)::regclass and contype='c' loop
   if constraint_row.definition='CHECK ((provider = ''paymob''::text))' then execute format('alter table public.%I drop constraint %I',name,constraint_row.conname);end if;
  end loop;
  execute format('alter table public.%I add constraint %I check(provider in(''paymob'',''wallet''))',name,name||'_funding_provider_check');
  execute format('alter table public.%I add column funding_source text generated always as(case when provider=''wallet'' then ''wallet'' else ''paymob'' end) stored',name);
 end loop;
end;$$;
-- Scope must inherit the parent source rather than defaulting a wallet attempt
-- to Paymob before the existing strict native binding trigger executes.
alter table public.billing_payment_attempts alter column provider drop default;
create function private.master_pin_wallet_order() returns trigger language plpgsql security definer set search_path='' as $$begin
 if nullif(current_setting('velora.master_wallet_company',true),'') is null then return new;end if;
 if current_setting('role',true) is distinct from 'service_role' or new.company_id::text<>current_setting('velora.master_wallet_company') or new.purchase_purpose<>'renew' or new.provider_environment<>'live' then raise exception 'WALLET_RENEWAL_ONLY';end if;
 new.provider:='wallet';new.provider_account_ref:='internal_wallet';new.provider_amount:=null;new.provider_amount_unit:=null;return new;
end;$$;
create trigger master_pin_wallet_order before insert on public.billing_orders for each row execute function private.master_pin_wallet_order();
-- Existing native source rows remain unchanged. Append the internally funded
-- proof branch, maintaining the previous view column order for every consumer.
do $$declare cols text;begin
 select string_agg(case when attname='plan_version_id' then 'o.plan_version_id' else format('g.%I',attname) end,',' order by attnum) into cols from pg_attribute where attrelid='private.billing_verified_collection_history'::regclass and attnum>0 and not attisdropped;
 alter view private.billing_verified_collection_history rename to billing_verified_collection_history_pre_wallet;
 execute 'create view private.billing_verified_collection_history as select old.*,''paymob''::text as funding_source from private.billing_verified_collection_history_pre_wallet old union all select '||cols||',''wallet''::text from public.billing_entitlement_applications g join public.billing_orders o on o.id=g.order_id and o.company_id=g.company_id
 join public.billing_plan_versions pv on pv.id=o.plan_version_id join public.billing_payment_attempts a on a.id=g.payment_attempt_id and a.order_id=o.id and a.company_id=o.company_id
 join private.master_wallet_ledger debit on debit.order_id=o.id and debit.company_id=o.company_id and debit.kind=''renewal'' and debit.delta_baisa=-o.amount_baisa
 join private.master_checkout_quotes q on q.order_id=o.id and q.company_id=o.company_id join private.master_checkout_consents consent on consent.checkout_id=q.checkout_id and consent.actor_id=o.created_by and consent.terms_version=q.snapshot->>''termsVersion''
 join public.billing_settlement_outcomes x on x.entitlement_application_id=g.id and x.order_id=o.id and x.payment_attempt_id=a.id and x.company_id=g.company_id and x.outcome=''granted''
 where g.provider=''wallet'' and o.provider=''wallet'' and a.provider=''wallet'' and x.provider=''wallet'' and g.provider_environment=''live'' and o.provider_environment=''live'' and a.provider_environment=''live'' and x.provider_environment=''live''
 and o.provider_account_ref=''internal_wallet'' and a.provider_account_ref=o.provider_account_ref and g.provider_account_ref=o.provider_account_ref and x.provider_account_ref=o.provider_account_ref
 and o.purchase_purpose=''renew'' and o.amount_baisa=pv.amount_baisa and o.currency=''OMR'' and o.currency=pv.currency and o.period_days=pv.period_days and o.period_unit=pv.period_unit and o.period_count=pv.period_count
 and g.provider_event_id is null and x.provider_event_id is null and a.provider_order_id is null and x.authenticity_method=''internal_wallet_ledger'' and x.evidence_marker=''VEL_INTERNAL_WALLET_LEDGER''
 and g.provider_transaction_id=''wallet:''||debit.id::text and x.provider_transaction_id=g.provider_transaction_id and g.period_days=o.period_days and g.period_unit=o.period_unit and g.period_count=o.period_count and x.applied_paid_through=g.applied_paid_through';
 create or replace view private.billing_proven_entitlement_grants as select h.* from private.billing_verified_collection_history h join public.billing_orders o on o.id=h.order_id and o.company_id=h.company_id join public.billing_payment_attempts a on a.id=h.payment_attempt_id and a.company_id=h.company_id where h.status='active' and o.status='closed' and a.status='paid';
 revoke all on private.billing_verified_collection_history,private.billing_proven_entitlement_grants from public,anon,authenticated;
 grant select on private.billing_verified_collection_history,private.billing_proven_entitlement_grants to service_role;
end;$$;

create function private.master_finalize_cycle_payment(oid uuid) returns void language plpgsql security definer set search_path='' set jit=off as $$declare g record;cycle uuid;begin
 select * into g from private.billing_proven_entitlement_grants where order_id=oid and provider_environment='live';if not found then return;end if;
 select billing_cycle_id into cycle from private.master_renewal_order_cycles where order_id=oid;if not found then return;end if;
 perform 1 from public.companies where id=g.company_id for update;
 update private.master_renewal_cycles set paid_receipt_id=g.id where id=cycle and company_id=g.company_id and paid_receipt_id is null;
 update private.master_renewal_attempts set state=case when order_id=oid then 'paid' when state in('committed','submitted','unknown') then 'unknown' else 'cancelled' end where billing_cycle_id=cycle and state in('prepared','queued','claimed','committed','submitted','unknown');
 update private.master_renewal_notices set state='cancelled' where billing_cycle_id=cycle and state='pending';
end;$$;
-- Surgical native extensions retain role/RBAC, full catalog amount and quote
-- equality, account binding, unresolved barriers, and actual grant receipts.
do $$declare f regprocedure;d text;anchor text;guard text;begin
 f:='public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)'::regprocedure;
 d:=replace(pg_get_functiondef(f),chr(13),'');
 anchor:='exists(select 1 from public.billing_subscriptions where company_id=p_company_id and environment=p_provider_environment and paid_through>clock_timestamp()) or p_provider_environment=''live'' and (private.master_activation_waiting(p_company_id) or private.master_activation_company_end(p_company_id)>clock_timestamp())';
 if position(anchor in d)=0 then raise exception 'RENEWAL_EFFECTIVE_END_BODY_REQUIRES_REVIEW';end if;
 guard:='case when p_provider_environment=''live'' then private.master_activation_waiting(p_company_id) or coalesce(private.master_activation_company_end(p_company_id),(select paid_through from public.billing_subscriptions where company_id=p_company_id and environment=p_provider_environment))>clock_timestamp() else exists(select 1 from public.billing_subscriptions where company_id=p_company_id and environment=p_provider_environment and paid_through>clock_timestamp()) end';
 execute replace(d,anchor,guard);
 f:=to_regprocedure('private.billing_snapshot_bound_service_order(uuid,uuid)');
 if f is not null then
  d:=replace(pg_get_functiondef(f),chr(13),'');anchor:=' select * into o from public.billing_orders where id=p_order_id;';
  if position(anchor in d)=0 then raise exception 'WALLET_NATIVE_SNAPSHOT_BODY_REQUIRES_REVIEW';end if;
  guard:=' if o.provider=''wallet'' then if current_setting(''role'',true) is distinct from ''service_role'' or o.company_id::text is distinct from nullif(current_setting(''velora.master_wallet_company'',true),'''') then raise insufficient_privilege;end if;result:=public.billing_snapshot_service_order(o.id);if result->>''ok'' is distinct from ''true'' then raise exception ''WALLET_SERVICE_SNAPSHOT_REQUIRED'';end if;return;end if;';
  execute replace(d,anchor,anchor||E'\n'||guard);
 end if;
 -- A wallet debit is the confirmation timestamp in its proved native branch.
 f:='public.master_capture_subscription_activation(uuid,uuid)'::regprocedure;d:=replace(pg_get_functiondef(f),chr(13),'');
 anchor:='join public.billing_provider_events e on e.id=proof.provider_event_id';if position(anchor in d)=0 then raise exception 'WALLET_C_CAPTURE_JOIN_REQUIRES_REVIEW';end if;
 d:=replace(d,anchor,'left join public.billing_provider_events e on e.id=proof.provider_event_id');
 anchor:='e.created_at as confirmed_at';if position(anchor in d)=0 then raise exception 'WALLET_C_CAPTURE_TIME_REQUIRES_REVIEW';end if;
 d:=replace(d,anchor,'case when proof.provider=''wallet'' then (select created_at from private.master_wallet_ledger where order_id=proof.order_id and kind=''renewal'') else e.created_at end as confirmed_at');
 anchor:='if not legacy and g.purchase_purpose=''initial'' then';if position(anchor in d)=0 then raise exception 'RENEWAL_C_BONUS_GUARD_REQUIRES_REVIEW';end if;
 execute replace(d,anchor,'if not legacy and g.purchase_purpose=''initial'' and not exists(select 1 from private.master_renewal_order_cycles where order_id=g.order_id) then');
 f:='private.master_activation_ready(uuid,uuid)'::regprocedure;d:=pg_get_functiondef(f);
 if position('master_activation_partial_disclosures' in d)>0 then
  anchor:='join public.billing_provider_events e on e.id=g.provider_event_id';if position(anchor in d)=0 then raise exception 'WALLET_C_DISCLOSURE_PROOF_JOIN_REQUIRES_REVIEW';end if;
  d:=replace(d,anchor,'left join public.billing_provider_events e on e.id=g.provider_event_id');
  anchor:='d.accepted_at<=e.created_at';if position(anchor in d)=0 then raise exception 'WALLET_C_DISCLOSURE_TIME_REQUIRES_REVIEW';end if;
  execute replace(d,anchor,'d.accepted_at<=case when g.provider=''wallet'' then (select created_at from private.master_wallet_ledger where order_id=g.order_id and kind=''renewal'') else e.created_at end');
 end if;
 f:='private.master_reconcile_activation_locked(uuid)'::regprocedure;d:=pg_get_functiondef(f);anchor:=' return jsonb_build_object(''ok'',true,''data'',private.master_activation_receipt_state(a.receipt_id));';
 if position(anchor in d)=0 then raise exception 'AUTORENEW_C_RECONCILE_ANCHOR_REQUIRES_REVIEW';end if;
 execute replace(d,anchor,' if a.subscription_started_at is not null then perform private.master_sync_auto_renew_locked(cid);end if;'||E'\n'||anchor);
end;$$;
create function public.master_wallet_pay_renewal(p_company_id uuid,p_actor_id uuid,p_actor_session_id uuid,p_plan_version_id uuid,p_expected_revision bigint,p_terms_version text,p_accepted boolean,p_client_op_id text) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare source jsonb;pv public.billing_plan_versions%rowtype;v_revision bigint;o public.billing_orders%rowtype;g record;result jsonb;agreement jsonb;debit uuid;grant_id uuid;sub public.billing_subscriptions%rowtype;paid_until timestamptz;service jsonb;activation jsonb;cycle uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 perform 1 from public.companies archive_company where archive_company.id=p_company_id and archive_company.status in('setup','active') and to_jsonb(archive_company)->>'archived_at' is null for update;if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if not private.billing_live_owner(p_company_id,p_actor_id,p_actor_session_id) then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 if p_accepted is distinct from true then return jsonb_build_object('ok',false,'code','CONSENT_REQUIRED');end if;
 if p_client_op_id is null or length(btrim(p_client_op_id)) not between 1 and 128 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select * into o from public.billing_orders where company_id=p_company_id and client_op_id=btrim(p_client_op_id);
 if found then
  if o.provider<>'wallet' or o.purchase_purpose<>'renew' or o.plan_version_id<>p_plan_version_id or o.created_by<>p_actor_id or not exists(select 1 from private.master_checkout_quotes q join private.master_checkout_consents consent using(checkout_id) where q.order_id=o.id and consent.actor_id=p_actor_id and consent.terms_version=p_terms_version) then return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');end if;
  select * into g from private.billing_verified_collection_history where order_id=o.id and company_id=p_company_id and provider='wallet';
  if found then return jsonb_build_object('ok',true,'orderId',o.id,'receiptId',g.id,'fundingSource','wallet','clientOpId',btrim(p_client_op_id));end if;
  return jsonb_build_object('ok',false,'code','PAYMENT_RECONCILIATION_REQUIRED');
 end if;
 source:=private.master_renewal_source(p_company_id);
 if source->>'state' is distinct from 'ready' or(source->>'dueAt')::timestamptz>clock_timestamp() then return jsonb_build_object('ok',false,'code','SUBSCRIPTION_CYCLE_NOT_ENDED');end if;
 cycle:=private.master_ensure_renewal_cycle(p_company_id);
 if exists(select 1 from private.master_renewal_cycles where id=cycle and paid_receipt_id is not null) then return jsonb_build_object('ok',false,'code','CYCLE_ALREADY_PAID');end if;
 if exists(select 1 from public.billing_payment_attempts where company_id=p_company_id and provider_environment='live' and status in('unresolved','provider_submitted')) then return jsonb_build_object('ok',false,'code','PAYMENT_RECONCILIATION_REQUIRED');end if;
 if exists(select 1 from private.master_wallet_accounts where company_id=p_company_id and frozen_at is not null) then return jsonb_build_object('ok',false,'code','WALLET_REQUIRES_RECONCILIATION');end if;
 select * into pv from public.billing_plan_versions where id=p_plan_version_id and status='published' and currency='OMR' and period_unit='month' and period_count=1 for share;
 if not found then return jsonb_build_object('ok',false,'code','PLAN_NOT_PUBLISHED');end if;
 select catalog.revision into v_revision from public.billing_catalog_revision catalog where singleton for update;
 if v_revision is distinct from p_expected_revision then return jsonb_build_object('ok',false,'code','CATALOG_REVISION_CONFLICT');end if;
 if not exists(select 1 from private.master_checkout_terms where plan_version_id=pv.id and terms_version=p_terms_version and approved_at<=clock_timestamp()) then return jsonb_build_object('ok',false,'code','CHECKOUT_TERMS_CHANGED');end if;
 if private.master_wallet_balance(p_company_id)<pv.amount_baisa then return jsonb_build_object('ok',false,'code','WALLET_INSUFFICIENT_BALANCE');end if;
 perform set_config('velora.live_checkout_contract','',true);perform set_config('velora.master_wallet_company',p_company_id::text,true);
 result:=public.billing_create_or_reuse_subscription_order(p_company_id,'velora_ai_staff','renew',pv.id,pv.plan_id,btrim(p_client_op_id),'wallet:'||pv.id::text||':'||pv.amount_baisa::text,'vel_wallet_'||gen_random_uuid()::text,pv.amount_baisa,pv.currency,pv.period_days,pv.period_unit,pv.period_count,'internal_wallet','live',p_actor_id);
 perform set_config('velora.master_wallet_company','',true);
 if result->>'ok' is distinct from 'true' then return result;end if;
 select * into o from public.billing_orders where id=(result->>'order_id')::uuid and company_id=p_company_id;
 if o.provider<>'wallet' then raise exception 'WALLET_NATIVE_ORDER_SOURCE_CONFLICT';end if;
 if not private.master_checkout_channel_quote_ready(o.id) then return jsonb_build_object('ok',false,'code','CHANNEL_ENTITLEMENT_UNCONFIGURED');end if;
 agreement:=public.master_accept_checkout_consent(p_company_id,o.id,p_actor_id,p_actor_session_id,p_terms_version,true);
 if agreement->>'ok' is distinct from 'true' then raise exception 'WALLET_CHECKOUT_CONSENT_FAILED';end if;
 if to_regprocedure('public.billing_snapshot_service_order(uuid)') is not null then service:=public.billing_snapshot_service_order(o.id);if service->>'ok' is distinct from 'true' then raise exception 'WALLET_SERVICE_SNAPSHOT_FAILED';end if;end if;
 insert into private.master_wallet_ledger(company_id,delta_baisa,kind,order_id,client_op_id) values(p_company_id,-o.amount_baisa,'renewal',o.id,'renew:'||o.id) returning id into debit;
 select * into sub from public.billing_subscriptions where id=(source->>'subscriptionId')::uuid and company_id=p_company_id and environment='live' for update;
 paid_until:=clock_timestamp()+interval '720 hours';
 insert into public.billing_entitlement_applications(company_id,order_id,subscription_id,payment_attempt_id,provider,provider_account_ref,provider_environment,provider_transaction_id,provider_event_id,previous_paid_through,applied_paid_through,period_days,period_unit,period_count,status)
 values(p_company_id,o.id,sub.id,(result->>'payment_attempt_id')::uuid,'wallet','internal_wallet','live','wallet:'||debit,null,sub.paid_through,paid_until,o.period_days,o.period_unit,o.period_count,'active') returning id into grant_id;
 update public.billing_subscriptions set status='active',plan_version_id=o.plan_version_id,paid_through=paid_until,updated_at=clock_timestamp() where id=sub.id and company_id=p_company_id;
 update public.billing_payment_attempts set status='paid',updated_at=clock_timestamp() where id=(result->>'payment_attempt_id')::uuid and order_id=o.id;
 update public.billing_orders set status='closed' where id=o.id;
 insert into public.billing_settlement_outcomes(company_id,order_id,payment_attempt_id,provider,provider_account_ref,provider_environment,provider_transaction_id,entitlement_application_id,outcome,evidence_marker,authenticity_method,previous_paid_through,applied_paid_through,detail)
 values(p_company_id,o.id,(result->>'payment_attempt_id')::uuid,'wallet','internal_wallet','live','wallet:'||debit,grant_id,'granted','VEL_INTERNAL_WALLET_LEDGER','internal_wallet_ledger',sub.paid_through,paid_until,jsonb_build_object('walletDebitId',debit,'billingCycleId',cycle));
 if not exists(select 1 from private.billing_proven_entitlement_grants where id=grant_id and company_id=p_company_id and provider='wallet') then raise exception 'WALLET_NATIVE_FINANCIAL_PROOF_FAILED';end if;
 if to_regprocedure('public.billing_apply_service_grant(uuid)') is not null then service:=public.billing_apply_service_grant(grant_id);if service->>'ok' is distinct from 'true' then raise exception 'WALLET_SERVICE_GRANT_FAILED';end if;end if;
 if(select enabled from private.master_activation_policy where singleton) then
  activation:=public.master_capture_subscription_activation(p_company_id,grant_id);if activation->>'ok' is distinct from 'true' then raise exception 'WALLET_ACTIVATION_CAPTURE_FAILED';end if;
  if activation->'data'->>'subscriptionStartedAt' is not null and to_regprocedure('public.master_capture_ai_cycle(uuid,uuid)') is not null then execute 'select public.master_capture_ai_cycle($1,$2)' into service using p_company_id,grant_id;if service->>'ok' is distinct from 'true' then raise exception 'WALLET_AI_CYCLE_CAPTURE_FAILED';end if;end if;
 end if;
 perform private.master_finalize_cycle_payment(o.id);
 perform private.master_sync_auto_renew_locked(p_company_id);
 return jsonb_build_object('ok',true,'orderId',o.id,'receiptId',grant_id,'fundingSource','wallet','clientOpId',btrim(p_client_op_id),'balanceBaisa',private.master_wallet_balance(p_company_id),'billingCycleId',cycle);
end;$$;
create function private.master_excess_reversed(xid uuid) returns boolean language plpgsql security definer set search_path='' set jit=off as $$declare x private.master_excess_collections%rowtype;e record;verified public.billing_provider_events%rowtype;begin
 select * into x from private.master_excess_collections where id=xid;if not found then return true;end if;
 for e in select id from public.billing_provider_events where company_id=x.company_id and provider=x.provider and provider_account_ref=x.provider_account_ref and provider_environment=x.provider_environment and provider_transaction_id=x.provider_transaction_id and(event_status in('refunded','voided','cancelled') or raw_summary->'is_refunded'='true'::jsonb or raw_summary->'is_voided'='true'::jsonb) loop
  verified:=private.master_native_payment_event(e.id);if verified.id is not null then return true;end if;
 end loop;
 return false;
end;$$;
create function private.master_wallet_lifecycle_fence() returns trigger language plpgsql security definer set search_path='' set jit=off as $$declare x record;begin
 if new.event_status not in('refunded','voided','cancelled') and new.raw_summary->'is_refunded' is distinct from 'true'::jsonb and new.raw_summary->'is_voided' is distinct from 'true'::jsonb then return new;end if;
 for x in select excess.id,excess.company_id from private.master_excess_collections excess join private.master_wallet_conversion_consents consent on consent.obligation_id=excess.id where excess.company_id=new.company_id and excess.provider=new.provider and excess.provider_account_ref=new.provider_account_ref and excess.provider_environment=new.provider_environment and excess.provider_transaction_id=new.provider_transaction_id loop
  if private.master_excess_reversed(x.id) then insert into private.master_wallet_accounts values(x.company_id,clock_timestamp(),'source_refund_extent_requires_review') on conflict(company_id) do update set frozen_at=coalesce(private.master_wallet_accounts.frozen_at,excluded.frozen_at),frozen_reason=excluded.frozen_reason;end if;
 end loop;
 return new;
end;$$;
create trigger master_wallet_lifecycle_fence after insert on public.billing_provider_events for each row execute function private.master_wallet_lifecycle_fence();
-- A converted/refunded source can never be credited again or automatically
-- reclaim spent principal. Freeze and preserve an explicit financial review.
do $$declare f regprocedure;d text;anchor text;begin
 f:='public.master_convert_excess_to_wallet(uuid,uuid,uuid,uuid,text,boolean,text)'::regprocedure;d:=pg_get_functiondef(f);anchor:=' if private.master_capture_excess_collection(x.settlement_outcome_id)';
 if position(anchor in d)=0 then raise exception 'WALLET_CONVERSION_RECONCILIATION_ANCHOR_MISSING';end if;
 execute replace(d,anchor,' if private.master_excess_reversed(x.id) then return jsonb_build_object(''ok'',false,''code'',''EXCESS_COLLECTION_RECONCILIATION_REQUIRED'');end if;'||E'\n'||anchor);
end;$$;

create function private.master_recurring_actor_allowed(cid uuid,actor uuid) returns boolean language plpgsql security definer set search_path='' set jit=off as $$declare jid uuid;token uuid;j private.master_renewal_attempts%rowtype;pref private.master_autorenew_preferences%rowtype;a private.master_autorenew_agreements%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then return false;end if;
 perform 1 from auth.users where id=actor for share nowait;if not found then return false;end if;
 perform 1 from public.company_members where company_id=cid and user_id=actor for share nowait;if not found then return false;end if;
 jid:=nullif(current_setting('velora.master_renewal_attempt',true),'')::uuid;token:=nullif(current_setting('velora.master_renewal_lease',true),'')::uuid;
 select * into j from private.master_renewal_attempts where id=jid and company_id=cid and state='claimed' and lease_token=token and lease_expires_at>clock_timestamp();if not found then return false;end if;
 select * into pref from private.master_autorenew_preferences where company_id=cid and requested and enabled and agreement_id=j.agreement_id;
 select * into a from private.master_autorenew_agreements where id=j.agreement_id and company_id=cid and actor_id=actor;
 return a.id is not null and pref.agreement_id is not null and private.master_mandate_ready(cid,actor,pref.mandate_id)
  and not exists(select 1 from private.master_renewal_cycles where id=j.billing_cycle_id and paid_receipt_id is not null)
  and exists(select 1 from auth.users u where u.id=actor and(u.email_confirmed_at is not null or u.phone_confirmed_at is not null) and to_jsonb(u)->>'deleted_at' is null and(to_jsonb(u)->>'banned_until' is null or(to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp()));
 exception when lock_not_available then return false;
end;$$;
-- The only sessionless owner authorization is a company-locked, still-current,
-- consent/mandate/cycle/lease-bound automatic renewal. Every existing browser
-- call retains the native owner/session implementation verbatim.
do $$declare f regprocedure;d text;anchor text;archive_guard text:=' if exists(select 1 from public.companies archive_company where archive_company.id=p_company_id and to_jsonb(archive_company)->>''archived_at'' is not null) then return jsonb_build_object(''ok'',false,''code'',''FORBIDDEN'');end if;';begin
 f:=to_regprocedure('public.billing_create_live_checkout_order(uuid,uuid,uuid,uuid,text,bigint,bigint,text,integer)');
 if f is not null then
  d:=pg_get_functiondef(f);anchor:=' select revision into r from public.billing_catalog_revision';
  if position(anchor in d)=0 then raise exception 'NATIVE_INITIAL_CYCLE_GUARD_ANCHOR_REQUIRED';end if;
  d:=replace(d,anchor,archive_guard||E'\n'||' if private.master_activation_waiting(p_company_id) or (private.master_renewal_source(p_company_id)->>''dueAt'')::timestamptz>clock_timestamp() then return jsonb_build_object(''ok'',false,''code'',''SUBSCRIPTION_CYCLE_NOT_ENDED'');end if;'||E'\n'||anchor);
  anchor:='p_company_id,''velora_ai_staff'',''initial'',v.id';if position(anchor in d)=0 then raise exception 'NATIVE_MANUAL_RENEW_PURPOSE_ANCHOR_REQUIRED';end if;
  execute replace(d,anchor,'p_company_id,''velora_ai_staff'',case when private.master_renewal_source(p_company_id)->>''state''=''ready'' then ''renew'' else ''initial'' end,v.id');
  alter function public.billing_create_live_checkout_order(uuid,uuid,uuid,uuid,text,bigint,bigint,text,integer) set jit=off;
 end if;
 f:=to_regprocedure('public.billing_create_live_upgrade_order(uuid,uuid,uuid,uuid,text,bigint,bigint,text,integer)');
 if f is not null then d:=pg_get_functiondef(f);anchor:=' select revision into r from public.billing_catalog_revision';if position(anchor in d)=0 then raise exception 'NATIVE_UPGRADE_ARCHIVE_GUARD_ANCHOR_REQUIRED';end if;execute replace(d,anchor,archive_guard||E'\n'||anchor);end if;
 f:=to_regprocedure('private.billing_live_owner(uuid,uuid,uuid)');if f is null then raise exception 'RECURRING_NATIVE_OWNER_DEPENDENCY_REQUIRED';end if;
 alter function private.billing_live_owner(uuid,uuid,uuid) rename to billing_live_owner_pre_recurring;
 create function private.billing_live_owner(p_company uuid,p_actor uuid,p_session uuid) returns boolean language plpgsql security definer set search_path='' set jit=off as $fn$declare u jsonb;s jsonb;revoked boolean;begin
  if p_session is null then return private.master_recurring_actor_allowed(p_company,p_actor);end if;
  if p_actor is null or not pg_try_advisory_xact_lock_shared(hashtextextended(p_actor::text||':session-revocation',0)) or not pg_try_advisory_xact_lock_shared(hashtextextended(p_actor::text||':personal-phone',0)) then return false;end if;
  if not private.billing_live_owner_pre_recurring(p_company,p_actor,p_session) then return false;end if;
  -- The native helper's user/session/activity/member NOWAIT locks are retained.
  -- Reread Auth and all available epoch boundaries only after those locks.
  select to_jsonb(actor),to_jsonb(session) into u,s from auth.users actor join auth.sessions session on session.user_id=actor.id where actor.id=p_actor and session.id=p_session;
  if u is null or u->>'deleted_at' is not null or(u->>'banned_until' is not null and(u->>'banned_until')::timestamptz>clock_timestamp()) or(s->>'not_after' is not null and(s->>'not_after')::timestamptz<=clock_timestamp()) then return false;end if;
  if to_regclass('private.master_account_session_revocations') is not null then execute 'select exists(select 1 from private.master_account_session_revocations where user_id=$1 and revoked_before >= $2)' into revoked using p_actor,(s->>'created_at')::timestamptz;if revoked then return false;end if;end if;
  if to_regclass('private.master_identity_session_boundaries') is not null then execute 'select exists(select 1 from private.master_identity_session_boundaries where user_id=$1 and survivor_session_id<>$2 and revoked_before >= $3)' into revoked using p_actor,p_session,(s->>'created_at')::timestamptz;if revoked then return false;end if;end if;
  return true;
 end;$fn$;
 revoke all on function private.billing_live_owner_pre_recurring(uuid,uuid,uuid),private.billing_live_owner(uuid,uuid,uuid) from public,anon,authenticated,service_role;
 f:=to_regprocedure('public.billing_create_live_checkout_order(uuid,uuid,uuid,uuid,text,bigint,bigint,text,integer)');
 if f is not null then d:=replace(pg_get_functiondef(f),chr(13),'');if position(archive_guard in d)=0 then raise exception 'RECURRING_ARCHIVE_GUARD_BODY_REQUIRES_REVIEW';end if;d:=replace(d,archive_guard,'');d:=replace(d,'public.billing_create_live_checkout_order(','public.billing_create_live_renewal_order(');d:=replace(d,'''velora_ai_staff'',''initial''','''velora_ai_staff'',''renew''');execute d;revoke all on function public.billing_create_live_renewal_order(uuid,uuid,uuid,uuid,text,bigint,bigint,text,integer) from public,anon,authenticated;grant execute on function public.billing_create_live_renewal_order(uuid,uuid,uuid,uuid,text,bigint,bigint,text,integer) to service_role;end if;
end;$$;
create function public.master_authorize_renewal_attempt(p_attempt_id uuid,p_lease_token uuid) returns jsonb language plpgsql security definer set search_path='' set jit=off as $$
declare j private.master_renewal_attempts%rowtype;cid uuid;a private.master_autorenew_agreements%rowtype;pref private.master_autorenew_preferences%rowtype;m private.master_recurring_mandates%rowtype;merchant private.billing_live_merchant_contracts%rowtype;source jsonb;r bigint;result jsonb;claim jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select company_id into cid from private.master_renewal_attempts where id=p_attempt_id;if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.companies where id=cid and status in('setup','active') for update;
 select * into j from private.master_renewal_attempts where id=p_attempt_id for update;
 if j.state<>'claimed' or j.lease_token is distinct from p_lease_token or j.lease_expires_at<=clock_timestamp() then return jsonb_build_object('ok',false,'code','RENEWAL_LEASE_INVALID');end if;
 if exists(select 1 from private.master_renewal_cycles where id=j.billing_cycle_id and paid_receipt_id is not null) then update private.master_renewal_attempts set state='cancelled' where id=j.id;return jsonb_build_object('ok',false,'code','CYCLE_ALREADY_PAID');end if;
 select * into pref from private.master_autorenew_preferences where company_id=cid and requested and enabled and agreement_id=j.agreement_id;
 select * into a from private.master_autorenew_agreements where id=j.agreement_id and company_id=cid;
 if pref.agreement_id is null or not private.master_mandate_ready(cid,a.actor_id,pref.mandate_id) then return jsonb_build_object('ok',false,'code','RECURRING_PROVIDER_UNCONFIGURED');end if;
 if j.due_at>clock_timestamp() or not exists(select 1 from private.master_renewal_cycles where id=j.billing_cycle_id and due_at<=clock_timestamp()) or not exists(select 1 from private.master_renewal_notices where billing_cycle_id=j.billing_cycle_id and ordinal=j.ordinal and kind=case when j.ordinal=1 then 'before_charge' else 'retry' end and state='accepted') then return jsonb_build_object('ok',false,'code','RENEWAL_NOTICE_REQUIRED');end if;
 if exists(select 1 from public.billing_provider_events e join public.billing_payment_attempts attempt on attempt.id=e.payment_attempt_id join private.master_renewal_order_cycles link on link.order_id=attempt.order_id where link.billing_cycle_id=j.billing_cycle_id and e.event_status in('pending','success') and not(e.event_status='pending' and attempt.status='failed' and exists(select 1 from private.master_renewal_attempts prior join public.billing_provider_events failed on failed.id=prior.failed_event_id where prior.payment_attempt_id=attempt.id and prior.state='failed' and failed.provider_transaction_id=e.provider_transaction_id))) then return jsonb_build_object('ok',false,'code','PAYMENT_RECONCILIATION_REQUIRED');end if;
 source:=private.master_renewal_source(cid);
 if source->>'planVersionId' is distinct from a.plan_version_id::text or not exists(select 1 from private.master_renewal_cycles where id=j.billing_cycle_id and due_at=(source->>'dueAt')::timestamptz and due_at>=a.next_due_at) or not exists(select 1 from public.billing_plan_versions where id=a.plan_version_id and amount_baisa=a.amount_baisa and currency=a.currency and status='published') or not exists(select 1 from private.master_checkout_terms where plan_version_id=a.plan_version_id and terms_version=a.terms_version) then return jsonb_build_object('ok',false,'code','AUTORENEW_TERMS_CHANGED');end if;
 if j.ordinal=2 and not exists(select 1 from private.master_renewal_attempts prior where prior.billing_cycle_id=j.billing_cycle_id and prior.ordinal=1 and prior.state='failed' and prior.confirmed_failed_at<=clock_timestamp()-interval '24 hours') then return jsonb_build_object('ok',false,'code','RETRY_NOT_DUE');end if;
 select * into m from private.master_recurring_mandates where id=pref.mandate_id;
 select contract.* into merchant from private.billing_live_merchant_contracts contract join public.billing_orders source_order on source_order.provider_account_ref=contract.integration_id::text join public.billing_entitlement_applications proof on proof.order_id=source_order.id where proof.id=m.source_receipt_id and contract.deadline_policy_approved and contract.verified_at<=clock_timestamp();
 if not found then return jsonb_build_object('ok',false,'code','RECURRING_PROVIDER_UNCONFIGURED');end if;
 select revision into r from public.billing_catalog_revision where singleton;
 perform set_config('velora.master_renewal_attempt',j.id::text,true);perform set_config('velora.master_renewal_lease',j.lease_token::text,true);
 result:=public.billing_create_live_renewal_order(cid,a.actor_id,null,a.plan_version_id,'recurring:'||j.id,r,merchant.integration_id,merchant.merchant_owner_id,merchant.units_per_omr);
 if result->>'ok' is distinct from 'true' then perform set_config('velora.master_renewal_attempt','',true);perform set_config('velora.master_renewal_lease','',true);return result;end if;
 -- Agreement was explicitly accepted before this quote. Bind the exact approved
 -- version only after checking its amount/currency/due again under company lock.
 insert into private.master_checkout_consents(checkout_id,actor_id,actor_session_id,terms_version) select q.checkout_id,a.actor_id,a.actor_session_id,a.terms_version from private.master_checkout_quotes q where q.order_id=(result->>'order_id')::uuid and q.snapshot->>'termsVersion'=a.terms_version and(q.snapshot->>'amountBaisa')::bigint=a.amount_baisa on conflict do nothing;
 claim:=public.billing_claim_live_checkout(cid,(result->>'order_id')::uuid,(result->>'payment_attempt_id')::uuid,a.actor_id,null);
 if claim->>'kind'<>'claimed' then raise exception 'RECURRING_NATIVE_CLAIM_FAILED';end if;
 update private.master_renewal_attempts set state='committed',order_id=(result->>'order_id')::uuid,payment_attempt_id=(result->>'payment_attempt_id')::uuid,committed_at=clock_timestamp() where id=j.id;
 perform set_config('velora.master_renewal_attempt','',true);perform set_config('velora.master_renewal_lease','',true);
 return jsonb_build_object('ok',true,'data',jsonb_build_object('id',j.id,'leaseToken',j.lease_token,'companyId',cid,'orderId',result->>'order_id','paymentAttemptId',result->>'payment_attempt_id','billingCycleId',j.billing_cycle_id,'provider','paymob','environment','live','accountRef',merchant.integration_id::text,'mandateRef',m.provider_mandate_ref,'amountBaisa',a.amount_baisa,'currency',a.currency,'idempotencyKey','recurring:'||j.id::text));
end;$$;

-- Dispatchers recheck stop/payment immediately before an external notification.
create function private.master_recurring_failed_event() returns trigger language plpgsql security definer set search_path='' set jit=off as $$declare jid uuid;begin
 if new.event_status='failed' then
  select id into jid from private.master_renewal_attempts where payment_attempt_id=new.payment_attempt_id and company_id=new.company_id and state in('committed','submitted','unknown','failed');
  if jid is not null then perform public.master_record_recurring_failure(jid,new.id);end if;
 end if;return new;
end;$$;
create trigger master_recurring_failed_event after insert on public.billing_provider_events for each row execute function private.master_recurring_failed_event();
revoke all on function private.master_recurring_failed_event() from public,anon,authenticated,service_role;
create function public.master_authorize_renewal_notice(p_notice_id uuid,p_claim_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare n private.master_renewal_notices%rowtype;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into n from private.master_renewal_notices where id=p_notice_id and claim_token=p_claim_token and state='dispatching';if not found then return null;end if;
 perform 1 from public.companies where id=n.company_id for update;
 if not exists(select 1 from private.master_autorenew_preferences where company_id=n.company_id and requested and enabled) or exists(select 1 from private.master_renewal_cycles where id=n.billing_cycle_id and paid_receipt_id is not null) then update private.master_renewal_notices set state='cancelled' where id=n.id and state='dispatching';return null;end if;
 return jsonb_build_object('id',n.id,'claimToken',n.claim_token,'companyId',n.company_id,'kind',n.kind,'detail',n.detail);
end;$$;

-- Preserve the complete native C/E settlement chain and append only proved
-- excess obligations and cycle queue bookkeeping in that same transaction.
-- A late signed collection for another order of the identical due cycle must
-- enter the native duplicate-collection branch, never buy a second period.
do $$declare d text;anchor text;f regprocedure;begin
 f:=coalesce(to_regprocedure('private.billing_settle_payment_core_pre_acceptance(jsonb)'),to_regprocedure('private.billing_settle_payment_core(jsonb)'));
 d:=replace(pg_get_functiondef(f),chr(13),'');
 anchor:='where g.order_id = v_order_id'||E'\n  for update;';
 if position(anchor in d)=0 then raise exception 'NATIVE_SAME_CYCLE_GRANT_ANCHOR_REQUIRES_REVIEW';end if;
 execute replace(d,anchor,'where g.order_id = v_order_id or v_env=''live'' and g.id in(select cycle.paid_receipt_id from private.master_renewal_order_cycles link join private.master_renewal_cycles cycle on cycle.id=link.billing_cycle_id where link.order_id=v_order_id and cycle.company_id=v_company_id and cycle.paid_receipt_id is not null)'||E'\n  for update;');
end;$$;
do $$declare name text;backing text;begin
 foreach name in array array['billing_settle_paymob_hmac_verified','billing_settle_live_paymob_hmac_verified'] loop
  if to_regprocedure('public.'||name||'(jsonb)') is null then continue;end if;
  backing:=name||'_pre_renewal_wallet';
  execute format('alter function public.%I(jsonb) set schema private',name);
  execute format('alter function private.%I(jsonb) rename to %I',name,backing);
  execute format('revoke all on function private.%I(jsonb) from public,anon,authenticated,service_role',backing);
  execute format($wrapper$create function public.%I(p_evidence jsonb) returns jsonb language plpgsql security definer set search_path='' set jit=off as $fn$declare result jsonb;cid uuid;begin
   if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
   result:=private.%I(p_evidence);
   if result->>'outcome' in('duplicate_collection_review','idempotent_replay') and nullif(result->>'settlement_outcome_id','') is not null then perform private.master_capture_excess_collection((result->>'settlement_outcome_id')::uuid);end if;
   if result->>'ok'='true' and result->>'outcome' in('granted','idempotent_replay') then
    perform private.master_finalize_cycle_payment((result->>'order_id')::uuid);
    select company_id into cid from public.billing_orders where id=(result->>'order_id')::uuid;
    perform private.master_sync_auto_renew_locked(cid);
   end if;
   return result;
  end;$fn$;$wrapper$,name,backing);
  execute format('revoke all on function public.%I(jsonb) from public,anon,authenticated',name);
  execute format('grant execute on function public.%I(jsonb) to service_role',name);
 end loop;
end;$$;
-- No browser gets a financial table, mandate writer, lease or worker RPC.
do $$declare f record;begin
 for f in select p.oid,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public') and p.proname in('master_native_payment_event','master_capture_excess_collection','master_wallet_balance','master_wallet_ledger_guard','master_convert_excess_to_wallet','master_request_excess_refund','master_renewal_source','master_ensure_renewal_cycle','master_bind_renewal_order','master_mandate_ready','master_set_auto_renew','master_claim_renewal_candidate','master_pin_wallet_order','master_finalize_cycle_payment','master_wallet_pay_renewal','master_excess_reversed','master_wallet_lifecycle_fence','master_recurring_actor_allowed','master_authorize_renewal_attempt','master_record_recurring_submission','master_record_recurring_unknown','master_record_recurring_failure','master_claim_renewal_notice','master_finish_renewal_notice','master_authorize_renewal_notice','master_sync_auto_renew_locked','master_read_renewal_wallet') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.oid::regprocedure);
  if f.nspname='public' then execute format('grant execute on function %s to service_role',f.oid::regprocedure);end if;
 end loop;
end;$$;
commit;
