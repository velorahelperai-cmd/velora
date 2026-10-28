-- LOCAL CANDIDATE; no provider, rollout or Production changes.
-- Reuse claimed native/ES02 authorization; never infer language from another branch/company.
-- Rollback removes this new RPC; caller then fails closed until paired code rollback.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.es02_read_claimed_reply_language(p_company_id uuid,p_job_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare gate jsonb; branch uuid; lang text; rev bigint;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege;end if;
 gate:=private.whatsapp_answer_profile(p_job_id,p_claim_token);
 if gate->>'ok' is distinct from 'true' then return gate;end if;
 if gate->>'company_id' is distinct from p_company_id::text or gate->>'job_id' is distinct from p_job_id::text then
 return jsonb_build_object('ok',false,'code','CLAIM_BINDING_REJECTED');end if;
 select binding.branch_id,l.reply_language,l.revision into branch,lang,rev
 from public.whatsapp_inbound_jobs j
 join public.whatsapp_messages m on m.id=j.message_id and m.company_id=j.company_id and m.wa_message_id=j.wa_message_id and m.direction='inbound' and m.sender='customer'
 join public.whatsapp_conversations c on c.id=m.conversation_id and c.company_id=j.company_id
 join public.whatsapp_company_links native_link on native_link.company_id=j.company_id and native_link.provider_phone_number_id=c.phone_number_id and native_link.status='verified' and native_link.authorization_status='active' and (native_link.authorization_expires_at is null or native_link.authorization_expires_at>clock_timestamp())
 join private.es02_b3_connection_links binding on binding.company_id=j.company_id and binding.channel='whatsapp' and binding.legacy_link_id=native_link.id and binding.legacy_generation=native_link.generation and binding.verified and binding.status='active' and binding.revoked_at is null
 join public.company_branches b on b.id=binding.branch_id and b.company_id=j.company_id
 join private.es02_branch_reply_language_confirmations l on l.branch_id=b.id and l.company_id=b.company_id
 where j.id=p_job_id and j.company_id=p_company_id
 for share of l,binding,native_link;
 if branch is null or lang is null or lang not in ('ar','en','both') or rev is null or rev<1 or rev>9007199254740991
 or (gate->>'authority'='es02' and gate->>'es02_branch_id' is distinct from branch::text) then
 return jsonb_build_object('ok',false,'code','REPLY_LANGUAGE_UNCONFIRMED');end if;
 return jsonb_build_object('ok',true,'company_id',p_company_id,'job_id',p_job_id,'branch_id',branch,'reply_language',lang,'revision',rev);
end;$$;
alter function public.es02_read_claimed_reply_language(uuid,uuid,uuid) owner to postgres;
revoke all on function public.es02_read_claimed_reply_language(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.es02_read_claimed_reply_language(uuid,uuid,uuid) to service_role;
commit;
