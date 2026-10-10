-- PRE-INSTALL ONLY. Read-only catalog metadata; no customer rows or credentials.
-- Expected to differ after installation. Never use this to authorize reapplication.
begin read only;
with expected(signature,body_hash,is_definer) as (values
 ('public.billing_create_or_reuse_subscription_order(uuid,text,text,uuid,uuid,text,text,text,bigint,text,integer,text,integer,text,text,uuid)','b2dd6ee0bf464f924e4ec51b25f8fe14',true),
 ('public.billing_create_test_checkout_order(jsonb,integer)','0bb5e53842c1b8667300d0cd5a01b91b',true),
 ('public.billing_settle_paymob_hmac_verified(jsonb)','a1ce90ae693324f11db6d3026969bf47',true),
 ('private.billing_acceptance_hmac_event(jsonb)','8c51025169a2210a9ae4fafe945c81af',true),
 ('private.billing_settle_payment_core(jsonb)','523f74f51727f24d5a27e84166d13273',true),
 ('private.billing_settle_payment_core_pre_acceptance(jsonb)','ae4dd1a4195db97e91fa0e662ccdfff7',true),
 ('public.billing_snapshot_service_order(uuid)','7cb64387308163d827cb271b481737c1',true),
 ('public.billing_apply_service_grant(uuid)','a24ab750931095099b473aeb73513fba',true),
 ('private.billing_service_receipt_eligible(uuid)','b7d82e7e8fefc05c22f876f1ac00b7c2',false),
 ('private.billing_service_immutable()','17b4d16be72ea6e2e3e44401c7680fd2',false),
 ('private.billing_ui_owner()','73e9d20bcaa68da3488d536ba8720bed',true),
 ('private.billing_financial_receipt_immutability()','968854ccf1b251404062386ea9f2fe2f',false)
 )
select e.signature,e.body_hash as expected_body_md5,
 md5(replace(p.prosrc,chr(13),'')) as installed_body_md5,
 e.is_definer as expected_definer,p.prosecdef as installed_definer,p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
 has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature);
select v.name,v.expected_hash,md5(replace(pg_get_viewdef(to_regclass(v.name),true),chr(13),'')) as installed_hash
from (values('private.billing_verified_collection_history','cdda398ed1d2f6bf1b0a4db89fcced9f'),
('private.billing_proven_entitlement_grants','6c6d6a29a1dfae3e667948901044a7b1')) v(name,expected_hash);
select c.oid::regclass as service_table,c.relrowsecurity,
 has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') as anon_access,
 has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as authenticated_access,
 has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE') as service_access
from pg_class c where c.oid in (to_regclass('private.billing_service_offers'),to_regclass('private.billing_service_order_offers'),to_regclass('private.billing_service_grants'));
select tgrelid::regclass as target,tgname,tgenabled
from pg_trigger where not tgisinternal and tgfoid in
(to_regprocedure('private.billing_financial_receipt_immutability()'),to_regprocedure('private.billing_service_immutable()')) order by target,tgname;
commit;
