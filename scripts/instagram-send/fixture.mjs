import assert from 'node:assert/strict';
import {setup as inboxSetup,reset as inboxReset,cleanup,id,sql,lit,prefix,conv} from '../instagram-inbox/verify-postgres.mjs';
import {file,session} from '../instagram-connection/postgres.mjs';
export {cleanup,id,sql,lit,prefix,conv,session};
export const migration='supabase/migrations/20261011205431_vel_instagram_send_intents.sql';
let catalog;
export async function setup(){await inboxSetup();catalog=JSON.parse(await sql('select to_json(private.access_company_capabilities())'));assert.ok(!catalog.includes('ig.conversations.reply'));await file(migration);}
/** Synthetic evidence projections and future capability registration are test
 * dependencies, NOT claims of real billing, signed window or rollout readiness. */
export async function reset(){
 await sql('truncate private.instagram_send_policy,private.instagram_send_entitlements,private.instagram_send_windows,private.instagram_send_intents cascade');
 await inboxReset();
 await sql(`create or replace function private.access_company_capabilities() returns text[] language sql immutable set search_path='' as $$select array[${[...catalog,'ig.conversations.reply'].map(lit).join(',')}]::text[]$$;
 insert into private.instagram_send_policy(id,enabled,entitlement_contract,window_contract) values('manual_text',true,'fixture-entitlement-v1','fixture-organic-window-v1');
 insert into private.instagram_send_entitlements(company_id,proof_id,revision,allowed,valid_from,valid_until,contract) values('${id(1)}','${id(301)}',1,true,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour','fixture-entitlement-v1');
 insert into private.instagram_send_windows(id,company_id,conversation_id,message_id,link_id,generation,account_id,counterparty_id,proof_body_sha256,provider_event_at,closes_at,contract)
 select '${id(302)}',company_id,conversation_id,id,link_id,generation,account_id,sender_id,raw_body_sha256,clock_timestamp()-interval '1 hour',clock_timestamp()+interval '23 hours'-interval '1 minute','fixture-organic-window-v1'
 from private.instagram_messages where provider_mid='mid.1';
 update public.company_member_grants set capabilities=capabilities||array['ig.conversations.reply'] where user_id='${id(13)}';
 update public.platform_admin_scopes set delegable_capabilities=delegable_capabilities||array['ig.conversations.reply'];`);
}
export const nativeRpc=(name,args,user=11,sid=user===11?21:user===13?23:26)=>sql(`${prefix(user,sid)}select public.${name}(${args})`).then(JSON.parse);
export const serverRpc=(name,args)=>sql(`set role service_role;set request.jwt.claims='{"role":"service_role"}';select public.${name}(${args})`).then(JSON.parse);
export const prepare=async(intent=401,text='synthetic reply',user=11,sid,company=1,conversation)=>nativeRpc('instagram_prepare_send',`'${id(company)}','${conversation??await conv()}','${id(intent)}',${lit(text)}`,user,sid);
export const bindingArg=b=>lit(JSON.stringify(b))+'::jsonb';
export const claim=b=>serverRpc('instagram_claim_send',bindingArg(b));
export const read=(b,user=11,sid)=>nativeRpc('instagram_read_send',bindingArg(b),user,sid);
export const settle=(b,receipt,outcome)=>serverRpc('instagram_settle_send',`${bindingArg(b)},'${receipt}',${bindingArg(outcome)}`);
export const project=b=>serverRpc('instagram_project_send',bindingArg(b));
export const recover=b=>serverRpc('instagram_recover_send',bindingArg(b));
export async function registered(enabled){await sql(`create or replace function private.access_company_capabilities() returns text[] language sql immutable set search_path='' as $$select array[${(enabled?[...catalog,'ig.conversations.reply']:catalog).map(lit).join(',')}]::text[]$$;`);}
export async function observed(marker){for(let n=0;n<50;n++){if(await sql(`select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event='PgSleep' and query like '%${marker}%')`)==='t')return;await new Promise(r=>setTimeout(r,10));}throw Error('REQUIRED_SEND_STORAGE_WAIT_NOT_OBSERVED');}
