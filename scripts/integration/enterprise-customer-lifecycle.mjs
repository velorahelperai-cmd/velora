// Native local PostgreSQL + GoTrue + PostgREST. No environment files or providers.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { startStack } from "./local-http-stack.mjs";

const migration = "supabase/migrations/20261014025849_enterprise_branch_authority.sql";
const stack = await startStack({ gatewayPort: 3230, authPort: 3240, restPort: 3241,
  throughMigration: "20261009215520_g03_verified_review.sql", progress: console.log });
let passed = 0;
const eq = (a,b,label) => { assert.deepEqual(a,b,label); passed++; };
try {
  // The repository's subsequent exact-file migration currently rejects its own
  // prerequisite hash. Do not weaken that release guard. This isolated core test
  // installs the real invitation recovery dependency explicitly, then our SQL.
  await stack.sql("begin;"+await readFile("supabase/migrations/20261011160000_vel_staff_invitation_recovery.sql","utf8")+"commit;");
  const oldAuthority=(await stack.rows("select 'public.has_company_capability(uuid,text)'::regprocedure::oid as capability,'private.user_has_company_capability(uuid,uuid,text)'::regprocedure::oid as evaluator"))[0];
  // RED is a real missing schema assertion, not a source-text check.
  try { assert.equal((await stack.rows("select to_regclass('public.company_branches')::text as name"))[0].name,"company_branches"); }
  catch (error) { if (error.code !== "ERR_ASSERTION") throw error; console.log("RED: enterprise branch schema is absent on baseline"); }
  await stack.sql(await readFile(migration,"utf8"));
  await stack.sql(await readFile("supabase/migrations/20261014032142_enterprise_staff_operations.sql","utf8"));
  await new Promise(resolve=>setTimeout(resolve,1000)); // PostgREST schema-cache notification.
  eq((await stack.rows("select 'public.has_company_capability(uuid,text)'::regprocedure::oid as capability,'private.user_has_company_capability(uuid,uuid,text)'::regprocedure::oid as evaluator"))[0],oldAuthority,"RLS authority OIDs preserved");
  eq((await stack.rows("select has_function_privilege('authenticated','private.enterprise_table_access(uuid,text)','execute') as allowed"))[0].allowed,true,"RLS helper remains executable after both migrations");
  const owner = await stack.adminCreateUser();
  const employee = await stack.adminCreateUser();
  const manager = await stack.adminCreateUser();
  const stranger = await stack.adminCreateUser();
  const company = randomUUID(), other = randomUUID();
  await stack.sql(`insert into public.companies(id,display_name,status,created_by) values
    ('${company}','Synthetic organization','active','${owner.id}'),('${other}','Other organization','active','${stranger.id}');
    insert into public.company_members(company_id,user_id,role,status) values
    ('${company}','${owner.id}','owner','active'),('${other}','${stranger.id}','owner','active');`);
  const users = [owner,employee,manager,stranger];
  const sessions = new Map();
  for (const u of users) {
    const response = await fetch(`${stack.url}/auth/v1/token?grant_type=password`,{method:"POST",
      headers:{apikey:stack.anonKey,"Content-Type":"application/json"},body:JSON.stringify({email:u.email,password:u.password})});
    assert.equal(response.status,200); const session = await response.json(); sessions.set(u.id,session.access_token);
  }
  async function rpc(u,name,args={}) {
    if (["enterprise_invite","enterprise_create_branch"].includes(name) && !args.p_operation_id) args={...args,p_operation_id:randomUUID()};
    const response = await fetch(`${stack.url}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:stack.anonKey,
      Authorization:`Bearer ${sessions.get(u.id)}`,"Content-Type":"application/json"},body:JSON.stringify(args)});
    const body = await response.json(); if (!response.ok) throw Error(`${name}: ${JSON.stringify(body)}`); return body;
  }
  async function visibleMemberships(u){
    const response=await fetch(`${stack.url}/rest/v1/company_members?select=company_id,user_id,role,status&user_id=eq.${u.id}`,{headers:{apikey:stack.anonKey,Authorization:`Bearer ${sessions.get(u.id)}`}});
    eq(response.status,200,"real RLS read remains usable");return response.json();
  }
  for (const u of users) eq((await rpc(u,"check_app_session",{p_touch:true})).ok,true,"native session initialized");
  const first = (await rpc(owner,"enterprise_workspace",{p_company_id:company})).branches[0].id;
  eq(await rpc(owner,"is_platform_admin"),false,"business owner does not acquire platform privileges");
  for(const resource of ["profiles?select=full_name,support_code","company_members?select=company_id,user_id,role,status,member_name,created_at","companies?select=id,display_name,status,business_type,reply_language,country,city,hours,contact_phone,contact_email,created_by,created_at,updated_at"]){
   const response=await fetch(`${stack.url}/rest/v1/${resource}`,{headers:{apikey:stack.anonKey,Authorization:`Bearer ${sessions.get(owner.id)}`}});
   eq(response.status,200,`real getCompanyAccess REST preflight: ${resource.split('?')[0]}`);await response.arrayBuffer();
  }
  const second = await rpc(owner,"enterprise_create_branch",{p_company_id:company,p_name:"Second branch",p_timezone:"Asia/Muscat"});
  eq(second.ok,true,"owner creates a branch");
  const branchOperation=randomUUID();
  const concurrentBranches=await Promise.all([rpc(owner,"enterprise_create_branch",{p_company_id:company,p_name:"Idempotent branch",p_timezone:"UTC",p_operation_id:branchOperation}),rpc(owner,"enterprise_create_branch",{p_company_id:company,p_name:"Idempotent branch",p_timezone:"UTC",p_operation_id:branchOperation})]);
  eq(concurrentBranches[0].branchId,concurrentBranches[1].branchId,"atomic branch operation replay");
  eq((await rpc(stranger,"enterprise_workspace",{p_company_id:company})).ok,false,"tenant isolation");
  eq((await rpc(employee,"enterprise_create_branch",{p_company_id:company,p_name:"Injected",p_timezone:"UTC"})).ok,false,"staff cannot create branches");
  const token = "a".repeat(64);
  const invitation = await rpc(owner,"enterprise_invite",{p_company_id:company,p_branch_ids:[first],p_role:"employee",p_email:employee.email,p_name:"Fixture staff",p_capabilities:["wa.conversations.read","wa.conversations.reply"],p_token_hash:token});
  eq(invitation.ok,true,"owner invitation");
  eq(Math.round((Date.parse(invitation.expiresAt)-Date.parse(invitation.createdAt))/3600000),72,"72 hour expiry");
  eq((await rpc(stranger,"enterprise_accept_invite",{p_token_hash:token})).ok,false,"target identity enforced");
  const accepted = await Promise.all([rpc(employee,"enterprise_accept_invite",{p_token_hash:token}),rpc(employee,"enterprise_accept_invite",{p_token_hash:token})]);
  eq(accepted.filter(x=>x.ok).length,1,"atomic single-use acceptance");
  let workspace = await rpc(employee,"enterprise_workspace",{p_company_id:company});
  eq((await visibleMemberships(employee)).map(x=>x.company_id),[company],"native employee workspace membership readable");
  eq(workspace.branches.map(x=>x.id),[first],"employee sees only their immutable branch");
  eq(await rpc(employee,"enterprise_branch_permission",{p_company_id:company,p_branch_id:second.branchId,p_capability:"wa.conversations.read"}),false,"employee cannot read another branch");
  const account=workspace.accounts[0].id;
  eq(await rpc(employee,"has_company_capability",{p_company_id:company,p_capability:"wa.conversations.reply"}),false,"reply denied without an active shift and presence");
  eq((await rpc(owner,"enterprise_save_schedule",{p_company_id:company,p_branch_id:first,p_user_id:employee.id,p_expected_revision:0,p_weekly:[{day:3,start:"22:00",end:"06:00"}],p_exceptions:[]})).ok,true,"owner creates an overnight shift");
  eq((await stack.rows(`select private.enterprise_shift_active('${account}','2026-10-14T21:59:59Z') as active`))[0].active,false,"before shift");
  eq((await stack.rows(`select private.enterprise_shift_active('${account}','2026-10-14T22:00:00Z') as active`))[0].active,true,"shift starts inclusively");
  eq((await stack.rows(`select private.enterprise_shift_active('${account}','2026-10-15T02:00:00Z') as active`))[0].active,true,"overnight next day");
  eq((await stack.rows(`select private.enterprise_shift_active('${account}','2026-10-15T06:00:00Z') as active`))[0].active,false,"shift end exclusive");
  eq((await rpc(employee,"enterprise_save_schedule",{p_company_id:company,p_branch_id:first,p_user_id:employee.id,p_expected_revision:1,p_weekly:[],p_exceptions:[]})).ok,false,"employee cannot schedule themselves");
  eq((await rpc(owner,"enterprise_save_schedule",{p_company_id:company,p_branch_id:first,p_user_id:employee.id,p_expected_revision:0,p_weekly:[],p_exceptions:[]})).code,"STALE_REVISION","schedule compare and swap");
  eq((await rpc(owner,"enterprise_save_schedule",{p_company_id:company,p_branch_id:first,p_user_id:employee.id,p_expected_revision:1,p_weekly:Array.from({length:7},(_,day)=>({day,start:"00:00",end:"23:59"})),p_exceptions:[]})).ok,true,"current eligible shift configured using existing schedule");
  eq((await rpc(employee,"enterprise_presence_heartbeat",{p_company_id:company})).ok,true,"session authenticated presence");
  eq(await rpc(employee,"has_company_capability",{p_company_id:company,p_capability:"wa.conversations.reply"}),true,"existing reply path requires actual current shift and heartbeat");
  const conversation=randomUUID(),note=randomUUID();
  await stack.sql(`insert into public.whatsapp_conversations(id,company_id,phone_number_id,customer_wa_id) values('${conversation}','${company}','synthetic-phone','synthetic-customer');`);
  await stack.sql(`begin;select set_config('velora.conversation_control','1',true);update public.whatsapp_conversations set status='handed_over',assigned_to='${employee.id}' where id='${conversation}';update private.enterprise_presence set heartbeat_at=clock_timestamp()-interval '119 seconds' where account_id='${account}';commit;`);
  eq((await rpc(employee,"enterprise_presence_heartbeat",{p_company_id:company})).ok,true,"connection recovery inside grace");
  eq((await stack.rows(`select assigned_to from public.whatsapp_conversations where id='${conversation}'`))[0].assigned_to,employee.id,"control retained within two minute grace");
  await stack.sql(`update private.enterprise_presence set heartbeat_at=clock_timestamp()-interval '121 seconds' where account_id='${account}';`);
  eq(await rpc(employee,"has_company_capability",{p_company_id:company,p_capability:"wa.conversations.reply"}),false,"disconnect past two minutes denies late reply");
  eq((await rpc(employee,"enterprise_presence_heartbeat",{p_company_id:company})).ok,true,"late recovery creates only presence");
  eq((await stack.rows(`select assigned_to,automation_allowed,status from public.whatsapp_conversations where id='${conversation}'`))[0],{assigned_to:null,automation_allowed:false,status:"open"},"late recovery does not restore human control or claim AI readiness");
  eq((await rpc(owner,"enterprise_save_note",{p_company_id:company,p_branch_id:first,p_conversation_id:conversation,p_note_id:note,p_expected_revision:0,p_body:"Private note never sent"})).ok,true,"owner internal note");
  eq((await rpc(employee,"enterprise_save_note",{p_company_id:company,p_branch_id:first,p_conversation_id:conversation,p_note_id:note,p_expected_revision:1,p_body:"Injected edit"})).ok,false,"employee cannot edit another author's note");
  eq((await rpc(employee,"enterprise_notes",{p_company_id:company,p_branch_id:second.branchId,p_conversation_id:conversation})).ok,false,"note branch isolation");
  eq((await rpc(employee,"enterprise_invite",{p_company_id:company,p_branch_ids:[first],p_role:"employee",p_email:stranger.email,p_name:"Injected",p_capabilities:[],p_token_hash:"b".repeat(64)})).ok,false,"only owner invites");
  const managerInvite = await rpc(owner,"enterprise_invite",{p_company_id:company,p_branch_ids:[first],p_role:"manager",p_email:manager.email,p_name:"Manager",p_capabilities:["staff.permissions.update","wa.conversations.read"],p_token_hash:"c".repeat(64)});
  eq(managerInvite.ok,true,"manager invitation");
  const invitationRevision=(await stack.rows(`select r.revision from private.staff_invitation_recipients r join private.staff_invitations i on i.company_id=r.company_id and i.email=r.email where i.id='${managerInvite.id}'`))[0].revision;
  await stack.sql(`update auth.users set email_confirmed_at=null,phone_confirmed_at=clock_timestamp() where id='${owner.id}';`);
  const replaced=await rpc(owner,"mutate_staff_invitation",{p_company_id:company,p_operation_id:randomUUID(),p_action:"replace",p_email:null,p_name:null,p_invitation_id:managerInvite.id,p_expected_revision:invitationRevision,p_token_hash:"e".repeat(64)});
  eq(replaced.ok,true,"existing invitation replacement path remains usable");
  eq((await stack.rows(`select enterprise_role,enterprise_branches from private.staff_invitations where id='${replaced.invitation.id}'`))[0],{enterprise_role:"manager",enterprise_branches:[first]},"resend preserves scope for a verified-phone owner");
  eq((await rpc(manager,"enterprise_accept_invite",{p_token_hash:"c".repeat(64)})).ok,false,"replacement revokes prior token");
  eq((await rpc(manager,"accept_staff_invitation",{p_token_hash:"e".repeat(64)})).ok,true,"legacy acceptance endpoint preserves manager role and scope");
  eq((await rpc(manager,"enterprise_workspace",{p_company_id:company})).branches.map(x=>x.id),[first],"manager has explicit branches only");
  const otherPrimary=(await rpc(stranger,"enterprise_workspace",{p_company_id:other})).branches[0].id;
  eq((await rpc(stranger,"enterprise_invite",{p_company_id:other,p_branch_ids:[otherPrimary],p_role:"manager",p_email:manager.email,p_name:"Same manager in other organization",p_capabilities:["wa.conversations.read"],p_token_hash:"d".repeat(64)})).ok,true,"manager explicitly invited to second organization");
  eq((await rpc(manager,"enterprise_accept_invite",{p_token_hash:"d".repeat(64)})).ok,true,"one manager account with explicit multi-organization memberships");
  eq((await rpc(manager,"enterprise_set_grants",{p_company_id:company,p_branch_id:first,p_user_id:manager.id,p_capabilities:["wa.conversations.reply"],p_delegable:[]})).ok,false,"manager cannot self-escalate");
  eq((await rpc(manager,"enterprise_set_grants",{p_company_id:company,p_branch_id:first,p_user_id:employee.id,p_capabilities:["customer.delete"],p_delegable:[]})).ok,false,"manager ceiling enforced");
  eq((await rpc(owner,"enterprise_revoke_sessions",{p_company_id:company,p_user_id:manager.id,p_session_id:null,p_other_devices:false})).ok,true,"owner revokes customer manager sessions in organization A");
  eq((await rpc(manager,"enterprise_workspace",{p_company_id:company})).ok,false,"revoked organization denied");
  eq((await rpc(manager,"enterprise_workspace",{p_company_id:other})).ok,true,"organization B customer session preserved");
  eq((await visibleMemberships(manager)).map(x=>x.company_id),[other],"revoked organization hidden in direct REST/RLS");
  eq((await rpc(manager,"check_app_session",{p_touch:false})).ok,true,"shared native/platform session preserved");
  eq((await rpc(owner,"enterprise_set_member_status",{p_company_id:company,p_user_id:employee.id,p_status:"suspended"})).ok,true,"suspension");
  eq((await rpc(employee,"enterprise_workspace",{p_company_id:company})).ok,false,"old token denied immediately");
  eq((await visibleMemberships(employee)).length,0,"suspended user cannot bypass RPC via direct REST");
  eq((await rpc(owner,"enterprise_set_member_status",{p_company_id:company,p_user_id:employee.id,p_status:"active"})).ok,false,"reactivation requires request");
  eq((await rpc(owner,"enterprise_set_member_status",{p_company_id:company,p_user_id:employee.id,p_status:"terminated"})).ok,true,"termination");
  eq((await rpc(owner,"enterprise_set_member_status",{p_company_id:company,p_user_id:employee.id,p_status:"active"})).ok,false,"terminated membership cannot reopen");
  // Privileged functions and raw customer tables cannot be used as alternate APIs.
  eq((await stack.rows("select has_table_privilege('authenticated','private.staff_invitations','select') as allowed"))[0].allowed,false,"private invitation tokens");
  eq((await stack.rows("select has_function_privilege('anon','public.enterprise_workspace(uuid)','execute') as allowed"))[0].allowed,false,"anonymous API denied");
  // Exercise the integration boundary with the actual Master field names,
  // without installing its independent billing/file executors or changing them.
  await stack.sql("alter table public.companies add column archived_at timestamptz,add column setup_file_destruction_at timestamptz;");
  const archiveInvite=await rpc(owner,"enterprise_invite",{p_company_id:company,p_branch_ids:[first],p_role:"manager",p_email:stranger.email,p_name:"Pending manager",p_capabilities:["staff.read"],p_token_hash:"f".repeat(64)});
  eq(archiveInvite.ok,true,"pending invitation before archive");
  await stack.sql(`update public.companies set archived_at=clock_timestamp() where id='${company}';`);
  const beforeBridge=await rpc(owner,"enterprise_workspace",{p_company_id:company});
  assert.throws(()=>assert.equal(beforeBridge.ok,false),{code:"ERR_ASSERTION"});
  console.log("RED: archived company is operable through original enterprise RPC");
  await stack.sql(await readFile("supabase/migrations/20261014051045_enterprise_business_lifecycle_guard.sql","utf8"));
  eq((await rpc(owner,"enterprise_workspace",{p_company_id:company})).ok,false,"archived direct workspace denied");
  eq((await rpc(owner,"enterprise_create_branch",{p_company_id:company,p_name:"Injected archived branch",p_timezone:"UTC"})).ok,false,"archived direct mutation denied");
  eq(await rpc(owner,"enterprise_branch_permission",{p_company_id:company,p_branch_id:first,p_capability:"staff.read"}),false,"archived owner branch grants denied");
  eq((await rpc(stranger,"enterprise_accept_invite",{p_token_hash:"f".repeat(64)})).ok,false,"archived enterprise invitation cannot be consumed");
  eq((await rpc(stranger,"accept_staff_invitation",{p_token_hash:"f".repeat(64)})).ok,false,"legacy endpoint cannot bypass archive guard");
  eq((await rpc(stranger,"enterprise_workspace",{p_company_id:other})).ok,true,"other organization unaffected by archive");
  const ownerHistory=await fetch(`${stack.url}/rest/v1/companies?select=id,archived_at&id=eq.${company}`,{headers:{apikey:stack.anonKey,Authorization:`Bearer ${sessions.get(owner.id)}`}});
  eq(ownerHistory.status,200,"owner archive history REST remains usable");
  const historyRows=await ownerHistory.json();
  eq(historyRows.map(x=>x.id),[company],"owner retains archived company history through RLS");
  eq((await visibleMemberships(owner)).map(x=>x.company_id),[company],"owner retains membership history after archive");
  await stack.sql(`update public.companies set archived_at=null,setup_file_destruction_at=clock_timestamp() where id='${company}';`);
  eq((await rpc(owner,"enterprise_workspace",{p_company_id:company})).ok,false,"destroyed setup files forbid enterprise operation");
  await stack.sql(`update public.companies set setup_file_destruction_at=null where id='${company}';`);
  eq((await rpc(owner,"enterprise_workspace",{p_company_id:company})).ok,true,"restoring eligible company resumes guarded access");
  eq((await rpc(stranger,"accept_staff_invitation",{p_token_hash:"f".repeat(64)})).ok,true,"blocked invitation remains single-use and can join after restore");
  console.log(`ENTERPRISE_DATABASE_PASS:${passed}`);
} finally { await stack.close(); }
