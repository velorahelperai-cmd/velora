-- TEST ONLY. Synthetic tenants, provider IDs, prices and collections; never cloud seeds.
create schema if not exists test_fixture;
-- Privileged fixture provisioning only: these helpers are never production SQL.
-- Actual accounting calls below still run with SET ROLE service_role.
create or replace function test_fixture.ai_budget(p_company uuid,p_limit numeric,p_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;begin
 insert into public.ai_budget_accounts(id,scope,company_id,limit_baisa,enabled)
 values(p_id,'company_live',p_company,p_limit,true) on conflict do nothing;
 select id into result from public.ai_budget_accounts where company_id=p_company and period_start=date_trunc('month',clock_timestamp())::date;
 return result;end;$$;
create or replace function test_fixture.ai_budget_change(p_id uuid,p_company uuid,p_enabled boolean,p_held numeric default null)
returns void language sql security definer set search_path='' as $$
 update public.ai_budget_accounts set enabled=p_enabled,held_baisa=coalesce(p_held,held_baisa)
 where (p_id is not null and id=p_id) or (p_company is not null and company_id=p_company);
$$;
revoke all on function test_fixture.ai_budget(uuid,numeric,uuid),test_fixture.ai_budget_change(uuid,uuid,boolean,numeric) from public,anon,authenticated;
grant execute on function test_fixture.ai_budget(uuid,numeric,uuid),test_fixture.ai_budget_change(uuid,uuid,boolean,numeric) to service_role;
create or replace function test_fixture.ai_admin(p_active boolean default true) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;cid uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();begin
 select user_id into actor from public.platform_admins where role='owner' and status='active' order by user_id limit 1;
 if actor is null then raise exception 'Synthetic bootstrap owner missing';end if;
 insert into public.companies(id,display_name,status,created_by) values(cid,'Synthetic C1 administrative tenant','active',actor);
 insert into auth.sessions(id,user_id) values(sid,actor);
 if p_active then insert into private.app_session_activity(session_id,user_id,last_activity_at) values(sid,actor,clock_timestamp());end if;
 return jsonb_build_object('company',cid,'actor',actor,'session',sid);end;$$;
revoke all on function test_fixture.ai_admin(boolean) from public,anon,authenticated;
grant execute on function test_fixture.ai_admin(boolean) to service_role;
-- F5 test helper: mark a fixture link's number confirmation as decided (no-op before the F5 migration).
create or replace function test_fixture.f5_confirm_number(p_link uuid,p_user uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 if to_regclass('private.whatsapp_link_number_confirmations') is not null then
  execute 'update private.whatsapp_link_number_confirmations set status=''confirmed'',decided_at=clock_timestamp(),decided_by=$2 where link_id=$1 and status=''pending''' using p_link,p_user;
 end if;end;$$;
revoke all on function test_fixture.f5_confirm_number(uuid,uuid) from public,anon,authenticated;
grant execute on function test_fixture.f5_confirm_number(uuid,uuid) to service_role;
create or replace function test_fixture.company(p_paid boolean default true,p_cap integer default 2)
returns jsonb language plpgsql as $$
declare u uuid:=gen_random_uuid();c uuid:=gen_random_uuid();v uuid:=gen_random_uuid();p uuid:=gen_random_uuid();
 l uuid:=gen_random_uuid();conv uuid:=gen_random_uuid();o uuid:=gen_random_uuid();a uuid:=gen_random_uuid();e uuid:=gen_random_uuid();
 k uuid:=gen_random_uuid();n text:=gen_random_uuid()::text;raw jsonb;r jsonb;sub uuid;pv integer;secret uuid;sid uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,'wa-fixture-'||n||'@example.invalid');
 insert into companies(id,display_name,status,created_by) values(c,'Synthetic worker tenant','active',u);
 insert into company_members(company_id,user_id,role,status) values(c,u,'owner','active');
 insert into whatsapp_company_links(id,company_id,status,provider_phone_number_id) values(l,c,'verified','synthetic-phone-'||n);
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='whatsapp_company_links' and column_name='provider_waba_id') then
  update auth.users set email_confirmed_at=clock_timestamp() where id=u;
  insert into auth.sessions(id,user_id) values(sid,u);
  secret:=vault.create_secret('synthetic-fixture-token-'||n);
  execute 'update public.whatsapp_company_links set provider_waba_id=$1,access_secret_id=$2,authorization_status=''active'',authorization_verified_at=clock_timestamp(),authorization_expires_at=clock_timestamp()+interval ''60 days'',authorization_app_id=''synthetic-app'',authorization_scopes=''["whatsapp_business_management","whatsapp_business_messaging"]''::jsonb,authorization_user_id=$4,authorization_session_id=$5 where id=$3'
  using 'synthetic-waba-'||n,secret,l,u,sid;
 end if;
 -- F5: synthetic owner already confirmed this fixture number (gate is tested separately).
 perform test_fixture.f5_confirm_number(l,u);
 insert into whatsapp_conversations(id,company_id,phone_number_id,customer_wa_id,automation_allowed)
 values(conv,c,'synthetic-phone-'||n,'synthetic-recipient-'||n,true);
 insert into knowledge_sources(id,company_id,kind,title,content,status,created_by,content_version,approved_version,approved_for_answers,approved_at,approved_by)
 values(k,c,'text','Synthetic knowledge','Synthetic verified answer','ready',u,1,1,true,clock_timestamp(),u);
 perform set_config('velora.knowledge_approval','1',true);
 update knowledge_sources set approved_for_answers=true,approved_version=content_version,approved_at=clock_timestamp(),approved_by=u where id=k;
 insert into billing_plans(id,code,name,status) values(p,'noor_basic','Synthetic worker plan','active')
 on conflict(code) do update set code=excluded.code returning id into p;
 select coalesce(max(version),0)+1 into pv from billing_plan_versions where plan_id=p;
 update billing_plan_versions set status='retired' where plan_id=p and status='published';
 insert into billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status,limits)
 values(v,p,pv,5000,'OMR',30,'day',30,'published',jsonb_build_object('automated_outbound_per_month',p_cap));
 if p_paid then
 insert into billing_orders(id,company_id,plan_version_id,amount_baisa,currency,period_days,period_unit,period_count,
 provider_account_ref,provider_environment,provider_amount,provider_amount_unit,special_reference,client_op_id,input_fingerprint,
 status,product_code,purchase_purpose,created_by,deadline_policy_approved)
 values(o,c,v,5000,'OMR',30,'day',30,'74002','live',5000,'paymob_amount','fixture-ref-'||n,'fixture-op-'||n,'fixture-fp-'||n,
 'locked','velora_ai_staff','initial',u,true);
 insert into billing_payment_attempts(id,order_id,company_id,status,provider_order_id) values(a,o,c,'provider_submitted','fixture-order-'||n);
 raw:=jsonb_build_object('provider_transaction_id','fixture-tx-'||n,'provider_order_id','fixture-order-'||n,'event_status','success',
 'hmac_verified',true,'amount_cents',5000,'currency','OMR','integration_id',74002,'signed_owner','84001'::text,
 'pending',false,'success',true,'error_occured',false,'is_auth',false,'is_capture',false,'is_voided',false,'is_refunded',false,
 'has_parent_transaction',false,'is_standalone_payment',true);
 insert into billing_provider_events(id,payment_attempt_id,company_id,provider_account_ref,provider_environment,provider_transaction_id,
 event_status,observation_key,amount_baisa_expected,currency_expected,raw_summary)
 values(e,a,c,'74002','live','fixture-tx-'||n,'success','fixture-observation',5000,'OMR',raw);
 r:=public.billing_settle_paymob_hmac_verified(jsonb_build_object('evidence_marker','VEL_PAYMOB_SERVER_HMAC_VERIFIED',
 'authenticity',jsonb_build_object('source','server_adapter_attestation','verified',true,'method','paymob_hmac_sha512'),
 'company_id',c,'order_id',o,'payment_attempt_id',a,'provider','paymob','provider_account_ref','74002','provider_environment','live',
 'provider_transaction_id','fixture-tx-'||n,'special_reference','fixture-ref-'||n,'amount_baisa',5000,'currency_expected','OMR',
 'event_status','success','observation_key','fixture-observation','provider_event_id',e));
 if r->>'outcome'<>'granted' then raise exception 'Synthetic receipt did not settle: %',r;end if;
 select id into sub from billing_subscriptions where company_id=c and environment='live';
 end if;
 return jsonb_build_object('company',c,'user',u,'conversation',conv,'link',l,'knowledge',k,'plan_version',v,'subscription',sub);
end;$$;
create or replace function test_fixture.job(f jsonb) returns uuid language plpgsql as $$
declare j uuid:=gen_random_uuid();m uuid:=gen_random_uuid();w text:='synthetic-wamid-'||gen_random_uuid();c public.whatsapp_conversations%rowtype;r jsonb;waba text;begin
 if to_regprocedure('public.whatsapp_store_meta_inbound(uuid,text,text,text,text,text,text,text,timestamp with time zone)') is not null then
  select * into c from whatsapp_conversations where id=(f->>'conversation')::uuid;
  execute 'select provider_waba_id from whatsapp_company_links where id=$1' into waba using (f->>'link')::uuid;
  execute 'select public.whatsapp_store_meta_inbound($1,$2,$3,$4,$5,$6,$7,$8,$9)' into r
   using (f->>'company')::uuid,waba,c.phone_number_id,c.customer_wa_id,'Synthetic customer',w,'Synthetic question','text',clock_timestamp();
  if r->>'ok'<>'true' then raise exception 'Synthetic signed ingress rejected: %',r;end if;
  return (r->>'job_id')::uuid;
 end if;
 insert into whatsapp_messages(id,company_id,conversation_id,wa_message_id,body,direction,sender,received_at)
 values(m,(f->>'company')::uuid,(f->>'conversation')::uuid,w,'Synthetic question','inbound','customer',clock_timestamp());
 insert into whatsapp_inbound_jobs(id,company_id,message_id,wa_message_id,created_at) values(j,(f->>'company')::uuid,m,w,clock_timestamp());return j;
end;$$;
grant usage on schema test_fixture to service_role;grant execute on all functions in schema test_fixture to service_role;
create or replace function test_fixture.draft(f jsonb,j uuid,token uuid) returns uuid language plpgsql as $$
declare a uuid:=gen_random_uuid();r jsonb;citations jsonb:=jsonb_build_array(jsonb_build_object('sourceId',f->>'knowledge','title','Synthetic knowledge','contentVersion',1));begin
 perform test_fixture.ai_budget((f->>'company')::uuid,10);
 r:=ai_reserve_whatsapp_attempt(a,j,token,1,'gpt-6-luna','openai',1,'synthetic-v1','{"modelId":"gpt-6-luna","version":"synthetic-v1"}',citations);
 if r->>'ok'<>'true' or not ai_start_whatsapp_attempt(a,token) then raise exception 'Synthetic AI reservation/start rejected: %',r;end if;
 if not ai_settle_whatsapp_attempt(a,token,'success',0.0026008,1,
 '{"promptTokens":20,"completionTokens":10,"cachedTokens":5,"cacheWriteTokens":3,"reasoningTokens":4,"totalTokens":30}',
 'synthetic-request','synthetic-response','gpt-6-luna','Synthetic persisted answer',null,12) then raise exception 'Synthetic usage settlement rejected';end if;
 return a;end;$$;
grant execute on function test_fixture.draft(jsonb,uuid,uuid) to service_role;
