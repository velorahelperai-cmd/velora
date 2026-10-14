// Guarded native finance/E fixture. Auth schema, channel readiness and provider
// attestations are offline ports; finance, credit and worker guards are native.
import {readFileSync,readdirSync} from 'node:fs';
import {bootstrap,sql,file,cleanup,session} from '../instagram-connection/postgres.mjs';
export {sql,file,cleanup,session};
export const server="set role service_role;set request.jwt.claims='{\"role\":\"service_role\"}';";
const body=(path,name)=>{const source=readFileSync(path,'utf8');const start=new RegExp('create(?: or replace)? function '+name.replaceAll('.','\\.')+'\\(').exec(source)?.index;if(start===undefined)throw Error('NATIVE_FUNCTION_MISSING '+name);return source.slice(start,source.indexOf('$$;',start)+3);};
export async function initialize(){
 await bootstrap('scripts/master-checkout/dependencies.sql');
 await sql('alter table auth.users add column banned_until timestamptz,add column deleted_at timestamptz');
 const epochs=readFileSync('supabase/migrations/20261014033007_master_password_session_revocation.sql','utf8');const epochStart=epochs.indexOf('create table private.master_account_session_revocations');await sql(epochs.slice(epochStart,epochs.indexOf(';',epochStart)+1));
 await sql(readdirSync('supabase/migrations').filter(n=>n>='20261006180000'&&n<='20261008080000_vel_billing_p1_dependencies_d1_to_d5.sql'&&(/billing|paymob|subscription/.test(n)||n<'20261007010001')).sort().map(n=>readFileSync('supabase/migrations/'+n,'utf8')).join('\n'));
 await file('scripts/master-checkout/live-dependencies.sql');
 const channel=readFileSync('supabase/migrations/20261014033000_channel_entitlement_contract.sql','utf8');const channelStart=channel.indexOf('create table private.plan_channel_entitlements');await sql(channel.slice(channelStart,channel.indexOf(';',channelStart)+1));
 await sql(['private.billing_live_owner','public.billing_create_live_checkout_order','public.billing_claim_live_checkout','public.billing_complete_live_checkout'].map(n=>body('supabase/upgrade-packages/paymob-live-checkout/20-production-compatibility.review.sql',n)).join('\n'));
 const history=readFileSync('supabase/migrations/20261008100000_vel_billing_legacy_evidence_upgrade_acceptance.sql','utf8');
 await sql(['private.billing_verified_collection_history','private.billing_proven_entitlement_grants'].map(n=>{const start=history.indexOf('create view '+n+' as');return history.slice(start,history.indexOf('\nrevoke',start));}).join('\n')+body('supabase/migrations/20261010053446_service_entitlement_read_contract.sql','private.billing_service_receipt_eligible')+body('supabase/migrations/20261008120000_vel_billing_lifecycle_evidence_acceptance.sql','private.billing_acceptance_hmac_event'));
 const path='supabase/migrations/20261014033001_master_subscription_activation.sql',source=readFileSync(path,'utf8');
 await sql(source.slice(source.indexOf('begin;'),source.indexOf('create function private.master_activation_setup_destroyed'))+'commit;drop function private.master_activation_company_end(uuid);drop function private.master_activation_waiting(uuid);create function private.master_activation_ready(uuid,uuid) returns boolean language sql as $$select false$$;');
 await sql(['private.master_activation_receipt_current','private.master_activation_receipt_state','private.master_activation_effective_end','private.master_reconcile_activation_locked','public.master_capture_subscription_activation','private.master_activation_company_end','private.master_activation_waiting'].map(n=>body(path,n)).join('\n'));
 await sql(`do $$declare f record;begin for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('private','public') and p.proname like 'master_%activation%' loop execute format('alter function %s set jit=off',f.oid::regprocedure);end loop;end;$$;`);
 await sql('drop function public.master_apply_cycle_upgrade(uuid,uuid);alter table public.companies add column timezone text');
 const deps=readFileSync('scripts/cycle-ai/dependencies.sql','utf8');await sql(deps.slice(deps.indexOf('create table public.whatsapp_conversations'),deps.indexOf('create function public.billing_read_company_operational_entitlement')));
 const selectedStart=channel.indexOf('create table private.company_selected_channels');await sql(channel.slice(selectedStart,channel.indexOf(';',selectedStart)+1));
 await sql(['private.wa_worker_month','private.wa_worker_lock','public.whatsapp_reserve_job_usage','public.whatsapp_stage_job_reply','public.whatsapp_claim_assistant_job_send'].map(n=>body('supabase/migrations/20261008132000_vel_wa_worker_atomic_integration.sql',n)).join('\n')+body('supabase/migrations/20261008133000_vel_ai_whatsapp_reservation_integration.sql','private.ai_lock_authorized_whatsapp_job')+body('supabase/migrations/20261010084102_noura_claimed_job_authority.sql','private.wa_noura_authority'));
 await file('supabase/migrations/20261014033003_master_checkout_contract.sql');await file('supabase/migrations/20261014033004_master_cycle_ai_credits.sql');await file('supabase/migrations/20261014033006_master_native_upgrade.sql');
 await file('supabase/migrations/20261014033008_master_autorenew_wallet.sql');
 // Actual F archive field: operational status is preserved, never 'archived'.
 const archive=readFileSync('supabase/migrations/20261014033011_master_business_archive.sql','utf8');const archiveStart=archive.indexOf('alter table public.companies add column archived_at');await sql(archive.slice(archiveStart,archive.indexOf(';',archiveStart)+1));
}
