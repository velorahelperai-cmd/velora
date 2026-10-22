-- GENERATED LOCAL-ONLY CANDIDATE. Production installation is NOT approved.
-- Generated from the adjacent reviewed fragments; do not hand-edit this file.
begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
do $local_only$ begin
 if current_database()<>'c1_ui_integration' or inet_client_addr() is not null then
  raise exception 'LOCAL_ONLY_ES02_CANDIDATE_PRODUCTION_REVIEW_REQUIRED';
 end if;
 if to_regclass('private.es02_reply_credit_holds') is not null then
  raise exception 'ES02_CANDIDATE_ALREADY_PRESENT_INSPECT_INSTEAD_OF_REAPPLY';
 end if;
end;$local_only$;
do $baseline_guard$ declare dep jsonb; begin
 for dep in select value from jsonb_array_elements($baseline$[{"acl":"{postgres=X/postgres}","hash":"f823ca2420e388d4d03f88d0f650169e","owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"private.es02_b3_current_binding(uuid,uuid,uuid,text)"},{"acl":"{postgres=X/postgres}","hash":"3206dfeb2548429bc536fee3d0ee0a25","owner":"postgres","config":["search_path=\"\""],"definer":false,"signature":"private.es02_b3_pin_matches(private.es02_b3_connection_attempts,jsonb)"},{"acl":"{postgres=X/postgres}","hash":"fd5fce85731f09329b0fbfb3dcf31098","owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"private.es02_b3_project(uuid,uuid,uuid,text)"},{"acl":"{postgres=X/postgres}","hash":"ece63b808ad811a89f22fd28cb25399f","owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"private.wa_frame_pre_meta_policy(uuid,uuid)"},{"acl":"{postgres=X/postgres}","hash":"c91188d4dfb33979efbe90db5f2aeeee","owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"private.whatsapp_answer_profile(uuid,uuid)"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","hash":"eb043ea32f66863805aba475d8190b3e","owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"public.ai_start_whatsapp_attempt(uuid,uuid)"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","hash":"1ae5ded598580b7379bf71ac09bc9bc4","owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"public.billing_finalize_automated_usage(uuid,uuid)"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","hash":"a67a2bd638c257b3cb23f44d42015afc","owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"public.billing_load_worker_frame(uuid,uuid)"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","hash":"b8d5cf04fecc2de9bedcf8137de4f4b9","owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"public.create_whatsapp_assistant_send_intent(text,uuid,text,text,integer,uuid,bigint)"},{"acl":"{postgres=X/postgres,authenticated=X/postgres}","hash":"86a70b98cb11a9dcfd8669617eb4f60e","owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"public.es02_reconcile_activation_readiness(uuid,uuid)"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","hash":"b800b6420711dcb050dd8f7b858f52e6","owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"public.whatsapp_claim_assistant_job_send(uuid,uuid)"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","hash":"88e06bb8fdd5091ad12106814ff7c370","owner":"postgres","config":["search_path=\"\"","jit=off"],"definer":true,"signature":"public.whatsapp_reserve_job_usage(uuid,uuid)"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","hash":"5af35074c8ae6df08cc9ed1551057935","owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text)"},{"acl":"{postgres=X/postgres,service_role=X/postgres}","hash":"ae04a08e8d81adcad51b1b52efa07632","owner":"postgres","config":["search_path=\"\""],"definer":true,"signature":"public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb)"}]$baseline$::jsonb) loop
  if not exists(select 1 from pg_proc p where p.oid=to_regprocedure(dep->>'signature')
   and md5(replace(p.prosrc,chr(13),''))=dep->>'hash'
   and pg_get_userbyid(p.proowner)=dep->>'owner' and p.prosecdef=(dep->>'definer')::boolean
   and coalesce(to_jsonb(p.proconfig),'null'::jsonb)=dep->'config'
   and p.proacl::text is not distinct from dep->>'acl') then
   raise exception 'ES02_LOCAL_BASELINE_CHANGED:%',dep->>'signature';
  end if;
 end loop;
end;$baseline_guard$;

-- SOURCE 20261020150000_es02_single_branch_scope.sql sha256=ff92b34d2f939d12fc69eab3c9e90071bb74a18c22970d2ee939259c0c973e17
-- Filename: 20261020150000_es02_single_branch_scope.sql
-- Current product scope: ONE branch per business. Multi-branch support is
-- DEFERRED (docs/MASTER_PLAN.md "Single-branch current scope"), not removed.
-- Additive only: no table/column/policy/grant removal, no existing row is
-- converted, merged, archived or re-parented. Existing multi-branch rows (for
-- example historical fixtures) remain readable and keep their isolation.
-- The guard blocks only the INSERT of an additional setup/active branch for a
-- company that already has one, from every path (Smart, enterprise, ES02
-- provisioning of multi-slot orders, direct SQL by owner roles).
-- Rollback: update private.es02_gates set enabled=false where name='single_branch_scope'.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regclass('public.company_branches') is null then
    raise exception 'ES02_SINGLE_BRANCH_BASELINE_MISSING';
  end if;
end;
$guard$;

create table if not exists private.es02_gates (
  name text primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.es02_gates owner to postgres;
alter table private.es02_gates enable row level security;
revoke all on table private.es02_gates from public, anon, authenticated;
grant all on table private.es02_gates to service_role;

insert into private.es02_gates(name, enabled) values ('single_branch_scope', true)
  on conflict (name) do nothing;

create or replace function private.es02_single_branch_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status not in ('setup', 'active') then
    return new;
  end if;
  if coalesce((select g.enabled from private.es02_gates g where g.name = 'single_branch_scope'), true) is distinct from true then
    return new;
  end if;
  -- On update, grandfather branches already setup/active in the same company
  if tg_op = 'UPDATE' and old.status in ('setup', 'active') and old.company_id = new.company_id then
    return new;
  end if;
  -- Serialize concurrent first/second inserts or promotions for the same company.
  perform pg_catalog.pg_advisory_xact_lock(87420401, pg_catalog.hashtext(new.company_id::text));
  if exists (
    select 1 from public.company_branches b
    where b.company_id = new.company_id
      and b.id is distinct from new.id
      and b.status in ('setup', 'active')
  ) then
    raise exception 'SECOND_BRANCH_DEFERRED' using errcode = 'P0001',
      hint = 'Multi-branch support is deferred; current scope is one branch per business.';
  end if;
  return new;
end;
$$;

alter function private.es02_single_branch_guard() owner to postgres;
revoke all on function private.es02_single_branch_guard() from public, anon, authenticated, service_role;

drop trigger if exists es02_single_branch_scope on public.company_branches;
create trigger es02_single_branch_scope
  before insert or update of company_id, status on public.company_branches
  for each row execute function private.es02_single_branch_guard();

notify pgrst, 'reload schema';


-- SOURCE 20261020153000_es02_b4_branch_hours.sql sha256=22fd606d964ae8bf298f3709b7644abd3f19aabb3dffb09580ee88f00e30ceeb
-- Filename: 20261020153000_es02_b4_branch_hours.sql
-- Additive B4 authoritative branch hours persistence and CAS.
-- Preserves B1, B2, B3 production migrations.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regrole('postgres') is null then
    raise exception 'ES02_B4_TRUSTED_OWNER_UNAVAILABLE';
  end if;
  if to_regprocedure('private.es02_require_active_actor(uuid)') is null
     or to_regprocedure('public.es02_read_owned_branch_setup(uuid,uuid,uuid)') is null
     or to_regprocedure('private.es02_authority_footprint_ok()') is null
     or to_regclass('private.es02_branch_slot_rights') is null
     or to_regclass('public.company_branches') is null
     or to_regclass('public.companies') is null
     or to_regclass('public.company_members') is null then
    raise exception 'ES02_B4_BASELINE_MISSING';
  end if;
end;
$guard$;

create table if not exists private.es02_branch_hours (
  company_id uuid not null,
  branch_id uuid not null,
  schedule jsonb not null,
  revision bigint not null default 0 check (revision >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_id, branch_id),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id)
);

alter table private.es02_branch_hours owner to postgres;
alter table private.es02_branch_hours enable row level security;
revoke all on table private.es02_branch_hours from public;
revoke all on table private.es02_branch_hours from anon;
revoke all on table private.es02_branch_hours from authenticated;
revoke all on table private.es02_branch_hours from service_role;

create table if not exists private.es02_branch_hours_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  branch_id uuid not null,
  revision bigint not null check (revision >= 1),
  fingerprint text not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (company_id, branch_id, revision),
  unique (company_id, branch_id, fingerprint),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id)
);

alter table private.es02_branch_hours_receipts owner to postgres;
alter table private.es02_branch_hours_receipts enable row level security;
revoke all on table private.es02_branch_hours_receipts from public;
revoke all on table private.es02_branch_hours_receipts from anon;
revoke all on table private.es02_branch_hours_receipts from authenticated;
revoke all on table private.es02_branch_hours_receipts from service_role;

create or replace function private.es02_branch_hours_timezone_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.timezone is distinct from new.timezone then
    update private.es02_branch_hours
    set revision = revision + 1, updated_at = clock_timestamp()
    where company_id = new.company_id and branch_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists es02_branch_hours_timezone_invalidation_trg on public.company_branches;
create trigger es02_branch_hours_timezone_invalidation_trg
after update of timezone on public.company_branches
for each row
execute function private.es02_branch_hours_timezone_invalidation();

create or replace function private.es02_validate_branch_hours_schedule(p_schedule jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_days text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  d text;
  day_val jsonb;
  st text;
  intervals jsonb;
  elem jsonb;
  s_str text;
  e_str text;
  nd boolean;
  s_m int;
  e_m int;
  day_index int := 0;
  span_start int;
  span_end int;
  span_starts int[] := array[]::int[];
  span_ends int[] := array[]::int[];
  previous_index int;
  week_offset int;
begin
  if p_schedule is null or jsonb_typeof(p_schedule) <> 'object' then
    return false;
  end if;
  if (select count(*) from jsonb_object_keys(p_schedule)) <> 7 then
    return false;
  end if;
  foreach d in array v_days loop
    if not (p_schedule ? d) then
      return false;
    end if;
    day_val := p_schedule->d;
    if jsonb_typeof(day_val) is distinct from 'object'
       or jsonb_typeof(day_val->'state') is distinct from 'string' then
      return false;
    end if;
    st := day_val->>'state';
    if st not in ('unset', 'closed', 'open') then
      return false;
    end if;
    if st in ('unset', 'closed') then
      if (select count(*) from jsonb_object_keys(day_val)) <> 1 then
        return false;
      end if;
    elsif st = 'open' then
      if (select count(*) from jsonb_object_keys(day_val)) <> 2 or not (day_val ? 'intervals') then
        return false;
      end if;
      intervals := day_val->'intervals';
      if jsonb_typeof(intervals) <> 'array' or jsonb_array_length(intervals) = 0 then
        return false;
      end if;
      for elem in select * from jsonb_array_elements(intervals) loop
        if jsonb_typeof(elem) <> 'object' or not (elem ? 'start') or not (elem ? 'end') or not (elem ? 'nextDay') then
          return false;
        end if;
        if (select count(*) from jsonb_object_keys(elem)) <> 3 then
          return false;
        end if;
        s_str := elem->>'start';
        e_str := elem->>'end';
        if jsonb_typeof(elem->'nextDay') is distinct from 'boolean'
           or jsonb_typeof(elem->'start') is distinct from 'string'
           or jsonb_typeof(elem->'end') is distinct from 'string' then
          return false;
        end if;
        if s_str !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' or e_str !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' then
          return false;
        end if;
        s_m := (substring(s_str from 1 for 2))::int * 60 + (substring(s_str from 4 for 2))::int;
        e_m := (substring(e_str from 1 for 2))::int * 60 + (substring(e_str from 4 for 2))::int;
        nd := (elem->>'nextDay')::boolean;
        if nd then
          e_m := e_m + 1440;
        end if;
        if e_m <= s_m then
          return false;
        end if;
        span_start := day_index * 1440 + s_m;
        span_end := day_index * 1440 + e_m;
        -- Match the existing local-week contract, including Sunday -> Monday.
        -- Touching endpoints are valid; timezone/DST conversion is not inferred.
        for previous_index in 1..coalesce(array_length(span_starts, 1), 0) loop
          foreach week_offset in array array[-10080, 0, 10080] loop
            if greatest(span_start, span_starts[previous_index] + week_offset)
               < least(span_end, span_ends[previous_index] + week_offset) then
              return false;
            end if;
          end loop;
        end loop;
        span_starts := array_append(span_starts, span_start);
        span_ends := array_append(span_ends, span_end);
      end loop;
    end if;
    day_index := day_index + 1;
  end loop;
  return true;
end;
$$;

create or replace function public.es02_read_owned_branch_hours(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
  branch public.company_branches%rowtype;
  hours_row private.es02_branch_hours%rowtype;
  empty_sched jsonb := '{"monday":{"state":"unset"},"tuesday":{"state":"unset"},"wednesday":{"state":"unset"},"thursday":{"state":"unset"},"friday":{"state":"unset"},"saturday":{"state":"unset"},"sunday":{"state":"unset"}}'::jsonb;
  sched jsonb;
  rev bigint := 0;
  conf text := 'unset';
  copy_targets jsonb := '[]'::jsonb;
  target_rec record;
  d text;
  has_unset boolean := false;
  v_days text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select * into branch
  from public.company_branches
  where company_id = p_company_id and id = p_branch_id;
  if branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;

  if branch.timezone is null or not exists (select 1 from pg_timezone_names where name = branch.timezone) then
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_TIMEZONE');
  end if;

  select * into hours_row
  from private.es02_branch_hours
  where company_id = p_company_id and branch_id = p_branch_id;

  if hours_row.company_id is not null then
    sched := hours_row.schedule;
    rev := hours_row.revision;
  else
    sched := empty_sched;
    rev := 0;
  end if;

  if rev > 0 then
    foreach d in array v_days loop
      if sched->d->>'state' = 'unset' then
        has_unset := true;
        exit;
      end if;
    end loop;
    if has_unset then
      conf := 'saved';
    else
      conf := 'confirmed';
    end if;
  end if;

  for target_rec in
    select b.id, b.name, b.timezone, coalesce(h.revision, 0) as version
    from public.company_branches b
    left join private.es02_branch_hours h on h.company_id = b.company_id and h.branch_id = b.id
    where b.company_id = p_company_id and b.id <> p_branch_id and b.status in ('setup', 'active')
    order by b.is_primary desc, b.name, b.id
  loop
    copy_targets := copy_targets || jsonb_build_array(jsonb_build_object(
      'branchId', target_rec.id,
      'label', target_rec.name,
      'timezone', target_rec.timezone,
      'version', target_rec.version
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', rev,
        'branchLabel', branch.name,
        'timezone', branch.timezone,
        'schedule', sched
      ),
      'copyTargets', copy_targets,
      'capabilities', jsonb_build_object(
        'canSave', true,
        'canCopy', jsonb_array_length(copy_targets) > 0
      ),
      'confirmation', conf
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_save_owned_branch_hours(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_expected_revision bigint,
  p_schedule jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
  branch public.company_branches%rowtype;
  current_rev bigint := 0;
  next_rev bigint;
  fp text;
  receipt_found boolean := false;
  conf text := 'unset';
  d text;
  has_unset boolean := false;
  v_days text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null
     or p_expected_revision is null or p_expected_revision < 0 or p_schedule is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  if not private.es02_validate_branch_hours_schedule(p_schedule) then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SCHEDULE');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select * into branch
  from public.company_branches
  where company_id = p_company_id and id = p_branch_id
  for update;

  if branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;

  if branch.timezone is null or not exists (select 1 from pg_timezone_names where name = branch.timezone) then
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_TIMEZONE');
  end if;

  select revision into current_rev
  from private.es02_branch_hours
  where company_id = p_company_id and branch_id = p_branch_id
  for update;

  if current_rev is null then
    current_rev := 0;
  end if;

  fp := md5(concat_ws(':', p_expected_revision::text, p_schedule::text));

  -- Idempotent duplicate check: same payload and expected revision already resulted in current_rev
  if current_rev = p_expected_revision + 1 then
    select exists (
      select 1 from private.es02_branch_hours_receipts
      where company_id = p_company_id and branch_id = p_branch_id and revision = current_rev and fingerprint = fp
    ) into receipt_found;

    if receipt_found then
      foreach d in array v_days loop
        if p_schedule->d->>'state' = 'unset' then
          has_unset := true;
          exit;
        end if;
      end loop;
      conf := case when has_unset then 'saved' else 'confirmed' end;

      return jsonb_build_object(
        'ok', true,
        'data', jsonb_build_object(
          'snapshot', jsonb_build_object(
            'scope', jsonb_build_object(
              'expectedAccountId', p_expected_account_id,
              'companyId', p_company_id,
              'branchId', p_branch_id
            ),
            'version', current_rev,
            'branchLabel', branch.name,
            'timezone', branch.timezone,
            'schedule', p_schedule
          ),
          'receipt', jsonb_build_object(
            'branchId', p_branch_id,
            'version', current_rev,
            'fingerprint', fp
          )
        )
      );
    end if;
  end if;

  if current_rev <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  next_rev := current_rev + 1;

  insert into private.es02_branch_hours (company_id, branch_id, schedule, revision, updated_at)
  values (p_company_id, p_branch_id, p_schedule, next_rev, clock_timestamp())
  on conflict (company_id, branch_id)
  do update set
    schedule = excluded.schedule,
    revision = excluded.revision,
    updated_at = excluded.updated_at;

  insert into private.es02_branch_hours_receipts (company_id, branch_id, revision, fingerprint)
  values (p_company_id, p_branch_id, next_rev, fp)
  on conflict (company_id, branch_id, revision) do nothing;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', next_rev,
        'branchLabel', branch.name,
        'timezone', branch.timezone,
        'schedule', p_schedule
      ),
      'receipt', jsonb_build_object(
        'branchId', p_branch_id,
        'version', next_rev,
        'fingerprint', fp
      )
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_copy_owned_branch_hours(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_source_branch_id uuid,
  p_expected_source_revision bigint,
  p_targets jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
  source_branch public.company_branches%rowtype;
  source_hours private.es02_branch_hours%rowtype;
  target_elem jsonb;
  target_id uuid;
  target_expected_rev bigint;
  target_branch public.company_branches%rowtype;
  target_current_rev bigint;
  target_next_rev bigint;
  fp text;
  receipt_id uuid;
  results jsonb := '[]'::jsonb;
  all_targets jsonb := '[]'::jsonb;
  target_rec record;
begin
  if p_expected_account_id is null or p_company_id is null or p_source_branch_id is null
     or p_expected_source_revision is null or p_expected_source_revision < 0
     or p_targets is null or jsonb_typeof(p_targets) <> 'array' or jsonb_array_length(p_targets) = 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_source_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select * into source_branch
  from public.company_branches
  where company_id = p_company_id and id = p_source_branch_id
  for update;

  if source_branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;

  if source_branch.timezone is null or not exists (select 1 from pg_timezone_names where name = source_branch.timezone) then
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_TIMEZONE');
  end if;

  select * into source_hours
  from private.es02_branch_hours
  where company_id = p_company_id and branch_id = p_source_branch_id
  for update;

  if coalesce(source_hours.revision, 0) <> p_expected_source_revision then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  -- Validate and apply each target atomically
  for target_elem in select * from jsonb_array_elements(p_targets) loop
    target_id := (target_elem->>'branchId')::uuid;
    target_expected_rev := (target_elem->>'expectedVersion')::bigint;

    if target_id is null or target_id = p_source_branch_id or target_expected_rev is null or target_expected_rev < 0 then
      return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
    end if;

    select * into target_branch
    from public.company_branches
    where company_id = p_company_id and id = target_id
    for update;

    if target_branch.id is null then
      return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
    end if;

    if target_branch.timezone is null or not exists (select 1 from pg_timezone_names where name = target_branch.timezone) then
      return jsonb_build_object('ok', false, 'code', 'UNKNOWN_TIMEZONE');
    end if;

    select revision into target_current_rev
    from private.es02_branch_hours
    where company_id = p_company_id and branch_id = target_id
    for update;

    if target_current_rev is null then
      target_current_rev := 0;
    end if;

    if target_current_rev <> target_expected_rev then
      return jsonb_build_object('ok', false, 'code', 'CONFLICT');
    end if;

    target_next_rev := target_current_rev + 1;
    fp := md5(concat_ws(':', 'copy', target_expected_rev::text, source_hours.schedule::text));

    insert into private.es02_branch_hours (company_id, branch_id, schedule, revision, updated_at)
    values (p_company_id, target_id, source_hours.schedule, target_next_rev, clock_timestamp())
    on conflict (company_id, branch_id)
    do update set
      schedule = excluded.schedule,
      revision = excluded.revision,
      updated_at = excluded.updated_at;

    insert into private.es02_branch_hours_receipts (company_id, branch_id, revision, fingerprint)
    values (p_company_id, target_id, target_next_rev, fp)
    on conflict (company_id, branch_id, revision) do update set fingerprint = excluded.fingerprint
    returning id into receipt_id;

    results := results || jsonb_build_array(jsonb_build_object(
      'branchId', target_id,
      'version', target_next_rev,
      'receiptId', receipt_id
    ));
  end loop;

  for target_rec in
    select b.id, b.name, b.timezone, coalesce(h.revision, 0) as version
    from public.company_branches b
    left join private.es02_branch_hours h on h.company_id = b.company_id and h.branch_id = b.id
    where b.company_id = p_company_id and b.id <> p_source_branch_id and b.status in ('setup', 'active')
    order by b.is_primary desc, b.name, b.id
  loop
    all_targets := all_targets || jsonb_build_array(jsonb_build_object(
      'branchId', target_rec.id,
      'label', target_rec.name,
      'timezone', target_rec.timezone,
      'version', target_rec.version
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'results', results,
      'targets', all_targets
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

alter function public.es02_read_owned_branch_hours(uuid, uuid, uuid) owner to postgres;
revoke all on function public.es02_read_owned_branch_hours(uuid, uuid, uuid) from public, anon;
grant execute on function public.es02_read_owned_branch_hours(uuid, uuid, uuid) to authenticated;

alter function public.es02_save_owned_branch_hours(uuid, uuid, uuid, bigint, jsonb) owner to postgres;
revoke all on function public.es02_save_owned_branch_hours(uuid, uuid, uuid, bigint, jsonb) from public, anon;
grant execute on function public.es02_save_owned_branch_hours(uuid, uuid, uuid, bigint, jsonb) to authenticated;

alter function public.es02_copy_owned_branch_hours(uuid, uuid, uuid, bigint, jsonb) owner to postgres;
revoke all on function public.es02_copy_owned_branch_hours(uuid, uuid, uuid, bigint, jsonb) from public, anon;
grant execute on function public.es02_copy_owned_branch_hours(uuid, uuid, uuid, bigint, jsonb) to authenticated;



-- SOURCE 20261020180000_es02_b5_b8_branch_setup_completion.sql sha256=e0f0e1f5bb2ecafa274a8d72dc145730471fddf10f2f5bc885cc1a842bd3feb4
-- Filename: 20261020180000_es02_b5_b8_branch_setup_completion.sql
-- Additive B5, B6, B7, B8 branch-bound setup completion and launch verification.
-- Preserves B1, B2, B3, B4 production migrations.

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regrole('postgres') is null then
    raise exception 'ES02_B5_B8_TRUSTED_OWNER_UNAVAILABLE';
  end if;
  if to_regprocedure('private.es02_require_active_actor(uuid)') is null
     or to_regprocedure('public.es02_read_owned_branch_setup(uuid,uuid,uuid)') is null
     or to_regclass('private.es02_branch_slot_rights') is null
     or to_regclass('public.company_branches') is null
     or to_regclass('public.companies') is null
     or to_regclass('public.company_members') is null then
    raise exception 'ES02_B5_B8_BASELINE_MISSING';
  end if;
end;
$guard$;

create table if not exists private.es02_branch_knowledge_sources (
  company_id uuid not null,
  branch_id uuid not null,
  source_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (branch_id, source_id),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id),
  foreign key (source_id) references public.knowledge_sources (id) on delete cascade
);

alter table private.es02_branch_knowledge_sources owner to postgres;
alter table private.es02_branch_knowledge_sources enable row level security;
revoke all on table private.es02_branch_knowledge_sources from public, anon, authenticated, service_role;

create table if not exists private.es02_branch_website_pages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  branch_id uuid not null,
  url text not null,
  title text,
  extracted_text text not null default '',
  status text not null default 'pending' check (status in ('pending','indexing','indexed','failed')),
  error text,
  version integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  indexed_at timestamptz,
  unique (branch_id, url),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id)
);

alter table private.es02_branch_website_pages owner to postgres;
alter table private.es02_branch_website_pages enable row level security;
revoke all on table private.es02_branch_website_pages from public, anon, authenticated, service_role;

create table if not exists private.es02_branch_reply_language_confirmations (
  company_id uuid not null,
  branch_id uuid not null,
  reply_language text not null check (reply_language in ('ar','en','both')),
  revision bigint not null default 1,
  confirmed_at timestamptz not null default clock_timestamp(),
  primary key (company_id, branch_id),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id)
);

alter table private.es02_branch_reply_language_confirmations owner to postgres;
alter table private.es02_branch_reply_language_confirmations enable row level security;
revoke all on table private.es02_branch_reply_language_confirmations from public, anon, authenticated, service_role;

create table if not exists private.es02_branch_assistant_trials (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  branch_id uuid not null,
  question text not null,
  answer text not null,
  origin text not null check (origin in ('engine','synthetic')),
  model_id text not null,
  hours_revision bigint not null default 0,
  language_code text not null default 'ar',
  persona text not null default 'noura',
  knowledge_revision text not null default '',
  created_at timestamptz not null default clock_timestamp(),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id)
);

alter table private.es02_branch_assistant_trials owner to postgres;
alter table private.es02_branch_assistant_trials enable row level security;
revoke all on table private.es02_branch_assistant_trials from public, anon, authenticated, service_role;

create table if not exists private.es02_branch_launch_confirmations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  branch_id uuid not null,
  account_id uuid not null references auth.users (id),
  readiness_revision text not null,
  operation_id uuid not null,
  confirmed boolean not null check (confirmed = true),
  confirmed_at timestamptz not null default clock_timestamp(),
  unique (company_id, branch_id),
  unique (account_id, operation_id),
  foreign key (company_id, branch_id) references public.company_branches (company_id, id)
);

alter table private.es02_branch_launch_confirmations owner to postgres;
alter table private.es02_branch_launch_confirmations enable row level security;
revoke all on table private.es02_branch_launch_confirmations from public, anon, authenticated, service_role;

create table if not exists private.es02_branch_reply_credit_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  account_id uuid not null references auth.users (id),
  operation_id uuid not null,
  deducted_kind text not null check (deducted_kind in ('purchased', 'base')),
  balance_id uuid not null references private.es02_credit_balances (id),
  remaining integer not null check (remaining >= 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (company_id, operation_id)
);

alter table private.es02_branch_reply_credit_receipts owner to postgres;
alter table private.es02_branch_reply_credit_receipts enable row level security;
revoke all on table private.es02_branch_reply_credit_receipts from public, anon, authenticated, service_role;

-- Source candidate only: native ACL/roles/concurrency acceptance remains NotRun.
alter table private.es02_branch_assistant_trials add column if not exists execution_id uuid;
create unique index if not exists es02_branch_trial_execution_unique
  on private.es02_branch_assistant_trials(company_id, branch_id, execution_id)
  where execution_id is not null;

-- One authoritative revision for BOTH indexed pages and currently approved knowledge.
create or replace function private.es02_branch_knowledge_revision(p_company_id uuid, p_branch_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  with tokens as (
    select 'page:' || p.id::text || ':' || p.version::text || ':' || md5(coalesce(p.title,'') || ':' || p.url || ':' || p.extracted_text) as token
    from private.es02_branch_website_pages p
    where p.company_id = p_company_id and p.branch_id = p_branch_id and p.status = 'indexed' and btrim(p.extracted_text) <> ''
    union all
    select 'source:' || k.id::text || ':' || k.content_version::text || ':' || md5(to_jsonb(k)::text)
    from public.knowledge_sources k
    where k.company_id = p_company_id and k.status = 'ready' and k.approved_for_answers = true
      and k.approved_version = k.content_version and btrim(k.content) <> ''
  ) select coalesce(md5(string_agg(token, ',' order by token)), 'no_knowledge') from tokens;
$$;
alter function private.es02_branch_knowledge_revision(uuid, uuid) owner to postgres;
revoke all on function private.es02_branch_knowledge_revision(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function public.es02_read_owned_branch_answer_context(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  authority jsonb;
  pages jsonb;
  page_count integer;
  page_chars bigint;
begin
  authority := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if authority->>'ok' is distinct from 'true' then return authority; end if;
  select count(*), coalesce(sum(length(p.extracted_text) + length(coalesce(p.title,p.url)) + 6),0)
    into page_count, page_chars
  from private.es02_branch_website_pages p
  where p.company_id = p_company_id and p.branch_id = p_branch_id and p.status = 'indexed' and btrim(p.extracted_text) <> '';
  if page_count > 40 or page_chars > 12000 then
    return jsonb_build_object('ok',false,'code','ANSWER_CONTEXT_OVERFLOW');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'version',p.version,'url',p.url,'title',p.title,'extracted_text',p.extracted_text) order by p.id),'[]'::jsonb)
    into pages
  from private.es02_branch_website_pages p
  where p.company_id = p_company_id and p.branch_id = p_branch_id and p.status = 'indexed' and btrim(p.extracted_text) <> '';
  return jsonb_build_object('ok',true,'data',jsonb_build_object('pages',pages,'knowledgeRevision',private.es02_branch_knowledge_revision(p_company_id,p_branch_id)));
end;
$$;
alter function public.es02_read_owned_branch_answer_context(uuid,uuid,uuid) owner to postgres;
revoke all on function public.es02_read_owned_branch_answer_context(uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.es02_read_owned_branch_answer_context(uuid,uuid,uuid) to authenticated;

create or replace function public.es02_read_owned_branch_knowledge(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
  branch public.company_branches%rowtype;
  entitlement jsonb;
  pkg text;
  quota_limit int := 10;
  quota_used int := 0;
  pages_arr jsonb := '[]'::jsonb;
  files_arr jsonb := '[]'::jsonb;
  faq_arr jsonb := '[]'::jsonb;
  pg record;
  src record;
  current_knowledge_rev text;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select * into branch from public.company_branches where company_id = p_company_id and id = p_branch_id;
  if branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;

  entitlement := auth_check->'data';
  pkg := entitlement->>'package';
  if pkg = 'premium' then
    quota_limit := 50;
  else
    quota_limit := 10;
  end if;

  select count(*) into quota_used
  from private.es02_branch_website_pages
  where branch_id = p_branch_id;

  for pg in
    select id, url, title, status, error, version, length(extracted_text) as extracted_length
    from private.es02_branch_website_pages
    where branch_id = p_branch_id
    order by created_at desc
  loop
    pages_arr := pages_arr || jsonb_build_array(jsonb_build_object(
      'id', pg.id,
      'companyId', p_company_id,
      'branchId', p_branch_id,
      'version', pg.version,
      'url', pg.url,
      'title', pg.title,
      'status', case pg.status when 'indexed' then 'ready' when 'pending' then 'processing' when 'indexing' then 'processing' else 'failed' end,
      'error', pg.error,
      'extractedLength', pg.extracted_length,
      'capabilities', jsonb_build_object(
        'canRetry', pg.status = 'failed',
        'canRetrain', pg.status = 'indexed'
      )
    ));
  end loop;

  for src in
    select k.*
    from public.knowledge_sources k
    join private.es02_branch_knowledge_sources bks on bks.source_id = k.id
    where bks.branch_id = p_branch_id and k.company_id = p_company_id
    order by k.created_at desc
  loop
    if src.kind = 'file' then
      files_arr := files_arr || jsonb_build_array(jsonb_build_object(
        'branchId', p_branch_id,
        'source', to_jsonb(src)
      ));
    else
      faq_arr := faq_arr || jsonb_build_array(jsonb_build_object(
        'branchId', p_branch_id,
        'source', to_jsonb(src)
      ));
    end if;
  end loop;

  current_knowledge_rev := private.es02_branch_knowledge_revision(p_company_id,p_branch_id);

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', 1,
        'knowledgeRevision', current_knowledge_rev,
        'branchLabel', branch.name,
        'websiteQuota', jsonb_build_object('limit', quota_limit, 'used', quota_used),
        'pages', pages_arr,
        'files', files_arr,
        'faq', faq_arr,
        'capabilities', jsonb_build_object(
          'canAddWebsite', quota_used < quota_limit,
          'canUploadFiles', true,
          'canSaveText', true
        )
      )
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_add_owned_branch_website(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_expected_version int,
  p_url text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
  entitlement jsonb;
  pkg text;
  quota_limit int := 10;
  quota_used int := 0;
  page_id uuid;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or nullif(trim(p_url), '') is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  -- Lock branch row to serialize concurrent website additions and CAS check
  perform 1 from public.company_branches
  where company_id = p_company_id and id = p_branch_id
  for update;

  entitlement := auth_check->'data';
  pkg := entitlement->>'package';
  if pkg = 'premium' then
    quota_limit := 50;
  else
    quota_limit := 10;
  end if;

  select count(*) into quota_used
  from private.es02_branch_website_pages
  where branch_id = p_branch_id;

  if quota_used >= quota_limit then
    return jsonb_build_object('ok', false, 'code', 'QUOTA_EXCEEDED');
  end if;

  -- Stored with 'pending' status (never immediately 'ready' before extraction/indexing)
  insert into private.es02_branch_website_pages (company_id, branch_id, url, status)
  values (p_company_id, p_branch_id, trim(p_url), 'pending')
  on conflict (branch_id, url)
  do update set updated_at = clock_timestamp(), version = private.es02_branch_website_pages.version + 1, status = 'pending', error = null
  returning id into page_id;

  -- Invalidate any prior launch confirmation if knowledge changed
  delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  return public.es02_read_owned_branch_knowledge(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_page_action_owned_branch_knowledge(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_page_id uuid,
  p_action text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_page_id is null or p_action not in ('retry', 'retrain') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  update private.es02_branch_website_pages
  set status = 'pending', error = null, updated_at = clock_timestamp(), version = version + 1
  where id = p_page_id and branch_id = p_branch_id and company_id = p_company_id;

  -- Invalidate any prior launch confirmation if knowledge changed
  delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  return public.es02_read_owned_branch_knowledge(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_read_owned_branch_reply_language(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
  company public.companies%rowtype;
  branch public.company_branches%rowtype;
  conf_row private.es02_branch_reply_language_confirmations%rowtype;
  conf_state text := 'unconfirmed';
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select * into company from public.companies where id = p_company_id;
  select * into branch from public.company_branches where company_id = p_company_id and id = p_branch_id;

  select * into conf_row
  from private.es02_branch_reply_language_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  if conf_row.company_id is not null then
    conf_state := 'confirmed';
  else
    conf_state := 'unconfirmed';
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', coalesce(conf_row.revision, 1),
        'companyLabel', coalesce(company.display_name, company.name, 'Velora Business'),
        'branchLabel', branch.name,
        'replyLanguage', coalesce(conf_row.reply_language, company.reply_language, 'both'),
        'confirmation', conf_state,
        'canConfirm', true
      )
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_confirm_owned_branch_reply_language(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_expected_version bigint,
  p_reply_language text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
  current_rev bigint;
  next_rev bigint;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_reply_language not in ('ar', 'en', 'both') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select revision into current_rev
  from private.es02_branch_reply_language_confirmations
  where company_id = p_company_id and branch_id = p_branch_id
  for update;

  if current_rev is not null and p_expected_version is not null and current_rev <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT');
  end if;

  next_rev := coalesce(current_rev, 0) + 1;

  insert into private.es02_branch_reply_language_confirmations (company_id, branch_id, reply_language, revision, confirmed_at)
  values (p_company_id, p_branch_id, p_reply_language, next_rev, clock_timestamp())
  on conflict (company_id, branch_id)
  do update set reply_language = excluded.reply_language, revision = excluded.revision, confirmed_at = excluded.confirmed_at;

  update public.companies set reply_language = p_reply_language where id = p_company_id;

  -- Invalidate any prior launch confirmation if language confirmed/changed
  delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  return public.es02_read_owned_branch_reply_language(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

-- Ten lifetime setup replies per branch. AI spend remains in the existing ledger/budget.
alter table public.ai_usage_ledger drop constraint if exists ai_usage_ledger_usage_mode_check;
alter table public.ai_usage_ledger add constraint ai_usage_ledger_usage_mode_check check(usage_mode in ('admin_test','company_live','setup_trial'));
create table if not exists private.es02_branch_trial_operations (
  operation_id uuid primary key references public.ai_usage_ledger(id),
  company_id uuid not null, branch_id uuid not null, account_id uuid not null references auth.users(id),
  native_session_id uuid not null references auth.sessions(id),
  question_hash text not null, knowledge_revision text not null, hours_revision bigint not null,
  language_code text not null, persona text not null, model_id text not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,branch_id) references public.company_branches(company_id,id)
);
alter table private.es02_branch_trial_operations owner to postgres;
alter table private.es02_branch_trial_operations enable row level security;
revoke all on private.es02_branch_trial_operations from public,anon,authenticated,service_role;
create index if not exists es02_trial_branch_allowance on private.es02_branch_trial_operations(company_id,branch_id);

create or replace function private.es02_trial_context_current(op private.es02_branch_trial_operations)
returns boolean language sql volatile security definer set search_path='' as $$
  select exists(
    select 1 from public.company_members m
    join public.companies c on c.id=m.company_id
    join public.company_branches b on b.company_id=c.id
    join private.es02_branch_slot_rights r on r.branch_id=b.id and r.company_id=c.id
    join private.es02_account_orders o on o.id=r.order_id and o.account_id=op.account_id
    join private.es02_branch_hours h on h.company_id=c.id and h.branch_id=b.id
    join private.es02_branch_reply_language_confirmations lang on lang.company_id=c.id and lang.branch_id=b.id
    where m.user_id=op.account_id and m.company_id=op.company_id and b.id=op.branch_id
      and m.role='owner' and m.status='active' and c.status in ('setup','active') and b.status='setup'
      and o.status='provisioned' and o.provisioned_company_id=op.company_id and private.es02_order_catalog_consistent(o)
      and op.persona=case r.persona when 'level_1' then 'noura' when 'level_2' then 'lina' when 'level_3' then 'dana' end
      and op.hours_revision=h.revision and op.language_code=lang.reply_language
      and op.knowledge_revision=private.es02_branch_knowledge_revision(op.company_id,op.branch_id)
  ) and private.es02_b3_session_open(op.account_id,op.native_session_id);
$$;
alter function private.es02_trial_context_current(private.es02_branch_trial_operations) owner to postgres;
revoke all on function private.es02_trial_context_current(private.es02_branch_trial_operations) from public,anon,authenticated,service_role;

create or replace function public.es02_reserve_branch_trial(
  p_operation_id uuid,p_account_id uuid,p_session_id uuid,p_company_id uuid,p_branch_id uuid,
  p_question text,p_knowledge_revision text,p_hours_revision bigint,p_language_code text,p_persona text,p_model_id text,
  p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.es02_branch_trial_operations; budget public.ai_budget_accounts; used integer; state text;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_operation_id is null or p_session_id is null or length(btrim(coalesce(p_question,''))) not between 1 and 1000
     or p_model_id<>'gemini-3.8-flash' or p_reserved_baisa is null or p_reserved_baisa<=0 or p_reserved_baisa>1000
     or p_reserved_baisa::text in ('NaN','Infinity','-Infinity')
     or jsonb_typeof(p_pricing_snapshot) is distinct from 'object'
     or p_pricing_snapshot->>'modelId' is distinct from p_model_id or p_pricing_snapshot->>'version' is distinct from p_pricing_version
     or jsonb_typeof(p_source_citations) is distinct from 'array' or jsonb_array_length(p_source_citations)>40 then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  -- Same global budget-first lock order as existing reserve/start/settle/reconcile.
  select * into budget from public.ai_budget_accounts where scope='admin_test' and company_id is null for update;
  if budget.id is null or not budget.enabled then return jsonb_build_object('ok',false,'code','BUDGET_DISABLED'); end if;
  perform 1 from public.company_branches where company_id=p_company_id and id=p_branch_id for update;
  select * into op from private.es02_branch_trial_operations where operation_id=p_operation_id;
  if op.operation_id is not null then
    if op.account_id<>p_account_id or op.company_id<>p_company_id or op.branch_id<>p_branch_id or op.question_hash<>md5(btrim(p_question)) then
      return jsonb_build_object('ok',false,'code','EXECUTION_CONFLICT');
    end if;
    select status into state from public.ai_usage_ledger where id=op.operation_id;
    return jsonb_build_object('ok',true,'newlyReserved',false,'state',state,'operationId',p_operation_id);
  end if;
  op.operation_id:=p_operation_id;op.company_id:=p_company_id;op.branch_id:=p_branch_id;op.account_id:=p_account_id;
  op.native_session_id:=p_session_id;op.question_hash:=md5(btrim(p_question));op.knowledge_revision:=p_knowledge_revision;
  op.hours_revision:=p_hours_revision;op.language_code:=p_language_code;op.persona:=p_persona;op.model_id:=p_model_id;
  if not private.es02_trial_context_current(op) then return jsonb_build_object('ok',false,'code','AUTHORIZATION_OR_CONTEXT_CHANGED'); end if;
  if exists(select 1 from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
    where t.company_id=p_company_id and t.branch_id=p_branch_id and l.status in ('reserved','running','uncertain')) then
    return jsonb_build_object('ok',false,'code','TRIAL_PENDING');
  end if;
  select count(*) into used from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
    where t.company_id=p_company_id and t.branch_id=p_branch_id and l.status<>'rejected';
  if used>=10 then return jsonb_build_object('ok',false,'code','TRIAL_LIMIT_REACHED'); end if;
  if budget.spent_baisa+budget.held_baisa+p_reserved_baisa>least(budget.limit_baisa,1000) then return jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED'); end if;
  insert into public.ai_usage_ledger(id,budget_account_id,company_id,actor_user_id,actor_session_id,execution_id,attempt,usage_mode,model_id,provider,reserved_baisa,pricing_version,pricing_snapshot,source_citations)
    values(p_operation_id,budget.id,p_company_id,p_account_id,p_session_id,p_operation_id,1,'setup_trial',p_model_id,'google',p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
  insert into private.es02_branch_trial_operations values(op.operation_id,op.company_id,op.branch_id,op.account_id,op.native_session_id,op.question_hash,op.knowledge_revision,op.hours_revision,op.language_code,op.persona,op.model_id,clock_timestamp());
  update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
  return jsonb_build_object('ok',true,'newlyReserved',true,'state','reserved','operationId',p_operation_id,'remaining',9-used);
end;
$$;

create or replace function public.es02_start_branch_trial(p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.es02_branch_trial_operations; entry public.ai_usage_ledger; budget public.ai_budget_accounts;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  select * into op from private.es02_branch_trial_operations where operation_id=p_operation_id;
  select * into entry from public.ai_usage_ledger where id=p_operation_id;
  if op.operation_id is null or entry.usage_mode is distinct from 'setup_trial' then return jsonb_build_object('ok',false,'code','NOT_RESERVED'); end if;
  select * into budget from public.ai_budget_accounts where id=entry.budget_account_id for update;
  perform 1 from public.company_branches where company_id=op.company_id and id=op.branch_id for update;
  select * into entry from public.ai_usage_ledger where id=p_operation_id for update;
  if not budget.enabled or budget.spent_baisa+budget.held_baisa>least(budget.limit_baisa,1000) or not private.es02_trial_context_current(op) then
    return jsonb_build_object('ok',false,'code','AUTHORIZATION_OR_CONTEXT_CHANGED');
  end if;
  if entry.status<>'reserved' then return jsonb_build_object('ok',false,'code','TRIAL_PENDING'); end if;
  update public.ai_usage_ledger set status='running' where id=p_operation_id;
  return jsonb_build_object('ok',true);
end;
$$;
alter function public.es02_reserve_branch_trial(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,numeric,text,jsonb,jsonb) owner to postgres;
revoke all on function public.es02_reserve_branch_trial(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,numeric,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.es02_reserve_branch_trial(uuid,uuid,uuid,uuid,uuid,text,text,bigint,text,text,text,numeric,text,jsonb,jsonb) to service_role;
alter function public.es02_start_branch_trial(uuid) owner to postgres;
revoke all on function public.es02_start_branch_trial(uuid) from public,anon,authenticated,service_role;
grant execute on function public.es02_start_branch_trial(uuid) to service_role;

-- Reuse the existing immutable cost settlement and unknown-outcome holds.
do $settlement$
declare definition text;
begin
  definition:=pg_get_functiondef('private.ai_settle_admin(uuid,text,numeric,numeric,jsonb,text,text,integer,text,text,boolean)'::regprocedure);
  if position('entry.usage_mode<>''admin_test''' in definition)>0 then
    definition:=replace(definition,'entry.usage_mode<>''admin_test''','entry.usage_mode not in (''admin_test'',''setup_trial'')');
    execute definition;
  elsif position('''setup_trial''' in definition)=0 then raise exception 'SETUP_TRIAL_SETTLEMENT_BASELINE_CHANGED'; end if;
end;
$settlement$;

create or replace function public.es02_read_owned_branch_assistant_trial(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authority jsonb;
  is_member boolean;
  branch public.company_branches%rowtype;
  company public.companies%rowtype;
  messages_arr jsonb := '[]'::jsonb;
  t_row record;
  current_knowledge_rev text;
begin
  authority := public.es02_read_owned_branch_setup(p_expected_account_id,p_company_id,p_branch_id);
  if authority->>'ok' is distinct from 'true' then return authority; end if;
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = p_expected_account_id and m.status = 'active'
  ) into is_member;
  if not is_member then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into branch from public.company_branches where company_id = p_company_id and id = p_branch_id;
  if branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;

  select * into company from public.companies where id = p_company_id;

  for t_row in
    select id, question, answer, origin, model_id, hours_revision, language_code, persona, knowledge_revision, execution_id, created_at
    from private.es02_branch_assistant_trials
    where company_id = p_company_id and branch_id = p_branch_id
    order by created_at asc
    limit 20
  loop
    messages_arr := messages_arr || jsonb_build_array(jsonb_build_object(
      'id', t_row.id,
      'executionId', t_row.execution_id,
      'scope', jsonb_build_object(
        'expectedAccountId', p_expected_account_id,
        'companyId', p_company_id,
        'branchId', p_branch_id
      ),
      'version', 1,
      'knowledgeRevision', t_row.knowledge_revision,
      'hoursRevision', t_row.hours_revision,
      'languageCode', t_row.language_code,
      'persona', t_row.persona,
      'question', t_row.question,
      'origin', t_row.origin,
      'result', jsonb_build_object(
        'ok', true,
        'text', t_row.answer,
        'modelId', t_row.model_id,
        'citations', coalesce((select l.source_citations from public.ai_usage_ledger l where l.id=t_row.execution_id),'[]'::jsonb)
      )
    ));
  end loop;

  current_knowledge_rev := private.es02_branch_knowledge_revision(p_company_id,p_branch_id);

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', 1,
        'knowledgeRevision', current_knowledge_rev,
        'branchLabel', branch.name,
        'businessType', coalesce(company.business_type, 'retail'),
        'canAsk', branch.status='setup' and
          (select count(*) from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id where op.company_id=p_company_id and op.branch_id=p_branch_id and l.status<>'rejected')<10 and
          not exists(select 1 from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id where op.company_id=p_company_id and op.branch_id=p_branch_id and l.status in ('reserved','running','uncertain')),
        'trialAllowance', jsonb_build_object('limit',10,'used',(select count(*) from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id where op.company_id=p_company_id and op.branch_id=p_branch_id and l.status<>'rejected')),
        'messages', messages_arr
      )
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

-- Trusted server writer only. The end-user RPC role cannot manufacture engine proof.
create or replace function public.es02_record_owned_branch_assistant_trial(
  p_expected_account_id uuid, p_company_id uuid, p_branch_id uuid,
  p_question text, p_answer text, p_model_id text,
  p_hours_revision bigint, p_language_code text, p_persona text,
  p_knowledge_revision text, p_execution_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  trusted_persona text;
  current_hours bigint;
  current_language text;
  receipt uuid;
begin
  if p_execution_id is null or nullif(btrim(p_question),'') is null or nullif(btrim(p_answer),'') is null or nullif(btrim(p_model_id),'') is null then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  if not exists(select 1 from private.es02_branch_trial_operations op join public.ai_usage_ledger l on l.id=op.operation_id
    where op.operation_id=p_execution_id and op.company_id=p_company_id and op.branch_id=p_branch_id and op.account_id=p_expected_account_id
      and op.question_hash=md5(btrim(p_question)) and op.model_id=p_model_id and op.persona=p_persona
      and op.knowledge_revision=p_knowledge_revision and op.hours_revision=p_hours_revision and op.language_code=p_language_code
      and l.usage_mode='setup_trial' and l.status='success') then
    return jsonb_build_object('ok',false,'code','VERIFIED_EXECUTION_REQUIRED');
  end if;
  -- The server re-attests the native actor before this service-only call.
  -- Lock/recheck the tenant, paid branch, profile and context before accepting proof.
  perform 1 from public.company_branches b join public.companies c on c.id=b.company_id
    join public.company_members m on m.company_id=c.id
    where b.company_id=p_company_id and b.id=p_branch_id and m.user_id=p_expected_account_id
      and m.status='active' and m.role='owner' and b.status in ('setup','active') and c.status in ('setup','active')
    for update of b,c,m;
  if not found then return jsonb_build_object('ok',false,'code','FORBIDDEN'); end if;
  select case r.persona when 'level_1' then 'noura' when 'level_2' then 'lina' when 'level_3' then 'dana' end
    into trusted_persona from private.es02_branch_slot_rights r
    where r.company_id=p_company_id and r.branch_id=p_branch_id for share;
  select revision into current_hours from private.es02_branch_hours where company_id=p_company_id and branch_id=p_branch_id for share;
  select reply_language into current_language from private.es02_branch_reply_language_confirmations where company_id=p_company_id and branch_id=p_branch_id for share;
  if trusted_persona is null or trusted_persona is distinct from p_persona or current_hours is distinct from p_hours_revision
     or current_language is distinct from p_language_code
     or private.es02_branch_knowledge_revision(p_company_id,p_branch_id) is distinct from p_knowledge_revision then
    return jsonb_build_object('ok',false,'code','CONTEXT_CHANGED');
  end if;
  insert into private.es02_branch_assistant_trials(company_id,branch_id,question,answer,origin,model_id,hours_revision,language_code,persona,knowledge_revision,execution_id)
    values(p_company_id,p_branch_id,btrim(p_question),btrim(p_answer),'engine',p_model_id,p_hours_revision,p_language_code,p_persona,p_knowledge_revision,p_execution_id)
    on conflict(company_id,branch_id,execution_id) where execution_id is not null do nothing
    returning id into receipt;
  if receipt is null then
    select id into receipt from private.es02_branch_assistant_trials
      where company_id=p_company_id and branch_id=p_branch_id and execution_id=p_execution_id
        and question=btrim(p_question) and answer=btrim(p_answer) and model_id=p_model_id and persona=p_persona
        and hours_revision=p_hours_revision and language_code=p_language_code and knowledge_revision=p_knowledge_revision;
    if receipt is null then return jsonb_build_object('ok',false,'code','EXECUTION_CONFLICT'); end if;
  end if;
  return jsonb_build_object('ok',true,'receiptId',receipt,'executionId',p_execution_id);
end;
$$;

create or replace function public.es02_read_owned_branch_launch_summary(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_member boolean;
  sel_channels jsonb;
  auth_check jsonb;
  branch public.company_branches%rowtype;
  conf_launch private.es02_branch_launch_confirmations%rowtype;
  conf_lang private.es02_branch_reply_language_confirmations%rowtype;
  hours_rev bigint := 0;
  lang_rev bigint := 0;
  knowledge_count int := 0;
  current_knowledge_rev text := 'no_pages';
  has_hours boolean := false;
  has_knowledge boolean := false;
  has_language boolean := false;
  has_trial boolean := false;
  has_ch_verified boolean := false;
  hours_status text := 'pending';
  knowledge_status text := 'pending';
  language_status text := 'pending';
  blockers text[] := array[]::text[];
  readiness_status text := 'ready';
  readiness_rev text := 'rev_0';
  op_id uuid := gen_random_uuid();
  ch_arr jsonb := '[]'::jsonb;
  ch text;
  ch_proof_summary text;
  channel_snapshot jsonb;
  channel_proofs jsonb := '[]'::jsonb;
  latest_trial_row record;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- Caller session check
  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  select exists (
    select 1 from public.company_members m
    where m.company_id = p_company_id and m.user_id = p_expected_account_id and m.status = 'active'
  ) into is_member;
  if not is_member then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select * into branch from public.company_branches where company_id = p_company_id and id = p_branch_id;
  if branch.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_OWNED');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  select channels into sel_channels
  from private.es02_branch_channel_selections
  where company_id = p_company_id and branch_id = p_branch_id;
  if sel_channels is null then
    sel_channels := coalesce(auth_check->'data'->'selectedChannels', '["whatsapp"]'::jsonb);
  end if;

  select * into conf_launch
  from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  select coalesce(revision, 0) into hours_rev
  from private.es02_branch_hours
  where company_id = p_company_id and branch_id = p_branch_id;
  has_hours := (hours_rev > 0);

  select * into conf_lang
  from private.es02_branch_reply_language_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;
  lang_rev := coalesce(conf_lang.revision, 0);
  has_language := (lang_rev > 0);

  -- Compute deterministic revision of approved / indexed knowledge for this branch
  current_knowledge_rev := private.es02_branch_knowledge_revision(p_company_id,p_branch_id);

  select count(*) into knowledge_count
  from private.es02_branch_website_pages
  where branch_id = p_branch_id and status = 'indexed';

  -- Only approved / ready / indexed knowledge counts
  select exists (
    select 1 from private.es02_branch_website_pages p
    where p.branch_id = p_branch_id and p.status = 'indexed' and p.extracted_text <> ''
    union
    select 1 from private.es02_branch_knowledge_sources bks
    join public.knowledge_sources ks on ks.id = bks.source_id
    where bks.branch_id = p_branch_id and ks.company_id = p_company_id and ks.status = 'ready' and ks.approved_for_answers = true and ks.approved_version = ks.content_version
    union
    select 1 from public.knowledge_sources ks
    where ks.company_id = p_company_id and ks.status = 'ready' and ks.approved_for_answers = true and ks.approved_version = ks.content_version
  ) into has_knowledge;

  -- Verified assistant trial required: must be from genuine engine and match current hours, language, and knowledge
  select exists (
    select 1 from private.es02_branch_assistant_trials t
    where t.company_id = p_company_id
      and t.branch_id = p_branch_id
      and t.origin = 'engine' and t.execution_id is not null
      and t.hours_revision = hours_rev
      and (lang_rev = 0 or t.language_code = coalesce(conf_lang.reply_language, 'both'))
      and t.knowledge_revision = current_knowledge_rev
      and t.persona = case auth_check->'data'->>'persona' when 'level_1' then 'noura' when 'level_2' then 'lina' when 'level_3' then 'dana' end
  ) into has_trial;

  hours_status := case when has_hours then 'verified' else 'pending' end;
  knowledge_status := case when has_knowledge then 'verified' else 'pending' end;
  language_status := case when has_language then 'verified' else 'pending' end;

  if not has_hours then
    blockers := array_append(blockers, 'hours_incomplete');
  end if;
  if not has_knowledge then
    blockers := array_append(blockers, 'knowledge_incomplete');
  end if;
  if not has_language then
    blockers := array_append(blockers, 'language_unconfirmed');
  end if;
  if not has_trial then
    blockers := array_append(blockers, 'trial_incomplete');
  end if;

  -- Channel verification requires actual B3 branch connection link proof
  for ch in select jsonb_array_elements_text(sel_channels) loop
    has_ch_verified := false;
    channel_snapshot := public.es02_b3_read_owned_branch_connection(p_expected_account_id,p_company_id,p_branch_id,ch);
    has_ch_verified := channel_snapshot->>'sourceStatus' = 'ready'
      and channel_snapshot->'connection'->>'state' = 'connected'
      and channel_snapshot->'connection'->>'verified' = 'true';
    channel_proofs := channel_proofs || jsonb_build_array(channel_snapshot - 'asOf');

    if has_ch_verified is distinct from true then
      blockers := array_append(blockers, 'channel_unverified:' || ch);
    end if;

    ch_arr := ch_arr || jsonb_build_array(jsonb_build_object(
      'channel', ch,
      'detail', case when has_ch_verified then 'تم إثبات الربط والصلاحيات للفرع' else 'بانتظار اكتمال ربط القناة للفرع' end,
      'status', case when has_ch_verified then 'verified' else 'pending' end
    ));
  end loop;

  if cardinality(blockers) > 0 then
    readiness_status := 'blocked';
  else
    readiness_status := 'ready';
  end if;

  select string_agg(l.id::text || ':' || coalesce(l.legacy_generation, 0)::text, ',' order by l.channel)
  into ch_proof_summary
  from private.es02_b3_connection_links l
  where l.branch_id = p_branch_id and l.company_id = p_company_id and l.status = 'active' and l.revoked_at is null;

  select id, created_at, model_id, persona into latest_trial_row
  from private.es02_branch_assistant_trials
  where company_id = p_company_id and branch_id = p_branch_id and origin = 'engine'
    and hours_revision = hours_rev
    and (lang_rev = 0 or language_code = coalesce(conf_lang.reply_language, 'both'))
    and knowledge_revision = current_knowledge_rev
    and execution_id is not null
    and persona = case auth_check->'data'->>'persona' when 'level_1' then 'noura' when 'level_2' then 'lina' when 'level_3' then 'dana' end
  order by created_at desc limit 1;

  -- Dynamic readiness revision fingerprint
  readiness_rev := md5(concat_ws(':',
    p_company_id::text,
    p_branch_id::text,
    hours_rev::text,
    lang_rev::text,
    current_knowledge_rev,
    ((auth_check->'data') - 'asOf')::text,
    sel_channels::text,
    channel_proofs::text,
    coalesce(ch_proof_summary, 'none'),
    coalesce(latest_trial_row.id::text, 'no_trial'),
    coalesce(latest_trial_row.model_id, 'no_model'),
    coalesce(latest_trial_row.persona, 'no_persona'),
    cardinality(blockers)::text
  ));

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'snapshot', jsonb_build_object(
        'scope', jsonb_build_object(
          'expectedAccountId', p_expected_account_id,
          'companyId', p_company_id,
          'branchId', p_branch_id
        ),
        'version', 1,
        'branchLabel', branch.name,
        'setup', jsonb_build_object(
          'companyId', p_company_id,
          'selectedBranchId', p_branch_id,
          'sourceStatus', auth_check->'data'->>'sourceStatus',
          'selectedChannels', auth_check->'data'->'selectedChannels',
          'entitlement', auth_check->'data'->'entitlement',
          'launch', jsonb_build_object(
            'confirmationRequired', true,
            'confirmed', conf_launch.id is not null,
            'canRequest', readiness_status = 'ready',
            'blockedReasons', to_jsonb(blockers)
          )
        ),
        'readiness', jsonb_build_object(
          'status', readiness_status,
          'revision', readiness_rev,
          'blockers', to_jsonb(blockers)
        ),
        'summary', jsonb_build_object(
          'channels', ch_arr,
          'hours', jsonb_build_object('detail', case when has_hours then 'مكتملة ومحفوظة' else 'غير مكتملة' end, 'status', hours_status),
          'knowledge', jsonb_build_object('detail', case when has_knowledge then 'مصادر معرفة معتمدة' else 'بانتظار إضافة المعرفة' end, 'status', knowledge_status),
          'persona', jsonb_build_object('detail', 'نورا', 'status', 'verified'),
          'team', jsonb_build_object('detail', 'دعوة الموظفين مؤجلة بقرار المالك', 'status', 'deferred')
        ),
        'operationId', op_id,
        'activation', jsonb_build_object(
          'status', case when conf_launch.id is not null then 'launched' else 'not_started' end,
          'receiptId', conf_launch.id,
          'operationId', conf_launch.operation_id
        )
      )
    )
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_confirm_owned_branch_launch(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_expected_version bigint,
  p_readiness_revision text,
  p_operation_id uuid,
  p_confirmed boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  summary jsonb;
  current_readiness_rev text;
  receipt_id uuid;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_operation_id is null or p_confirmed is distinct from true then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- Caller session identity guard
  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  -- Lock branch row to serialize concurrent launch confirmations
  perform 1 from public.company_branches
  where company_id = p_company_id and id = p_branch_id
  for update;

  summary := public.es02_read_owned_branch_launch_summary(p_expected_account_id, p_company_id, p_branch_id);
  if summary->>'ok' is distinct from 'true' then
    return summary;
  end if;

  if summary->'data'->'snapshot'->'readiness'->>'status' is distinct from 'ready' then
    return jsonb_build_object('ok', false, 'code', 'READINESS_INCOMPLETE', 'blockers', summary->'data'->'snapshot'->'readiness'->'blockers');
  end if;

  current_readiness_rev := summary->'data'->'snapshot'->'readiness'->>'revision';
  if p_readiness_revision is distinct from current_readiness_rev then
    return jsonb_build_object('ok', false, 'code', 'READINESS_CHANGED', 'currentRevision', current_readiness_rev);
  end if;

  insert into private.es02_branch_launch_confirmations (company_id, branch_id, account_id, readiness_revision, operation_id, confirmed)
  values (p_company_id, p_branch_id, p_expected_account_id, p_readiness_revision, p_operation_id, true)
  on conflict (company_id, branch_id)
  do update set confirmed = true, confirmed_at = clock_timestamp(), readiness_revision = excluded.readiness_revision
  returning id into receipt_id;

  -- Activate branch and company if still in setup
  update public.company_branches set status = 'active' where company_id = p_company_id and id = p_branch_id and status = 'setup';
  perform set_config('velora.allow_status_change', 'on', true);
  update public.companies set status = 'active' where id = p_company_id and status = 'setup';

  return public.es02_read_owned_branch_launch_summary(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_atomic_deduct_reply_credit(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipt_row private.es02_branch_reply_credit_receipts%rowtype;
  row_rec record;
  deducted_kind text;
  new_remaining integer;
begin
  if p_expected_account_id is null or p_company_id is null or p_operation_id is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  -- 1. Session identity guard: when called via authenticated PostgREST API, auth.uid() must match p_expected_account_id
  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  -- 2. Check membership / tenancy authorization
  perform 1 from public.company_members m
  where m.company_id = p_company_id and m.user_id = p_expected_account_id and m.status = 'active'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  -- 3. Idempotency receipt check: if this operation_id was already processed, return existing receipt
  select * into receipt_row
  from private.es02_branch_reply_credit_receipts
  where company_id = p_company_id and operation_id = p_operation_id;

  if receipt_row.id is not null then
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'deductedFrom', receipt_row.deducted_kind,
      'remaining', receipt_row.remaining
    );
  end if;

  -- 4. Try purchased add-on credits first (lock row for update)
  select * into row_rec
  from private.es02_credit_balances
  where company_id = p_company_id
    and kind = 'purchased'
    and remaining > 0
    and (ordinary_expiry is null or ordinary_expiry > clock_timestamp())
  order by created_at asc
  limit 1
  for update;

  if row_rec.id is not null then
    deducted_kind := 'purchased';
    new_remaining := row_rec.remaining - 1;
    update private.es02_credit_balances
    set remaining = new_remaining
    where id = row_rec.id;

    insert into private.es02_branch_reply_credit_receipts (
      company_id, account_id, operation_id, deducted_kind, balance_id, remaining
    ) values (
      p_company_id, p_expected_account_id, p_operation_id, 'purchased', row_rec.id, new_remaining
    );

    return jsonb_build_object('ok', true, 'replayed', false, 'deductedFrom', 'purchased', 'remaining', new_remaining);
  end if;

  -- 5. Try base package allowance
  select * into row_rec
  from private.es02_credit_balances
  where company_id = p_company_id
    and kind = 'base'
    and remaining > 0
    and (ordinary_expiry is null or ordinary_expiry > clock_timestamp())
  order by created_at asc
  limit 1
  for update;

  if row_rec.id is not null then
    deducted_kind := 'base';
    new_remaining := row_rec.remaining - 1;
    update private.es02_credit_balances
    set remaining = new_remaining
    where id = row_rec.id;

    insert into private.es02_branch_reply_credit_receipts (
      company_id, account_id, operation_id, deducted_kind, balance_id, remaining
    ) values (
      p_company_id, p_expected_account_id, p_operation_id, 'base', row_rec.id, new_remaining
    );

    return jsonb_build_object('ok', true, 'replayed', false, 'deductedFrom', 'base', 'remaining', new_remaining);
  end if;

  -- 6. No credits remaining: do not allow negative balance, signal transfer to staff
  return jsonb_build_object(
    'ok', false,
    'code', 'CREDITS_EXHAUSTED',
    'transferToStaff', true,
    'message', 'Credit limit reached. Transfer to staff requested.'
  );
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

create or replace function public.es02_index_branch_website_page(
  p_expected_account_id uuid,
  p_company_id uuid,
  p_branch_id uuid,
  p_page_id uuid,
  p_title text,
  p_extracted_text text,
  p_status text,
  p_error text,
  p_expected_version integer,
  p_expected_url text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_check jsonb;
begin
  if p_expected_account_id is null or p_company_id is null or p_branch_id is null or p_page_id is null or p_status not in ('indexed', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT');
  end if;

  if auth.uid() is not null and auth.uid() <> p_expected_account_id then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  end if;

  auth_check := public.es02_read_owned_branch_setup(p_expected_account_id, p_company_id, p_branch_id);
  if auth_check->>'ok' is distinct from 'true' then
    return auth_check;
  end if;

  perform 1 from public.company_branches where company_id=p_company_id and id=p_branch_id for update;
  update private.es02_branch_website_pages
  set title = coalesce(p_title, title),
      extracted_text = case when p_status = 'indexed' then coalesce(p_extracted_text, '') else extracted_text end,
      status = p_status,
      error = case when p_status = 'failed' then coalesce(p_error, 'Extraction failed') else null end,
      indexed_at = case when p_status = 'indexed' then clock_timestamp() else indexed_at end,
      updated_at = clock_timestamp(),
      version = version + 1
  where id = p_page_id and branch_id = p_branch_id and company_id = p_company_id
     and version=p_expected_version and url=p_expected_url;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'PAGE_CHANGED');
  end if;

  delete from private.es02_branch_launch_confirmations
  where company_id = p_company_id and branch_id = p_branch_id;

  return public.es02_read_owned_branch_knowledge(p_expected_account_id, p_company_id, p_branch_id);
exception
  when others then
    return jsonb_build_object('ok', false, 'code', 'UNAVAILABLE');
end;
$$;

-- Prior local signatures must not retain authenticated EXECUTE after an upgrade.
do $acl$
declare target regprocedure;
begin
  for target in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('es02_record_owned_branch_assistant_trial','es02_index_branch_website_page')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role',target);
  end loop;
end;
$acl$;

-- Explicit ownership and execution permissions for all public functions
alter function public.es02_read_owned_branch_knowledge(uuid, uuid, uuid) owner to postgres;
revoke all on function public.es02_read_owned_branch_knowledge(uuid, uuid, uuid) from public, anon;
grant execute on function public.es02_read_owned_branch_knowledge(uuid, uuid, uuid) to authenticated;

alter function public.es02_add_owned_branch_website(uuid, uuid, uuid, int, text) owner to postgres;
revoke all on function public.es02_add_owned_branch_website(uuid, uuid, uuid, int, text) from public, anon;
grant execute on function public.es02_add_owned_branch_website(uuid, uuid, uuid, int, text) to authenticated;

alter function public.es02_page_action_owned_branch_knowledge(uuid, uuid, uuid, uuid, text) owner to postgres;
revoke all on function public.es02_page_action_owned_branch_knowledge(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.es02_page_action_owned_branch_knowledge(uuid, uuid, uuid, uuid, text) to authenticated;

alter function public.es02_read_owned_branch_reply_language(uuid, uuid, uuid) owner to postgres;
revoke all on function public.es02_read_owned_branch_reply_language(uuid, uuid, uuid) from public, anon;
grant execute on function public.es02_read_owned_branch_reply_language(uuid, uuid, uuid) to authenticated;

alter function public.es02_confirm_owned_branch_reply_language(uuid, uuid, uuid, bigint, text) owner to postgres;
revoke all on function public.es02_confirm_owned_branch_reply_language(uuid, uuid, uuid, bigint, text) from public, anon;
grant execute on function public.es02_confirm_owned_branch_reply_language(uuid, uuid, uuid, bigint, text) to authenticated;

alter function public.es02_read_owned_branch_assistant_trial(uuid, uuid, uuid) owner to postgres;
revoke all on function public.es02_read_owned_branch_assistant_trial(uuid, uuid, uuid) from public, anon;
grant execute on function public.es02_read_owned_branch_assistant_trial(uuid, uuid, uuid) to authenticated;

alter function public.es02_record_owned_branch_assistant_trial(uuid, uuid, uuid, text, text, text, bigint, text, text, text, uuid) owner to postgres;
revoke all on function public.es02_record_owned_branch_assistant_trial(uuid, uuid, uuid, text, text, text, bigint, text, text, text, uuid) from public, anon;
grant execute on function public.es02_record_owned_branch_assistant_trial(uuid, uuid, uuid, text, text, text, bigint, text, text, text, uuid) to service_role;

alter function public.es02_index_branch_website_page(uuid, uuid, uuid, uuid, text, text, text, text, integer, text) owner to postgres;
revoke all on function public.es02_index_branch_website_page(uuid, uuid, uuid, uuid, text, text, text, text, integer, text) from public, anon;
grant execute on function public.es02_index_branch_website_page(uuid, uuid, uuid, uuid, text, text, text, text, integer, text) to authenticated;

alter function public.es02_read_owned_branch_launch_summary(uuid, uuid, uuid) owner to postgres;
revoke all on function public.es02_read_owned_branch_launch_summary(uuid, uuid, uuid) from public, anon;
grant execute on function public.es02_read_owned_branch_launch_summary(uuid, uuid, uuid) to authenticated;

alter function public.es02_confirm_owned_branch_launch(uuid, uuid, uuid, bigint, text, uuid, boolean) owner to postgres;
revoke all on function public.es02_confirm_owned_branch_launch(uuid, uuid, uuid, bigint, text, uuid, boolean) from public, anon;
grant execute on function public.es02_confirm_owned_branch_launch(uuid, uuid, uuid, bigint, text, uuid, boolean) to authenticated;

alter function public.es02_atomic_deduct_reply_credit(uuid, uuid, uuid) owner to postgres;
revoke all on function public.es02_atomic_deduct_reply_credit(uuid, uuid, uuid) from public, anon;
revoke all on function public.es02_atomic_deduct_reply_credit(uuid, uuid, uuid) from authenticated, service_role;
-- Legacy account-only debit is retired; workers use the existing claimed capacity/cost RPC.




-- SOURCE 20261022093000_es02_trial_session_history.sql (idempotent local overlay) sha256=355da4ba03c01bc19e6cb4096bf806dd4c0a034eeca4b233a71261780e5f7486
do $history_overlay$ begin
 if not exists(select 1 from information_schema.columns where table_schema='private' and table_name='es02_branch_trial_operations' and column_name='native_session_id_snapshot') then
 alter table private.es02_branch_trial_operations add column native_session_id_snapshot uuid;
update private.es02_branch_trial_operations set native_session_id_snapshot=native_session_id;
alter table private.es02_branch_trial_operations alter column native_session_id_snapshot set not null;
alter table private.es02_branch_trial_operations alter column native_session_id drop not null;
alter table private.es02_branch_trial_operations drop constraint es02_branch_trial_operations_native_session_id_fkey;
alter table private.es02_branch_trial_operations add constraint es02_branch_trial_operations_native_session_id_fkey foreign key(native_session_id) references auth.sessions(id) on delete set null;
alter table private.es02_branch_trial_operations add constraint es02_trial_session_snapshot_match check(native_session_id is null or native_session_id=native_session_id_snapshot);


 end if;
end;$history_overlay$;
create or replace function public.es02_reserve_branch_trial(
  p_operation_id uuid,p_account_id uuid,p_session_id uuid,p_company_id uuid,p_branch_id uuid,
  p_question text,p_knowledge_revision text,p_hours_revision bigint,p_language_code text,p_persona text,p_model_id text,
  p_reserved_baisa numeric,p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare op private.es02_branch_trial_operations; budget public.ai_budget_accounts; used integer; state text;
begin
  if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
  if p_operation_id is null or p_session_id is null or length(btrim(coalesce(p_question,''))) not between 1 and 1000
     or p_model_id<>'gemini-3.8-flash' or p_reserved_baisa is null or p_reserved_baisa<=0 or p_reserved_baisa>1000
     or p_reserved_baisa::text in ('NaN','Infinity','-Infinity')
     or jsonb_typeof(p_pricing_snapshot) is distinct from 'object'
     or p_pricing_snapshot->>'modelId' is distinct from p_model_id or p_pricing_snapshot->>'version' is distinct from p_pricing_version
     or jsonb_typeof(p_source_citations) is distinct from 'array' or jsonb_array_length(p_source_citations)>40 then
    return jsonb_build_object('ok',false,'code','INVALID_INPUT');
  end if;
  -- Same global budget-first lock order as existing reserve/start/settle/reconcile.
  select * into budget from public.ai_budget_accounts where scope='admin_test' and company_id is null for update;
  if budget.id is null or not budget.enabled then return jsonb_build_object('ok',false,'code','BUDGET_DISABLED'); end if;
  perform 1 from public.company_branches where company_id=p_company_id and id=p_branch_id for update;
  select * into op from private.es02_branch_trial_operations where operation_id=p_operation_id;
  if op.operation_id is not null then
    if op.account_id<>p_account_id or op.company_id<>p_company_id or op.branch_id<>p_branch_id or op.question_hash<>md5(btrim(p_question)) then
      return jsonb_build_object('ok',false,'code','EXECUTION_CONFLICT');
    end if;
    select status into state from public.ai_usage_ledger where id=op.operation_id;
    return jsonb_build_object('ok',true,'newlyReserved',false,'state',state,'operationId',p_operation_id);
  end if;
  op.operation_id:=p_operation_id;op.company_id:=p_company_id;op.branch_id:=p_branch_id;op.account_id:=p_account_id;
  op.native_session_id:=p_session_id;op.question_hash:=md5(btrim(p_question));op.knowledge_revision:=p_knowledge_revision;
  op.hours_revision:=p_hours_revision;op.language_code:=p_language_code;op.persona:=p_persona;op.model_id:=p_model_id;
  if not private.es02_trial_context_current(op) then return jsonb_build_object('ok',false,'code','AUTHORIZATION_OR_CONTEXT_CHANGED'); end if;
  if exists(select 1 from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
    where t.company_id=p_company_id and t.branch_id=p_branch_id and l.status in ('reserved','running','uncertain')) then
    return jsonb_build_object('ok',false,'code','TRIAL_PENDING');
  end if;
  select count(*) into used from private.es02_branch_trial_operations t join public.ai_usage_ledger l on l.id=t.operation_id
    where t.company_id=p_company_id and t.branch_id=p_branch_id and l.status<>'rejected';
  if used>=10 then return jsonb_build_object('ok',false,'code','TRIAL_LIMIT_REACHED'); end if;
  if budget.spent_baisa+budget.held_baisa+p_reserved_baisa>least(budget.limit_baisa,1000) then return jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED'); end if;
  insert into public.ai_usage_ledger(id,budget_account_id,company_id,actor_user_id,actor_session_id,execution_id,attempt,usage_mode,model_id,provider,reserved_baisa,pricing_version,pricing_snapshot,source_citations)
    values(p_operation_id,budget.id,p_company_id,p_account_id,p_session_id,p_operation_id,1,'setup_trial',p_model_id,'google',p_reserved_baisa,p_pricing_version,p_pricing_snapshot,p_source_citations);
  insert into private.es02_branch_trial_operations(operation_id,company_id,branch_id,account_id,native_session_id,question_hash,knowledge_revision,hours_revision,language_code,persona,model_id,created_at,native_session_id_snapshot) values(op.operation_id,op.company_id,op.branch_id,op.account_id,op.native_session_id,op.question_hash,op.knowledge_revision,op.hours_revision,op.language_code,op.persona,op.model_id,clock_timestamp(),op.native_session_id);
  update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
  return jsonb_build_object('ok',true,'newlyReserved',true,'state','reserved','operationId',p_operation_id,'remaining',9-used);
end;
$$;



-- SOURCE wallet-core.sql sha256=ba3f66816bc3cd31099a79286486d1226f71b90e9d10e2dabdd98242cb2cdae0
-- LOCAL-ONLY REVIEW CANDIDATE. No top-level transaction: the caller must wrap
-- installer + native tests in BEGIN/ROLLBACK. Not a Production apply approval.
-- These owner-only helpers consume authority established by the native integration;
-- they are NOT standalone worker/browser authorization or provider receipt APIs.
create table private.es02_reply_credit_holds (
 job_id uuid primary key references public.whatsapp_inbound_jobs(id),
 company_id uuid not null references public.companies(id),
 balance_id uuid not null references private.es02_credit_balances(id),
 order_group_id uuid not null,
 state text not null default 'held' check(state in ('held','accepted','unknown','released')),
 review_required boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 accepted_at timestamptz,
 released_at timestamptz,
 check((state='accepted')=(accepted_at is not null)),
 check((state='released')=(released_at is not null))
);
alter table private.es02_reply_credit_holds owner to postgres;
alter table private.es02_reply_credit_holds enable row level security;
revoke all on private.es02_reply_credit_holds from public,anon,authenticated,service_role;
create index es02_reply_credit_holds_balance_pending on private.es02_reply_credit_holds(balance_id) where state in ('held','unknown');
create index es02_reply_credit_holds_company_review on private.es02_reply_credit_holds(company_id) where review_required;

create function private.es02_reply_credit_hold_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'ES02_CREDIT_HISTORY_IMMUTABLE' using errcode='23514';end if;
 if tg_op='INSERT' then
  if new.state<>'held' or new.review_required or not exists(select 1 from public.whatsapp_inbound_jobs j
   join private.es02_credit_balances b on b.id=new.balance_id and b.company_id=j.company_id
   where j.id=new.job_id and j.company_id=new.company_id) then
   raise exception 'ES02_CREDIT_HOLD_BINDING_INVALID' using errcode='23514';
  end if;
 else
  if row(new.job_id,new.company_id,new.balance_id,new.order_group_id,new.created_at)
   is distinct from row(old.job_id,old.company_id,old.balance_id,old.order_group_id,old.created_at)
   or (old.review_required and not new.review_required)
   or (old.state='accepted' and row(new.state,new.accepted_at,new.released_at) is distinct from row(old.state,old.accepted_at,old.released_at))
   or (old.state='released' and row(new.state,new.accepted_at,new.released_at) is distinct from row(old.state,old.accepted_at,old.released_at)) then
   raise exception 'ES02_CREDIT_HOLD_IMMUTABLE' using errcode='23514';
  end if;
 end if;
 return new;
end;$$;
alter function private.es02_reply_credit_hold_guard() owner to postgres;
revoke all on function private.es02_reply_credit_hold_guard() from public,anon,authenticated,service_role;
create trigger es02_reply_credit_hold_guard before insert or update or delete on private.es02_reply_credit_holds
 for each row execute function private.es02_reply_credit_hold_guard();

create function private.es02_hold_reply_credit(p_job_id uuid,p_company_id uuid,p_order_group_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.es02_reply_credit_holds;b private.es02_credit_balances;
begin
 if p_job_id is null or p_company_id is null or p_order_group_id is null then
  return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 -- Native caller already holds company -> subscription -> conversation -> job.
 -- Reacquiring the same company/job locks does not change that global order.
 perform 1 from public.companies where id=p_company_id for no key update;
 if not found then return jsonb_build_object('ok',false,'code','CREDIT_SCOPE_INVALID');end if;
 perform 1 from public.whatsapp_inbound_jobs where id=p_job_id and company_id=p_company_id for update;
 if not found then return jsonb_build_object('ok',false,'code','CREDIT_SCOPE_INVALID');end if;
 select * into h from private.es02_reply_credit_holds where job_id=p_job_id for update;
 if h.job_id is not null then
  if h.company_id<>p_company_id or h.order_group_id<>p_order_group_id then return jsonb_build_object('ok',false,'code','CREDIT_SCOPE_INVALID');end if;
  if h.state='accepted' then return jsonb_build_object('ok',false,'code','CREDIT_ALREADY_ACCEPTED');end if;
  if h.state='unknown' then return jsonb_build_object('ok',false,'code','CREDIT_RECONCILIATION_REQUIRED');end if;
  if h.state='released' then return jsonb_build_object('ok',false,'code','CREDIT_RESERVATION_RELEASED');end if;
 end if;
 if exists(select 1 from private.es02_reply_credit_holds where company_id=p_company_id and review_required) then
  return jsonb_build_object('ok',false,'code','CREDIT_ACCOUNTING_REVIEW');end if;
 -- Before the INITIAL clock starts, exactly one real-customer reply may be
 -- potentially accepted. UNKNOWN (and accepted-but-clock-pending) fences all
 -- competing initial dispatches. Test-number work does not start that clock.
 if to_regclass('private.es02_operational_recipient_proofs') is not null then
  if exists(select 1 from private.es02_activation_foundation a where a.company_id=p_company_id and a.clock_state='waiting_readiness')
   and exists(select 1 from private.es02_operational_recipient_proofs r where r.job_id=p_job_id and r.company_id=p_company_id and r.recipient_class='real_customer')
   and exists(select 1 from private.es02_reply_credit_holds pending join private.es02_operational_recipient_proofs r on r.job_id=pending.job_id
    where pending.company_id=p_company_id and pending.job_id<>p_job_id and r.company_id=p_company_id
     and r.recipient_class='real_customer' and pending.state in ('held','unknown','accepted')) then
   return jsonb_build_object('ok',false,'code','INITIAL_REPLY_PENDING');
  end if;
 end if;
 if h.job_id is not null then return jsonb_build_object('ok',true,'reused',true,'state','held','balanceId',h.balance_id);end if;
 -- Purchased capacity is company-owned across order groups, without ordinary
 -- expiry. Base capacity remains bound to this authorized order group/expiry.
 -- No SKIP LOCKED: never fall through to base because a purchased row is busy.
 select x.* into b from private.es02_credit_balances x
 where x.company_id=p_company_id
 and ((x.kind='purchased') or (x.kind='base' and x.order_group_id=p_order_group_id
  and (x.ordinary_expiry is null or x.ordinary_expiry>clock_timestamp())))
 and x.remaining>(select count(*) from private.es02_reply_credit_holds pending
  where pending.balance_id=x.id and pending.state in ('held','unknown'))
 order by case x.kind when 'purchased' then 0 else 1 end,x.created_at,x.id
 limit 1 for update;
 if b.id is null then return jsonb_build_object('ok',false,'code','CREDITS_EXHAUSTED');end if;
 insert into private.es02_reply_credit_holds(job_id,company_id,balance_id,order_group_id)
 values(p_job_id,p_company_id,b.id,p_order_group_id);
 return jsonb_build_object('ok',true,'reused',false,'state','held','kind',b.kind,'balanceId',b.id);
end;$$;
alter function private.es02_hold_reply_credit(uuid,uuid,uuid) owner to postgres;
revoke all on function private.es02_hold_reply_credit(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function private.es02_settle_reply_credit(p_job_id uuid,p_state text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.es02_reply_credit_holds;cid uuid;left_units integer;
begin
 if p_job_id is null or p_state is null or p_state not in ('accepted','unknown','released') then
  return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 select company_id into cid from private.es02_reply_credit_holds where job_id=p_job_id;
 if cid is null then return jsonb_build_object('ok',false,'code','CREDIT_HOLD_MISSING');end if;
 perform 1 from public.companies where id=cid for no key update;
 perform 1 from public.whatsapp_inbound_jobs where id=p_job_id and company_id=cid for update;
 select * into h from private.es02_reply_credit_holds where job_id=p_job_id for update;
 if h.state='accepted' then
  if p_state='accepted' then return jsonb_build_object('ok',true,'reused',true,'state','accepted');end if;
  return jsonb_build_object('ok',false,'code','CREDIT_ALREADY_ACCEPTED');
 end if;
 if h.state='released' then
  if p_state='released' then return jsonb_build_object('ok',true,'reused',true,'state','released');end if;
  -- A contradictory late receipt must not consume unrelated capacity, create
  -- units or silently vanish. Retain the liability and stop fresh allocations.
  update private.es02_reply_credit_holds set review_required=true,updated_at=clock_timestamp() where job_id=p_job_id;
  return jsonb_build_object('ok',false,'code','CREDIT_ACCOUNTING_REVIEW','accountingReview',true);
 end if;
 if p_state='accepted' then
  update private.es02_credit_balances set remaining=remaining-1
   where id=h.balance_id and company_id=h.company_id and remaining>=1 returning remaining into left_units;
  if not found then
   update private.es02_reply_credit_holds set review_required=true,updated_at=clock_timestamp() where job_id=p_job_id;
   return jsonb_build_object('ok',false,'code','CREDIT_ACCOUNTING_REVIEW','accountingReview',true);
  end if;
  update private.es02_reply_credit_holds set state='accepted',accepted_at=clock_timestamp(),updated_at=clock_timestamp() where job_id=p_job_id;
  return jsonb_build_object('ok',true,'reused',false,'state','accepted','remaining',left_units);
 end if;
 update private.es02_reply_credit_holds set state=p_state,
  released_at=case when p_state='released' then clock_timestamp() else null end,
  updated_at=clock_timestamp() where job_id=p_job_id;
 return jsonb_build_object('ok',true,'reused',h.state=p_state,'state',p_state);
end;$$;
alter function private.es02_settle_reply_credit(uuid,text) owner to postgres;
revoke all on function private.es02_settle_reply_credit(uuid,text) from public,anon,authenticated,service_role;


-- SOURCE acceptance-clock.sql sha256=d8be7cfbd255e300cc6e9192fd9f595cbf6be597824d577b76569fa973efceb0
-- LOCAL REVIEW CANDIDATE. Native receipt authority; no provider calls or grants
-- of customer credits. Caller wraps all candidate fragments in BEGIN/ROLLBACK.
create table private.es02_operational_recipient_proofs (
 job_id uuid primary key references public.whatsapp_inbound_jobs(id),
 company_id uuid not null references public.companies(id),
 branch_id uuid not null references public.company_branches(id),
 recipient_class text not null check(recipient_class in ('real_customer','test_number')),
 inbound_binding text not null,
 created_at timestamptz not null default clock_timestamp()
);
create table private.es02_initial_acceptance_receipts (
 company_id uuid primary key references public.companies(id),
 job_id uuid not null unique references public.whatsapp_inbound_jobs(id),
 intent_id uuid not null unique references public.whatsapp_send_intents(id),
 order_id uuid not null references private.es02_account_orders(id),
 branch_id uuid not null references public.company_branches(id),
 provider_message_id text not null unique check(length(btrim(provider_message_id))>0),
 accepted_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table private.es02_operational_recipient_proofs owner to postgres;
alter table private.es02_initial_acceptance_receipts owner to postgres;
alter table private.es02_operational_recipient_proofs enable row level security;
alter table private.es02_initial_acceptance_receipts enable row level security;
revoke all on private.es02_operational_recipient_proofs,private.es02_initial_acceptance_receipts from public,anon,authenticated,service_role;

create function private.es02_acceptance_evidence_immutable() returns trigger
language plpgsql set search_path='' as $$begin
 raise exception 'ES02_ACCEPTANCE_EVIDENCE_IMMUTABLE' using errcode='23514';
end;$$;
alter function private.es02_acceptance_evidence_immutable() owner to postgres;
revoke all on function private.es02_acceptance_evidence_immutable() from public,anon,authenticated,service_role;
create trigger es02_recipient_proof_immutable before update or delete on private.es02_operational_recipient_proofs
 for each row execute function private.es02_acceptance_evidence_immutable();
create trigger es02_initial_acceptance_immutable before update or delete on private.es02_initial_acceptance_receipts
 for each row execute function private.es02_acceptance_evidence_immutable();

create function private.es02_initial_clock_receipt_guard() returns trigger
language plpgsql set search_path='' as $$begin
 if old.subscription_started_at is not null and new.subscription_started_at is distinct from old.subscription_started_at then
  raise exception 'ES02_INITIAL_CLOCK_IMMUTABLE' using errcode='23514';end if;
 if old.clock_state='ended' and new.clock_state<>'ended' then
  raise exception 'ES02_ENDED_CLOCK_IMMUTABLE' using errcode='23514';end if;
 if old.subscription_started_at is null and (new.subscription_started_at is not null or new.clock_state='active' or new.paid_through_at is not null) then
  if not exists(select 1 from private.es02_initial_acceptance_receipts r
   where r.company_id=new.company_id and r.order_id=new.order_id and r.accepted_at=new.subscription_started_at)
   or new.clock_state<>'active' or new.paid_through_at is distinct from (
    ((new.subscription_started_at at time zone 'Asia/Muscat') + case new.term_unit when 'year' then interval '1 year' else interval '1 month' end
     + make_interval(days=>new.bonus_days)) at time zone 'Asia/Muscat') then
   raise exception 'ES02_INITIAL_CLOCK_ACCEPTANCE_REQUIRED' using errcode='23514';end if;
 end if;
 return new;
end;$$;
alter function private.es02_initial_clock_receipt_guard() owner to postgres;
revoke all on function private.es02_initial_clock_receipt_guard() from public,anon,authenticated,service_role;
create trigger es02_initial_clock_receipt_guard before update of clock_state,subscription_started_at,paid_through_at on private.es02_activation_foundation
 for each row execute function private.es02_initial_clock_receipt_guard();

create function public.es02_classify_claimed_reply(
 p_job_id uuid,p_claim_token uuid,p_configuration_mode text,p_test_phone_number_id text,p_test_recipients text[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs; c public.whatsapp_conversations;
 kind text; binding text; previous private.es02_operational_recipient_proofs; review_message boolean:=false;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 j:=private.wa_worker_lock(p_job_id,p_claim_token);
 if j.id is null then return jsonb_build_object('ok',false,'code','CLAIM_REJECTED');end if;
 if not exists(select 1 from private.es02_activation_foundation where company_id=j.company_id) then
  return jsonb_build_object('ok',true,'recipientClass','legacy');end if;
 select x.* into c from public.whatsapp_conversations x join public.whatsapp_messages m
  on m.conversation_id=x.id and m.company_id=x.company_id where m.id=j.message_id and m.company_id=j.company_id
  and m.wa_message_id=j.wa_message_id and m.direction='inbound' and m.sender='customer';
 if c.id is null or c.branch_id is null or p_configuration_mode is null
  or p_configuration_mode not in ('live','meta_test') or p_test_recipients is null
  or cardinality(p_test_recipients)>100 or exists(select 1 from unnest(p_test_recipients) x where x is null or x !~ '^\+?[0-9]{6,20}$') then
  return jsonb_build_object('ok',false,'code','RECIPIENT_CLASSIFICATION_UNAVAILABLE');end if;
 if to_regclass('private.review_whatsapp_inbound') is not null then
  execute 'select exists(select 1 from private.review_whatsapp_inbound where message_id=$1)' into review_message using j.message_id;
 end if;
 kind:=case when p_configuration_mode='meta_test' or review_message
  or c.phone_number_id=p_test_phone_number_id
  or exists(select 1 from unnest(p_test_recipients) x where regexp_replace(x,'[^0-9]','','g')=regexp_replace(c.customer_wa_id,'[^0-9]','','g'))
  then 'test_number' else 'real_customer' end;
 binding:=md5(concat_ws(':',j.company_id,c.branch_id,j.message_id,c.id,c.phone_number_id,c.customer_wa_id));
 select * into previous from private.es02_operational_recipient_proofs where job_id=j.id;
 if previous.job_id is not null and (previous.recipient_class<>kind or previous.inbound_binding<>binding) then
  return jsonb_build_object('ok',false,'code','CLASSIFICATION_CHANGED');end if;
 insert into private.es02_operational_recipient_proofs(job_id,company_id,branch_id,recipient_class,inbound_binding)
 values(j.id,j.company_id,c.branch_id,kind,binding) on conflict(job_id) do nothing;
 return jsonb_build_object('ok',true,'recipientClass',kind);
end;$$;
alter function public.es02_classify_claimed_reply(uuid,uuid,text,text,text[]) owner to postgres;
revoke all on function public.es02_classify_claimed_reply(uuid,uuid,text,text,text[]) from public,anon,authenticated,service_role;
grant execute on function public.es02_classify_claimed_reply(uuid,uuid,text,text,text[]) to service_role;

create function private.es02_start_on_accepted_reply(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare proof record; a private.es02_activation_foundation; started timestamptz; through timestamptz;
begin
 -- Native usage settlement has already authenticated the provider outcome.
 -- Independently require the original inbound, exact intent, successful LIVE
 -- AI execution, held wallet binding and immutable real-recipient snapshot.
 select j.company_id,j.id as job_id,i.id as intent_id,c.branch_id,i.wa_message_id,i.acceptance_observed_at,h.order_group_id
 into proof from public.whatsapp_inbound_jobs j
 join public.whatsapp_messages m on m.id=j.message_id and m.company_id=j.company_id and m.wa_message_id=j.wa_message_id
 join public.whatsapp_conversations c on c.id=m.conversation_id and c.company_id=j.company_id
 join public.whatsapp_send_intents i on i.id=j.send_intent_id and i.original_job_id=j.id and i.company_id=j.company_id
  and i.conversation_id=c.id and i.phone_number_id=c.phone_number_id and i.recipient_wa_id=c.customer_wa_id
 join public.ai_usage_ledger l on l.id=j.staged_ai_attempt_id and l.worker_job_id=j.id and l.company_id=j.company_id
  and l.usage_mode='company_live' and l.status='success' and l.response_text=i.body and l.source_citations=j.staged_citations
  and l.automation_generation=j.expected_automation_generation
 join public.billing_subscriptions subscription on subscription.id=j.usage_subscription_id and subscription.company_id=j.company_id and subscription.environment='live'
 join private.es02_reply_credit_holds h on h.job_id=j.id and h.company_id=j.company_id and h.state='accepted'
 join private.es02_activation_foundation foundation on foundation.company_id=j.company_id
  and foundation.order_id=l.es02_order_id and foundation.order_group_id=h.order_group_id
 join private.es02_operational_recipient_proofs r on r.job_id=j.id and r.company_id=j.company_id and r.branch_id=c.branch_id
  and r.recipient_class='real_customer' and r.inbound_binding=md5(concat_ws(':',j.company_id,c.branch_id,j.message_id,c.id,c.phone_number_id,c.customer_wa_id))
 where j.id=p_job_id and j.usage_status='accepted' and m.direction='inbound' and m.sender='customer'
 and l.es02_branch_id=c.branch_id and l.es02_slot_index between 0 and 31
 and l.es02_paid_fingerprint ~ '^[0-9a-f]{64}$' and l.es02_persona in ('noura','lina','dana')
 and i.sender_kind='assistant' and i.outcome='accepted' and nullif(btrim(i.wa_message_id),'') is not null
 and i.acceptance_observed_wa_message_id=i.wa_message_id and i.acceptance_observed_at is not null
 and i.acceptance_observed_at<=clock_timestamp() and i.staff_review_grant_id is null
 and coalesce(to_jsonb(i)->>'response_kind','ai_answer_v1')='ai_answer_v1';
 if proof.job_id is null then return jsonb_build_object('ok',false,'code','VERIFIED_OPERATIONAL_ACCEPTANCE_REQUIRED');end if;
 perform 1 from public.companies where id=proof.company_id for no key update;
 select * into a from private.es02_activation_foundation where company_id=proof.company_id for update;
 if a.company_id is null or a.order_group_id<>proof.order_group_id
  or proof.acceptance_observed_at<a.entitlement_created_at or proof.acceptance_observed_at<a.payment_confirmed_at then
  return jsonb_build_object('ok',false,'code','ACCEPTANCE_SCOPE_MISMATCH');end if;
 if a.clock_state in ('active','ended') then
  return jsonb_build_object('ok',true,'reused',true,'clockState',a.clock_state);end if;
 if a.clock_state<>'waiting_readiness' or a.subscription_started_at is not null or a.paid_through_at is not null then
  return jsonb_build_object('ok',false,'code','CLOCK_RECONCILIATION_REQUIRED');end if;
 -- Historical acceptance settles even if readiness/entitlement was later revoked.
 -- No current-authority recheck may erase accepted provider work.
 started:=proof.acceptance_observed_at;
 through:=((started at time zone 'Asia/Muscat') + case a.term_unit when 'year' then interval '1 year' else interval '1 month' end
  + make_interval(days=>a.bonus_days)) at time zone 'Asia/Muscat';
 insert into private.es02_initial_acceptance_receipts(company_id,job_id,intent_id,order_id,branch_id,provider_message_id,accepted_at)
 values(a.company_id,proof.job_id,proof.intent_id,a.order_id,proof.branch_id,proof.wa_message_id,started);
 update private.es02_activation_foundation set clock_state='active',subscription_started_at=started,paid_through_at=through,
  updated_at=clock_timestamp() where company_id=a.company_id and clock_state='waiting_readiness';
 -- Bind the actual accepted start to the existing ES02 live subscription. A
 -- subsequent cancellation/revocation is retained, never automatically revived.
 update public.billing_subscriptions set paid_through=through,
  status=case when status='awaiting_payment' then 'active' else status end
  where company_id=a.company_id and environment='live' and plan_version_id is null and paid_through is null;
 return jsonb_build_object('ok',true,'reused',false,'clockState','active','subscriptionStartedAt',started,'paidThroughAt',through);
end;$$;
alter function private.es02_start_on_accepted_reply(uuid) owner to postgres;
revoke all on function private.es02_start_on_accepted_reply(uuid) from public,anon,authenticated,service_role;

create function private.es02_native_usage_credit_settlement() returns trigger
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from private.es02_reply_credit_holds where job_id=new.id) then return new;end if;
 if new.usage_status in ('accepted','unknown','released') then
  result:=private.es02_settle_reply_credit(new.id,new.usage_status);
  if new.usage_status='accepted' and result->>'ok'='true' then
   perform private.es02_start_on_accepted_reply(new.id);
  end if;
 end if;
 return new;
end;$$;
alter function private.es02_native_usage_credit_settlement() owner to postgres;
revoke all on function private.es02_native_usage_credit_settlement() from public,anon,authenticated,service_role;
create trigger es02_native_usage_credit_settlement after update of usage_status on public.whatsapp_inbound_jobs
 for each row when (old.usage_status is distinct from new.usage_status) execute function private.es02_native_usage_credit_settlement();


-- SOURCE authority.sql sha256=7d8bed659a2863d3d9cbbc5fb9f93f1a47eee36474f4ba2e2071bef414da6f48
-- Reviewed LOCAL candidate: ES02 paid-order authority is distinct from legacy
-- native-plan authority. It never invents a plan UUID, paid-through or credit.
create function private.es02_paid_branch_readiness(p_company uuid,p_branch uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.es02_activation_foundation;o private.es02_account_orders;
 r private.es02_branch_slot_rights;sel private.es02_branch_channel_selections;
 binding jsonb; channel_binding jsonb; projection jsonb; ch text; hours bigint; lang text; knowledge text; persona text; sub public.billing_subscriptions;
begin
 select * into a from private.es02_activation_foundation where company_id=p_company;
 if a.company_id is null then return jsonb_build_object('ok',false,'code','ES02_SCOPE_REQUIRED');end if;
 select * into o from private.es02_account_orders where id=a.order_id;
 -- No browser return, synthetic fixture settlement or unverified provisioned
 -- flag can manufacture a LIVE operational entitlement.
 if o.id is null or o.provisioned_company_id is distinct from p_company or o.account_id is distinct from a.account_id
  or o.original_order_group_id is distinct from a.order_group_id or o.status is distinct from 'provisioned'
  or o.environment is distinct from 'live' or o.settlement_authority is distinct from 'paymob_hmac'
  or o.settled_at is null or nullif(btrim(o.provider_transaction_id),'') is null
  or not exists(select 1 from private.es02_account_settlement_events e where e.order_id=o.id and e.account_id=o.account_id
   and e.provider_transaction_id=o.provider_transaction_id and e.outcome='applied' and e.amount_baisa=o.amount_baisa and e.currency=o.currency)
  or not exists(select 1 from auth.users u where u.id=a.account_id and u.email_confirmed_at is not null and u.deleted_at is null)
 then return jsonb_build_object('ok',false,'code','VERIFIED_LIVE_ES02_PAYMENT_REQUIRED');end if;
 if a.clock_state='ended' or (a.clock_state='active' and (a.paid_through_at is null or a.paid_through_at<=clock_timestamp())) then
  return jsonb_build_object('ok',false,'code','SUBSCRIPTION_INACTIVE');end if;
 if not exists(select 1 from public.companies where id=p_company and status='active')
  or not exists(select 1 from public.company_branches where id=p_branch and company_id=p_company and status='active') then
  return jsonb_build_object('ok',false,'code','BRANCH_NOT_LAUNCHED');end if;
 binding:=private.es02_b3_current_binding(a.account_id,p_company,p_branch,'whatsapp');
 if binding->>'ok' is distinct from 'true' then return jsonb_build_object('ok',false,'code','PAID_BINDING_CHANGED');end if;
 select * into r from private.es02_branch_slot_rights where company_id=p_company and branch_id=p_branch and order_id=a.order_id;
 select * into sel from private.es02_branch_channel_selections where company_id=p_company and branch_id=p_branch and account_id=a.account_id;
 if r.id is null or sel.id is null or not (sel.channels ? 'whatsapp') then return jsonb_build_object('ok',false,'code','CHANNEL_NOT_SELECTED');end if;
 -- Existing B3 projection verifies actual legacy authorization, expiry,
 -- coexistence proof and generation. Also recheck immutable paid pins.
 for ch in select jsonb_array_elements_text(sel.channels) loop
  channel_binding:=private.es02_b3_current_binding(a.account_id,p_company,p_branch,ch);
  projection:=private.es02_b3_project(a.account_id,p_company,p_branch,ch);
  if channel_binding->>'ok' is distinct from 'true' or projection->>'sourceStatus' is distinct from 'ready'
   or projection->'connection'->>'state' is distinct from 'connected' or projection->'connection'->>'verified' is distinct from 'true'
   or not exists(select 1 from private.es02_b3_connection_links l join private.es02_b3_connection_attempts t on t.id=l.attempt_id
    where l.company_id=p_company and l.branch_id=p_branch and l.channel=ch and l.status='active' and l.revoked_at is null and l.verified
    and t.status='bound' and private.es02_b3_pin_matches(t,channel_binding)) then
   return jsonb_build_object('ok',false,'code','CHANNEL_PROOF_CHANGED');end if;
 end loop;
 select revision into hours from private.es02_branch_hours where company_id=p_company and branch_id=p_branch;
 select reply_language into lang from private.es02_branch_reply_language_confirmations where company_id=p_company and branch_id=p_branch;
 knowledge:=private.es02_branch_knowledge_revision(p_company,p_branch);
 persona:=case r.persona when 'level_1' then 'noura' when 'level_2' then 'lina' when 'level_3' then 'dana' end;
 if hours is null or hours<1 or lang is null or knowledge='no_knowledge'
  or not exists(select 1 from private.es02_branch_launch_confirmations where company_id=p_company and branch_id=p_branch and confirmed)
  or not exists(select 1 from private.es02_branch_assistant_trials t join public.ai_usage_ledger l on l.id=t.execution_id
   where t.company_id=p_company and t.branch_id=p_branch and t.origin='engine' and t.persona=persona
   and t.hours_revision=hours and t.language_code=lang and t.knowledge_revision=knowledge
   and l.company_id=p_company and l.usage_mode='setup_trial' and l.status='success') then
  return jsonb_build_object('ok',false,'code','CURRENT_BRANCH_READINESS_REQUIRED');end if;
 select * into sub from public.billing_subscriptions where company_id=p_company and environment='live';
 if sub.id is null or sub.plan_version_id is not null then
  return jsonb_build_object('ok',false,'code','SUBSCRIPTION_BINDING_REQUIRED');end if;
 if (a.clock_state='waiting_readiness' and (sub.status is distinct from 'awaiting_payment' or sub.paid_through is not null))
  or (a.clock_state='active' and (sub.status not in ('active','cancel_at_period_end') or sub.status is null
    or sub.paid_through is distinct from a.paid_through_at)) then
  return jsonb_build_object('ok',false,'code','SUBSCRIPTION_INACTIVE');end if;
 return jsonb_build_object('ok',true,'company_id',p_company,'branch_id',p_branch,'order_id',o.id,'order_group_id',a.order_group_id,
  'slot_index',r.slot_index,'paid_fingerprint',binding->>'paidFingerprint','persona',persona,'subscription_id',sub.id,
  'period_start',private.wa_worker_month());
exception when lock_not_available or deadlock_detected then
 return jsonb_build_object('ok',false,'code','AUTHORITY_BUSY');
end;$$;
alter function private.es02_paid_branch_readiness(uuid,uuid) owner to postgres;
revoke all on function private.es02_paid_branch_readiness(uuid,uuid) from public,anon,authenticated,service_role;

create function private.es02_claimed_reply_authority(p_job_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.whatsapp_inbound_jobs;c public.whatsapp_conversations; gate jsonb; scope record;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 -- Acquire the B3 member -> company -> branch -> order -> provisioning ->
 -- foundation -> rights -> selection prelude BEFORE native job locks. NOWAIT
 -- fails closed if another workflow already owns any part of this footprint;
 -- it never waits holding company/job while a setup writer holds membership.
 select j0.company_id,c0.branch_id,a.account_id,a.order_id into scope
 from public.whatsapp_inbound_jobs j0 join public.whatsapp_messages m on m.id=j0.message_id and m.company_id=j0.company_id
 join public.whatsapp_conversations c0 on c0.id=m.conversation_id and c0.company_id=j0.company_id
 join private.es02_activation_foundation a on a.company_id=j0.company_id where j0.id=p_job_id;
 if scope.company_id is null then return jsonb_build_object('ok',false,'code','CLAIM_REJECTED');end if;
 perform 1 from public.company_members where company_id=scope.company_id and user_id=scope.account_id and role='owner' and status='active' for update nowait;
 if not found then return jsonb_build_object('ok',false,'code','OWNER_AUTHORITY_REQUIRED');end if;
 perform 1 from public.companies where id=scope.company_id for update nowait;
 perform 1 from public.company_branches where id=scope.branch_id and company_id=scope.company_id for update nowait;
 perform 1 from private.es02_account_orders where id=scope.order_id for update nowait;
 perform 1 from private.es02_account_provisioning where order_id=scope.order_id for update nowait;
 perform 1 from private.es02_activation_foundation where company_id=scope.company_id for update nowait;
 perform 1 from private.es02_branch_slot_rights where company_id=scope.company_id and branch_id=scope.branch_id order by order_id,slot_index for update nowait;
 perform 1 from private.es02_branch_channel_selections where company_id=scope.company_id and branch_id=scope.branch_id for update nowait;
 j:=private.wa_worker_lock(p_job_id,p_claim_token);
 if j.id is null then return jsonb_build_object('ok',false,'code','CLAIM_REJECTED');end if;
 gate:=private.whatsapp_job_service_window(p_job_id,p_claim_token);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 select x.* into c from public.whatsapp_conversations x join public.whatsapp_messages m on m.conversation_id=x.id and m.company_id=x.company_id
 where m.id=j.message_id and m.company_id=j.company_id and m.wa_message_id=j.wa_message_id and m.direction='inbound' and m.sender='customer';
 if c.id is null or c.branch_id is null then return jsonb_build_object('ok',false,'code','BRANCH_BINDING_REQUIRED');end if;
 if not exists(select 1 from private.es02_operational_recipient_proofs r where r.job_id=j.id and r.company_id=j.company_id and r.branch_id=c.branch_id
  and r.inbound_binding=md5(concat_ws(':',j.company_id,c.branch_id,j.message_id,c.id,c.phone_number_id,c.customer_wa_id))) then
  return jsonb_build_object('ok',false,'code','RECIPIENT_CLASSIFICATION_REQUIRED');end if;
 gate:=private.es02_paid_branch_readiness(j.company_id,c.branch_id);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 -- The paid B3 link must be the exact phone used by this original inbound.
 if not exists(select 1 from private.es02_b3_connection_links b join public.whatsapp_company_links w on w.id=b.legacy_link_id
  where b.company_id=j.company_id and b.branch_id=c.branch_id and b.channel='whatsapp' and b.status='active' and b.revoked_at is null
  and w.company_id=j.company_id and w.provider_phone_number_id=c.phone_number_id and w.generation=b.legacy_generation) then
  return jsonb_build_object('ok',false,'code','CHANNEL_SCOPE_CHANGED');end if;
 return gate;
exception when lock_not_available or deadlock_detected then
 return jsonb_build_object('ok',false,'code','AUTHORITY_BUSY');
end;$$;
alter function private.es02_claimed_reply_authority(uuid,uuid) owner to postgres;
revoke all on function private.es02_claimed_reply_authority(uuid,uuid) from public,anon,authenticated,service_role;

-- Readiness observes current facts but NEVER starts or extends the INITIAL term.
-- Retains the existing authenticated function signature/result and ACL.
create or replace function public.es02_reconcile_activation_readiness(p_expected_account_id uuid,p_company_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; branch record; ready boolean:=false; observed jsonb;
begin
 actor:=private.es02_require_active_actor(p_expected_account_id);
 if actor is null then return jsonb_build_object('ok',false,'code','UNAUTHENTICATED');end if;
 if not exists(select 1 from public.company_members where company_id=p_company_id and user_id=actor and role='owner' and status='active') then
  return jsonb_build_object('ok',false,'code','FORBIDDEN');end if;
 perform 1 from public.company_members where company_id=p_company_id and user_id=actor and role='owner' and status='active' for update nowait;
 perform 1 from public.companies where id=p_company_id for update nowait;
 if not exists(select 1 from private.es02_activation_foundation where company_id=p_company_id and account_id=actor) then
  return jsonb_build_object('ok',false,'code','UNAVAILABLE');end if;
 for branch in select id from public.company_branches where company_id=p_company_id and status='active' order by id loop
  observed:=private.es02_paid_branch_readiness(p_company_id,branch.id);
  ready:=ready or (observed->>'ok'='true');
 end loop;
 update private.es02_activation_foundation set first_channel_ready=ready,actual_ai_ready=ready,operational_ready=ready,
  updated_at=clock_timestamp() where company_id=p_company_id and account_id=actor;
 return public.es02_read_activation_foundation(actor,p_company_id);
exception when lock_not_available or deadlock_detected then
 return jsonb_build_object('ok',false,'code','AUTHORITY_BUSY');
end;$$;
alter function public.es02_reconcile_activation_readiness(uuid,uuid) owner to postgres;


-- SOURCE worker-cost.sql sha256=8a68dda25691164396a760c50042e6a353db33ad426e1487a1a1def7d926d424
-- LOCAL-ONLY REVIEW CANDIDATE. Caller owns transaction and reviewed installation.
-- Reuses native company_live AI budget/cost ledger. No prices, budgets, balances
-- or financial grants are created. Legacy worker RPCs and plan bindings remain.
alter table public.ai_usage_ledger
 add column es02_order_id uuid references private.es02_account_orders(id),
 add column es02_branch_id uuid references public.company_branches(id),
 add column es02_slot_index integer,
 add column es02_paid_fingerprint text,
 add column es02_persona text;
alter table public.ai_usage_ledger add constraint ai_es02_worker_profile_complete check(
 (es02_order_id is null and es02_branch_id is null and es02_slot_index is null and es02_paid_fingerprint is null and es02_persona is null)
 or (es02_order_id is not null and es02_branch_id is not null and es02_slot_index is not null and es02_slot_index between 0 and 31
 and es02_paid_fingerprint is not null and es02_paid_fingerprint ~ '^[0-9a-f]{64}$'
 and es02_persona is not null and es02_persona in ('noura','lina','dana')
 and usage_mode='company_live' and worker_job_id is not null and worker_claim_token is not null
 and answer_persona is null and answer_plan_version_id is null));

create function private.es02_worker_cost_binding_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare authority jsonb;
begin
 if tg_op='UPDATE' then
  if row(new.es02_order_id,new.es02_branch_id,new.es02_slot_index,new.es02_paid_fingerprint,new.es02_persona)
   is distinct from row(old.es02_order_id,old.es02_branch_id,old.es02_slot_index,old.es02_paid_fingerprint,old.es02_persona) then
   raise exception 'ES02_WORKER_COST_BINDING_IMMUTABLE' using errcode='23514';end if;
 elsif new.es02_order_id is not null then
  authority:=private.es02_claimed_reply_authority(new.worker_job_id,new.worker_claim_token);
  if new.status is distinct from 'reserved' or not exists(
   select 1 from public.whatsapp_inbound_jobs j
   join private.es02_branch_slot_rights r on r.company_id=j.company_id
    and r.branch_id=new.es02_branch_id and r.order_id=new.es02_order_id and r.slot_index=new.es02_slot_index
   where j.id=new.worker_job_id and j.company_id=new.company_id
   and j.claim_token=new.worker_claim_token and j.expected_automation_generation=new.automation_generation
  ) or authority->>'ok' is distinct from 'true'
   or authority->>'company_id' is distinct from new.company_id::text or authority->>'order_id' is distinct from new.es02_order_id::text
   or authority->>'branch_id' is distinct from new.es02_branch_id::text or authority->>'slot_index' is distinct from new.es02_slot_index::text
   or authority->>'paid_fingerprint' is distinct from new.es02_paid_fingerprint or authority->>'persona' is distinct from new.es02_persona
   or not exists(select 1 from private.es02_reply_credit_holds h where h.job_id=new.worker_job_id and h.company_id=new.company_id and h.state='held')
   then raise exception 'ES02_WORKER_COST_BINDING_INVALID' using errcode='23514';end if;
 end if;
 return new;
end;$$;
alter function private.es02_worker_cost_binding_guard() owner to postgres;
revoke all on function private.es02_worker_cost_binding_guard() from public,anon,authenticated,service_role;
create trigger ai_es02_worker_cost_binding_guard before insert or update on public.ai_usage_ledger
 for each row execute function private.es02_worker_cost_binding_guard();

-- Citation conventions are the actual server loader conventions: native UUID,
-- page-<uuid> for indexed same-branch website pages, hours-<branch uuid> for B4.
create function private.es02_whatsapp_citations_current(p_company_id uuid,p_branch_id uuid,p_citations jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare x jsonb;sid text;v numeric;k public.knowledge_sources;page private.es02_branch_website_pages;hours private.es02_branch_hours;
begin
 if p_company_id is null or p_branch_id is null or jsonb_typeof(p_citations) is distinct from 'array'
 then return false;end if;
 if jsonb_array_length(p_citations) not between 1 and 40 then return false;end if;
 if not exists(select 1 from public.company_branches where id=p_branch_id and company_id=p_company_id) then return false;end if;
 for x in select value from jsonb_array_elements(p_citations) loop
  if jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'sourceId') is distinct from 'string'
   or jsonb_typeof(x->'contentVersion') is distinct from 'number' then return false;end if;
  sid:=x->>'sourceId';v:=(x->>'contentVersion')::numeric;
  if v<1 or v>2147483647 or v<>trunc(v) then return false;end if;
  if sid='hours-'||p_branch_id::text then
   select * into hours from private.es02_branch_hours where company_id=p_company_id and branch_id=p_branch_id for share;
   if not found or hours.revision is distinct from v::bigint or (x ? 'title' and x->>'title' is distinct from 'Working Hours') then return false;end if;
  elsif left(sid,5)='page-' then
   select * into page from private.es02_branch_website_pages where id=substring(sid from 6)::uuid
    and company_id=p_company_id and branch_id=p_branch_id for share;
   if not found or page.status<>'indexed' or length(btrim(page.extracted_text))=0 or page.version is distinct from v::integer
    or (x ? 'title' and x->>'title' is distinct from coalesce(nullif(page.title,''),page.url)) then return false;end if;
  else
   select * into k from public.knowledge_sources where id=sid::uuid and company_id=p_company_id for share;
   if not found or k.status<>'ready' or not k.approved_for_answers or k.approved_version is distinct from k.content_version
    or k.content_version is distinct from v::integer or length(btrim(k.content))=0
    or (x ? 'title' and x->>'title' is distinct from k.title) then return false;end if;
  end if;
 end loop;
 if (select count(distinct value->>'sourceId') from jsonb_array_elements(p_citations))<>jsonb_array_length(p_citations) then return false;end if;
 -- Preserve the existing mandatory business-instruction inclusion rule.
 return private.whatsapp_citations_include_current_instructions(p_company_id,p_citations);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;$$;
alter function private.es02_whatsapp_citations_current(uuid,uuid,jsonb) owner to postgres;
revoke all on function private.es02_whatsapp_citations_current(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.es02_reserve_whatsapp_capacity_cost_attempt(
 p_id uuid,p_job_id uuid,p_claim_token uuid,p_attempt integer,p_model_id text,p_provider text,p_reserved_baisa numeric,
 p_pricing_version text,p_pricing_snapshot jsonb,p_source_citations jsonb,p_expected_persona text,
 p_expected_order_id uuid,p_expected_branch_id uuid,p_expected_slot_index integer,p_expected_paid_fingerprint text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare gate jsonb;final_gate jsonb;r jsonb;budget public.ai_budget_accounts;j public.whatsapp_inbound_jobs;cid uuid;generation integer;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if p_id is null or p_job_id is null or p_claim_token is null or p_attempt is null or p_attempt not between 1 and 3
 or p_reserved_baisa is null or p_reserved_baisa<=0 or p_reserved_baisa>1000 or p_reserved_baisa::text in ('NaN','Infinity','-Infinity')
 or p_model_id is null or p_provider is null
 or not ((p_model_id='gemini-3.8-flash' and p_provider='google') or (p_model_id in ('gpt-6-luna','gpt-6.1-sol') and p_provider='openai'))
 or length(btrim(coalesce(p_pricing_version,'')))=0 or jsonb_typeof(p_pricing_snapshot) is distinct from 'object'
 or p_pricing_snapshot->>'modelId' is distinct from p_model_id or p_pricing_snapshot->>'version' is distinct from p_pricing_version
 or p_expected_persona is null or p_expected_persona not in ('noura','lina','dana') or p_expected_order_id is null or p_expected_branch_id is null
 or p_expected_slot_index is null or p_expected_slot_index not between 0 and 31 or coalesce(p_expected_paid_fingerprint,'') !~ '^[0-9a-f]{64}$'
 then return jsonb_build_object('ok',false,'code','INVALID_RESERVATION');end if;
 begin
  gate:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
  if gate->>'ok' is distinct from 'true' then r:=gate;raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  if gate->>'persona' is distinct from p_expected_persona or gate->>'order_id' is distinct from p_expected_order_id::text
   or gate->>'branch_id' is distinct from p_expected_branch_id::text or gate->>'slot_index' is distinct from p_expected_slot_index::text
   or gate->>'paid_fingerprint' is distinct from p_expected_paid_fingerprint then
   r:=jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  cid:=(gate->>'company_id')::uuid;
  select * into j from public.whatsapp_inbound_jobs where id=p_job_id and company_id=cid for update;
  if not found or j.expected_automation_generation is null or j.claim_token is distinct from p_claim_token then
   r:=jsonb_build_object('ok',false,'code','CLAIM_REJECTED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  generation:=j.expected_automation_generation;
  if j.usage_status in ('accepted','unknown') then
   r:=jsonb_build_object('ok',false,'code','usage_already_final_or_unknown');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  if gate->>'subscription_id' is null or gate->>'period_start' is null or (j.usage_status='reserved' and
   (j.usage_subscription_id is distinct from (gate->>'subscription_id')::uuid or j.usage_period_start is distinct from (gate->>'period_start')::timestamptz)) then
   r:=jsonb_build_object('ok',false,'code','USAGE_BINDING_CHANGED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  r:=private.es02_hold_reply_credit(p_job_id,cid,(gate->>'order_group_id')::uuid);
  if r->>'ok' is distinct from 'true' then raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  update public.whatsapp_inbound_jobs set usage_status='reserved',usage_subscription_id=(gate->>'subscription_id')::uuid,
   usage_period_start=(gate->>'period_start')::timestamptz where id=p_job_id and company_id=cid;
  if not private.es02_whatsapp_citations_current(cid,p_expected_branch_id,p_source_citations) then
   r:=jsonb_build_object('ok',false,'code','KNOWLEDGE_CHANGED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  select * into budget from public.ai_budget_accounts where scope='company_live' and company_id=cid
   and period_start=date_trunc('month',clock_timestamp())::date for update;
  if not found or not budget.enabled then r:=jsonb_build_object('ok',false,'code','BUDGET_DISABLED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  if exists(select 1 from public.ai_usage_ledger where id=p_id or (execution_id=p_job_id and attempt=p_attempt)) then
   r:=jsonb_build_object('ok',false,'code','DUPLICATE_REQUEST');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  if exists(select 1 from public.ai_usage_ledger where worker_job_id=p_job_id and
   (automation_generation is distinct from generation or status<>'rejected' or cost_baisa is distinct from 0
    or cost_usd is distinct from 0 or error_code not in ('KEY_MISSING','PROVIDER_HTTP_403','PROVIDER_HTTP_404') or error_code is null)) then
   r:=jsonb_build_object('ok',false,'code','PRIOR_ATTEMPT_NOT_RETRYABLE');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  if (select count(*) from public.ai_usage_ledger where worker_job_id=p_job_id and automation_generation=generation)<>p_attempt-1
   or (p_attempt>1 and not exists(select 1 from public.ai_usage_ledger where worker_job_id=p_job_id
    and automation_generation=generation and attempt=p_attempt-1 and worker_claim_token=p_claim_token
    and es02_order_id=p_expected_order_id and es02_branch_id=p_expected_branch_id and es02_slot_index=p_expected_slot_index
    and es02_paid_fingerprint=p_expected_paid_fingerprint and es02_persona=p_expected_persona)) then
   r:=jsonb_build_object('ok',false,'code','ATTEMPT_SEQUENCE_REJECTED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  if budget.spent_baisa+budget.held_baisa+p_reserved_baisa>budget.limit_baisa then
   r:=jsonb_build_object('ok',false,'code','BUDGET_EXCEEDED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  insert into public.ai_usage_ledger(id,budget_account_id,company_id,execution_id,attempt,usage_mode,model_id,provider,
   reserved_baisa,pricing_version,pricing_snapshot,worker_job_id,worker_claim_token,automation_generation,source_citations,
   es02_order_id,es02_branch_id,es02_slot_index,es02_paid_fingerprint,es02_persona)
  values(p_id,budget.id,cid,p_job_id,p_attempt,'company_live',p_model_id,p_provider,p_reserved_baisa,p_pricing_version,p_pricing_snapshot,
   p_job_id,p_claim_token,generation,p_source_citations,p_expected_order_id,p_expected_branch_id,p_expected_slot_index,p_expected_paid_fingerprint,p_expected_persona);
  update public.ai_budget_accounts set held_baisa=held_baisa+p_reserved_baisa where id=budget.id;
  -- Recheck authority after shared locks and all new writes. Any denial rolls
  -- this subtransaction back, preserving earlier durable/unknown reservations.
  final_gate:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
  if final_gate->>'ok' is distinct from 'true' or (final_gate-'asOf') is distinct from (gate-'asOf') then
   r:=jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');raise exception 'ES02_ATOMIC_RESERVATION_DENIED' using errcode='PEC01';end if;
  return jsonb_build_object('ok',true,'id',p_id,'job_id',p_job_id,'company_id',cid,'automation_generation',generation,
   'answer_persona',p_expected_persona,'es02_order_id',p_expected_order_id,'es02_branch_id',p_expected_branch_id,
   'es02_slot_index',p_expected_slot_index,'es02_paid_fingerprint',p_expected_paid_fingerprint,
   'remaining_baisa',budget.limit_baisa-budget.spent_baisa-budget.held_baisa-p_reserved_baisa);
 exception when sqlstate 'PEC01' then return r;end;
end;$$;
alter function public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text) owner to postgres;
revoke all on function public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.es02_reserve_whatsapp_capacity_cost_attempt(uuid,uuid,uuid,integer,text,text,numeric,text,jsonb,jsonb,text,uuid,uuid,integer,text) to service_role;

create function private.es02_start_whatsapp_attempt(p_id uuid,p_claim_token uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare a public.ai_usage_ledger;gate jsonb;final_gate jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 select * into a from public.ai_usage_ledger where id=p_id;
 if not found or a.es02_order_id is null or a.worker_job_id is null or p_claim_token is null
  or a.worker_claim_token is distinct from p_claim_token or a.status<>'reserved' then return false;end if;
 begin
  gate:=private.es02_claimed_reply_authority(a.worker_job_id,p_claim_token);
  if gate->>'ok' is distinct from 'true' or gate->>'company_id' is distinct from a.company_id::text
   or gate->>'order_id' is distinct from a.es02_order_id::text or gate->>'branch_id' is distinct from a.es02_branch_id::text
   or gate->>'slot_index' is distinct from a.es02_slot_index::text or gate->>'paid_fingerprint' is distinct from a.es02_paid_fingerprint
   or gate->>'persona' is distinct from a.es02_persona then return false;end if;
  if not exists(select 1 from public.whatsapp_inbound_jobs where id=a.worker_job_id and company_id=a.company_id
   and expected_automation_generation=a.automation_generation and usage_status='reserved'
   and usage_subscription_id=(gate->>'subscription_id')::uuid and usage_period_start=(gate->>'period_start')::timestamptz)
   or not exists(select 1 from private.es02_reply_credit_holds where job_id=a.worker_job_id and company_id=a.company_id and state='held' and not review_required)
   or exists(select 1 from private.es02_reply_credit_holds where company_id=a.company_id and review_required)
   or not private.es02_whatsapp_citations_current(a.company_id,a.es02_branch_id,a.source_citations) then return false;end if;
  perform 1 from public.ai_budget_accounts where id=a.budget_account_id and enabled and scope='company_live' and company_id=a.company_id
   and period_start=date_trunc('month',clock_timestamp())::date for update;
  if not found then return false;end if;
  select * into a from public.ai_usage_ledger where id=p_id and status='reserved' and worker_claim_token=p_claim_token for update;
  if not found then return false;end if;
  final_gate:=private.es02_claimed_reply_authority(a.worker_job_id,p_claim_token);
  if final_gate->>'ok' is distinct from 'true' or (final_gate-'asOf') is distinct from (gate-'asOf') then return false;end if;
  update public.ai_usage_ledger set status='running' where id=p_id and status='reserved' and worker_claim_token=p_claim_token;
  return found;
 end;
end;$$;
alter function private.es02_start_whatsapp_attempt(uuid,uuid) owner to postgres;
revoke all on function private.es02_start_whatsapp_attempt(uuid,uuid) from public,anon,authenticated,service_role;


-- SOURCE usage-reconciliation.sql sha256=51f08e0205691a1630802a0ad230ceafdee23c136eedffd0bbb9f223729fee1d
-- Idempotent reconciliation preserves durable native provider evidence even
-- when accounting needs a later repair. No resend, refund or new credit grant.
create function private.es02_native_reply_outcome_proven(p_job_id uuid,p_state text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if p_state is null or p_state not in ('accepted','released') then return false;end if;
 return exists(
  select 1 from public.whatsapp_inbound_jobs j
  join public.whatsapp_messages m on m.id=j.message_id and m.company_id=j.company_id and m.wa_message_id=j.wa_message_id
  join public.whatsapp_conversations c on c.id=m.conversation_id and c.company_id=j.company_id
  join public.whatsapp_send_intents i on i.id=j.send_intent_id and i.original_job_id=j.id and i.company_id=j.company_id
   and i.conversation_id=c.id and i.phone_number_id=c.phone_number_id and i.recipient_wa_id=c.customer_wa_id
  join public.ai_usage_ledger l on l.id=j.staged_ai_attempt_id and l.worker_job_id=j.id and l.company_id=j.company_id
   and l.usage_mode='company_live' and l.status='success' and l.response_text=i.body and l.source_citations=j.staged_citations
   and l.automation_generation=j.expected_automation_generation and l.es02_branch_id=c.branch_id
  join private.es02_reply_credit_holds h on h.job_id=j.id and h.company_id=j.company_id
  join private.es02_account_orders o on o.id=l.es02_order_id and o.provisioned_company_id=j.company_id and o.original_order_group_id=h.order_group_id
  where j.id=p_job_id and j.usage_status=p_state and m.direction='inbound' and m.sender='customer'
   and i.sender_kind='assistant' and i.expected_automation_generation=j.expected_automation_generation
   and l.es02_slot_index between 0 and 31 and l.es02_paid_fingerprint ~ '^[0-9a-f]{64}$'
   and l.es02_persona in ('noura','lina','dana')
   and ((p_state='accepted' and i.outcome='accepted' and nullif(btrim(i.wa_message_id),'') is not null
     and i.acceptance_observed_wa_message_id=i.wa_message_id and i.acceptance_observed_at is not null)
    or (p_state='released' and i.outcome='rejected' and i.wa_message_id is null
     and i.acceptance_observed_wa_message_id is null and i.acceptance_observed_at is null))
 );
end;$$;
alter function private.es02_native_reply_outcome_proven(uuid,text) owner to postgres;
revoke all on function private.es02_native_reply_outcome_proven(uuid,text) from public,anon,authenticated,service_role;

create function private.es02_reconcile_native_reply_credit(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare h private.es02_reply_credit_holds;j public.whatsapp_inbound_jobs;r jsonb;kind text;clock_state text;
begin
 select * into h from private.es02_reply_credit_holds where job_id=p_job_id;
 if h.job_id is null then return jsonb_build_object('ok',true,'legacy',true);end if;
 perform 1 from public.companies where id=h.company_id for no key update;
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id and company_id=h.company_id for update;
 if j.usage_status='unknown' then return private.es02_settle_reply_credit(p_job_id,'unknown');end if;
 if j.usage_status not in ('accepted','released') or j.usage_status is null then
  return jsonb_build_object('ok',false,'code','ES02_ACCOUNTING_PENDING');end if;
 if not private.es02_native_reply_outcome_proven(p_job_id,j.usage_status) then
  -- A raw released status is not provider rejection proof. Keep capacity held.
  if h.state in ('held','unknown') then perform private.es02_settle_reply_credit(p_job_id,'unknown');end if;
  return jsonb_build_object('ok',false,'code','ES02_PROVIDER_OUTCOME_PROOF_REQUIRED','status',j.usage_status);
 end if;
 r:=private.es02_settle_reply_credit(p_job_id,j.usage_status);
 if r->>'ok' is distinct from 'true' or j.usage_status<>'accepted' then return r;end if;
 select recipient_class into kind from private.es02_operational_recipient_proofs where job_id=p_job_id and company_id=h.company_id;
 if kind='test_number' then return r||jsonb_build_object('clock','excluded_test_number');end if;
 if kind is distinct from 'real_customer' then return jsonb_build_object('ok',false,'code','RECIPIENT_CLASSIFICATION_REQUIRED','status','accepted');end if;
 select a.clock_state into clock_state from private.es02_activation_foundation a where a.company_id=h.company_id;
 if clock_state in ('active','ended') then return r||jsonb_build_object('clock','already_started');end if;
 r:=private.es02_start_on_accepted_reply(p_job_id);
 if r->>'ok' is distinct from 'true' then
  return jsonb_build_object('ok',false,'code','ES02_CLOCK_RECONCILIATION_REQUIRED','status','accepted');end if;
 return jsonb_build_object('ok',true,'status','accepted','clock','started');
end;$$;
alter function private.es02_reconcile_native_reply_credit(uuid) owner to postgres;
revoke all on function private.es02_reconcile_native_reply_credit(uuid) from public,anon,authenticated,service_role;

-- A retry/reconciliation of an already accepted native job MUST attempt the
-- wallet/clock again. A status-change-only trigger is insufficient.
alter function public.billing_finalize_automated_usage(uuid,uuid) set schema private;
alter function private.billing_finalize_automated_usage(uuid,uuid) rename to es02_pre_usage_settlement;
revoke all on function private.es02_pre_usage_settlement(uuid,uuid) from public,anon,authenticated,service_role;
create function public.billing_finalize_automated_usage(p_company_id uuid,p_intent_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare native jsonb; accounting jsonb; job uuid;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 native:=private.es02_pre_usage_settlement(p_company_id,p_intent_id);
 select id into job from public.whatsapp_inbound_jobs where company_id=p_company_id and send_intent_id=p_intent_id;
 if job is null then return native;end if;
 -- Only this inner accounting work rolls back on an internal error; the native
 -- receipt/outcome above survives and prevents another provider attempt.
 begin
  accounting:=private.es02_reconcile_native_reply_credit(job);
 exception when others then
  accounting:=jsonb_build_object('ok',false,'code','ES02_ACCOUNTING_PENDING');
 end;
 if accounting->>'ok' is distinct from 'true' then
  return native||jsonb_build_object('ok',false,'code',accounting->>'code','accounting','pending');end if;
 return native||jsonb_build_object('accounting','settled');
end;$$;
alter function public.billing_finalize_automated_usage(uuid,uuid) owner to postgres;
revoke all on function public.billing_finalize_automated_usage(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.billing_finalize_automated_usage(uuid,uuid) to service_role;

-- Native paths which update usage directly still reconcile. Internal errors must
-- not erase an already observed provider receipt; the public replay repairs it.
create or replace function private.es02_native_usage_credit_settlement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from private.es02_reply_credit_holds where job_id=new.id) then
  begin
   perform private.es02_reconcile_native_reply_credit(new.id);
  exception when others then
   raise log '{"error_code":"ES02_ACCOUNTING_PENDING","operation":"native_usage_settlement"}';
  end;
 end if;
 return new;
end;$$;


-- SOURCE worker-bridge.sql sha256=b3d408ce69278eec5ae22dcf8f2106ed673ce6d5d7d42ca34da2d2ee148b410d
-- LOCAL REVIEW ONLY. This fragment bridges existing worker APIs to verified
-- ES02 order authority without manufacturing a legacy plan/paid-through.
-- The enclosing installer must pin every renamed native function beforehand.
create function private.es02_job_scope(p_job uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.whatsapp_inbound_jobs j join private.es02_activation_foundation a on a.company_id=j.company_id where j.id=p_job);
$$;
alter function private.es02_job_scope(uuid) owner to postgres;
revoke all on function private.es02_job_scope(uuid) from public,anon,authenticated,service_role;

alter function private.whatsapp_answer_profile(uuid,uuid) rename to es02_pre_answer_profile;
revoke all on function private.es02_pre_answer_profile(uuid,uuid) from public,anon,authenticated,service_role;
create function private.whatsapp_answer_profile(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare g jsonb;begin
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_answer_profile(p_job_id,p_claim_token);end if;
 g:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if g->>'ok' is distinct from 'true' then return g;end if;
 return jsonb_build_object('ok',true,'authority','es02','job_id',p_job_id,'company_id',g->'company_id','persona',g->'persona',
  'es02_order_id',g->'order_id','es02_branch_id',g->'branch_id','es02_slot_index',g->'slot_index','es02_paid_fingerprint',g->'paid_fingerprint');
end;$$;
alter function private.whatsapp_answer_profile(uuid,uuid) owner to postgres;
revoke all on function private.whatsapp_answer_profile(uuid,uuid) from public,anon,authenticated,service_role;

alter function public.billing_load_worker_frame(uuid,uuid) set schema private;
alter function private.billing_load_worker_frame(uuid,uuid) rename to es02_pre_load_worker_frame;
revoke all on function private.es02_pre_load_worker_frame(uuid,uuid) from public,anon,authenticated,service_role;
create function public.billing_load_worker_frame(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare g jsonb;r jsonb;f jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_load_worker_frame(p_job_id,p_claim_token);end if;
 g:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if g->>'ok' is distinct from 'true' then return g;end if;
 -- Exact native projection only: its original-job/link checks remain. The old
 -- public entitlement wrapper cannot authorize this new ES02 order contract.
 r:=private.wa_frame_pre_meta_policy(p_job_id,p_claim_token);
 if r->>'ok' is distinct from 'true' then return r;end if;
 if r->'data'->>'ai_attempt_id' is not null and not exists(select 1 from public.ai_usage_ledger l
  where l.id=(r->'data'->>'ai_attempt_id')::uuid and l.worker_job_id=p_job_id and l.company_id=(g->>'company_id')::uuid
   and l.es02_order_id=(g->>'order_id')::uuid and l.es02_branch_id=(g->>'branch_id')::uuid and l.es02_slot_index=(g->>'slot_index')::integer
   and l.es02_paid_fingerprint=g->>'paid_fingerprint' and l.es02_persona=g->>'persona') then
  return jsonb_build_object('ok',false,'code','ES02_LEGACY_ATTEMPT_REVIEW');end if;
 f:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if f->>'ok' is distinct from 'true' or f is distinct from g then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return jsonb_set(r,'{data}',r->'data'||jsonb_build_object('authority','es02'));
end;$$;
alter function public.billing_load_worker_frame(uuid,uuid) owner to postgres;
revoke all on function public.billing_load_worker_frame(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.billing_load_worker_frame(uuid,uuid) to service_role;

alter function public.whatsapp_reserve_job_usage(uuid,uuid) set schema private;
alter function private.whatsapp_reserve_job_usage(uuid,uuid) rename to es02_pre_reserve_job_usage;
revoke all on function private.es02_pre_reserve_job_usage(uuid,uuid) from public,anon,authenticated,service_role;
create function public.whatsapp_reserve_job_usage(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare g jsonb;j public.whatsapp_inbound_jobs;h private.es02_reply_credit_holds;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_reserve_job_usage(p_job_id,p_claim_token);end if;
 g:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if g->>'ok' is distinct from 'true' then return g;end if;
 select * into j from public.whatsapp_inbound_jobs where id=p_job_id and company_id=(g->>'company_id')::uuid for update;
 select * into h from private.es02_reply_credit_holds where job_id=p_job_id and company_id=j.company_id for update;
 if h.job_id is null then return jsonb_build_object('ok',false,'code','CREDIT_RESERVATION_REQUIRED');end if;
 if h.state<>'held' or h.review_required or exists(select 1 from private.es02_reply_credit_holds where company_id=j.company_id and review_required) then
  return jsonb_build_object('ok',false,'code','CREDIT_RECONCILIATION_REQUIRED');end if;
 if h.order_group_id is distinct from (g->>'order_group_id')::uuid or j.usage_status is distinct from 'reserved'
  or j.usage_subscription_id is distinct from (g->>'subscription_id')::uuid or j.usage_period_start is distinct from (g->>'period_start')::timestamptz then
  return jsonb_build_object('ok',false,'code','USAGE_BINDING_CHANGED');end if;
 return jsonb_build_object('ok',true,'reused',true,'can_dispatch',false,'status','reserved');
end;$$;
alter function public.whatsapp_reserve_job_usage(uuid,uuid) owner to postgres;
revoke all on function public.whatsapp_reserve_job_usage(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_reserve_job_usage(uuid,uuid) to service_role;

alter function public.ai_start_whatsapp_attempt(uuid,uuid) set schema private;
alter function private.ai_start_whatsapp_attempt(uuid,uuid) rename to es02_pre_start_whatsapp_attempt;
revoke all on function private.es02_pre_start_whatsapp_attempt(uuid,uuid) from public,anon,authenticated,service_role;
create function public.ai_start_whatsapp_attempt(p_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if exists(select 1 from public.ai_usage_ledger where id=p_id and es02_order_id is not null) then
  return private.es02_start_whatsapp_attempt(p_id,p_claim_token);end if;
 return private.es02_pre_start_whatsapp_attempt(p_id,p_claim_token);
end;$$;
alter function public.ai_start_whatsapp_attempt(uuid,uuid) owner to postgres;
revoke all on function public.ai_start_whatsapp_attempt(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.ai_start_whatsapp_attempt(uuid,uuid) to service_role;

create function private.es02_successful_worker_attempt(p_job uuid,p_claim uuid,p_attempt uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare g jsonb;j public.whatsapp_inbound_jobs;a public.ai_usage_ledger;begin
 g:=private.es02_claimed_reply_authority(p_job,p_claim);if g->>'ok' is distinct from 'true' then return g;end if;
 select * into j from public.whatsapp_inbound_jobs where id=p_job and company_id=(g->>'company_id')::uuid for update;
 select * into a from public.ai_usage_ledger where id=p_attempt and company_id=j.company_id and worker_job_id=j.id for update;
 if not found or a.status<>'success' or a.response_text is null or length(btrim(a.response_text)) not between 1 and 4096
  or a.automation_generation is distinct from j.expected_automation_generation or a.usage_mode<>'company_live'
  or a.es02_order_id is distinct from (g->>'order_id')::uuid or a.es02_branch_id is distinct from (g->>'branch_id')::uuid
  or a.es02_slot_index is distinct from (g->>'slot_index')::integer or a.es02_paid_fingerprint is distinct from g->>'paid_fingerprint'
  or a.es02_persona is distinct from g->>'persona' or a.answer_persona is not null or a.answer_plan_version_id is not null then
  return jsonb_build_object('ok',false,'code','VERIFIED_ES02_REPLY_REQUIRED');end if;
 if j.usage_status is distinct from 'reserved' or j.usage_subscription_id is distinct from (g->>'subscription_id')::uuid
  or j.usage_period_start is distinct from (g->>'period_start')::timestamptz
  or not exists(select 1 from private.es02_reply_credit_holds where job_id=j.id and company_id=j.company_id
   and order_group_id=(g->>'order_group_id')::uuid and state='held' and not review_required)
  or exists(select 1 from private.es02_reply_credit_holds where company_id=j.company_id and review_required)
  or not private.es02_whatsapp_citations_current(j.company_id,a.es02_branch_id,a.source_citations) then
  return jsonb_build_object('ok',false,'code','ENTITLEMENT_USAGE_OR_KNOWLEDGE_CHANGED');end if;
 return g;
end;$$;
alter function private.es02_successful_worker_attempt(uuid,uuid,uuid) owner to postgres;
revoke all on function private.es02_successful_worker_attempt(uuid,uuid,uuid) from public,anon,authenticated,service_role;

alter function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) set schema private;
alter function private.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) rename to es02_pre_stage_job_reply;
revoke all on function private.es02_pre_stage_job_reply(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.whatsapp_stage_job_reply(p_job_id uuid,p_claim_token uuid,p_ai_attempt_id uuid,p_citations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g jsonb;f jsonb;r jsonb;j public.whatsapp_inbound_jobs;a public.ai_usage_ledger;c public.whatsapp_conversations;l public.whatsapp_company_links;i uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_stage_job_reply(p_job_id,p_claim_token,p_ai_attempt_id,p_citations);end if;
 begin
  g:=private.es02_successful_worker_attempt(p_job_id,p_claim_token,p_ai_attempt_id);
  if g->>'ok' is distinct from 'true' then r:=g;raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  select * into j from public.whatsapp_inbound_jobs where id=p_job_id;
  select * into a from public.ai_usage_ledger where id=p_ai_attempt_id;
  if p_citations is distinct from a.source_citations then r:=jsonb_build_object('ok',false,'code','citations_changed');raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  if j.send_intent_id is not null then
   if j.staged_ai_attempt_id is distinct from p_ai_attempt_id or j.staged_citations is distinct from p_citations or j.staged_reply is distinct from a.response_text
    or not exists(select 1 from public.whatsapp_send_intents x where x.id=j.send_intent_id and x.company_id=j.company_id and x.original_job_id=j.id
     and x.sender_kind='assistant' and x.body=j.staged_reply and x.expected_automation_generation=j.expected_automation_generation
     and private.whatsapp_intent_link_current(x)) then r:=jsonb_build_object('ok',false,'code','staged_content_mismatch');raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
   return jsonb_build_object('ok',true,'reused',true,'intent_id',j.send_intent_id);
  end if;
  select x.* into c from public.whatsapp_conversations x join public.whatsapp_messages m on m.conversation_id=x.id and m.company_id=x.company_id where m.id=j.message_id;
  select * into l from public.whatsapp_company_links where company_id=j.company_id and status='verified' and provider_phone_number_id=c.phone_number_id for share;
  if not found then r:=jsonb_build_object('ok',false,'code','link_unavailable');raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  r:=public.create_whatsapp_assistant_send_intent('wa-job:'||j.id,c.id,a.response_text,c.phone_number_id,j.expected_automation_generation,l.id,l.generation);
  if r->>'ok' is distinct from 'true' then raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  i:=(r->'intent'->>'id')::uuid;
  update public.whatsapp_send_intents set original_job_id=j.id where id=i and company_id=j.company_id;
  update public.whatsapp_inbound_jobs set staged_reply=a.response_text,staged_citations=p_citations,staged_ai_attempt_id=a.id,send_intent_id=i where id=j.id;
  f:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
  if f->>'ok' is distinct from 'true' or f is distinct from g then r:=jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  return jsonb_build_object('ok',true,'reused',false,'intent_id',i);
 exception when sqlstate 'PEB01' then return r;end;
end;$$;
alter function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) owner to postgres;
revoke all on function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_stage_job_reply(uuid,uuid,uuid,jsonb) to service_role;

alter function public.whatsapp_claim_assistant_job_send(uuid,uuid) set schema private;
alter function private.whatsapp_claim_assistant_job_send(uuid,uuid) rename to es02_pre_claim_assistant_job_send;
revoke all on function private.es02_pre_claim_assistant_job_send(uuid,uuid) from public,anon,authenticated,service_role;
create function public.whatsapp_claim_assistant_job_send(p_job_id uuid,p_claim_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$declare j public.whatsapp_inbound_jobs;i public.whatsapp_send_intents;g jsonb;f jsonb;r jsonb;token uuid;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_claim_assistant_job_send(p_job_id,p_claim_token);end if;
 begin
  select * into j from public.whatsapp_inbound_jobs where id=p_job_id;
  g:=private.es02_successful_worker_attempt(p_job_id,p_claim_token,j.staged_ai_attempt_id);
  if g->>'ok' is distinct from 'true' then r:=g;raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  select * into j from public.whatsapp_inbound_jobs where id=p_job_id;
  select * into i from public.whatsapp_send_intents where id=j.send_intent_id and company_id=j.company_id and original_job_id=j.id for update;
  if not found or i.sender_kind<>'assistant' or i.body is distinct from j.staged_reply or i.expected_automation_generation is distinct from j.expected_automation_generation
   or i.staff_review_grant_id is not null or coalesce(to_jsonb(i)->>'response_kind','ai_answer_v1')<>'ai_answer_v1'
   or not private.whatsapp_intent_link_current(i)
   or not exists(select 1 from public.ai_usage_ledger a where a.id=j.staged_ai_attempt_id and a.company_id=j.company_id
    and a.worker_job_id=j.id and a.response_text=j.staged_reply and a.source_citations=j.staged_citations) then
   r:=jsonb_build_object('ok',false,'code','intent_binding_changed');raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  -- Existing attempting/unknown/accepted/rejected outcomes are never a fresh send.
  if i.outcome<>'ready' then return jsonb_build_object('ok',true,'claimed',false,'intent',private.whatsapp_send_intent_public(i));end if;
  token:=gen_random_uuid();
  update public.whatsapp_send_intents set outcome='attempting',attempt_token=token,attempt_started_at=clock_timestamp(),attempt_expires_at=clock_timestamp()+interval '90 seconds' where id=i.id returning * into i;
  f:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
  if f->>'ok' is distinct from 'true' or f is distinct from g then r:=jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');raise exception 'ES02_BRIDGE_DENIED' using errcode='PEB01';end if;
  return jsonb_build_object('ok',true,'claimed',true,'attempt_token',token,'intent',private.whatsapp_send_intent_public(i));
 exception when sqlstate 'PEB01' then return r;end;
end;$$;
alter function public.whatsapp_claim_assistant_job_send(uuid,uuid) owner to postgres;
revoke all on function public.whatsapp_claim_assistant_job_send(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_claim_assistant_job_send(uuid,uuid) to service_role;

create function public.es02_verify_claimed_reply_citations(p_job_id uuid,p_claim_token uuid,p_source_citations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$declare g jsonb;f jsonb;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 g:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);if g->>'ok' is distinct from 'true' then return g;end if;
 if not private.es02_whatsapp_citations_current((g->>'company_id')::uuid,(g->>'branch_id')::uuid,p_source_citations) then return jsonb_build_object('ok',false,'code','KNOWLEDGE_CHANGED');end if;
 f:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if f->>'ok' is distinct from 'true' or f is distinct from g then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return jsonb_build_object('ok',true,'company_id',g->'company_id','job_id',p_job_id);
end;$$;
alter function public.es02_verify_claimed_reply_citations(uuid,uuid,jsonb) owner to postgres;
revoke all on function public.es02_verify_claimed_reply_citations(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.es02_verify_claimed_reply_citations(uuid,uuid,jsonb) to service_role;

alter function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) set schema private;
alter function private.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) rename to es02_pre_retrieve_approved_knowledge;
revoke all on function private.es02_pre_retrieve_approved_knowledge(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.whatsapp_retrieve_approved_knowledge(p_company_id uuid,p_job_id uuid,p_claim_token uuid,p_question text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare g jsonb;f jsonb;query_text text;q tsquery;rows jsonb;citations jsonb;n integer;chars bigint;knowledge_count integer;begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 if not private.es02_job_scope(p_job_id) then return private.es02_pre_retrieve_approved_knowledge(p_company_id,p_job_id,p_claim_token,p_question);end if;
 if p_company_id is null or p_question is null or length(btrim(p_question)) not between 1 and 1000 then return jsonb_build_object('ok',false,'code','INVALID_INPUT');end if;
 g:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);if g->>'ok' is distinct from 'true' then return g;end if;
 if g->>'company_id' is distinct from p_company_id::text then return jsonb_build_object('ok',false,'code','company_binding_rejected');end if;
 if not exists(select 1 from public.whatsapp_inbound_jobs j join public.whatsapp_messages m on m.id=j.message_id and m.company_id=j.company_id
  where j.id=p_job_id and j.company_id=p_company_id and m.wa_message_id=j.wa_message_id and m.direction='inbound' and m.sender='customer'
   and m.body=p_question) then return jsonb_build_object('ok',false,'code','question_binding_rejected');end if;
 select string_agg(quote_literal(word),' | ' order by word) into query_text
 from unnest(tsvector_to_array(to_tsvector('simple'::regconfig,p_question))) tokens(word) where length(word)>1;
 if query_text is null then return jsonb_build_object('ok',false,'code','NO_KNOWLEDGE');end if;
 q:=to_tsquery('simple'::regconfig,query_text);
 with candidates as (
  select k.id::text as id,k.company_id,k.title,btrim(k.content) as content,k.content_version,k.approved_version,k.approved_for_answers,
   k.status,k.kind,k.storage_path,k.byte_size,k.updated_at,k.usage_role
  from public.knowledge_sources k where k.company_id=p_company_id and k.status='ready' and k.approved_for_answers
   and k.approved_version=k.content_version and length(btrim(k.content))>0
   and (k.usage_role='business_instructions' or to_tsvector('simple'::regconfig,k.title||' '||k.content)@@q)
  union all
  select 'page-'||p.id,p.company_id,coalesce(nullif(p.title,''),p.url),btrim(p.extracted_text),p.version,p.version,true,'ready','text',null,null,p.updated_at,'knowledge'
  from private.es02_branch_website_pages p where p.company_id=p_company_id and p.branch_id=(g->>'branch_id')::uuid
   and p.status='indexed' and length(btrim(p.extracted_text))>0 and to_tsvector('simple'::regconfig,coalesce(p.title,p.url)||' '||p.extracted_text)@@q
  union all
  select 'hours-'||h.branch_id,h.company_id,'Working Hours',
   'Branch hours ('||b.name||', timezone: '||b.timezone||'): '||h.schedule::text,h.revision::integer,h.revision::integer,true,'ready','text',null,null,h.updated_at,'business_instructions'
  from private.es02_branch_hours h join public.company_branches b on b.id=h.branch_id and b.company_id=h.company_id
  where h.company_id=p_company_id and h.branch_id=(g->>'branch_id')::uuid and h.revision between 1 and 2147483647
 ), selected as materialized (
  select * from candidates order by usage_role,id limit 41
 ) select coalesce(jsonb_agg(to_jsonb(s) order by s.usage_role,s.id),'[]'::jsonb),count(*),
  coalesce(sum(length(s.title)+length(s.content)+5),0)+greatest(count(*)-1,0)*2,count(*) filter(where s.usage_role='knowledge')
 into rows,n,chars,knowledge_count from selected s;
 if n>40 or chars>12000 then return jsonb_build_object('ok',false,'code','CONTEXT_OVERFLOW');end if;
 if knowledge_count=0 then return jsonb_build_object('ok',false,'code','NO_KNOWLEDGE');end if;
 select jsonb_agg(jsonb_build_object('sourceId',x->>'id','title',x->>'title','contentVersion',x->'content_version')) into citations from jsonb_array_elements(rows)x;
 if not private.es02_whatsapp_citations_current(p_company_id,(g->>'branch_id')::uuid,citations) then return jsonb_build_object('ok',false,'code','APPROVAL_INCOMPLETE');end if;
 f:=private.es02_claimed_reply_authority(p_job_id,p_claim_token);
 if f->>'ok' is distinct from 'true' or f is distinct from g then return jsonb_build_object('ok',false,'code','ANSWER_PROFILE_CHANGED');end if;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'job_id',p_job_id,'sources',rows,'context_chars',chars);
end;$$;
alter function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) owner to postgres;
revoke all on function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.whatsapp_retrieve_approved_knowledge(uuid,uuid,uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
