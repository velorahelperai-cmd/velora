import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { bootstrap, cleanup, sql, lit, session } from "./postgres.mjs";

const migration = "supabase/migrations/20261011160000_vel_staff_invitation_recovery.sql";
const owner = "f1000000-0000-4000-8000-000000000001";
const member = "f1000000-0000-4000-8000-000000000002";
const otherOwner = "f1000000-0000-4000-8000-000000000003";
const wrong = "f1000000-0000-4000-8000-000000000004";
const unverified = "f1000000-0000-4000-8000-000000000005";
const company = "f2000000-0000-4000-8000-000000000001";
const otherCompany = "f2000000-0000-4000-8000-000000000002";
const sid = (actor, second = false) => actor.replace("f1", second ? "f4" : "f3");
const auth = (actor, second = false) => `set request.jwt.claims=${lit(JSON.stringify({sub:actor,session_id:sid(actor,second),role:"authenticated"}))};set role authenticated;`;
const hash = value => createHash("sha256").update(value).digest("hex");
let assertions = 0;
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
const yes = (actual, message) => { assert.ok(actual, message); assertions++; };
const nullable = value => value == null ? "null" : lit(value);
const mutateStatement = ({operation=randomUUID(),action="create",email="member@fixture.invalid",name="Staff fixture",id=null,revision=null,token=hash(randomUUID()),business=company}={}) =>
  `select public.mutate_staff_invitation('${business}','${operation}',${lit(action)},${nullable(email)},${nullable(name)},${nullable(id)},${revision ?? "null"},${nullable(token)})`;
const query = async (actor, statement, second=false) => JSON.parse(await sql(auth(actor,second)+statement));
const make = async (options={},actor=owner) => query(actor,mutateStatement(options));
const manage = (action,invite,options={}) => make({action,email:null,name:null,id:invite.id,revision:invite.revision,...options});
const acceptStatement = token => `select public.accept_staff_invitation('${token}')`;
const accept = (token,actor=member) => query(actor,acceptStatement(token));
const preview = async token => JSON.parse(await sql(`set role anon;select public.read_staff_invitation('${token}')`));
const team = (actor=owner,business=company) => query(actor,`select public.list_company_team('${business}')`);
const count = (table,where="true") => sql(`select count(*) from ${table} where ${where}`);
const inputEpoch = () => sql(`select input_epoch from private.g03_company_inputs where company_id='${company}'`);

async function waitForOutput(connection, marker) {
  const deadline = Date.now()+5000;
  while (!connection.output().includes(marker)) {
    if (Date.now()>deadline) throw Error(`Missing race barrier ${marker}: ${connection.output()}`);
    await new Promise(resolve => setTimeout(resolve,20));
  }
}
// First transaction has completed the RPC but deliberately holds recipient locks.
// The second transaction must wait on those real PostgreSQL locks until COMMIT.
async function orderedRace(firstActor, firstStatement, secondActor, secondStatement) {
  const first = session(`begin;${auth(firstActor)}${firstStatement};select 'RACE_READY';`,{keepOpen:true});
  await waitForOutput(first,"RACE_READY");
  const marker=`staff-race-${randomUUID()}`;
  const second = session(`set application_name=${lit(marker)};`+auth(secondActor,true)+secondStatement);
  try {
    const deadline=Date.now()+5000;
    while(await sql(`select exists(select 1 from pg_stat_activity where application_name=${lit(marker)} and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0)`) !== "t") {
      if(Date.now()>deadline) throw Error(`Competing transaction did not block: ${second.output()}`);
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assertions++;
    first.child.stdin.end("commit;\n");
    const firstOutput = await first.done;
    const secondOutput = await second.done;
    return [JSON.parse(firstOutput.split("\n")[0]),JSON.parse(secondOutput)];
  } catch(error) {
    first.child.stdin.end("rollback;\n");
    await Promise.allSettled([first.done,second.done]);
    throw error;
  }
}

let actorSequence=20;
async function fixtureActor(email) {
  const actor=`f1000000-0000-4000-8000-${String(actorSequence++).padStart(12,"0")}`;
  const sessions=[sid(actor),sid(actor,true)];
  await sql(`insert into auth.users values('${actor}',${lit(email)},clock_timestamp());
    insert into auth.sessions(id,user_id) values('${sessions[0]}','${actor}'),('${sessions[1]}','${actor}');`);
  return actor;
}

try {
  await bootstrap();
  await sql(`insert into auth.users values
    ('${owner}','owner@fixture.invalid',clock_timestamp()),('${member}','member@fixture.invalid',clock_timestamp()),
    ('${otherOwner}','other-owner@fixture.invalid',clock_timestamp()),('${wrong}','wrong@fixture.invalid',clock_timestamp()),
    ('${unverified}','unverified@fixture.invalid',null);
    insert into auth.sessions(id,user_id) select replace(id::text,'f1','f3')::uuid,id from auth.users;
    insert into auth.sessions(id,user_id) select replace(id::text,'f1','f4')::uuid,id from auth.users;
    insert into public.companies values('${company}','First fixture business','active'),('${otherCompany}','Other fixture business','active');
    insert into public.company_members(company_id,user_id,role,status,member_name) values
    ('${company}','${owner}','owner','active','Owner'),('${otherCompany}','${otherOwner}','owner','active','Other owner');
    insert into public.company_member_grants values('${company}','${owner}',array['owner.fixture'],null,'active',7);`);
  // Legacy duplicate links deliberately retained and contained during upgrade.
  const oldA=hash("legacy-a"), oldB=hash("legacy-b");
  eq((await query(owner,`select public.create_staff_invitation('${company}','member@fixture.invalid','Legacy A','${oldA}')`)).ok,true);
  eq((await query(owner,`select public.create_staff_invitation('${company}','member@fixture.invalid','Legacy B','${oldB}')`)).ok,true);
  const legacyAcceptedActor=await fixtureActor("legacy-accepted@fixture.invalid"),legacyAcceptedToken=hash("legacy-accepted");
  eq((await query(owner,`select public.create_staff_invitation('${company}','legacy-accepted@fixture.invalid','Legacy accepted','${legacyAcceptedToken}')`)).ok,true);
  eq((await accept(legacyAcceptedToken,legacyAcceptedActor)).ok,true);
  await sql(`insert into public.company_member_grants values('${company}','${legacyAcceptedActor}',array['leads.view'],null,'active',9);`);
  const legacyBefore=await sql("select jsonb_agg(to_jsonb(i) order by id) from private.staff_invitations i");
  // Simulate installer rollback; old functions and data must remain operable.
  await sql("begin;"+await readFile(migration,"utf8")+";rollback;");
  eq(await sql("select to_regclass('private.staff_invitation_operations') is null"),"t");
  eq(await sql("select jsonb_agg(to_jsonb(i) order by id) from private.staff_invitations i"),legacyBefore);
  eq((await preview(oldA)).ok,true); eq((await preview(oldB)).ok,true);
  await sql("begin;"+await readFile(migration,"utf8")+";commit;");
  eq(await count("private.staff_invitations"),"3");
  eq(await sql("select jsonb_agg(to_jsonb(i)-'cancelled_at'-'cancelled_by'-'superseded_by'-'legacy_duplicate' order by id) from private.staff_invitations i"),legacyBefore);
  eq((await preview(oldA)).code,"INVITE_INVALID");
  eq((await preview(oldB)).code,"INVITE_INVALID");
  eq((await accept(oldA)).code,"INVITE_INVALID");
  eq((await accept(legacyAcceptedToken,legacyAcceptedActor)).ok,true);
  eq(await sql(`select capabilities::text||':'||revision from public.company_member_grants where company_id='${company}' and user_id='${legacyAcceptedActor}'`),"{leads.view}:9");
  eq((await make()).code,"LEGACY_CONFLICT");
  eq((await query(owner,`select public.create_staff_invitation('${company}','legacy@fixture.invalid','Old client','${hash("old-client")}')`)).code,"UPGRADE_REQUIRED");
  let listed=await team();
  eq(listed.invitations.length,3);
  eq(listed.invitations.filter(i=>i.status==="conflicted").length,2);
  const repairHash=hash("repair");
  const repaired=await manage("replace",listed.invitations.find(i=>i.status==="conflicted"),{token:repairHash});
  eq(repaired.ok,true); eq(repaired.outcome,"replaced");
  eq(await count("private.staff_invitations","cancelled_at is not null"),"2");
  eq((await preview(oldA)).code,"INVITE_INVALID"); eq((await preview(oldB)).code,"INVITE_INVALID"); eq((await preview(repairHash)).ok,true);
  const repairedPreview=await preview(repairHash);
  eq(repairedPreview.maskedEmail,"m***@fixture.invalid");yes(!JSON.stringify(repairedPreview).includes("member@fixture.invalid"));
  eq((await accept(repairHash,wrong)).code,"EMAIL_MISMATCH");
  const repairEpoch=Number(await inputEpoch());
  eq((await accept(repairHash)).ok,true);eq(await inputEpoch(),String(repairEpoch+1));
  eq((await accept(repairHash)).ok,true);eq(await inputEpoch(),String(repairEpoch+1));
  eq(await count("public.company_members",`company_id='${company}' and user_id='${member}'`),"1");
  eq((await make()).code,"MEMBER_EXISTS");
  const acceptedHistory=await sql(`select to_jsonb(i) from private.staff_invitations i where token_hash='${repairHash}'`);
  const acceptedProjection=(await team()).invitations.find(i=>i.id===repaired.invitation.id);
  eq((await manage("cancel",acceptedProjection,{token:null})).code,"INVITE_NOT_PENDING");
  eq((await manage("replace",acceptedProjection)).code,"INVITE_NOT_PENDING");
  eq(await sql(`select to_jsonb(i) from private.staff_invitations i where token_hash='${repairHash}'`),acceptedHistory);
  eq(await sql(`select capabilities::text||':'||revision from public.company_member_grants where company_id='${company}' and user_id='${owner}'`),"{owner.fixture}:7");
  // Replay binds actor, tenant and canonical payload, but never stores plaintext.
  const operation=randomUUID(), token=hash("replay-original");
  const created=await make({operation,email:"  REPLAY@fixture.invalid  ",name:"  Replay staff  ",token});
  eq(created.ok,true); eq(created.outcome,"created"); eq(created.replayed,false); eq(created.tokenMatched,true);
  const auditBefore=await count("public.admin_audit_logs");
  const replayed=await make({operation,email:"replay@fixture.invalid",name:"Replay staff",token:hash("lost-response-new-token")});
  eq(replayed.ok,true); eq(replayed.replayed,true); eq(replayed.tokenMatched,false); eq(replayed.invitation.id,created.invitation.id);
  eq(await count("public.admin_audit_logs"),auditBefore);
  eq((await make({operation,email:"different@fixture.invalid"})).code,"OPERATION_CONFLICT");
  eq((await make({operation,email:"replay@fixture.invalid",name:"Replay staff",business:otherCompany},otherOwner)).code,"OPERATION_CONFLICT");
  const existing=await make({email:"replay@fixture.invalid",token:hash("not-saved")});
  eq(existing.ok,true); eq(existing.outcome,"existing"); eq(existing.tokenMatched,false); eq(existing.invitation.id,created.invitation.id);
  const replaced=await manage("replace",created.invitation,{token:hash("replay-replacement")});
  eq(replaced.ok,true); eq((await preview(token)).code,"INVITE_INVALID");
  const replayAfterReplace=await make({operation,email:"replay@fixture.invalid",name:"Replay staff",token});
  eq(replayAfterReplace.invitation.status,"cancelled"); eq(replayAfterReplace.tokenMatched,false);
  eq((await manage("cancel",replaced.invitation,{token:null})).ok,true);
  // Tenant, verified email, native session and active owner/company enforcement.
  eq((await make({email:"tenant@fixture.invalid",business:otherCompany})).code,"FORBIDDEN");
  const ownTenantInvitation=await make({email:"tenant-same@fixture.invalid"});
  const otherTenantInvitation=await make({email:"tenant-same@fixture.invalid",business:otherCompany},otherOwner);
  eq(ownTenantInvitation.ok,true);eq(otherTenantInvitation.ok,true);yes(ownTenantInvitation.invitation.id!==otherTenantInvitation.invitation.id);
  yes(!(await team()).invitations.some(i=>i.id===otherTenantInvitation.invitation.id));
  yes(!(await team(otherOwner,otherCompany)).invitations.some(i=>i.id===ownTenantInvitation.invitation.id));
  eq((await make({email:"tenant@fixture.invalid"},wrong)).code,"FORBIDDEN");
  eq((await team(wrong)).code,"FORBIDDEN");
  eq((await make({email:"tenant@fixture.invalid"},unverified)).code,"UNVERIFIED");
  const unverifiedToken=hash("unverified");
  eq((await make({email:"unverified@fixture.invalid",token:unverifiedToken})).ok,true);
  eq((await accept(unverifiedToken,unverified)).code,"UNVERIFIED");
  eq(JSON.parse(await sql(`set request.jwt.claims=${lit(JSON.stringify({sub:owner,session_id:randomUUID(),role:"authenticated"}))};set role authenticated;${mutateStatement({email:"session@fixture.invalid"})}`)).code,"UNAUTHENTICATED");
  await sql(`update public.companies set status='suspended' where id='${company}'`);
  eq((await make({operation,email:"replay@fixture.invalid",name:"Replay staff",token})).code,"FORBIDDEN");
  await sql(`update public.companies set status='active' where id='${company}';update public.company_members set status='disabled' where company_id='${company}' and user_id='${owner}'`);
  eq((await make({operation,email:"replay@fixture.invalid",name:"Replay staff",token})).code,"FORBIDDEN");
  await sql(`update public.company_members set status='active' where company_id='${company}' and user_id='${owner}'`);
  // Competing creates and same-operation retries in independent native sessions.
  let races=await orderedRace(owner,mutateStatement({email:"race-create@fixture.invalid",token:hash("race-create-a")}),owner,mutateStatement({email:"race-create@fixture.invalid",token:hash("race-create-b")}));
  eq(races.map(r=>r.outcome),["created","existing"]); eq(races[0].invitation.id,races[1].invitation.id);
  eq(await count("private.staff_invitations","email='race-create@fixture.invalid' and cancelled_at is null and accepted_at is null"),"1");
  const raceOperation=randomUUID();
  races=await orderedRace(owner,mutateStatement({operation:raceOperation,email:"race-replay@fixture.invalid",token:hash("race-replay-a")}),owner,mutateStatement({operation:raceOperation,email:"race-replay@fixture.invalid",token:hash("race-replay-b")}));
  eq(races.map(r=>r.replayed),[false,true]); eq(races[1].tokenMatched,false);
  const replaceRace=await make({email:"race-replace@fixture.invalid"});
  const replaceOptions={action:"replace",email:null,name:null,id:replaceRace.invitation.id,revision:replaceRace.invitation.revision};
  races=await orderedRace(owner,mutateStatement({...replaceOptions,token:hash("race-replace-a")}),owner,mutateStatement({...replaceOptions,token:hash("race-replace-b")}));
  eq(races[0].ok,true); eq(races[1].code,"STALE_REVISION");
  // Cancellation/replacement versus acceptance use one recipient lock ordering.
  const raceAcceptToken=hash("race-accept-cancel"), raceAccept=await make({email:"wrong@fixture.invalid",token:raceAcceptToken});
  races=await orderedRace(owner,mutateStatement({action:"cancel",email:null,name:null,id:raceAccept.invitation.id,revision:raceAccept.invitation.revision,token:null}),wrong,acceptStatement(raceAcceptToken));
  eq(races[0].outcome,"cancelled"); eq(races[1].code,"INVITE_INVALID");
  const acceptFirstToken=hash("accept-first"),acceptFirst=await make({email:"wrong@fixture.invalid",token:acceptFirstToken});
  races=await orderedRace(wrong,acceptStatement(acceptFirstToken),owner,mutateStatement({action:"replace",email:null,name:null,id:acceptFirst.invitation.id,revision:acceptFirst.invitation.revision,token:hash("accept-first-replace")}));
  eq(races[0].ok,true); eq(races[1].code,"STALE_REVISION");
  const replaceActor=await fixtureActor("replace-first@fixture.invalid");
  const replaceFirstToken=hash("replace-first"),replaceFirstNewToken=hash("replace-first-new");
  const replaceFirst=await make({email:"replace-first@fixture.invalid",token:replaceFirstToken});
  races=await orderedRace(owner,mutateStatement({action:"replace",email:null,name:null,id:replaceFirst.invitation.id,revision:replaceFirst.invitation.revision,token:replaceFirstNewToken}),replaceActor,acceptStatement(replaceFirstToken));
  eq(races[0].outcome,"replaced");eq(races[1].code,"INVITE_INVALID");
  eq((await accept(replaceFirstNewToken,replaceActor)).ok,true);
  const cancelActor=await fixtureActor("accept-before-cancel@fixture.invalid"),acceptCancelToken=hash("accept-before-cancel");
  const acceptCancel=await make({email:"accept-before-cancel@fixture.invalid",token:acceptCancelToken});
  races=await orderedRace(cancelActor,acceptStatement(acceptCancelToken),owner,mutateStatement({action:"cancel",email:null,name:null,id:acceptCancel.invitation.id,revision:acceptCancel.invitation.revision,token:null}));
  eq(races[0].ok,true);eq(races[1].code,"STALE_REVISION");
  const createActor=await fixtureActor("create-accept@fixture.invalid"),createAcceptToken=hash("create-accept");
  await make({email:"create-accept@fixture.invalid",token:createAcceptToken});
  races=await orderedRace(owner,mutateStatement({email:"create-accept@fixture.invalid"}),createActor,acceptStatement(createAcceptToken));
  eq(races[0].outcome,"existing");eq(races[1].ok,true);
  const acceptCreateActor=await fixtureActor("accept-create@fixture.invalid"),acceptCreateToken=hash("accept-create");
  await make({email:"accept-create@fixture.invalid",token:acceptCreateToken});
  races=await orderedRace(acceptCreateActor,acceptStatement(acceptCreateToken),owner,mutateStatement({email:"accept-create@fixture.invalid"}));
  eq(races[0].ok,true);eq(races[1].code,"MEMBER_EXISTS");
  const acceptReplayActor=await fixtureActor("accept-race-replay@fixture.invalid"),acceptReplayToken=hash("accept-race-replay");
  await make({email:"accept-race-replay@fixture.invalid",token:acceptReplayToken});
  const acceptReplayAudits=Number(await count("public.admin_audit_logs"));
  races=await orderedRace(acceptReplayActor,acceptStatement(acceptReplayToken),acceptReplayActor,acceptStatement(acceptReplayToken));
  eq(races.map(r=>r.ok),[true,true]);
  eq(await count("public.admin_audit_logs"),String(acceptReplayAudits+1));
  // Successful cancel retry is durable; stale revisions cannot cancel newer links.
  const cancelRetryInvite=await make({email:"cancel-retry@fixture.invalid"}),cancelOperation=randomUUID();
  const cancelPayload={action:"cancel",email:null,name:null,id:cancelRetryInvite.invitation.id,revision:cancelRetryInvite.invitation.revision,token:null,operation:cancelOperation};
  const cancelRetry=await make(cancelPayload);eq(cancelRetry.outcome,"cancelled");
  eq((await make(cancelPayload)).replayed,true);
  const newerCancelInvite=await make({email:"cancel-retry@fixture.invalid"});
  eq((await manage("cancel",cancelRetryInvite.invitation,{token:null})).code,"STALE_REVISION");
  eq((await manage("cancel",newerCancelInvite.invitation,{token:null})).ok,true);
  const expiredToken=hash("expired-original"),expiredInvite=await make({email:"expired@fixture.invalid",token:expiredToken});
  await sql(`update private.staff_invitations set expires_at=clock_timestamp()-interval '1 second' where id='${expiredInvite.invitation.id}'`);
  eq((await preview(expiredToken)).code,"INVITE_INVALID");
  const expiredExisting=await make({email:"expired@fixture.invalid"});
  eq(expiredExisting.outcome,"existing");eq(expiredExisting.invitation.status,"expired");eq(expiredExisting.invitation.revision,expiredInvite.invitation.revision);
  const expiredReplacementToken=hash("expired-replacement");
  eq((await manage("replace",expiredExisting.invitation,{token:expiredReplacementToken})).outcome,"replaced");
  eq((await preview(expiredReplacementToken)).ok,true);
  // Every successful mutation is atomic with its audit record; injected audit fault rolls back.
  const auditTargetToken=hash("audit-target"),auditTarget=await make({email:"audit-target@fixture.invalid",token:auditTargetToken});
  const auditActor=await fixtureActor("audit-target@fixture.invalid");
  const auditTargetBefore=await sql(`select to_jsonb(i) from private.staff_invitations i where id='${auditTarget.invitation.id}'`);
  const auditEpochBefore=await inputEpoch();
  await sql(`create function private.fixture_reject_audit() returns trigger language plpgsql as $$begin raise exception 'FIXTURE_AUDIT_FAILURE';end;$$;
    create trigger fixture_audit_failure before insert on public.admin_audit_logs for each row execute function private.fixture_reject_audit();`);
  const auditCount=await count("public.admin_audit_logs"),inviteCount=await count("private.staff_invitations"),operationCount=await count("private.staff_invitation_operations");
  await assert.rejects(()=>make({email:"audit-fault@fixture.invalid"}),/FIXTURE_AUDIT_FAILURE/); assertions++;
  eq(await count("public.admin_audit_logs"),auditCount); eq(await count("private.staff_invitations"),inviteCount); eq(await count("private.staff_invitation_operations"),operationCount);
  await assert.rejects(()=>manage("replace",auditTarget.invitation),/FIXTURE_AUDIT_FAILURE/);assertions++;
  eq(await sql(`select to_jsonb(i) from private.staff_invitations i where id='${auditTarget.invitation.id}'`),auditTargetBefore);
  eq(await count("private.staff_invitations"),inviteCount);eq(await count("private.staff_invitation_operations"),operationCount);
  await assert.rejects(()=>manage("cancel",auditTarget.invitation,{token:null}),/FIXTURE_AUDIT_FAILURE/);assertions++;
  eq(await sql(`select to_jsonb(i) from private.staff_invitations i where id='${auditTarget.invitation.id}'`),auditTargetBefore);
  await assert.rejects(()=>accept(auditTargetToken,auditActor),/FIXTURE_AUDIT_FAILURE/);assertions++;
  eq(await count("public.company_members",`company_id='${company}' and user_id='${auditActor}'`),"0");
  eq(await sql(`select to_jsonb(i) from private.staff_invitations i where id='${auditTarget.invitation.id}'`),auditTargetBefore);
  eq(await count("public.admin_audit_logs"),auditCount);
  eq(await inputEpoch(),auditEpochBefore);
  await sql("drop trigger fixture_audit_failure on public.admin_audit_logs;drop function private.fixture_reject_audit()");
  eq((await make({email:"audit-fault@fixture.invalid"})).ok,true);
  eq((await accept(auditTargetToken,auditActor)).ok,true);
  eq(await inputEpoch(),String(Number(auditEpochBefore)+1));
  const acceptedAuditCount=await count("public.admin_audit_logs");
  eq((await accept(auditTargetToken,auditActor)).ok,true);
  eq(await count("public.admin_audit_logs"),acceptedAuditCount);
  eq(await inputEpoch(),String(Number(auditEpochBefore)+1));
  // Hashes and mailbox/name material are absent from audit/operation result surfaces.
  const auditText=await sql("select coalesce(jsonb_agg(to_jsonb(a))::text,'[]') from public.admin_audit_logs a");
  yes(!auditText.includes(token)); yes(!auditText.includes("replay@fixture.invalid")); yes(!auditText.includes("Replay staff"));
  const operationText=await sql("select jsonb_agg(to_jsonb(o))::text from private.staff_invitation_operations o");
  yes(!operationText.includes(token));
  for(const table of ["staff_invitations","staff_invitation_recipients","staff_invitation_operations"]){
    eq(await sql(`select has_table_privilege('authenticated','private.${table}','SELECT') or has_table_privilege('anon','private.${table}','SELECT')`),"f");
    eq(await sql(`select relrowsecurity from pg_class where oid='private.${table}'::regclass`),"t");
  }
  eq(await sql("select has_function_privilege('anon','public.mutate_staff_invitation(uuid,uuid,text,text,text,uuid,integer,text)','EXECUTE')"),"f");
  eq(await sql("select has_function_privilege('authenticated','public.mutate_staff_invitation(uuid,uuid,text,text,text,uuid,integer,text)','EXECUTE')"),"t");
  eq(await sql("select has_function_privilege('authenticated','public.create_staff_invitation(uuid,text,text,text)','EXECUTE')"),"t");
  const finalTeam=await team();
  yes(!JSON.stringify(finalTeam).includes("token_hash"));
  // Emergency RPC containment is reversible and does not rewrite persisted history.
  const snapshot=async()=>sql(`select jsonb_build_object(
    'invitations',(select jsonb_agg(to_jsonb(i) order by id) from private.staff_invitations i),
    'operations',(select jsonb_agg(to_jsonb(o) order by operation_id) from private.staff_invitation_operations o),
    'members',(select jsonb_agg(to_jsonb(m) order by company_id,user_id) from public.company_members m),
    'grants',(select jsonb_agg(to_jsonb(g) order by company_id,user_id) from public.company_member_grants g),
    'epochs',(select jsonb_agg(to_jsonb(e) order by company_id) from private.g03_company_inputs e),
    'audits',(select jsonb_agg(to_jsonb(a) order by id) from public.admin_audit_logs a))`);
  const beforeContainment=await snapshot();
  const contained=await sql(`begin;
    revoke execute on function public.mutate_staff_invitation(uuid,uuid,text,text,text,uuid,integer,text) from authenticated;
    revoke execute on function public.accept_staff_invitation(text) from authenticated;
    revoke execute on function public.read_staff_invitation(text) from authenticated,anon;
    select has_function_privilege('authenticated','public.mutate_staff_invitation(uuid,uuid,text,text,text,uuid,integer,text)','EXECUTE')
      or has_function_privilege('authenticated','public.accept_staff_invitation(text)','EXECUTE')
      or has_function_privilege('authenticated','public.read_staff_invitation(text)','EXECUTE')
      or has_function_privilege('anon','public.read_staff_invitation(text)','EXECUTE');
    ${auth(owner)}
    do $$begin
      perform public.mutate_staff_invitation('${company}','${randomUUID()}','create','contained@fixture.invalid','Contained',null,null,'${hash("contained")}');
      raise exception 'MUTATE_CONTAINMENT_FAILED';
    exception when insufficient_privilege then null;end$$;
    do $$begin perform public.accept_staff_invitation('${repairHash}');raise exception 'ACCEPT_CONTAINMENT_FAILED';
    exception when insufficient_privilege then null;end$$;
    do $$begin perform public.read_staff_invitation('${repairHash}');raise exception 'READ_CONTAINMENT_FAILED';
    exception when insufficient_privilege then null;end$$;
    reset role;set role anon;
    do $$begin perform public.read_staff_invitation('${repairHash}');raise exception 'ANON_CONTAINMENT_FAILED';
    exception when insufficient_privilege then null;end$$;
    reset role;rollback;`);
  eq(contained,"f");eq(await snapshot(),beforeContainment);
  eq(await sql("select has_function_privilege('authenticated','public.mutate_staff_invitation(uuid,uuid,text,text,text,uuid,integer,text)','EXECUTE') and has_function_privilege('authenticated','public.accept_staff_invitation(text)','EXECUTE') and has_function_privilege('authenticated','public.read_staff_invitation(text)','EXECUTE') and has_function_privilege('anon','public.read_staff_invitation(text)','EXECUTE')"),"t");
  eq((await make({operation,email:"replay@fixture.invalid",name:"Replay staff",token})).replayed,true);
  eq((await accept(repairHash)).ok,true);eq(await snapshot(),beforeContainment);
  console.log(`Staff invitation native PostgreSQL tests passed: ${assertions} assertions; legacy containment/recovery, replay, races, tenant/session/owner gates, audit rollback, G03 epoch trigger, reversible RPC containment, grants and history.`);
} finally { await cleanup(); }
