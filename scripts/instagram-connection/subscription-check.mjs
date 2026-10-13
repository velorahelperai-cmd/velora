import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {bootstrap,cleanup,installVaultContractFixture,sql,file,lit} from './postgres.mjs';
// Disposable local SQL fixture only; no Meta or production calls.
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const b={companyId:id(1),userId:id(11),sessionId:id(21),attemptId:id(31),generation:1,appId:'3391832644330595',contractId:'fixture'};
const j=v=>`${lit(JSON.stringify(v))}::jsonb`;
const perms=['instagram_business_basic','instagram_business_manage_messages'];
const rpc=async(name,args,role='service_role')=>JSON.parse(await sql(`set role ${role};set request.jwt.claims=${lit(JSON.stringify(role==='authenticated'?{role,sub:b.userId,session_id:b.sessionId}:{role}))};select public.${name}(${args});`));
try{
 await bootstrap('supabase/migrations/'+readdirSync('supabase/migrations').find(n=>n.endsWith('_vel_instagram_connection_store.sql')));
 await installVaultContractFixture();
 await file('supabase/migrations/20261013000000_vel_instagram_subscription_checkpoint.sql');
 await sql(`insert into auth.users(id,email,email_confirmed_at) values('${b.userId}','fixture@example.invalid',now());insert into auth.sessions(id,user_id) values('${b.sessionId}','${b.userId}');insert into public.companies values('${b.companyId}','Fixture','active');insert into public.company_members(company_id,user_id,role,status) values('${b.companyId}','${b.userId}','owner','active');insert into private.app_session_activity(session_id,user_id,last_activity_at) values('${b.sessionId}','${b.userId}',now());insert into private.instagram_provider_contracts values('fixture','${b.appId}',array['instagram_business_basic','instagram_business_manage_messages'],true);`);
 const state='a'.repeat(64),hash=createHash('sha256').update(state).digest('hex');
 assert.equal((await rpc('instagram_start_connection',`${lit(b.companyId)},${lit(b.attemptId)},${lit(hash)},${lit(b.appId)},'fixture',0`,'authenticated')).ok,true);
 assert.equal((await rpc('instagram_claim_connection',`${j(b)},${lit(state)}`,'authenticated')).kind,'claimed');
 const staged=await rpc('instagram_stage_connection',`${j(b)},'synthetic-token',${j({appId:b.appId,contractId:b.contractId,accountId:'123456789',permissions:perms,expiresAt:'2030-01-01T00:00:00Z'})}`);
 assert.ok(staged.stageReceipt);
 const args=`${j(b)},${lit(staged.stageReceipt)}::uuid`;
 assert.equal((await rpc('instagram_finalize_connection',args)).code,'RECONCILIATION_REQUIRED');
 for(const role of ['anon','authenticated'])assert.equal(await sql(`select has_function_privilege('${role}','public.instagram_claim_subscription(jsonb,uuid)','execute')`),'f');
 assert.equal((await rpc('instagram_claim_subscription',`${j({...b,companyId:id(2)})},${lit(staged.stageReceipt)}::uuid`)).code,'FORBIDDEN');
 const claim=await rpc('instagram_claim_subscription',args);assert.equal(claim.kind,'claimed');assert.equal(claim.fields[0],'messages');assert.equal(claim.accessToken,'synthetic-token');
 const replay=await rpc('instagram_claim_subscription',args);assert.equal(replay.kind,'existing');assert.equal(replay.accessToken,undefined);
 assert.equal((await rpc('instagram_finalize_connection',args)).code,'RECONCILIATION_REQUIRED');
 assert.equal((await rpc('instagram_settle_subscription',`${args},${lit(id(99))}::uuid,'verified'`)).code,'FORBIDDEN');
 assert.equal((await rpc('instagram_settle_subscription',`${args},${lit(claim.claimReceipt)}::uuid,'verified'`)).state,'verified');
 assert.equal((await rpc('instagram_settle_subscription',`${args},${lit(claim.claimReceipt)}::uuid,'unknown'`)).state,'verified');
 assert.equal((await rpc('instagram_finalize_connection',args)).ok,true);
 console.log('PASS: subscription SQL install, authority, no repeat token, finalize gate and immutable settlement');
}finally{await cleanup();}
