-- Synthetic schemas/rows only. Receipt and JSON projection adapters are doubles;
-- identity/session, membership, branch, billing policy and inbox bodies are real.
alter table auth.users add email text default 'synthetic@example.invalid',add email_confirmed_at timestamptz default now();
create table public.platform_admins(user_id uuid,role text,status text);
create table public.platform_admin_scopes(admin_user_id uuid,company_id uuid,usable_capabilities text[]);
create table public.company_member_grants(company_id uuid,user_id uuid,capabilities text[],status text,manager_user_id uuid,conversation_scope text);
create table public.billing_subscriptions(company_id uuid,environment text,paid_through timestamptz);
create table private.billing_expiry_episodes(company_id uuid,disconnected_at timestamptz);
create table private.synthetic_receipts(company_id uuid,receipt jsonb);
insert into private.synthetic_receipts select id,jsonb_build_object('expiredAt',now()+interval '1 day') from public.companies;
create function private.billing_lifecycle_receipt(cid uuid) returns jsonb language sql stable as $$select receipt from private.synthetic_receipts where company_id=cid$$;
create table public.whatsapp_company_links(id uuid primary key,company_id uuid unique,generation bigint,provider_phone_number_id text unique,status text,authorization_status text,authorization_expires_at timestamptz,authorization_non_expiring boolean);
create table private.instagram_company_links(id uuid primary key,company_id uuid unique,generation bigint,account_id text unique,status text,authorization_expires_at timestamptz);
create table private.instagram_company_generations(company_id uuid primary key,bound_account_id text,generation bigint);
create table private.es02_b3_connection_links(company_id uuid,branch_id uuid,channel text,legacy_link_id uuid,legacy_generation bigint,verified boolean,status text,revoked_at timestamptz);
create unique index on private.es02_b3_connection_links(channel,legacy_link_id) where status='active';
create unique index on private.es02_b3_connection_links(branch_id,channel) where status='active';
insert into public.whatsapp_company_links select id, id,1,'wa'||right(id::text,2),'verified','active',now()+interval '1 day',false from public.companies;
insert into private.instagram_company_links select id,id,1,'ig'||right(id::text,2),'active',now()+interval '1 day' from public.companies;
insert into private.instagram_company_generations select company_id,account_id,generation from private.instagram_company_links;
insert into private.es02_b3_connection_links select c.id,b.id,ch,c.id,1,true,'active',null from public.companies c join public.company_branches b on b.company_id=c.id cross join unnest(array['whatsapp','instagram']) ch where right(b.id::text,2) in ('31','32');
create table public.whatsapp_conversations(id uuid primary key,company_id uuid,phone_number_id text,inbox_sequence bigint,assigned_to uuid,assigned_user_id uuid);
create table public.whatsapp_messages(id uuid primary key,company_id uuid,conversation_id uuid,arrival_sequence bigint);
create table private.instagram_conversations(id uuid primary key,company_id uuid,account_id text,inbox_sequence bigint,assigned_to uuid,assigned_user_id uuid);
create table private.instagram_messages(id uuid primary key,company_id uuid,conversation_id uuid,arrival_sequence bigint);
insert into public.whatsapp_conversations values
 ('10000000-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000021','wa21',1,'10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000042','10000000-0000-4000-8000-000000000022','wa22',1,'10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002'),
 ('10000000-0000-4000-8000-000000000043','10000000-0000-4000-8000-000000000021','foreign',2,null,null);
insert into private.instagram_conversations select id,company_id,replace(phone_number_id,'wa','ig'),inbox_sequence,assigned_to,assigned_user_id from public.whatsapp_conversations;
insert into public.whatsapp_messages values ('10000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000041',1),('10000000-0000-4000-8000-000000000052','10000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000042',1);
insert into private.instagram_messages select * from public.whatsapp_messages;
create function private.whatsapp_inbox_conversation_public(c public.whatsapp_conversations,uid uuid) returns jsonb language sql as $$select jsonb_build_object('id',c.id)$$;
create function private.whatsapp_inbox_message_public(m public.whatsapp_messages) returns jsonb language sql as $$select jsonb_build_object('id',m.id)$$;
create function private.instagram_inbox_item(c private.instagram_conversations,uid uuid) returns jsonb language sql as $$select jsonb_build_object('id',c.id)$$;
create function private.instagram_inbox_message(m private.instagram_messages) returns jsonb language sql as $$select jsonb_build_object('id',m.id)$$;
