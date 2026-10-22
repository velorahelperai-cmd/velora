-- Existing isolated fixture only; install exact candidate fragments and run
-- this file inside an outer BEGIN/ROLLBACK. No Auth/ledger/balance writes.
do $guard$ begin
 if current_database()<>'c1_ui_integration' or inet_client_addr() is not null then raise exception 'LOCAL_FIXTURE_REQUIRED';end if;
end;$guard$;
create function pg_temp.es02_bounds_call(slot integer,fingerprint text) returns jsonb
language plpgsql security definer set search_path='' as $$begin
 return public.es02_reserve_whatsapp_capacity_cost_attempt(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),1,
  'gemini-3.8-flash','google',1,'synthetic-bounds','{"modelId":"gemini-3.8-flash","version":"synthetic-bounds"}',
  '[]'::jsonb,'noura',gen_random_uuid(),gen_random_uuid(),slot,fingerprint);
end;$$;
create function pg_temp.es02_bounds_must(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'ES02_BOUNDS_ASSERT_FAILED:%',label;end if;
 raise notice 'BOUNDS_PASS:%',label;
end;$$;
do $bounds$ declare r jsonb;slot integer;fp text;definition text;begin
 perform set_config('role','service_role',true);
 r:=pg_temp.es02_bounds_call(32,repeat('a',64));
 perform pg_temp.es02_bounds_must(r->>'code'='INVALID_RESERVATION','slot32_rejected_before_authority');
 r:=pg_temp.es02_bounds_call(-1,repeat('a',64));
 perform pg_temp.es02_bounds_must(r->>'code'='INVALID_RESERVATION','negative_slot_rejected');
 r:=pg_temp.es02_bounds_call(null,repeat('a',64));
 perform pg_temp.es02_bounds_must(r->>'code'='INVALID_RESERVATION','null_slot_rejected');
 r:=pg_temp.es02_bounds_call(0,repeat('a',63));
 perform pg_temp.es02_bounds_must(r->>'code'='INVALID_RESERVATION','short_fingerprint_rejected_before_authority');
 r:=pg_temp.es02_bounds_call(0,repeat('a',65));
 perform pg_temp.es02_bounds_must(r->>'code'='INVALID_RESERVATION','long_fingerprint_rejected');
 r:=pg_temp.es02_bounds_call(0,repeat('A',64));
 perform pg_temp.es02_bounds_must(r->>'code'='INVALID_RESERVATION','uppercase_fingerprint_rejected');
 r:=pg_temp.es02_bounds_call(0,repeat('g',64));
 perform pg_temp.es02_bounds_must(r->>'code'='INVALID_RESERVATION','nonhex_fingerprint_rejected');
 r:=pg_temp.es02_bounds_call(0,' '||repeat('a',64));
 perform pg_temp.es02_bounds_must(r->>'code'='INVALID_RESERVATION','fingerprint_whitespace_rejected');
 r:=pg_temp.es02_bounds_call(0,null);
 perform pg_temp.es02_bounds_must(r->>'code'='INVALID_RESERVATION','null_fingerprint_rejected');
 foreach slot in array array[0,31] loop
  r:=pg_temp.es02_bounds_call(slot,repeat('a',64));
  perform pg_temp.es02_bounds_must(r->>'code'='CLAIM_REJECTED','valid_boundary_'||slot||'_reaches_real_claim_denial');
 end loop;
 perform set_config('role','none',true);
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.ai_usage_ledger'::regclass and conname='ai_es02_worker_profile_complete';
 perform pg_temp.es02_bounds_must(definition like '%es02_slot_index >= 0%' and definition like '%es02_slot_index <= 31%','constraint_enforces_slot_range');
 perform pg_temp.es02_bounds_must(definition like '%^[0-9a-f]{64}$%','constraint_enforces_fingerprint_shape');
end;$bounds$;
