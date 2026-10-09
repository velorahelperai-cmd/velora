-- TEST ONLY. Actual local Vault, synthetic owners/sessions/assets/tokens; rollback all fixtures.
begin;
grant usage on schema test_fixture to authenticated;
create function test_fixture.signup_owner() returns jsonb language plpgsql as $$
declare f jsonb:=test_fixture.company(false);sid uuid:=gen_random_uuid();begin
 update auth.users set email_confirmed_at=clock_timestamp() where id=(f->>'user')::uuid;
 insert into auth.sessions(id,user_id) values(sid,(f->>'user')::uuid);
 insert into private.app_session_activity(session_id,user_id,last_activity_at) values(sid,(f->>'user')::uuid,clock_timestamp());
 return f||jsonb_build_object('session',sid,'waba','2'||lpad((floor(random()*1000000000000000)::bigint)::text,15,'0'),'phone','3'||lpad((floor(random()*1000000000000000)::bigint)::text,15,'0'));
end;$$;
create function test_fixture.signup_claims(f jsonb) returns void language plpgsql as $$ begin
 perform set_config('request.jwt.claim.sub',f->>'user',true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',f->>'user','session_id',f->>'session','role','authenticated')::text,true);
end;$$;
create function test_fixture.signup_start(f jsonb) returns jsonb language plpgsql as $$
declare attempt uuid:=gen_random_uuid();nonce text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text);r jsonb;begin
 r:=public.whatsapp_start_embedded_signup((f->>'company')::uuid,attempt,nonce,false,'111','444','v25.0');
 if r->>'ok' is distinct from 'true' then raise exception 'durable start rejected: %',r;end if;
 return f||jsonb_build_object('attempt',attempt,'nonce',nonce);
end;$$;
create function test_fixture.signup_proof(f jsonb) returns jsonb language sql as $$
 select jsonb_build_object('app_id','111','waba_id',f->>'waba','phone_number_id',f->>'phone','display_phone_number','+96899001122',
 'scopes',jsonb_build_array('whatsapp_business_management','whatsapp_business_messaging'),
 'granular_scopes',jsonb_build_array(jsonb_build_object('scope','whatsapp_business_management','target_ids',jsonb_build_array(f->>'waba')),jsonb_build_object('scope','whatsapp_business_messaging','target_ids',jsonb_build_array(f->>'waba'))),
 'expires_at',0,'data_access_expires_at',0,'authorization_expires_at',null,'code_verification_status','VERIFIED','platform_type','CLOUD_API','registered',true,'subscribed',true,'is_on_biz_app',false,'verified_at',clock_timestamp());
$$;
grant execute on function test_fixture.signup_claims(jsonb),test_fixture.signup_start(jsonb),test_fixture.signup_proof(jsonb) to authenticated,service_role;

do $$declare f jsonb:=test_fixture.signup_owner();r jsonb;old_secret uuid;new_secret uuid;old_gen bigint;new_gen bigint;raw jsonb;begin
 perform test_fixture.signup_claims(f);perform set_config('role','authenticated',true);
 f:=test_fixture.signup_start(f);
 r:=public.whatsapp_claim_embedded_signup((f->>'company')::uuid,(f->>'attempt')::uuid,f->>'nonce');
 if r->>'ok' is distinct from 'true' or r->>'session_id' is distinct from f->>'session' then raise exception 'session-bound claim rejected: %',r;end if;
 r:=public.whatsapp_claim_embedded_signup((f->>'company')::uuid,(f->>'attempt')::uuid,f->>'nonce');
 if r->>'code' is distinct from 'CONSUMED' then raise exception 'code claim replay accepted';end if;
 perform set_config('role','none',true);
 select access_secret_id,generation into old_secret,old_gen from whatsapp_company_links where id=(f->>'link')::uuid;
 perform set_config('role','service_role',true);
 r:=public.whatsapp_finalize_embedded_signup((f->>'attempt')::uuid,(f->>'user')::uuid,(f->>'session')::uuid,'synthetic-new-business-token',test_fixture.signup_proof(f));
 if r->>'ok' is distinct from 'true' then raise exception 'verified finalize rejected: %',r;end if;
 select access_secret_id,generation into new_secret,new_gen from whatsapp_company_links where id=(f->>'link')::uuid;
 if new_secret is null or new_secret=old_secret or new_gen<>old_gen+1 then raise exception 'rotation did not invalidate old generation';end if;
 r:=public.whatsapp_read_link_access_secret((f->>'company')::uuid,(f->>'link')::uuid,f->>'phone',new_gen);
 if r->>'access_token' is distinct from 'synthetic-new-business-token' then raise exception 'exact bound runtime secret rejected';end if;
 r:=public.whatsapp_read_link_access_secret((f->>'company')::uuid,(f->>'link')::uuid,f->>'phone',old_gen);
 if r->>'ok'='true' then raise exception 'old-generation secret read accepted';end if;
 r:=public.whatsapp_read_link_access_secret(gen_random_uuid(),(f->>'link')::uuid,f->>'phone',new_gen);
 if r->>'ok'='true' then raise exception 'cross-tenant secret read accepted';end if;
 r:=public.whatsapp_finalize_embedded_signup((f->>'attempt')::uuid,(f->>'user')::uuid,(f->>'session')::uuid,'synthetic-replay',test_fixture.signup_proof(f));
 if r->>'code' is distinct from 'CONSUMED' then raise exception 'finalize replay accepted';end if;
 perform set_config('role','none',true);
 if exists(select 1 from vault.secrets where id=old_secret) then raise exception 'old Vault secret retained';end if;
 if exists(select 1 from vault.secrets where id=new_secret and secret='synthetic-new-business-token') then raise exception 'Vault secret was plaintext';end if;
 select to_jsonb(l) into raw from whatsapp_company_links l where id=(f->>'link')::uuid;
 if raw::text like '%synthetic-new-business-token%' then raise exception 'public link stored plaintext token';end if;
 -- Resolve private Vault relation names as the test administrator while checking
 -- the authenticated role's ACL. That actor is intentionally denied Vault usage.
 if has_table_privilege('authenticated','vault.decrypted_secrets','SELECT') or has_function_privilege('authenticated','public.whatsapp_finalize_embedded_signup(uuid,uuid,uuid,text,jsonb)','EXECUTE') then raise exception 'client secret/finalization ACL exposed';end if;
 perform set_config('role','authenticated',true);
 r:=public.whatsapp_disconnect_embedded_signup((f->>'company')::uuid);
 if r->>'ok' is distinct from 'true' then raise exception 'owner disconnect failed';end if;
 perform set_config('role','none',true);
 if exists(select 1 from vault.secrets where id=new_secret) then raise exception 'disconnect retained Vault token';end if;
 select private.whatsapp_company_link_public(l,false) into raw from whatsapp_company_links l where id=(f->>'link')::uuid;
 if raw->>'status' is distinct from 'disconnected' or raw::text like '%synthetic-new-business-token%' then raise exception 'disconnect snapshot leaked/still verified';end if;
end;$$;
select 'PASS|Meta durable claim/finalize replay, Vault encryption/rotation/ACL, generation binding and owner disconnect';

do $$declare f jsonb:=test_fixture.signup_owner();g jsonb:=test_fixture.signup_owner();r jsonb;sid uuid;begin
 perform test_fixture.signup_claims(f);perform set_config('role','authenticated',true);f:=test_fixture.signup_start(f);
 r:=public.whatsapp_claim_embedded_signup((g->>'company')::uuid,(f->>'attempt')::uuid,f->>'nonce');
 if r->>'ok'='true' then raise exception 'foreign company attempt claimed';end if;
 perform set_config('role','none',true);sid:=gen_random_uuid();insert into auth.sessions(id,user_id) values(sid,(f->>'user')::uuid);insert into private.app_session_activity(session_id,user_id,last_activity_at) values(sid,(f->>'user')::uuid,clock_timestamp());
 perform test_fixture.signup_claims(f||jsonb_build_object('session',sid));perform set_config('role','authenticated',true);
 r:=public.whatsapp_claim_embedded_signup((f->>'company')::uuid,(f->>'attempt')::uuid,f->>'nonce');
 if r->>'ok'='true' then raise exception 'other actual Auth session claimed attempt';end if;
 perform test_fixture.signup_claims(f);r:=public.whatsapp_cancel_embedded_signup((f->>'company')::uuid,(f->>'attempt')::uuid,f->>'nonce');
 r:=public.whatsapp_claim_embedded_signup((f->>'company')::uuid,(f->>'attempt')::uuid,f->>'nonce');if r->>'code' is distinct from 'CONSUMED' then raise exception 'cancelled attempt resumed';end if;
 f:=test_fixture.signup_start(f);perform set_config('role','none',true);update whatsapp_embedded_signup_attempts set expires_at=now()-interval '1 second' where id=(f->>'attempt')::uuid;
 perform set_config('role','authenticated',true);r:=public.whatsapp_claim_embedded_signup((f->>'company')::uuid,(f->>'attempt')::uuid,f->>'nonce');if r->>'code' is distinct from 'EXPIRED' then raise exception 'expired attempt claimed';end if;
 perform set_config('role','none',true);update private.app_session_activity set last_activity_at=now()-interval '3 hours' where session_id=(f->>'session')::uuid;
 perform set_config('role','authenticated',true);r:=public.whatsapp_disconnect_embedded_signup((f->>'company')::uuid);if r->>'ok'='true' then raise exception 'idle expired session disconnected';end if;
 perform set_config('role','none',true);
end;$$;
select 'PASS|Meta cross-company/session isolation, cancellation, TTL and idle-expired owner rejection';

do $$declare f jsonb:=test_fixture.signup_owner();r jsonb;proof jsonb;revoked_secret_id uuid;gen bigint;begin
 perform test_fixture.signup_claims(f);perform set_config('role','authenticated',true);f:=test_fixture.signup_start(f);
 r:=public.whatsapp_claim_embedded_signup((f->>'company')::uuid,(f->>'attempt')::uuid,f->>'nonce');perform set_config('role','service_role',true);
 proof:=test_fixture.signup_proof(f);
 r:=public.whatsapp_finalize_embedded_signup((f->>'attempt')::uuid,(f->>'user')::uuid,(f->>'session')::uuid,'synthetic-token',proof||'{"app_id":"999"}');if r->>'ok'='true' then raise exception 'wrong app proof finalized';end if;
 r:=public.whatsapp_finalize_embedded_signup((f->>'attempt')::uuid,(f->>'user')::uuid,(f->>'session')::uuid,'synthetic-token',proof-'phone_number_id');if r->>'ok'='true' then raise exception 'missing phone proof finalized';end if;
 r:=public.whatsapp_finalize_embedded_signup((f->>'attempt')::uuid,(f->>'user')::uuid,(f->>'session')::uuid,'synthetic-token',proof||'{"expires_at":1,"authorization_expires_at":"1970-01-01T00:00:01Z"}');if r->>'ok'='true' then raise exception 'expired token finalized';end if;
 r:=public.whatsapp_finalize_embedded_signup((f->>'attempt')::uuid,(f->>'user')::uuid,(f->>'session')::uuid,'synthetic-token',proof);if r->>'ok' is distinct from 'true' then raise exception 'good proof rejected: %',r;end if;
 select access_secret_id,generation into revoked_secret_id,gen from whatsapp_company_links where id=(f->>'link')::uuid;
 r:=public.whatsapp_revoke_meta_waba_authorization(f->>'waba','PARTNER_REMOVED',now()-interval '1 hour');if r->>'revoked' is distinct from '0' then raise exception 'late old revocation removed renewed grant';end if;
 r:=public.whatsapp_revoke_meta_waba_authorization(f->>'waba','PARTNER_REMOVED',clock_timestamp());if r->>'revoked' is distinct from '1' then raise exception 'matching current WABA revocation failed';end if;
 r:=public.whatsapp_read_link_access_secret((f->>'company')::uuid,(f->>'link')::uuid,f->>'phone',gen);if r->>'ok'='true' then raise exception 'revoked authorization read secret';end if;
 perform set_config('role','none',true);if exists(select 1 from vault.secrets where id=revoked_secret_id) then raise exception 'revocation retained Vault token';end if;
end;$$;
select 'PASS|Meta server proof app/asset/expiry guards and exact WABA revocation with stale-event protection';
rollback;
