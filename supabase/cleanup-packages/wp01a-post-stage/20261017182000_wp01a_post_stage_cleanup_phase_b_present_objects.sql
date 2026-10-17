-- Safe Phase B apply for catalogs that only have the present smart/review/live_owner footprint.
-- Applied on vmpifljyozsbtssxhoxd as migration wp01a_post_stage_cleanup_phase_b_present_objects (2026-10-17).
-- No CASCADE. No auth.* / billing receipt tables.
-- Phase A stubs already absent on this project.

select set_config('velora.cleanup_approval', 'WP01A-POST-STAGE-PHASE-B', true);

do $gate$
begin
  if current_setting('velora.cleanup_approval', true) is distinct from 'WP01A-POST-STAGE-PHASE-B' then
    raise exception 'CLEANUP_APPROVAL_REQUIRED:WP01A-POST-STAGE-PHASE-B';
  end if;
end;
$gate$;

do $g03$
begin
  if to_regprocedure('private.g03_readiness_before_smart(uuid)') is not null then
    execute $fn$
      create or replace function private.g03_readiness(p_company_id uuid) returns text
      language plpgsql stable security definer set search_path = '' as $body$
      begin
        return private.g03_readiness_before_smart(p_company_id);
      end;
      $body$;
    $fn$;
  end if;
  if to_regprocedure('private.g03_manifest_before_smart(uuid,uuid)') is not null then
    execute $fn$
      create or replace function private.g03_manifest(p_company_id uuid, p_requester uuid) returns jsonb
      language sql stable security definer set search_path = '' as $body$
        select private.g03_manifest_before_smart(p_company_id, p_requester);
      $body$;
    $fn$;
  end if;
end;
$g03$;

drop function if exists public.smart_review_configuration(uuid) restrict;
drop function if exists public.rename_smart_branch(uuid, uuid, uuid, uuid, text, text) restrict;
drop function if exists public.create_smart_branch(uuid, uuid, uuid, text, text) restrict;
drop function if exists public.create_smart_business(uuid, uuid, text, text, text) restrict;
drop function if exists public.save_smart_branch_setup_v2(uuid, uuid, uuid, uuid, integer, text, text, text) restrict;
drop function if exists public.save_smart_profile(uuid, uuid, uuid, bigint, text, jsonb) restrict;
drop function if exists public.read_smart_profile(uuid) restrict;
drop function if exists public.read_smart_branch_setup(uuid) restrict;

drop function if exists private.smart_review_ownership_allowed(uuid, text, text) restrict;
drop function if exists private.smart_review_scope(uuid) restrict;
drop function if exists private.smart_review_enabled(uuid) restrict;
drop function if exists private.smart_branch_setup_receipt(uuid) restrict;
drop function if exists private.smart_profile_receipt(uuid) restrict;
drop function if exists private.smart_payload_hash(jsonb) restrict;
drop function if exists private.smart_profile_payload(uuid) restrict;
drop function if exists private.smart_setup_commit(uuid, uuid) restrict;
drop function if exists private.smart_setup_authorize(uuid) restrict;
drop function if exists private.smart_setup_owner(uuid, uuid) restrict;
drop function if exists private.smart_setup_actor() restrict;

drop trigger if exists smart_primary_branch on public.companies;
drop function if exists private.smart_new_company_branch() restrict;

drop table if exists private.smart_save_attempts restrict;
drop table if exists private.smart_profile_revisions restrict;
drop table if exists private.smart_branch_audit restrict;
drop table if exists private.smart_branch_setup restrict;
drop table if exists private.smart_review_policy restrict;

drop function if exists private.billing_live_owner(uuid, uuid, uuid) restrict;

do $probe$
begin
  if to_regprocedure('public.create_smart_business(uuid,uuid,text,text,text)') is not null
     or to_regclass('private.smart_branch_setup') is not null
     or to_regclass('private.smart_review_policy') is not null
     or to_regprocedure('private.billing_live_owner(uuid,uuid,uuid)') is not null then
    raise exception 'CLEANUP_PHASE_B_PRESENT_OBJECTS_REMAIN';
  end if;
  if to_regprocedure('public.check_app_session(boolean)') is null
     or to_regprocedure('public.accept_staff_invitation(text)') is null
     or to_regclass('public.company_branches') is null
     or to_regclass('public.billing_orders') is null
     or to_regprocedure('private.g03_readiness(uuid)') is null then
    raise exception 'CLEANUP_PHASE_B_REMOVED_KEEP_SHARED';
  end if;
end;
$probe$;
