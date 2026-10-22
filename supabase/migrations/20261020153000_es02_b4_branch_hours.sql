-- Filename: 20261020153000_es02_b4_branch_hours.sql
-- Additive B4 authoritative branch hours persistence and CAS.
-- Preserves B1, B2, B3 production migrations.
begin;
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

commit;
