-- TEST ONLY: existing isolated PostgreSQL; all synthetic data rolls back.
begin;
create temporary table review_scope_fixture(a uuid,b uuid,c uuid,actor uuid,other_actor uuid,sid uuid);
insert into review_scope_fixture values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
grant select on review_scope_fixture to authenticated;
insert into auth.users(id,email,email_confirmed_at) select actor,'synthetic-review-owner@example.invalid',clock_timestamp() from review_scope_fixture
union all select other_actor,'synthetic-review-other@example.invalid',clock_timestamp() from review_scope_fixture;
insert into public.companies(id,display_name,status,created_by) select a,'Synthetic review A','active',actor from review_scope_fixture
union all select b,'Synthetic review B','active',actor from review_scope_fixture union all select c,'Synthetic review C','active',other_actor from review_scope_fixture;
insert into public.company_members(company_id,user_id,role,status,created_at) select a,actor,'owner','active',clock_timestamp()-interval '1 day' from review_scope_fixture
union all select b,actor,'staff','active',clock_timestamp() from review_scope_fixture union all select c,other_actor,'owner','active',clock_timestamp() from review_scope_fixture;
insert into auth.sessions(id,user_id) select sid,actor from review_scope_fixture;
insert into private.app_session_activity(session_id,user_id,last_activity_at) select sid,actor,clock_timestamp() from review_scope_fixture;
insert into public.admin_audit_logs(actor_user_id,company_id,action,after_data) select actor,a,'review.submit','{"revision":1,"owner_note":"Synthetic A","private_detail":"must stay private"}'::jsonb from review_scope_fixture
union all select actor,b,'review.approve','{"revision":2,"owner_note":"Synthetic B","private_detail":"must stay private"}'::jsonb from review_scope_fixture;
select set_config('request.jwt.claim.sub',actor::text,true),set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',sid,'role','authenticated')::text,true) from review_scope_fixture;
set local role authenticated;
do $$declare f review_scope_fixture%rowtype;r jsonb;old_r jsonb;begin
 select * into f from review_scope_fixture;r:=public.list_owner_company_review_events_for_company(f.a);
 if jsonb_array_length(r)<>1 or r->0->>'owner_note'<>'Synthetic A' then raise exception 'Owner history not scoped to requested company';end if;
end;$$;
-- Respect the existing one-active-owner-per-user policy. Simulate a committed
-- ownership transfer after a caller captured company A, not two active owners.
reset role;update public.company_members set role='staff' where company_id=(select a from review_scope_fixture);update public.company_members set role='owner' where company_id=(select b from review_scope_fixture);
set local role authenticated;
do $$declare f review_scope_fixture%rowtype;r jsonb;begin select * into f from review_scope_fixture;
 if public.list_owner_company_review_events()->0->>'owner_note'<>'Synthetic B' then raise exception 'Legacy scope precondition failed';end if;
 begin perform public.list_owner_company_review_events_for_company(f.a);raise exception 'Reader silently followed changed ownership';exception when insufficient_privilege then null;end;
 r:=public.list_owner_company_review_events_for_company(f.b);if r->0->>'owner_note'<>'Synthetic B' then raise exception 'New owner cannot read correct company';end if;
end;$$;
select 'PASS|Ownership transfer cannot silently substitute the new company for a captured scope';
do $$declare f review_scope_fixture%rowtype;begin select * into f from review_scope_fixture;
 begin perform public.list_owner_company_review_events_for_company(f.c);raise exception 'Other tenant history exposed';exception when insufficient_privilege then null;end;
end;$$;
select 'PASS|Unrelated tenant review history is denied';
do $$declare f review_scope_fixture%rowtype;r jsonb;begin select * into f from review_scope_fixture;r:=public.list_owner_company_review_events_for_company(f.b);
 if exists(select 1 from jsonb_object_keys(r->0) k where k not in ('action','revision','created_at','owner_note')) then raise exception 'Raw audit data exposed';end if;
 begin if exists(select 1 from public.admin_audit_logs) then raise exception 'Raw audit rows exposed to owner';end if;exception when insufficient_privilege then null;end;
 if has_function_privilege('anon','public.list_owner_company_review_events_for_company(uuid)','execute') or has_function_privilege('service_role','public.list_owner_company_review_events_for_company(uuid)','execute') then raise exception 'Owner-only reader exposed to other roles';end if;
end;$$;
select 'PASS|Audit projection excludes raw payloads and privilege boundary remains narrow';
do $$begin begin perform public.list_owner_company_review_events_for_company((select a from review_scope_fixture));raise exception 'Staff read owner-only history';exception when insufficient_privilege then null;end;end;$$;
select 'PASS|Staff cannot use owner-only review reader';
reset role;update public.company_members set status='disabled' where company_id=(select b from review_scope_fixture);
set local role authenticated;
do $$begin begin perform public.list_owner_company_review_events_for_company((select b from review_scope_fixture));raise exception 'Revoked membership history exposed';exception when insufficient_privilege then null;end;end;$$;
select 'PASS|Revoked membership fails closed';
reset role;update public.company_members set status='active' where company_id=(select b from review_scope_fixture);update private.app_session_activity set last_activity_at=clock_timestamp()-interval '3 hours' where session_id=(select sid from review_scope_fixture);
set local role authenticated;
do $$begin begin perform public.list_owner_company_review_events_for_company((select b from review_scope_fixture));raise exception 'Expired session read history';exception when insufficient_privilege then null;end;end;$$;
select 'PASS|Expired application session cannot read history';
reset role;update private.app_session_activity set last_activity_at=clock_timestamp() where session_id=(select sid from review_scope_fixture);update auth.users set email_confirmed_at=null,phone_confirmed_at=null where id=(select actor from review_scope_fixture);
set local role authenticated;
do $$begin begin perform public.list_owner_company_review_events_for_company((select b from review_scope_fixture));raise exception 'Unverified user read history';exception when insufficient_privilege then null;end;end;$$;
select 'PASS|Unverified identity cannot use the security-definer reader';
rollback;
