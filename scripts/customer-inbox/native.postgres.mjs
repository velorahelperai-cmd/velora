// Opt-in integration check against the existing, isolated local PostgreSQL fixture.
// The fixture verifies its data directory and never connects to a hosted database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { nativeIngressFixture } from '../whatsapp-integration/native-ingress-fixture.mjs';

let fixture;
try {
  fixture = await nativeIngressFixture();
  const db = fixture.db;
  // The partial replay predates ES02. Production has this NOT NULL column;
  // adding it here only reproduces that single prerequisite in the fixture.
  await db.query('alter table public.company_members add column es02_branch_only boolean not null default false');
  for (const name of ['20261104092239_customer_inbox_extensions.sql', '20261105182449_customer_whatsapp_media_intent.sql', '20261105200500_whatsapp_start_conversation.sql']) {
    await db.query((await readFile(`supabase/migrations/${name}`, 'utf8')).replace(/\r\n/g, '\n'));
  }
  const permissions = (await db.query(`select
    has_table_privilege('authenticated','private.customer_inbox_extensions','SELECT') as auth_table,
    has_table_privilege('anon','private.customer_inbox_extensions','SELECT') as anon_table,
    has_function_privilege('anon','public.customer_inbox_extension(uuid,text,uuid,text,uuid,text,text,text)','EXECUTE') as anon_extension,
    has_function_privilege('authenticated','public.customer_inbox_extension(uuid,text,uuid,text,uuid,text,text,text)','EXECUTE') as auth_extension,
    has_function_privilege('anon','public.whatsapp_start_conversation(uuid,text)','EXECUTE') as anon_start,
    has_function_privilege('authenticated','public.whatsapp_start_conversation(uuid,text)','EXECUTE') as auth_start,
    has_function_privilege('authenticated','public.claim_whatsapp_media_send_attempt(uuid,uuid,integer)','EXECUTE') as auth_claim,
    has_function_privilege('service_role','public.claim_whatsapp_media_send_attempt(uuid,uuid,integer)','EXECUTE') as service_claim,
    (select relrowsecurity from pg_class where oid='private.customer_inbox_extensions'::regclass) as extensions_rls`)).rows[0];
  assert.deepEqual(permissions, { auth_table:false, anon_table:false, anon_extension:false, auth_extension:true,
    anon_start:false, auth_start:true, auth_claim:false, service_claim:true, extensions_rls:true });
  const { tenant, asset } = await fixture.legacyPaidTenant();
  const user = tenant.user;
  const session = (await db.query('select id from auth.sessions where user_id=$1', [user])).rows[0].id;
  await db.query('insert into private.app_session_activity(session_id,user_id,last_activity_at) values($1,$2,clock_timestamp()) on conflict(session_id) do update set last_activity_at=excluded.last_activity_at,expired_at=null', [session, user]);
  const auth = async sessionId => {
    await db.query('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [user, JSON.stringify({ sub: user, session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 3600 })]);
  };
  const ext = async (action, item = null, body = null, mime = null, base64 = null, company = tenant.company) =>
    (await db.query("select public.customer_inbox_extension($1,'whatsapp',$2,$3,$4,$5,$6,$7) result",
      [company, tenant.conversation, action, item, body, mime, base64])).rows[0].result;
  await auth(session);
  const start = async (company, recipient) => (await db.query('select public.whatsapp_start_conversation($1,$2) result', [company, recipient])).rows[0].result;
  assert.equal((await start(tenant.company, 'invalid')).code, 'invalid_input');
  assert.equal((await start(randomUUID(), '96890000000')).code, 'forbidden');
  await auth(randomUUID());
  assert.equal((await start(tenant.company, '96890000000')).code, 'forbidden');
  await auth(session);
  const started = await start(tenant.company, '96890000000');
  assert.equal(started.ok, true, JSON.stringify(started));
  assert.equal(started.created, true);
  const duplicate = await start(tenant.company, '96890000000');
  assert.equal(duplicate.conversation_id, started.conversation_id);
  assert.equal(duplicate.created, false);
  const page = (await db.query('select public.whatsapp_inbox_page($1,40,null) result', [tenant.company])).rows[0].result;
  assert.equal(page.ok, true, JSON.stringify(page));
  assert(page.conversations.some(row => row.id === started.conversation_id));
  const thread = (await db.query('select public.whatsapp_thread_page($1,$2,40,null) result', [tenant.company, started.conversation_id])).rows[0].result;
  assert.equal(thread.ok, true, JSON.stringify(thread));
  assert.equal(thread.messages.length, 0);
  await db.query('reset role');
  assert.equal((await db.query('select count(*)::int n from public.whatsapp_messages where conversation_id=$1', [started.conversation_id])).rows[0].n, 0);
  await auth(session);
  const tag = randomUUID(), quick = randomUUID(), file = randomUUID();
  // PostgreSQL wraps base64 after 76 characters; both read paths must return
  // canonical unwrapped data for realistic files, not only tiny fixtures.
  const fileBase64=Buffer.concat([Buffer.from('%PDF-'),Buffer.alloc(128,65)]).toString('base64');
  for (const args of [['star'], ['tag', tag, 'Synthetic tag'], ['quick', quick, 'Synthetic reply'],
    ['file', file, 'proof.pdf', 'application/pdf', fileBase64]]) {
    assert.equal((await ext(...args)).ok, true, `native ${args[0]}`);
  }
  const listed = await ext('list');
  assert.equal(listed.ok, true);
  for (const kind of ['star', 'tag', 'quick', 'file']) assert(listed.data.some(row => row.kind === kind));
  const download=await ext('download', file);
  assert.equal(download.data.name, 'proof.pdf');
  assert.equal(download.data.base64, fileBase64);
  assert.equal((await ext('list', null, null, null, null, randomUUID())).code, 'FORBIDDEN');
  await auth(randomUUID());
  assert.equal((await ext('list')).code, 'FORBIDDEN');
  await auth(session);
  await db.query('reset role');
  const link = (await db.query('select id,generation from public.whatsapp_company_links where id=$1', [tenant.link])).rows[0];
  await auth(session);
  const created = (await db.query('select public.create_whatsapp_media_send_intent($1,$2,$3,$4,$5,$6,$7,$8) result',
    [tenant.company, tenant.conversation, file, `native-media-${randomUUID()}`, 'Synthetic caption', asset.phone, link.id, link.generation])).rows[0].result;
  assert.equal(created.ok, true, JSON.stringify(created));
  const noCaption = (await db.query('select public.create_whatsapp_media_send_intent($1,$2,$3,$4,$5,$6,$7,$8) result',
    [tenant.company, tenant.conversation, file, `native-media-${randomUUID()}`, '', asset.phone, link.id, link.generation])).rows[0].result;
  assert.equal(noCaption.ok, true, JSON.stringify(noCaption));
  assert.equal(noCaption.media_filename, 'proof.pdf');
  assert.equal(noCaption.intent.body, 'proof.pdf');
  await db.query('set role service_role');
  const claim = async name => (await db.query(`select public.${name}($1,$2,90) result`, [created.intent.id, user])).rows[0].result;
  assert.equal((await claim('claim_whatsapp_media_send_attempt')).code, 'service_window_closed');
  await db.query('select test_fixture.job($1::jsonb)', [JSON.stringify(tenant)]);
  await assert.rejects(() => claim('claim_whatsapp_send_attempt'), /MEDIA_CLAIM_REQUIRED/);
  const claimed = await claim('claim_whatsapp_media_send_attempt');
  assert.equal(claimed.ok, true, JSON.stringify(claimed));
  await auth(session);
  const attachment = async token => (await db.query('select public.whatsapp_media_claimed_attachment($1,$2) result', [created.intent.id, token])).rows[0].result;
  assert.equal((await attachment(randomUUID())).code, 'forbidden');
  const loaded = await attachment(claimed.attempt_token);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.attachmentId, file);
  assert.equal(loaded.base64, fileBase64);
  console.log('PASS: native partial-schema inbox session, isolation, storage and media-claim checks');
} finally {
  await fixture?.close();
}
