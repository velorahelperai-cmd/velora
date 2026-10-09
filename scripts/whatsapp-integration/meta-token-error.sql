-- TEST ONLY: simulated confirmed Meta OAuth failure, actual SQL/Vault/ledger state.
begin;
create function test_fixture.fail_vault_delete() returns trigger language plpgsql as $$begin raise exception 'synthetic_vault_delete_failure';end;$$;
create trigger synthetic_vault_delete_failure before delete on vault.secrets for each row execute function test_fixture.fail_vault_delete();
set local role service_role;
do $$ declare f jsonb:=test_fixture.company();j uuid:=test_fixture.job(f);r jsonb;claim uuid;a uuid;i uuid;token uuid;g bigint;sid uuid;phone text;begin
 r:=claim_whatsapp_inbound_job(j,120);claim:=(r->>'claim_token')::uuid;
 perform whatsapp_reserve_job_usage(j,claim);a:=test_fixture.draft(f,j,claim);
 r:=whatsapp_stage_job_reply(j,claim,a,(select source_citations from ai_usage_ledger where id=a));i:=(r->>'intent_id')::uuid;
 r:=whatsapp_claim_assistant_job_send(j,claim);token:=(r->>'attempt_token')::uuid;
 if token is null then raise exception 'simulated send claim rejected: %',r;end if;
 select generation,access_secret_id,provider_phone_number_id into g,sid,phone from whatsapp_company_links where id=(f->>'link')::uuid;
 if whatsapp_revoke_failed_credential((f->>'company')::uuid,(f->>'link')::uuid,phone,g,100)
 or whatsapp_revoke_failed_credential(gen_random_uuid(),(f->>'link')::uuid,phone,g,190)
 or whatsapp_revoke_failed_credential((f->>'company')::uuid,(f->>'link')::uuid,phone,g-1,190)
 then raise exception 'unrelated error/tenant/generation revoked credential';end if;
 begin
  perform finalize_whatsapp_send_attempt(i,token,'rejected',null,'graph_190',null);
  raise exception 'expected synthetic cleanup failure';
 exception when others then
  if sqlerrm is distinct from 'synthetic_vault_delete_failure' then raise;end if;
 end;
 if not exists(select 1 from whatsapp_send_intents where id=i and outcome='attempting')
 or not exists(select 1 from whatsapp_company_links where id=(f->>'link')::uuid and status='verified' and generation=g and access_secret_id=sid)
 then raise exception 'failed cleanup committed half a rejection';end if;
 perform set_config('role','none',true);
 execute 'drop trigger synthetic_vault_delete_failure on vault.secrets';
 perform set_config('role','service_role',true);
 r:=finalize_whatsapp_send_attempt(i,token,'rejected',null,'graph_190',null);
 if r->>'ok' is distinct from 'true' then raise exception 'known rejection could not finalize with credential invalidation: %',r;end if;
 if exists(select 1 from whatsapp_company_links where id=(f->>'link')::uuid and (status='verified' or generation<>g+1 or access_secret_id is not null))
 or exists(select 1 from vault.secrets where id=sid) then raise exception 'invalid token remains usable';end if;
 r:=billing_finalize_automated_usage((f->>'company')::uuid,i);
 if r->>'status' is distinct from 'released' or not exists(select 1 from ai_usage_ledger where id=a and status='success' and cost_baisa>0)
 then raise exception 'token invalidation lost known cost or quota settlement';end if;
end;$$;
select 'PASS|Confirmed Meta 190 revokes only exact current credential and preserves incurred AI cost/rejected send settlement';
select 'PASS|Vault cleanup failure rolls back rejection and credential together; original receipt retry completes atomically';
do $$ declare f jsonb:=test_fixture.company();j uuid:=test_fixture.job(f);r jsonb;claim uuid;a uuid;i uuid;token uuid;g bigint;begin
 r:=claim_whatsapp_inbound_job(j,120);claim:=(r->>'claim_token')::uuid;perform whatsapp_reserve_job_usage(j,claim);
 a:=test_fixture.draft(f,j,claim);r:=whatsapp_stage_job_reply(j,claim,a,(select source_citations from ai_usage_ledger where id=a));i:=(r->>'intent_id')::uuid;
 r:=whatsapp_claim_assistant_job_send(j,claim);token:=(r->>'attempt_token')::uuid;
 select generation into g from whatsapp_company_links where id=(f->>'link')::uuid;
 r:=finalize_whatsapp_send_attempt(i,token,'rejected',null,'graph_100',null);
 if r->>'ok' is distinct from 'true' then raise exception 'original non-token rejection failed';end if;
 r:=finalize_whatsapp_send_attempt(i,gen_random_uuid(),'rejected',null,'graph_190',null);
 if not exists(select 1 from whatsapp_company_links where id=(f->>'link')::uuid and status='verified' and generation=g and access_secret_id is not null)
 or not exists(select 1 from whatsapp_send_intents where id=i and outcome='rejected' and provider_error_code='graph_100')
 then raise exception 'caller replay fabricated token failure from unrelated settled rejection';end if;
end;$$;
select 'PASS|Already-final replay cannot replace stored rejection cause or revoke a valid credential';
reset role;
do $$begin
 if has_function_privilege('authenticated','public.whatsapp_revoke_failed_credential(uuid,uuid,text,bigint,integer)','execute')
 or has_function_privilege('anon','public.whatsapp_revoke_failed_credential(uuid,uuid,text,bigint,integer)','execute') then raise exception 'credential invalidation RPC exposed';end if;
end;$$;
select 'PASS|Credential invalidation is server-only';rollback;
