import {randomUUID} from 'node:crypto';
import {lit} from '../g03-review-acceptance/postgres.mjs';
import {json,service} from './fixtures.mjs';
export async function actor(db){
 const f={company:randomUUID(),user:randomUUID(),plan:randomUUID(),version:randomUUID(),account:'74001'};
 await db.sql('BEGIN;SET LOCAL ROLE postgres;'+
 'INSERT INTO auth.users(id,email,email_confirmed_at) VALUES('+lit(f.user)+',\'synthetic@stage2a.invalid\',now());'+
 'INSERT INTO public.companies(id,display_name,status,created_by) VALUES('+lit(f.company)+',\'Synthetic Stage2A\',\'active\','+lit(f.user)+');'+
 'INSERT INTO public.company_members(company_id,user_id,role,status) VALUES('+lit(f.company)+','+lit(f.user)+',\'owner\',\'active\') ON CONFLICT DO NOTHING;'+
 'INSERT INTO public.billing_plans(id,code,name,status) VALUES('+lit(f.plan)+','+lit('synthetic-'+f.plan)+',\'Synthetic Stage2A\',\'active\');'+
 'INSERT INTO public.billing_plan_versions(id,plan_id,version,amount_baisa,currency,period_days,period_unit,period_count,status) VALUES('+lit(f.version)+','+lit(f.plan)+',1,5000,\'OMR\',30,\'day\',30,\'published\');COMMIT;');return f;
}
export async function checkout(db,f,{purpose='initial',environment='test',op=randomUUID(),overrides={}}={}){
 const input={p_company_id:f.company,p_product_code:'velora_ai_staff',p_purchase_purpose:purpose,p_plan_version_id:f.version,p_requested_plan_id:null,p_client_op_id:op,p_input_fingerprint:op,p_special_reference:'synthetic-'+op,p_amount_baisa:5000,p_currency:'OMR',p_period_days:30,p_period_unit:'day',p_period_count:30,p_provider_account_ref:f.account,p_provider_environment:environment,p_created_by:f.user,...overrides};
 const args=[input.p_company_id,input.p_product_code,input.p_purchase_purpose,input.p_plan_version_id,input.p_requested_plan_id,input.p_client_op_id,input.p_input_fingerprint,input.p_special_reference,input.p_amount_baisa,input.p_currency,input.p_period_days,input.p_period_unit,input.p_period_count,input.p_provider_account_ref,input.p_provider_environment,input.p_created_by].map(v=>v===null?'NULL':lit(v)).join(',');
 const query=environment==='test'?'SELECT public.billing_create_test_checkout_order('+lit(JSON.stringify(input))+'::jsonb,1000);':'SELECT public.billing_create_or_reuse_subscription_order('+args+');';
 return {...json(await db.sql(service(query))),input};
}

export async function manualOrder(db,f,{environment='live',expires=new Date(Date.now()+7200000).toISOString(),approval=null,periodCount=30}={}){
 const id=randomUUID(),attempt=randomUUID(),op=randomUUID();
 await db.sql('BEGIN;SET LOCAL ROLE postgres;'+
 'INSERT INTO public.billing_orders(id,company_id,plan_version_id,amount_baisa,currency,period_days,period_unit,period_count,provider,provider_account_ref,provider_environment,provider_amount,provider_amount_unit,special_reference,client_op_id,input_fingerprint,status,product_code,purchase_purpose,created_by,expires_at,deadline_policy_approved) VALUES('+lit(id)+','+lit(f.company)+','+lit(f.version)+',5000,\'OMR\',30,\'day\','+periodCount+',\'paymob\','+lit(f.account)+','+lit(environment)+',5000,\'paymob_amount\','+lit('synthetic-'+op)+','+lit(op)+','+lit(op)+',\'locked\',\'velora_ai_staff\',\'initial\','+lit(f.user)+','+(expires===null?'NULL':lit(expires))+','+(approval===null?'NULL':approval?'true':'false')+');COMMIT;');
 const r={ok:true,order_id:id,payment_attempt_id:attempt};
 await db.sql('SET ROLE service_role;INSERT INTO public.billing_payment_attempts(id,order_id,company_id) VALUES('+lit(attempt)+','+lit(id)+','+lit(f.company)+');');return r;
}
export async function storedEvent(db,f,r,{raw={},eventStatus='success',transaction=randomUUID(),providerOrder=randomUUID(),bind=true}={}){
 if(bind)await db.sql('SET ROLE service_role;UPDATE public.billing_payment_attempts SET status=\'provider_submitted\',provider_order_id='+lit(providerOrder)+' WHERE id='+lit(r.payment_attempt_id));
 const o=json(await db.sql('SELECT to_jsonb(o) FROM public.billing_orders o WHERE id='+lit(r.order_id)));
 const a=json(await db.sql('SELECT to_jsonb(a) FROM public.billing_payment_attempts a WHERE id='+lit(r.payment_attempt_id)));
 const summary={provider_transaction_id:transaction,provider_order_id:a.provider_order_id,hmac_verified:true,amount_cents:5000,currency:'OMR',integration_id:Number(f.account),signed_owner:'84001',pending:false,success:true,error_occured:false,is_auth:false,is_capture:false,is_voided:false,is_refunded:false,has_parent_transaction:false,is_standalone_payment:true,...raw};
 const observation='synthetic-'+randomUUID();
 const evidence={evidence_marker:'VEL_PAYMOB_SERVER_HMAC_VERIFIED',authenticity:{source:'server_adapter_attestation',verified:true,method:'paymob_hmac_sha512'},company_id:f.company,order_id:r.order_id,payment_attempt_id:r.payment_attempt_id,provider:'paymob',provider_account_ref:f.account,provider_environment:o.provider_environment,provider_transaction_id:transaction,special_reference:o.special_reference,amount_baisa:5000,currency:'OMR',currency_expected:'OMR',event_status:eventStatus,observation_key:observation};
 const event=await db.sql(service('INSERT INTO public.billing_provider_events(payment_attempt_id,company_id,provider,provider_account_ref,provider_environment,provider_transaction_id,event_status,observation_key,amount_baisa_expected,currency_expected,raw_summary) VALUES('+lit(r.payment_attempt_id)+','+lit(f.company)+',\'paymob\','+lit(f.account)+','+lit(o.provider_environment)+','+lit(transaction)+','+lit(eventStatus)+','+lit(observation)+',5000,\'OMR\','+lit(JSON.stringify(summary))+'::jsonb) RETURNING id;'));
 return {evidence,event,summary};
}
export const settle=(db,evidence)=>db.sql(service('SELECT public.billing_settle_paymob_hmac_verified('+lit(JSON.stringify(evidence))+'::jsonb);')).then(json);
