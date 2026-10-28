-- LOCAL CANDIDATE: existing schedule JSON now accepts optional date exceptions.
-- Existing RPC actor/branch ownership, row locks, CAS, receipts and revisions stay intact.
-- No row rewrite, public API, grants or provider operation. Apply only with separate approval.
-- Rollback: restore previous validator only after separately preserving/removing exceptions;
-- do not silently strip saved dates or bypass existing revisions.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create or replace function private.es02_validate_branch_hours_schedule(p_schedule jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_exception jsonb;
  v_date text;
  v_seen text[] := array[]::text[];
  v_week jsonb;
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
  if jsonb_typeof(p_schedule) = 'object' and p_schedule ? 'exceptions' then
    if jsonb_typeof(p_schedule->'exceptions') is distinct from 'array' then return false; end if;
    if jsonb_array_length(p_schedule->'exceptions') > 366 then return false; end if;
    if not private.es02_validate_branch_hours_schedule(p_schedule - 'exceptions') then return false; end if;
    select jsonb_object_agg(day, jsonb_build_object('state','unset')) into v_week from unnest(v_days) day;
    for v_exception in select * from jsonb_array_elements(p_schedule->'exceptions') loop
      if jsonb_typeof(v_exception) is distinct from 'object' then return false; end if;
      if (select count(*) from jsonb_object_keys(v_exception)) <> 2
        or not (v_exception ?& array['date','hours'])
        or jsonb_typeof(v_exception->'date') is distinct from 'string' then return false; end if;
      v_date := v_exception->>'date';
      if v_date !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' or v_date = any(v_seen) then return false; end if;
      begin
        if to_char(v_date::date, 'YYYY-MM-DD') <> v_date then return false; end if;
      exception when invalid_datetime_format or datetime_field_overflow then return false;
      end;
      v_seen := array_append(v_seen,v_date);
      if v_exception->'hours'->>'state' is null or v_exception->'hours'->>'state' not in ('closed','open') then return false; end if;
      if not private.es02_validate_branch_hours_schedule(jsonb_set(v_week,'{monday}',v_exception->'hours')) then return false; end if;
      if v_exception->'hours'->>'state' = 'open' and exists (
        select 1 from jsonb_array_elements(v_exception->'hours'->'intervals') i where i->'nextDay' = 'true'::jsonb and i->>'end' <> '00:00'
      ) then return false; end if;
    end loop;
    return true;
  end if;
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

commit;
