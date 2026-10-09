import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { isolatedPostgres, lit } from "./postgres.mjs";

const db = await isolatedPostgres();
let passed = 0;
let migrationLegacy;
const uuid = label => {
  const h = createHash("md5").update(label).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
const platform = { user: uuid("g03-synthetic-platform-owner"), sid: uuid("g03-platform-session") };
const actorSql = actor => `SET LOCAL ROLE authenticated; SET LOCAL "request.jwt.claim.sub"=${lit(actor.user)}; SET LOCAL "request.jwt.claims"=${lit(JSON.stringify({ sub: actor.user, session_id: actor.sid, role: "authenticated" }))};`;
const rpcSql = (name, args) => `SELECT to_jsonb(public.${name}(${args}));`;
const asActor = async (actor, query) => db.sql(`BEGIN; ${actorSql(actor)} ${query} COMMIT;`);
const rpc = async (actor, name, args) => JSON.parse(await asActor(actor, rpcSql(name,args)));
const args = (action,c,revision=null,ownership="new",number="",note="") => [lit(action),lit(c.company),revision??"null",action==="approve"||action==="request_changes"?"null":lit(ownership),action==="approve"||action==="request_changes"?"null":lit(number),action==="approve"||action==="request_changes"?"null":"true",note?lit(note):"null"].join(",");
async function fixture(label) {
  const c = { company: uuid(`company-${label}`), source: uuid(`source-${label}`), user: uuid(`owner-${label}`), sid: uuid(`session-${label}`) };
  await db.sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${lit(c.user)},${lit(`synthetic-${label}@example.invalid`)},now());
    INSERT INTO auth.sessions(id,user_id) VALUES(${lit(c.sid)},${lit(c.user)});
    INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(c.sid)},${lit(c.user)},clock_timestamp());
    INSERT INTO public.companies(id,display_name,business_type,hours,created_by) VALUES(${lit(c.company)},'Synthetic business','restaurant','09:00–18:00',${lit(c.user)});
    INSERT INTO public.company_members(company_id,user_id,role,status) VALUES(${lit(c.company)},${lit(c.user)},'owner','active');
    INSERT INTO public.knowledge_sources(id,company_id,kind,title,content,status,created_by) VALUES(${lit(c.source)},${lit(c.company)},'text','Approved synthetic menu','Tea costs 1 OMR.','ready',${lit(c.user)});`);
  await rpc(c,"set_knowledge_source_approval",`${lit(c.source)},true`);
  return c;
}
async function prepare(actor, action, c, revision=null, ownership="new", number="", note="") {
  const result = await rpc(actor,"g03_begin_review_check",args(action,c,revision,ownership,number,note));
  if (!result.ok) return result;
  const observations = (result.files??[]).map(f => ({ source_id:f.id,sha256:f.prepared_file_sha256,byte_size:f.byte_size,object_id:uuid(`object-${f.id}`),object_updated_at:"2026-10-10T00:00:00Z",observed_at:new Date().toISOString() }));
  const done = JSON.parse(await db.sql(`BEGIN; SET LOCAL ROLE service_role; SELECT public.g03_complete_review_check(${lit(result.check_id)},${lit(JSON.stringify(observations))}::jsonb); COMMIT;`));
  assert.equal(done.ok,true,JSON.stringify(done));
  return result;
}
async function transition(actor,action,c,revision=null,ownership="new",number="",note="") {
  const proof = await prepare(actor,action,c,revision,ownership,number,note);
  if (!proof.ok) return proof;
  return rpc(actor,"transition_company_review",args(action,c,revision,ownership,number,note));
}
async function caseOf(name,test) {
  if(process.argv.includes("--lock-regressions-only")&&!name.includes("[lock-order]"))return;
  if(process.argv.includes("--read-authorization-only")&&!name.includes("[read-auth]"))return;
  await test(); passed++; console.log(`PASS ${name}`);
}
async function waitFor(query) {
  const until=Date.now()+5000;
  while(Date.now()<until) { if(await db.sql(query)==="t")return; await new Promise(r=>setTimeout(r,30)); }
  throw Error(`LOCK_OBSERVATION_TIMEOUT: ${query}`);
}
async function holding(query,name) {
  const s=db.session(`BEGIN; SELECT pg_backend_pid(); ${query} SELECT 'HELD';`,name,{keepOpen:true});
  // Register rejection immediately; callers subsequently await the same result.
  s.done.catch(()=>{});
  const until=Date.now()+5000;
  while(!s.output().includes("HELD")) {
    if(Date.now()>until) { s.child.stdin.end("ROLLBACK;\n"); await s.done; throw Error("HOLDER_TIMEOUT"); }
    await new Promise(r=>setTimeout(r,20));
  }
  let released=false;
  return { ...s, pid:Number(s.output().split("\n")[0]),release:()=>{if(!released){released=true;s.child.stdin.end("COMMIT;\n");}} };
}
const sessionResult=output=>JSON.parse(output.trim().split("\n").at(-1));
async function conflictingDecisionWhilePaused(a,b,gate,waiterName) {
  let finished=false;
  b.done.finally(()=>{finished=true;}).catch(()=>{});
  // For RED, release the injected pause once the old implementation waits;
  // the actual two RPCs then expose their inverse lock ordering to PostgreSQL.
  const observer=(async()=>{
    const until=Date.now()+5000;
    while(!finished&&Date.now()<until) {
      if(await db.sql(`SELECT coalesce(bool_or(wait_event_type='Lock'),false) FROM pg_stat_activity WHERE application_name=${lit(waiterName)};`)==="t") {gate.release();return;}
      await new Promise(r=>setTimeout(r,20));
    }
  })();
  try {
    const output=await b.done;
    assert.equal(sessionResult(output).code,"CONFLICT");
    assert.notEqual(Number(output.split("\n")[0]),Number(a.output().split("\n")[0]),"independent backends required");
    if(!gate.child.stdin.destroyed)gate.release();
    await gate.done;await a.done;await observer;
  } finally {
    if(!gate.child.stdin.destroyed)gate.release();
    await Promise.allSettled([gate.done,a.done,b.done,observer]);
  }
}
try {
  console.log(`G03 isolated PostgreSQL: ${db.container}`);
  console.log(`Migrations applied: ${await db.bootstrap({ omitG03: process.argv.includes("--baseline"), beforeG03: async()=>{
    migrationLegacy=await fixture("before-migration");
    const file=uuid("before-migration-file");migrationLegacy.file=file;
    await db.sql(`INSERT INTO public.knowledge_sources(id,company_id,kind,title,content,status,file_name,content_type,byte_size,storage_path,created_by) VALUES(${lit(file)},${lit(migrationLegacy.company)},'file','Historical file','historical extraction','ready','menu.txt','text/plain',3,${lit(`${migrationLegacy.company}/${file}/menu.txt`)},${lit(migrationLegacy.user)});`);
    await rpc(migrationLegacy,"set_knowledge_source_approval",`${lit(file)},true`);
    assert.equal((await rpc(migrationLegacy,"transition_company_review",args("submit",migrationLegacy))).ok,true);
    assert.equal((await rpc(platform,"transition_company_review",args("approve",migrationLegacy,1))).ok,true);
  } })}`);
  await db.sql(`INSERT INTO auth.sessions(id,user_id) VALUES(${lit(platform.sid)},${lit(platform.user)}); INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(platform.sid)},${lit(platform.user)},clock_timestamp());`);
  if(process.argv.includes("--red-lock-order")) {
    // Test database only: reconstruct the pre-review lock behavior from the
    // installed function definitions. Never touches a source file/cloud DB.
    for(const signature of ["private.g03_lock_actor(uuid,text,uuid)","public.transition_company_review(text,uuid,integer,text,text,boolean,text)"]){
      let definition=await db.sql(`SELECT pg_get_functiondef(${lit(signature)}::regprocedure);`);
      definition=definition.replace(/\bnowait\b/gi,"");
      if(signature.startsWith("private")){
        definition=definition.replace("perform 1 from auth.users", "perform public.check_app_session(false);\n  perform 1 from auth.users");
        const grants=definition.match(/  perform 1 from public.company_member_grants[^;]+;/)?.[0];
        if(!grants)throw Error("RED_LOCK_FIXTURE_CHANGED");
        definition=definition.replace(grants,"").replace("  perform 1 from public.platform_admins",`${grants}\n  perform 1 from public.platform_admins`);
      }
      await db.sql(definition);
    }
  }
  await caseOf("forged browser readiness cannot submit directly",async()=>{
    const c=await fixture("forged");
    const result=await rpc(c,"transition_company_review",args("submit",c));
    assert.equal(result.ok,false,"baseline improperly accepts a browser readiness flag");
    assert.equal(result.code,"PROOF_REQUIRED");
    assert.equal(await db.sql(`SELECT count(*) FROM public.company_review_requests WHERE company_id=${lit(c.company)};`),"0");
  });
  if(process.argv.includes("--baseline"))throw Error("BASELINE_UNEXPECTEDLY_PASSED");
  await caseOf("upgrade preserves existing approved rows/history without inventing file proof",async()=>{
    const old=migrationLegacy;
    assert.equal(await db.sql(`SELECT content||':'||approved_for_answers::text||':'||(prepared_file_sha256 IS NULL)::text FROM public.knowledge_sources WHERE id=${lit(old.file)};`),"historical extraction:true:true");
    const review=await rpc(old,"g03_read_review_request",lit(old.company));
    assert.equal(review.status,"approved");assert.equal(review.revision,2);assert.equal(review.proof_current,false);
    assert.equal((await prepare(old,"resubmit",old,2)).code,"FILE_REPREPARE_REQUIRED");
    assert.equal(await db.sql(`SELECT count(*) FROM public.admin_audit_logs WHERE company_id=${lit(old.company)} AND action LIKE 'review.%';`),"2");
  });
  await caseOf("text knowledge, no paid subscription or Meta link: submit and approve",async()=>{
    const c=await fixture("happy");
    const result=await transition(c,"submit",c,null,"own","+96800000000");
    assert.equal(result.ok,true); assert.equal(result.request.proof_current,true);
    assert.equal(result.request.number_ownership,"own"); assert.equal(result.request.whatsapp_number,"+96800000000");
    const approved=await transition(platform,"approve",c,1);
    assert.equal(approved.request.status,"approved");assert.equal(approved.request.revision,2);
    assert.equal(await db.sql(`SELECT status FROM public.companies WHERE id=${lit(c.company)};`),"setup");
    assert.equal(await db.sql(`SELECT count(*) FROM public.billing_subscriptions WHERE company_id=${lit(c.company)};`),"0");
  });
  await caseOf("same submit has one effect; changed intent and approval replay conflict",async()=>{
    const c=await fixture("replay");assert.equal((await transition(c,"submit",c)).ok,true);
    assert.equal((await transition(c,"submit",c)).code,"EXISTING");
    assert.equal((await transition(c,"submit",c,null,"own","+96800000000")).code,"CONFLICT");
    assert.equal(await db.sql(`SELECT count(*) FROM public.admin_audit_logs WHERE company_id=${lit(c.company)} AND action='review.submit';`),"1");
    assert.equal((await transition(platform,"approve",c,1)).ok,true);
    assert.equal((await transition(platform,"approve",c,1)).code,"CONFLICT");
    assert.equal(await db.sql(`SELECT count(*) FROM public.admin_audit_logs WHERE company_id=${lit(c.company)} AND action='review.approve';`),"1");
  });
  await caseOf("knowledge edit invalidates submission; explicit resubmit preserves history",async()=>{
    const c=await fixture("edit");await transition(c,"submit",c);
    await asActor(c,`UPDATE public.knowledge_sources SET content='New synthetic menu' WHERE id=${lit(c.source)};`);
    assert.equal((await rpc(c,"g03_read_review_request",lit(c.company))).proof_current,false);
    assert.equal((await prepare(platform,"approve",c,1)).code,"CONFLICT");
    assert.equal((await prepare(c,"resubmit",c,1)).code,"KNOWLEDGE_INCOMPLETE");
    await rpc(c,"set_knowledge_source_approval",`${lit(c.source)},true`);
    assert.equal((await transition(c,"resubmit",c,1)).request.revision,2);
    assert.equal(await db.sql(`SELECT count(*) FROM public.admin_audit_logs WHERE company_id=${lit(c.company)} AND action LIKE 'review.%';`),"2");
  });
  await caseOf("revoke/reapprove ABA and new source insertion invalidate an in-flight check",async()=>{
    const c=await fixture("aba");await prepare(c,"submit",c);
    await rpc(c,"set_knowledge_source_approval",`${lit(c.source)},false`);await rpc(c,"set_knowledge_source_approval",`${lit(c.source)},true`);
    assert.equal((await rpc(c,"transition_company_review",args("submit",c))).code,"CONFLICT");
    await prepare(c,"submit",c);
    await asActor(c,`INSERT INTO public.knowledge_sources(company_id,kind,title,content,status,created_by) VALUES(${lit(c.company)},'text','New draft','draft body','draft',${lit(c.user)});`);
    assert.equal((await rpc(c,"transition_company_review",args("submit",c))).code,"CONFLICT");
  });
  await caseOf("legacy approved file is retained but requires re-preparation",async()=>{
    const c=await fixture("legacy-file"), file=uuid("legacy-file-id");
    await db.sql(`INSERT INTO public.knowledge_sources(id,company_id,kind,title,content,status,file_name,content_type,byte_size,storage_path,created_by) VALUES(${lit(file)},${lit(c.company)},'file','Legacy','old extraction','ready','menu.txt','text/plain',3,${lit(`${c.company}/${file}/menu.txt`)},${lit(c.user)});`);
    await rpc(c,"set_knowledge_source_approval",`${lit(file)},true`);
    assert.equal((await prepare(c,"submit",c)).code,"FILE_REPREPARE_REQUIRED");
    assert.equal(await db.sql(`SELECT content||':'||(prepared_file_sha256 IS NULL)::text FROM public.knowledge_sources WHERE id=${lit(file)};`),"old extraction:true");
  });
  await caseOf("legacy review history is unverified, explicitly re-submittable",async()=>{
    const c=await fixture("legacy-review");
    await db.sql(`INSERT INTO public.company_review_requests(company_id,requested_by,number_ownership,whatsapp_number,readiness_confirmed,status,revision) VALUES(${lit(c.company)},${lit(c.user)},'new','',true,'approved',4);`);
    assert.equal((await rpc(c,"g03_read_review_request",lit(c.company))).proof_current,false);
    assert.equal((await transition(c,"resubmit",c,4)).request.revision,5);
  });
  await caseOf("tenant isolation, service-only completion and protected extraction columns",async()=>{
    const a=await fixture("tenant-a"),b=await fixture("tenant-b");
    await assert.rejects(rpc(b,"g03_begin_review_check",args("submit",a)),/forbidden/);
    await assert.rejects(rpc(b,"g03_read_review_request",lit(a.company)),/forbidden/);
    await assert.rejects(rpc(a,"g03_complete_review_check",`${lit(uuid("check"))},'[]'::jsonb`),/permission denied/);
    await assert.rejects(asActor(a,`UPDATE public.knowledge_sources SET prepared_file_sha256=repeat('a',64) WHERE id=${lit(a.source)};`),/permission denied/);
  });
  await caseOf("owner revocation and session expiry during Storage I/O block final write",async()=>{
    const c=await fixture("revoked");await prepare(c,"submit",c);
    await db.sql(`UPDATE public.company_members SET status='disabled' WHERE company_id=${lit(c.company)} AND user_id=${lit(c.user)};`);
    await assert.rejects(rpc(c,"transition_company_review",args("submit",c)),/forbidden/);
    const expired=await fixture("expired");await prepare(expired,"submit",expired);
    await db.sql(`UPDATE private.app_session_activity SET expired_at=clock_timestamp() WHERE session_id=${lit(expired.sid)};`);
    await assert.rejects(rpc(expired,"transition_company_review",args("submit",expired)),/session_expired/);
  });
  await caseOf("distinct PostgreSQL backends serialize concurrent same submit",async()=>{
    const c=await fixture("concurrent-submit");await prepare(c,"submit",c);await prepare(c,"submit",c);
    const a=await holding(`${actorSql(c)} ${rpcSql("transition_company_review",args("submit",c))}`,"g03-submit-a");
    const b=db.session(`BEGIN; ${actorSql(c)} ${rpcSql("transition_company_review",args("submit",c))} COMMIT;`,"g03-submit-b");
    b.done.catch(()=>{});
    try {
      const result=JSON.parse(await b.done);assert.equal(result.code,"CONFLICT");
      a.release();await a.done;assert.equal((await transition(c,"submit",c)).code,"EXISTING");
      assert.equal(await db.sql(`SELECT count(*) FROM public.admin_audit_logs WHERE company_id=${lit(c.company)} AND action='review.submit';`),"1");
    } finally {if(!a.child.stdin.destroyed)a.release();}
  });
  await caseOf("knowledge writer first: final review waits for commit and rejects stale epoch",async()=>{
    const c=await fixture("writer-first");await prepare(c,"submit",c);
    const a=await holding(`${actorSql(c)} UPDATE public.knowledge_sources SET title='changed title' WHERE id=${lit(c.source)};`,"g03-edit-a");
    const b=db.session(`BEGIN; ${actorSql(c)} ${rpcSql("transition_company_review",args("submit",c))} COMMIT;`,"g03-edit-b");b.done.catch(()=>{});
    try {assert.equal(JSON.parse(await b.done).code,"CONFLICT");a.release();await a.done;assert.equal((await rpc(c,"transition_company_review",args("submit",c))).code,"CONFLICT");}
    finally {if(!a.child.stdin.destroyed)a.release();}
  });
  await caseOf("decision first: edit waits, then makes committed evidence stale",async()=>{
    const c=await fixture("decision-first");await prepare(c,"submit",c);
    const a=await holding(`${actorSql(c)} ${rpcSql("transition_company_review",args("submit",c))}`,"g03-decision-a");
    const b=db.session(`BEGIN; ${actorSql(c)} UPDATE public.knowledge_sources SET title='after decision' WHERE id=${lit(c.source)}; COMMIT;`,"g03-decision-b");b.done.catch(()=>{});
    try {await waitFor("SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE application_name='g03-decision-b';");a.release();await a.done;await b.done;assert.equal((await rpc(c,"g03_read_review_request",lit(c.company))).proof_current,false);}
    finally {if(!a.child.stdin.destroyed)a.release();}
  });
  await caseOf("trusted preparation binds extracted text and file hash; edits clear only the proof",async()=>{
    const c=await fixture("prepared-file"),source=uuid("prepared-source"),object=uuid(`object-${source}`),path=`${c.company}/${source}/menu.txt`;
    const fileHash=createHash("sha256").update("abc").digest("hex"),text="Synthetic extracted text";
    await db.sql(`INSERT INTO storage.objects(id,bucket_id,name,owner,updated_at) VALUES(${lit(object)},'company-knowledge',${lit(path)},${lit(c.user)},'2026-10-10T00:00:00Z');
      INSERT INTO public.knowledge_sources(id,company_id,kind,title,content,status,file_name,content_type,byte_size,storage_path,created_by) VALUES(${lit(source)},${lit(c.company)},'file','Prepared','','processing','menu.txt','text/plain',3,${lit(path)},${lit(c.user)});`);
    const pubArgs=[lit(c.user),lit(c.sid),lit(source),lit(c.company),1,lit(path),lit(text),lit(fileHash),3,lit(object),lit("2026-10-10T00:00:00Z")].join(",");
    await assert.rejects(rpc(c,"g03_publish_prepared_file",pubArgs),/permission denied/);
    const result=JSON.parse(await db.sql(`BEGIN; SET LOCAL ROLE service_role; ${rpcSql("g03_publish_prepared_file",pubArgs)} COMMIT;`));
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(result.source.prepared_file_sha256,fileHash);
    assert.equal(result.source.prepared_text_sha256,createHash("sha256").update(text).digest("hex"));
    assert.equal(result.source.prepared_content_version,result.source.content_version);
    assert.equal(result.source.approved_for_answers,false);
    await rpc(c,"set_knowledge_source_approval",`${lit(source)},true`);
    assert.equal((await transition(c,"submit",c)).ok,true);
    await asActor(c,`UPDATE public.knowledge_sources SET content='edited extraction' WHERE id=${lit(source)};`);
    assert.equal(await db.sql(`SELECT prepared_file_sha256 IS NULL AND NOT approved_for_answers FROM public.knowledge_sources WHERE id=${lit(source)};`),"t");
    assert.equal((await rpc(c,"g03_read_review_request",lit(c.company))).proof_current,false);
    assert.equal(await db.sql(`SELECT count(*) FROM storage.objects WHERE id=${lit(object)};`),"1");
  });
  await caseOf("Storage generation changes block stale preparation and clear review evidence",async()=>{
    const c=await fixture("storage-change"),source=uuid("changed-file"),object=uuid(`object-${source}`),path=`${c.company}/${source}/menu.txt`;
    await db.sql(`INSERT INTO storage.objects(id,bucket_id,name,owner,updated_at) VALUES(${lit(object)},'company-knowledge',${lit(path)},${lit(c.user)},'2026-10-10T00:00:00Z');
      INSERT INTO public.knowledge_sources(id,company_id,kind,title,content,status,file_name,content_type,byte_size,storage_path,created_by) VALUES(${lit(source)},${lit(c.company)},'file','File','','processing','menu.txt','text/plain',3,${lit(path)},${lit(c.user)});`);
    await prepare(c,"submit",c);
    await db.sql(`UPDATE storage.objects SET updated_at='2026-10-10T00:01:00Z' WHERE id=${lit(object)};`);
    const pubArgs=[lit(c.user),lit(c.sid),lit(source),lit(c.company),1,lit(path),lit("abc"),lit(createHash("sha256").update("abc").digest("hex")),3,lit(object),lit("2026-10-10T00:00:00Z")].join(",");
    const publication=JSON.parse(await db.sql(`BEGIN; SET LOCAL ROLE service_role; ${rpcSql("g03_publish_prepared_file",pubArgs)} COMMIT;`));
    assert.equal(publication.code,"CONFLICT");
    assert.equal((await rpc(c,"transition_company_review",args("submit",c))).code,"CONFLICT");
  });
  await caseOf("a revoked requester blocks approval even after the preflight passed",async()=>{
    const c=await fixture("approve-owner-revoked");await transition(c,"submit",c);await prepare(platform,"approve",c,1);
    await db.sql(`UPDATE public.company_members SET status='disabled' WHERE company_id=${lit(c.company)} AND user_id=${lit(c.user)};`);
    await assert.rejects(rpc(platform,"transition_company_review",args("approve",c,1)),/requester_revoked/);
    assert.equal(await db.sql(`SELECT status FROM public.company_review_requests WHERE company_id=${lit(c.company)};`),"pending_review");
  });
  await caseOf("delegated reviewer scope revocation while a decision waits denies approval",async()=>{
    const c=await fixture("scope-revoke"),reviewer={user:uuid("delegated-reviewer"),sid:uuid("delegated-session")};
    await db.sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${lit(reviewer.user)},'reviewer@example.invalid',now()); INSERT INTO auth.sessions(id,user_id) VALUES(${lit(reviewer.sid)},${lit(reviewer.user)}); INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(reviewer.sid)},${lit(reviewer.user)},clock_timestamp()); INSERT INTO public.platform_admins(user_id,role,status) VALUES(${lit(reviewer.user)},'delegated','active'); INSERT INTO public.platform_admin_scopes(admin_user_id,company_id,usable_capabilities) VALUES(${lit(reviewer.user)},${lit(c.company)},ARRAY['platform.manage_companies']);`);
    await transition(c,"submit",c);await prepare(reviewer,"approve",c,1);
    const a=await holding(`UPDATE public.platform_admin_scopes SET usable_capabilities='{}' WHERE admin_user_id=${lit(reviewer.user)} AND company_id=${lit(c.company)};`,"g03-revoke-scope-a");
    const b=db.session(`BEGIN; ${actorSql(reviewer)} ${rpcSql("transition_company_review",args("approve",c,1))} COMMIT;`,"g03-revoke-scope-b");b.done.catch(()=>{});
    try {assert.equal(JSON.parse(await b.done).code,"CONFLICT");a.release();await a.done;await assert.rejects(rpc(reviewer,"transition_company_review",args("approve",c,1)),/forbidden/);}
    finally {if(!a.child.stdin.destroyed)a.release();}
    assert.equal(await db.sql(`SELECT status FROM public.company_review_requests WHERE company_id=${lit(c.company)};`),"pending_review");
  });
  await caseOf("profile edits and source deletion invalidate evidence; caller cannot supply a snapshot",async()=>{
    const c=await fixture("profile-change");await prepare(c,"submit",c);
    await asActor(c,`UPDATE public.companies SET hours='new hours' WHERE id=${lit(c.company)};`);
    assert.equal((await rpc(c,"transition_company_review",args("submit",c))).code,"CONFLICT");
    await prepare(c,"submit",c);await asActor(c,`DELETE FROM public.knowledge_sources WHERE id=${lit(c.source)};`);
    assert.equal((await rpc(c,"transition_company_review",args("submit",c))).code,"CONFLICT");
    assert.equal((await prepare(c,"submit",c)).code,"KNOWLEDGE_INCOMPLETE");
    await assert.rejects(asActor(c,`UPDATE public.company_review_requests SET submitted_manifest='{}' WHERE company_id=${lit(c.company)};`),/permission denied/);
  });
  await caseOf("audit failure rolls back review and check consumption atomically",async()=>{
    const c=await fixture("rollback");const check=await prepare(c,"submit",c);
    await db.sql(`CREATE FUNCTION private.g03_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF new.company_id=${lit(c.company)}::uuid THEN RAISE EXCEPTION 'synthetic_audit_failure'; END IF; RETURN new; END $$; CREATE TRIGGER g03_test_audit_failure BEFORE INSERT ON public.admin_audit_logs FOR EACH ROW EXECUTE FUNCTION private.g03_test_reject_audit();`);
    try {await assert.rejects(rpc(c,"transition_company_review",args("submit",c)),/synthetic_audit_failure/);}
    finally {await db.sql("DROP TRIGGER g03_test_audit_failure ON public.admin_audit_logs; DROP FUNCTION private.g03_test_reject_audit();");}
    assert.equal(await db.sql(`SELECT count(*) FROM public.company_review_requests WHERE company_id=${lit(c.company)};`),"0");
    assert.equal(await db.sql(`SELECT consumed_at IS NULL FROM private.g03_review_checks WHERE id=${lit(check.check_id)};`),"t");
    assert.equal((await rpc(c,"transition_company_review",args("submit",c))).ok,true);
  });
  await caseOf("a stale check expires without adding a review or changing readiness flags",async()=>{
    const c=await fixture("proof-expired");const proof=await prepare(c,"submit",c);
    await db.sql(`UPDATE private.g03_review_checks SET created_at=clock_timestamp()-interval '61 seconds' WHERE id=${lit(proof.check_id)};`);
    assert.equal((await rpc(c,"transition_company_review",args("submit",c))).code,"PROOF_REQUIRED");
    assert.equal(await db.sql(`SELECT count(*) FROM public.company_review_requests WHERE company_id=${lit(c.company)};`),"0");
  });
  await caseOf("[lock-order] actual owner profile RPC versus final admin approval",async()=>{
    const c=await fixture("profile-rpc-lock");await transition(c,"submit",c);await prepare(platform,"approve",c,1);
    const key=7300301;
    await db.sql(`CREATE FUNCTION private.g03_test_pause_profile() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN IF new.id=${lit(c.company)}::uuid THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN new; END $$; CREATE TRIGGER g03_test_pause_profile AFTER UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION private.g03_test_pause_profile();`);
    const gate=await holding(`SELECT pg_advisory_xact_lock(${key});`,"g03-profile-gate");
    const a=db.session(`BEGIN; SELECT pg_backend_pid(); ${actorSql(c)} ${rpcSql("upsert_selected_owner_company",`${lit(c.company)},'Updated business','restaurant','both','OM','Muscat','new hours','','','Owner'`)} COMMIT;`,"g03-profile-rpc-a");a.done.catch(()=>{});
    try {
      await waitFor("SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE application_name='g03-profile-rpc-a';");
      const b=db.session(`BEGIN; SELECT pg_backend_pid(); ${actorSql(platform)} ${rpcSql("transition_company_review",args("approve",c,1))} COMMIT;`,"g03-profile-rpc-b");b.done.catch(()=>{});
      await conflictingDecisionWhilePaused(a,b,gate,"g03-profile-rpc-b");
      assert.equal(await db.sql(`SELECT status FROM public.company_review_requests WHERE company_id=${lit(c.company)};`),"pending_review");
    } finally {if(!gate.child.stdin.destroyed)gate.release();await Promise.allSettled([gate.done,a.done]);await db.sql("DROP TRIGGER g03_test_pause_profile ON public.companies; DROP FUNCTION private.g03_test_pause_profile();");}
  });
  await caseOf("[lock-order] actual scope and role revocation RPCs with dependent grants",async()=>{
    for(const mode of ["scope","role"]){
      const c=await fixture(`access-rpc-${mode}`),manager=uuid(`manager-${mode}`),staff=uuid(`staff-${mode}`),key=mode==="scope"?7300302:7300303;
      await db.sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${lit(manager)},${lit(`manager-${mode}@example.invalid`)},now()),(${lit(staff)},${lit(`staff-${mode}@example.invalid`)},now()); INSERT INTO public.platform_admins(user_id,role,status) VALUES(${lit(manager)},'delegated','active'); INSERT INTO public.platform_admin_scopes(admin_user_id,company_id,usable_capabilities,delegable_capabilities) VALUES(${lit(manager)},${lit(c.company)},ARRAY['knowledge.write'],ARRAY['knowledge.write']); INSERT INTO public.company_members(company_id,user_id,role) VALUES(${lit(c.company)},${lit(staff)},'staff'); INSERT INTO public.company_member_grants(company_id,user_id,capabilities,manager_user_id) VALUES(${lit(c.company)},${lit(staff)},ARRAY['knowledge.write'],${lit(manager)});`);
      await transition(c,"submit",c);await prepare(platform,"approve",c,1);
      const table=mode==="scope"?"platform_admin_scopes":"platform_admins",field=mode==="scope"?"admin_user_id":"user_id";
      await db.sql(`CREATE FUNCTION private.g03_test_pause_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN IF new.${field}=${lit(manager)}::uuid THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN new; END $$; CREATE TRIGGER g03_test_pause_access AFTER UPDATE ON public.${table} FOR EACH ROW EXECUTE FUNCTION private.g03_test_pause_access();`);
      const gate=await holding(`SELECT pg_advisory_xact_lock(${key});`,"g03-access-gate");
      const call=mode==="scope"?rpcSql("access_set_admin_scope",`${lit(manager)},${lit(c.company)},'{}'::text[],'{}'::text[],1,'synthetic test'`):rpcSql("access_set_platform_role",`${lit(manager)},'delegated','disabled',1,'','synthetic test'`);
      const a=db.session(`BEGIN; SELECT pg_backend_pid(); ${actorSql(platform)} ${call} COMMIT;`,"g03-access-rpc-a");a.done.catch(()=>{});
      try {
        await waitFor("SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE application_name='g03-access-rpc-a';");
        const b=db.session(`BEGIN; SELECT pg_backend_pid(); ${actorSql(platform)} ${rpcSql("transition_company_review",args("approve",c,1))} COMMIT;`,"g03-access-rpc-b");b.done.catch(()=>{});
        await conflictingDecisionWhilePaused(a,b,gate,"g03-access-rpc-b");
        assert.equal(await db.sql(`SELECT status FROM public.company_member_grants WHERE company_id=${lit(c.company)} AND user_id=${lit(staff)};`),"disabled");
      } finally {if(!gate.child.stdin.destroyed)gate.release();await Promise.allSettled([gate.done,a.done]);await db.sql(`DROP TRIGGER g03_test_pause_access ON public.${table}; DROP FUNCTION private.g03_test_pause_access();`);}
    }
  });
  await caseOf("[lock-order] session deletion cascade versus final owner submission",async()=>{
    const c=await fixture("session-cascade");await prepare(c,"submit",c);const key=7300304;
    await db.sql(`CREATE FUNCTION private.g03_test_pause_session() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN IF old.id=${lit(c.sid)}::uuid THEN PERFORM pg_advisory_xact_lock(${key}); END IF; RETURN old; END $$; CREATE TRIGGER "A_g03_test_pause_session" AFTER DELETE ON auth.sessions FOR EACH ROW EXECUTE FUNCTION private.g03_test_pause_session();`);
    const gate=await holding(`SELECT pg_advisory_xact_lock(${key});`,"g03-session-gate");
    const a=db.session(`BEGIN; SELECT pg_backend_pid(); DELETE FROM auth.sessions WHERE id=${lit(c.sid)}; COMMIT;`,"g03-session-delete-a");a.done.catch(()=>{});
    try {
      await waitFor("SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE application_name='g03-session-delete-a';");
      const b=db.session(`BEGIN; SELECT pg_backend_pid(); ${actorSql(c)} ${rpcSql("transition_company_review",args("submit",c))} COMMIT;`,"g03-session-delete-b");b.done.catch(()=>{});
      await conflictingDecisionWhilePaused(a,b,gate,"g03-session-delete-b");
      assert.equal(await db.sql(`SELECT count(*) FROM private.app_session_activity WHERE session_id=${lit(c.sid)};`),"0");
      assert.equal(await db.sql(`SELECT count(*) FROM public.company_review_requests WHERE company_id=${lit(c.company)};`),"0");
    } finally {if(!gate.child.stdin.destroyed)gate.release();await Promise.allSettled([gate.done,a.done]);await db.sql('DROP TRIGGER "A_g03_test_pause_session" ON auth.sessions; DROP FUNCTION private.g03_test_pause_session();');}
  });
  await caseOf("[read-auth] expired session cannot read a company's review even when rollout setting is disabled",async()=>{
    const c=await fixture("read-expired");await transition(c,"submit",c);
    await db.sql(`UPDATE private.app_session_activity SET expired_at=clock_timestamp() WHERE session_id=${lit(c.sid)};`);
    await assert.rejects(rpc(c,"g03_read_review_request",lit(c.company)),/forbidden/);
  });
  console.log(`PASS ${passed}; FAIL 0`);
} catch (error) {
  console.error(`FAIL after ${passed} passed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
