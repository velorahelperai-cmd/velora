-- Existing isolated local fixture only. Run after candidate B4 in one transaction,
-- then ROLLBACK. This verifies actual PostgreSQL behavior, not source predicates.
do $local_guard$
begin
  if current_database() <> 'c1_ui_integration' or inet_client_addr() is not null then
    raise exception 'LOCAL_FIXTURE_REQUIRED';
  end if;
end;
$local_guard$;

create function pg_temp.assert_hours(label text, schedule jsonb, expected boolean)
returns void language plpgsql as $$
begin
  if private.es02_validate_branch_hours_schedule(schedule) is distinct from expected then
    raise exception 'SCHEDULE_CONTRACT_FAILED:%', label;
  end if;
  raise notice 'HOURS_PASS:%', label;
end;
$$;

do $cases$
declare
  week jsonb;
  first_day jsonb;
  second_day jsonb;
begin
  select jsonb_object_agg(day, jsonb_build_object('state','closed')) into week
  from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) day;
  perform pg_temp.assert_hours('closed_week', week, true);
  perform pg_temp.assert_hours('unset_day', jsonb_set(week,'{monday}','{"state":"unset"}'), true);
  perform pg_temp.assert_hours('sql_null', null, false);
  perform pg_temp.assert_hours('json_null', 'null', false);
  perform pg_temp.assert_hours('missing_day', week-'monday', false);
  perform pg_temp.assert_hours('extra_day', week||'{"holiday":{"state":"closed"}}', false);
  perform pg_temp.assert_hours('null_state', jsonb_set(week,'{monday}','{"state":null}'), false);
  perform pg_temp.assert_hours('unknown_state', jsonb_set(week,'{monday}','{"state":"other"}'), false);
  perform pg_temp.assert_hours('closed_with_extra_fields', jsonb_set(week,'{monday}','{"state":"closed","intervals":[]}'), false);
  perform pg_temp.assert_hours('empty_open_intervals', jsonb_set(week,'{monday}','{"state":"open","intervals":[]}'), false);
  perform pg_temp.assert_hours('null_start', jsonb_set(week,'{monday}','{"state":"open","intervals":[{"start":null,"end":"18:00","nextDay":false}]}'), false);
  perform pg_temp.assert_hours('null_end', jsonb_set(week,'{monday}','{"state":"open","intervals":[{"start":"09:00","end":null,"nextDay":false}]}'), false);
  perform pg_temp.assert_hours('null_next_day', jsonb_set(week,'{monday}','{"state":"open","intervals":[{"start":"09:00","end":"18:00","nextDay":null}]}'), false);
  perform pg_temp.assert_hours('invalid_clock', jsonb_set(week,'{monday}','{"state":"open","intervals":[{"start":"25:00","end":"18:00","nextDay":false}]}'), false);
  perform pg_temp.assert_hours('same_day', jsonb_set(week,'{monday}','{"state":"open","intervals":[{"start":"09:00","end":"18:00","nextDay":false}]}'), true);
  perform pg_temp.assert_hours('unflagged_overnight', jsonb_set(week,'{monday}','{"state":"open","intervals":[{"start":"22:00","end":"02:00","nextDay":false}]}'), false);
  first_day := '{"state":"open","intervals":[{"start":"22:00","end":"02:00","nextDay":true}]}';
  second_day := '{"state":"open","intervals":[{"start":"01:00","end":"03:00","nextDay":false}]}';
  perform pg_temp.assert_hours('explicit_overnight', jsonb_set(week,'{monday}',first_day), true);
  perform pg_temp.assert_hours('cross_day_overlap', jsonb_set(jsonb_set(week,'{monday}',first_day),'{tuesday}',second_day), false);
  perform pg_temp.assert_hours('sunday_monday_overlap', jsonb_set(jsonb_set(week,'{sunday}',first_day),'{monday}',second_day), false);
  perform pg_temp.assert_hours('same_day_overlap', jsonb_set(week,'{monday}','{"state":"open","intervals":[{"start":"09:00","end":"12:00","nextDay":false},{"start":"11:00","end":"14:00","nextDay":false}]}'), false);
  perform pg_temp.assert_hours('touching_endpoints', jsonb_set(week,'{monday}','{"state":"open","intervals":[{"start":"09:00","end":"12:00","nextDay":false},{"start":"12:00","end":"14:00","nextDay":false}]}'), true);
  perform pg_temp.assert_hours('cross_day_touching_endpoints', jsonb_set(jsonb_set(week,'{monday}',first_day),'{tuesday}','{"state":"open","intervals":[{"start":"02:00","end":"04:00","nextDay":false}]}'), true);
  perform pg_temp.assert_hours('duplicate_interval', jsonb_set(week,'{monday}','{"state":"open","intervals":[{"start":"09:00","end":"12:00","nextDay":false},{"start":"09:00","end":"12:00","nextDay":false}]}'), false);
end;
$cases$;
