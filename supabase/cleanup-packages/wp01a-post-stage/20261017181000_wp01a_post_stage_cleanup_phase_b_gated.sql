-- WP01A post-stage cleanup — PHASE B (approval-gated).
-- Location: supabase/cleanup-packages/wp01a-post-stage/ (NOT auto-applied with migrations/).
-- Target remote project ref (from configured URL host): vmpifljyozsbtssxhoxd
-- Local config.toml project_id label: Velora_new
-- Prepared by Cursor. NOT authorized until owner names this project + object list.
-- Historical migrations/ retained. No CASCADE. Never touches auth.* or billing receipt tables.
--
-- Fresh rebuild: Auth-scoped migrations already skip these 9 installers; Phase B SQL is a no-op
--   when objects are absent (IF EXISTS / to_regprocedure checks).
-- Upgrade (DB that applied the 9): set velora.cleanup_approval=WP01A-POST-STAGE-PHASE-B then apply.
-- Restore: DB backup before apply, or rebuild from historical migrations/.

do $gate$
begin
  if current_setting('velora.cleanup_approval', true)
     is distinct from 'WP01A-POST-STAGE-PHASE-B' then
    raise exception 'CLEANUP_APPROVAL_REQUIRED:WP01A-POST-STAGE-PHASE-B';
  end if;
end;
$gate$;

create or replace function private.wp01a_cleanup_drop_function_if_unused(p_signature text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target regprocedure;
  dep_count integer;
begin
  begin
    target := p_signature::regprocedure;
  exception
    when undefined_function then
      return;
  end;
  select count(*)::integer into dep_count
  from pg_depend d
  where d.refobjid = target
    and d.deptype in ('n', 'a');
  if dep_count > 0 then
    raise exception 'CLEANUP_DEPENDENCY_BLOCKED:%:%', p_signature, dep_count;
  end if;
  execute format('drop function %s restrict', target);
end;
$$;

create or replace function private.wp01a_cleanup_drop_table_if_unused(p_qualified text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target regclass;
  dep_count integer;
begin
  target := to_regclass(p_qualified);
  if target is null then
    return;
  end if;
  select count(*)::integer into dep_count
  from pg_depend d
  where d.refobjid = target
    and d.deptype in ('n', 'a')
    and d.classid <> 'pg_rewrite'::regclass;
  if dep_count > 0 then
    raise exception 'CLEANUP_TABLE_DEPENDENCY_BLOCKED:%:%', p_qualified, dep_count;
  end if;
  execute format('drop table %s restrict', target);
end;
$$;

-- ---------------------------------------------------------------------------
-- 51045: remove archive operable gate; restore forwarders to native bodies
-- ---------------------------------------------------------------------------
do $e$
begin
  if to_regprocedure('private.enterprise_business_native_authorize(uuid)') is not null then
    execute $fn$
      create or replace function private.enterprise_authorize(cid uuid) returns uuid
      language plpgsql volatile security definer set search_path='' as $$
      begin
        return private.enterprise_business_native_authorize(cid);
      end; $$;
    $fn$;
  end if;
  if to_regprocedure('private.enterprise_business_native_can(uuid,uuid,uuid,text)') is not null then
    execute $fn$
      create or replace function private.enterprise_can(cid uuid, bid uuid, uid uuid, cap text) returns boolean
      language plpgsql volatile security definer set search_path='' as $$
      begin
        return private.enterprise_business_native_can(cid, bid, uid, cap);
      end; $$;
    $fn$;
  end if;
  if to_regprocedure('private.enterprise_business_native_accept_invite(text)') is not null then
    execute $fn$
      create or replace function public.enterprise_accept_invite(p_token_hash text) returns jsonb
      language plpgsql volatile security definer set search_path='' as $$
      begin
        return private.enterprise_business_native_accept_invite(p_token_hash);
      end; $$;
    $fn$;
  end if;
  if to_regprocedure('private.enterprise_business_native_accept_staff(text)') is not null then
    execute $fn$
      create or replace function public.accept_staff_invitation(p_token_hash text) returns jsonb
      language plpgsql volatile security definer set search_path='' as $$
      begin
        return private.enterprise_business_native_accept_staff(p_token_hash);
      end; $$;
    $fn$;
  end if;
end;
$e$;
select private.wp01a_cleanup_drop_function_if_unused('private.enterprise_business_operable(uuid)');

-- ---------------------------------------------------------------------------
-- 40120 / 80217: restore pre-smart G03 readiness/manifest, then drop smart review
-- ---------------------------------------------------------------------------
create or replace function private.g03_manifest(p_company_id uuid, p_requester uuid) returns jsonb
language sql stable security definer set search_path='' as $$
select jsonb_build_object('company',to_jsonb(c)-'created_at'-'updated_at',
  'requester',jsonb_build_object('user_id',p_requester,
    'verified_email',coalesce((select u.email_confirmed_at is not null from auth.users u where u.id=p_requester),false),
    'email_sha256',(select private.g03_sha(lower(coalesce(u.email,''))) from auth.users u where u.id=p_requester),'active_owner',exists(
    select 1 from public.company_members m where m.company_id=c.id and m.user_id=p_requester and m.role='owner' and m.status='active')),
  'sources',coalesce((select jsonb_agg(jsonb_build_object(
    'id',k.id,'company_id',k.company_id,'kind',k.kind,'title',k.title,'usage_role',k.usage_role,
    'status',k.status,'content_version',k.content_version,'text_sha256',private.g03_sha(k.content),
    'approved_for_answers',k.approved_for_answers,'approved_version',k.approved_version,'approved_at',k.approved_at,'approved_by',k.approved_by,
    'storage_path',k.storage_path,'file_name',k.file_name,'content_type',k.content_type,'byte_size',k.byte_size,
    'prepared_file_sha256',k.prepared_file_sha256,'prepared_text_sha256',k.prepared_text_sha256,'prepared_content_version',k.prepared_content_version)
    order by k.id) from public.knowledge_sources k where k.company_id=c.id),'[]'::jsonb))
from public.companies c where c.id=p_company_id;
$$;

create or replace function private.g03_readiness(p_company_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare n integer;
begin
  if not exists(select 1 from public.companies where id=p_company_id and status<>'suspended'
    and btrim(display_name)<>'' and btrim(business_type)<>'' and btrim(hours)<>'' ) then return 'PROFILE_INCOMPLETE';end if;
  select count(*) into n from public.knowledge_sources where company_id=p_company_id
    and status='ready' and approved_for_answers and approved_version=content_version and btrim(content)<>'';
  if n>40 then return 'SOURCE_LIMIT';end if;
  if not exists(select 1 from public.knowledge_sources where company_id=p_company_id and usage_role='knowledge'
    and status='ready' and approved_for_answers and approved_version=content_version and btrim(content)<>'') then return 'KNOWLEDGE_INCOMPLETE';end if;
  if exists(select 1 from public.knowledge_sources where company_id=p_company_id and kind='file'
    and status='ready' and approved_for_answers and approved_version=content_version and btrim(content)<>''
    and (prepared_file_sha256 is null or prepared_content_version is distinct from content_version
      or prepared_text_sha256 is distinct from private.g03_sha(content))) then return 'FILE_REPREPARE_REQUIRED';end if;
  return 'OK';
end; $$;

select private.wp01a_cleanup_drop_function_if_unused('public.smart_review_configuration(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.smart_review_ownership_allowed(uuid,text,text)');
select private.wp01a_cleanup_drop_function_if_unused('private.smart_review_scope(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.smart_review_enabled(uuid)');
select private.wp01a_cleanup_drop_table_if_unused('private.smart_review_policy');

-- ---------------------------------------------------------------------------
-- 80155 / 80108 smart setup RPCs + private tables (NOT public.company_branches)
-- ---------------------------------------------------------------------------
select private.wp01a_cleanup_drop_function_if_unused('public.rename_smart_branch(uuid,uuid,uuid,uuid,text,text)');
select private.wp01a_cleanup_drop_function_if_unused('public.create_smart_branch(uuid,uuid,uuid,text,text)');
select private.wp01a_cleanup_drop_function_if_unused('public.create_smart_business(uuid,uuid,text,text,text)');
select private.wp01a_cleanup_drop_function_if_unused('public.save_smart_branch_setup_v2(uuid,uuid,uuid,uuid,integer,text,text,text)');
select private.wp01a_cleanup_drop_function_if_unused('public.save_smart_profile(uuid,uuid,uuid,bigint,text,jsonb)');
select private.wp01a_cleanup_drop_function_if_unused('public.read_smart_profile(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.read_smart_branch_setup(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.save_smart_branch_setup(uuid,integer,text,text,text)');

select private.wp01a_cleanup_drop_function_if_unused('private.smart_profile_receipt(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.smart_payload_hash(jsonb)');
select private.wp01a_cleanup_drop_function_if_unused('private.smart_profile_payload(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.smart_branch_setup_receipt(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.smart_new_company_branch()');
select private.wp01a_cleanup_drop_function_if_unused('private.smart_setup_commit(uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.smart_setup_authorize(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.smart_setup_owner(uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.smart_setup_actor()');

drop trigger if exists smart_primary_branch on public.companies;

select private.wp01a_cleanup_drop_table_if_unused('private.smart_save_attempts');
select private.wp01a_cleanup_drop_table_if_unused('private.smart_profile_revisions');
select private.wp01a_cleanup_drop_table_if_unused('private.smart_branch_audit');
select private.wp01a_cleanup_drop_table_if_unused('private.smart_branch_setup');
-- public.company_branches KEEP (enterprise_branch_authority / Auth fixture)

-- ---------------------------------------------------------------------------
-- 33012 admin cycle cost RPCs only (preserve public.master_ai_cycle_costs)
-- ---------------------------------------------------------------------------
select private.wp01a_cleanup_drop_function_if_unused('public.master_admin_read_ai_cycle_costs(uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_admin_ai_cost_cycles(uuid,timestamptz,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_admin_ai_cost_companies(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_admin_cost_authorized()');

-- ---------------------------------------------------------------------------
-- 33011 archive / deletion request surfaces (+ column archived_at)
-- ---------------------------------------------------------------------------
drop policy if exists master_archive_knowledge_insert on public.knowledge_sources;
drop policy if exists master_archive_knowledge_update on public.knowledge_sources;
drop policy if exists master_archive_knowledge_delete on public.knowledge_sources;
drop policy if exists master_archive_storage_insert on storage.objects;
drop policy if exists master_archive_storage_update on storage.objects;
drop policy if exists master_archive_storage_delete on storage.objects;
drop trigger if exists master_archive_profile_guard on public.companies;
drop trigger if exists master_archive_draft_write_guard on public.company_setup_drafts;
drop trigger if exists master_archive_source_write_guard on public.knowledge_sources;
drop trigger if exists master_archive_channel_write_guard on private.company_selected_channels;

select private.wp01a_cleanup_drop_function_if_unused('public.master_request_business_deletion(uuid,uuid,bigint,uuid,text)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_set_business_archive(uuid,uuid,bigint,boolean)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_business_workspace_allowed(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_list_owned_businesses(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_archive_company_write_guard()');
select private.wp01a_cleanup_drop_function_if_unused('private.master_archive_profile_guard()');
select private.wp01a_cleanup_drop_function_if_unused('private.master_archive_storage_writable(text)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_business_lifecycle_receipt(public.companies)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_archive_owner(uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_company_not_archived(uuid)');

select private.wp01a_cleanup_drop_table_if_unused('private.master_business_deletion_requests');
select private.wp01a_cleanup_drop_table_if_unused('private.master_business_deletion_policy');
select private.wp01a_cleanup_drop_table_if_unused('private.master_business_lifecycle_audit');
select private.wp01a_cleanup_drop_table_if_unused('private.master_business_archive_settings');

alter table public.companies drop column if exists archived_at;

-- ---------------------------------------------------------------------------
-- 33010 knowledge import
-- ---------------------------------------------------------------------------
select private.wp01a_cleanup_drop_function_if_unused('public.master_read_knowledge_import(uuid,uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_confirm_knowledge_import(uuid,uuid,uuid,bigint,text)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_stage_knowledge_import(uuid,uuid,uuid,text,text,boolean,bigint)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_import_context(uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_import_receipt(private.master_knowledge_import_previews)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_import_lock_writer(uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_import_catalog(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_import_writer(uuid,uuid)');
select private.wp01a_cleanup_drop_table_if_unused('private.master_knowledge_import_previews');
select private.wp01a_cleanup_drop_table_if_unused('private.master_knowledge_import_settings');

-- ---------------------------------------------------------------------------
-- 33008 wallet / autorenew (NOT billing_orders / payment_attempts / provider_events)
-- Drop RPCs/triggers first, then tables in dependency order.
-- ---------------------------------------------------------------------------
drop trigger if exists master_bind_renewal_order on public.billing_orders;
drop trigger if exists master_pin_wallet_order on public.billing_orders;
drop trigger if exists master_wallet_lifecycle_fence on public.billing_provider_events;
drop trigger if exists master_recurring_failed_event on public.billing_provider_events;
drop trigger if exists master_checkout_partial_consent on private.master_checkout_consents;
drop trigger if exists master_wallet_ledger_guard on private.master_wallet_ledger;

select private.wp01a_cleanup_drop_function_if_unused('public.master_authorize_renewal_notice(uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_authorize_renewal_attempt(uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.billing_live_owner(uuid,uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_recurring_failed_event()');
select private.wp01a_cleanup_drop_function_if_unused('private.master_recurring_actor_allowed(uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_wallet_lifecycle_fence()');
select private.wp01a_cleanup_drop_function_if_unused('private.master_excess_reversed(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_wallet_pay_renewal(uuid,uuid,uuid,uuid,bigint,text,boolean,text)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_finalize_cycle_payment(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_pin_wallet_order()');
select private.wp01a_cleanup_drop_function_if_unused('public.master_claim_renewal_candidate()');
select private.wp01a_cleanup_drop_function_if_unused('public.master_set_auto_renew(uuid,uuid,uuid,boolean,text,boolean,uuid,bigint,text,timestamptz)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_mandate_ready(uuid,uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_read_renewal_wallet(uuid,uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_sync_auto_renew_locked(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_finish_renewal_notice(uuid,uuid,text,text)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_claim_renewal_notice()');
select private.wp01a_cleanup_drop_function_if_unused('public.master_record_recurring_failure(uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_record_recurring_unknown(uuid,uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_record_recurring_submission(uuid,uuid,text,text)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_bind_renewal_order()');
select private.wp01a_cleanup_drop_function_if_unused('private.master_ensure_renewal_cycle(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_renewal_source(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_request_excess_refund(uuid,uuid,uuid,uuid,text)');
select private.wp01a_cleanup_drop_function_if_unused('public.master_convert_excess_to_wallet(uuid,uuid,uuid,uuid,text,boolean,text)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_wallet_ledger_guard()');
select private.wp01a_cleanup_drop_function_if_unused('private.master_wallet_balance(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_capture_excess_collection(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_native_payment_event(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_checkout_channel_quote_ready(uuid)');
select private.wp01a_cleanup_drop_function_if_unused('private.master_checkout_partial_consent()');

select private.wp01a_cleanup_drop_table_if_unused('private.master_renewal_notices');
select private.wp01a_cleanup_drop_table_if_unused('private.master_renewal_attempts');
select private.wp01a_cleanup_drop_table_if_unused('private.master_renewal_order_cycles');
select private.wp01a_cleanup_drop_table_if_unused('private.master_renewal_cycles');
select private.wp01a_cleanup_drop_table_if_unused('private.master_autorenew_preferences');
select private.wp01a_cleanup_drop_table_if_unused('private.master_autorenew_agreements');
select private.wp01a_cleanup_drop_table_if_unused('private.master_recurring_mandate_revocations');
select private.wp01a_cleanup_drop_table_if_unused('private.master_recurring_mandates');
select private.wp01a_cleanup_drop_table_if_unused('private.master_recurring_provider_status');
select private.wp01a_cleanup_drop_table_if_unused('private.master_recurring_provider_contracts');
select private.wp01a_cleanup_drop_table_if_unused('private.master_wallet_ledger');
select private.wp01a_cleanup_drop_table_if_unused('private.master_wallet_accounts');
select private.wp01a_cleanup_drop_table_if_unused('private.master_wallet_refund_requests');
select private.wp01a_cleanup_drop_table_if_unused('private.master_wallet_conversion_consents');
select private.wp01a_cleanup_drop_table_if_unused('private.master_excess_collections');
select private.wp01a_cleanup_drop_table_if_unused('private.master_wallet_policy');
select private.wp01a_cleanup_drop_table_if_unused('private.master_wallet_legal_terms');
select private.wp01a_cleanup_drop_table_if_unused('private.master_checkout_partial_disclosure_policy');

-- Preserve: auth.*, companies (minus archived_at), company_members, company_branches,
-- billing_orders, billing_payment_attempts, billing_provider_events,
-- billing_entitlement_applications, billing_subscriptions, vel_broker_*, session gates.

do $probe$
begin
  if to_regclass('private.master_wallet_ledger') is not null
     or to_regclass('private.smart_branch_setup') is not null
     or to_regprocedure('public.create_smart_business(uuid,uuid,text,text,text)') is not null
     or to_regprocedure('private.billing_live_owner(uuid,uuid,uuid)') is not null then
    raise exception 'CLEANUP_PHASE_B_OBJECTS_REMAIN';
  end if;
  if to_regprocedure('public.check_app_session(boolean)') is null
     or to_regprocedure('public.accept_staff_invitation(text)') is null
     or to_regclass('public.company_branches') is null
     or to_regclass('public.billing_orders') is null then
    raise exception 'CLEANUP_PHASE_B_REMOVED_KEEP_SHARED';
  end if;
end;
$probe$;
