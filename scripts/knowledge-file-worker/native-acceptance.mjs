/**
 * Isolated disposable Postgres acceptance for knowledge-file-worker.
 * Opt-in / local only. No production DB. No gate/provider enable.
 *
 * 1) Replay real supabase/migrations (transactionally, matching staff-invitations
 *    approved applicator + migration "Apply transactionally" contract).
 * 2) Install review packages 10 + 11 (REVIEW_ONLY stop removed only on disposable).
 * 3) Adversarial claim/replay/recover/review on real binding tables.
 *
 * Usage: node scripts/knowledge-file-worker/native-acceptance.mjs
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { isolatedPostgres, lit, wrapMigrationTransaction } from "./postgres-lf.mjs";

const rawExec = promisify(execFile);
const evidencePath = join(
  "supabase",
  "upgrade-packages",
  "knowledge-file-worker",
  "native-acceptance.evidence.json",
);
const MUTATIONS_THROUGH = "20261028171327_es02_branch_knowledge_mutations.sql";
const STAFF_MIGRATION = "20261011160000_vel_staff_invitation_recovery.sql";

const evidence = {
  status: "STARTED",
  at: new Date().toISOString(),
  production: false,
  runner_diagnosis: null,
  candidate_10_installed: false,
  ops_11_installed: false,
  baseline_through: null,
  used_synthetic_binding: false,
  skipped_migrations: [],
  tested: [],
  gaps: [],
  package_10_11: { state: "NOT_RUN" },
  container: null,
  cleaned: false,
  error: null,
};

function lf(sql) {
  return String(sql).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

function record(name, pass, detail = null) {
  evidence.tested.push({ name, pass, detail });
  console.log(
    `${pass ? "PASS" : "FAIL"}|${name}${detail ? `|${JSON.stringify(detail).slice(0, 220)}` : ""}`,
  );
}

function stripReviewStop(sql) {
  return lf(sql).replace(
    /do \$\$ begin raise exception 'REVIEW_ONLY_NOT_APPROVED_FOR_EXECUTION';\s*end \$\$;/g,
    "-- ISOLATED_ACCEPTANCE_ONLY: review stop removed for disposable DB",
  );
}

// Prove local runner previously diverged from approved transactional apply.
{
  const staffBody = readFileSync(`supabase/migrations/${STAFF_MIGRATION}`, "utf8");
  const wrapped = wrapMigrationTransaction(staffBody);
  const diagnosis = {
    migration_header_requires_transaction: /Apply transactionally/i.test(staffBody),
    migration_opens_with_begin: /^\s*begin\s*;/im.test(staffBody.replace(/^(?:\s*--[^\n]*\n|\s*\n)*/, "")),
    approved_staff_cases_wrap: "begin;"+ "<body>" +";commit;",
    local_wrap_adds_begin_commit: /^begin;/i.test(wrapped) && /commit;\s*$/i.test(wrapped),
    defect: "local_runner_not_migration",
  };
  evidence.runner_diagnosis = diagnosis;
  record(
    "runner_matches_approved_transactional_apply",
    diagnosis.migration_header_requires_transaction
      && !diagnosis.migration_opens_with_begin
      && diagnosis.local_wrap_adds_begin_commit,
    diagnosis,
  );
}

let db;
const work = mkdtempSync(join(tmpdir(), "velora-kfw-"));
try {
  await rawExec("docker", ["image", "inspect", "supabase/postgres:17.6.1.136"], {
    timeout: 60_000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });

  db = await isolatedPostgres();
  evidence.container = db.container;
  db.file = async (path, opts) =>
    db.sql(
      opts?.transactionalMigration
        ? wrapMigrationTransaction(readFileSync(resolve(path), "utf8"))
        : lf(readFileSync(resolve(path), "utf8")),
    );

  const boot = await db.bootstrap({
    throughMigration: MUTATIONS_THROUGH,
    skipMigrations: [],
  });
  evidence.baseline_through = MUTATIONS_THROUGH;
  evidence.skipped_migrations = boot.skipped ?? [];
  evidence.baseline_migrations = boot.count;
  evidence.paymob_predecessor = boot.paymobPredecessor ?? null;
  if (!boot.paymobPredecessor?.sourceSha256) {
    throw Error("PAYMOB_PREDECESSOR_NOT_INSTALLED");
  }
  record("paymob_live_owner_predecessor_installed", true, {
    sourceSha256: boot.paymobPredecessor.sourceSha256,
    path: boot.paymobPredecessor.path,
    paymentCalls: boot.paymobPredecessor.paymentCalls,
  });
  record("full_migration_chain_through_es02_mutations", true, {
    count: boot.count,
    through: MUTATIONS_THROUGH,
  });

  const bindingExists = await db.sql(
    `select to_regclass('private.es02_branch_knowledge_sources') is not null`,
  );
  if (bindingExists !== "t") throw Error("REAL_BINDING_TABLE_MISSING_AFTER_CHAIN");
  record("real_binding_table_present", true);

  const digest = await db.sql(
    `select md5(prosrc) from pg_proc where oid=to_regprocedure('public.g03_publish_prepared_file(uuid,uuid,uuid,uuid,integer,text,text,text,bigint,uuid,timestamp with time zone)')`,
  );
  if (digest !== "5e0dccd905f383e1b4ba541cff94b0bf") {
    throw Error(`PUBLISHER_DIGEST_MISMATCH:${digest}`);
  }
  record("publisher_digest_matches_review_guard", true, digest);

  const lockDigest = await db.sql(
    `select md5(prosrc) from pg_proc where oid=to_regprocedure('private.g03_lock_actor(uuid,text,uuid)')`,
  );
  if (lockDigest !== "6a7e552989ce5f3e980d11ca320c4683") {
    throw Error(`LOCK_ACTOR_DIGEST_MISMATCH:${lockDigest}`);
  }
  record("lock_actor_digest_matches_review_guard", true, lockDigest);

  const candidate = stripReviewStop(
    readFileSync("supabase/upgrade-packages/knowledge-file-worker/10-file-attempts.review.sql", "utf8"),
  );
  if (candidate.includes("REVIEW_ONLY_NOT_APPROVED_FOR_EXECUTION")) {
    throw Error("REVIEW_STOP_STILL_PRESENT_10");
  }
  writeFileSync(join(work, "10.isolated.sql"), candidate, "utf8");
  await db.file(join(work, "10.isolated.sql"), { transactionalMigration: true });
  evidence.candidate_10_installed = true;
  record("package_10_file_attempts_installed", true);

  const ops = stripReviewStop(
    readFileSync("supabase/upgrade-packages/knowledge-file-worker/11-worker-ops.review.sql", "utf8"),
  );
  if (ops.includes("REVIEW_ONLY_NOT_APPROVED_FOR_EXECUTION")) {
    throw Error("REVIEW_STOP_STILL_PRESENT_11");
  }
  writeFileSync(join(work, "11.isolated.sql"), ops, "utf8");
  await db.file(join(work, "11.isolated.sql"), { transactionalMigration: true });
  evidence.ops_11_installed = true;
  record("package_11_worker_ops_installed", true);
  evidence.package_10_11.state = "INSTALLED";

  const company = randomUUID();
  const foreignBranch = randomUUID(); // unbound id — single-branch scope forbids a second row
  const actor = randomUUID();
  const session = randomUUID();
  const source = randomUUID();
  const objectId = randomUUID();
  const path = `${company}/${source}/sample.pdf`;
  const updatedAt = "2026-10-31T12:00:00.000000Z";

  await db.sql(`
    insert into auth.users(id,email,email_confirmed_at)
      values(${lit(actor)},'kfw-synth@example.invalid',now())
      on conflict (id) do nothing;
    insert into auth.sessions(id,user_id) values(${lit(session)},${lit(actor)})
      on conflict do nothing;
    insert into private.app_session_activity(session_id,user_id,last_activity_at)
      values(${lit(session)},${lit(actor)},clock_timestamp())
      on conflict do nothing;
    insert into public.companies(id,display_name,business_type,hours,status,created_by)
      values(${lit(company)},'KFW synth','restaurant','09:00-18:00','active',${lit(actor)})
      on conflict (id) do nothing;
    insert into public.company_members(company_id,user_id,role,status)
      values(${lit(company)},${lit(actor)},'owner','active')
      on conflict do nothing;
  `);
  // Enterprise/ES02 single-branch producer creates the one primary branch on insert.
  const branchA = await db.sql(
    `select id::text from public.company_branches where company_id=${lit(company)} and is_primary limit 1`,
  );
  if (!/^[0-9a-f-]{36}$/i.test(branchA)) throw Error(`PRIMARY_BRANCH_MISSING:${branchA}`);

  await db.sql(`
    insert into storage.buckets(id,name,public) values('company-knowledge','company-knowledge',false)
      on conflict do nothing;
    insert into storage.objects(id,bucket_id,name,owner,updated_at)
      values(${lit(objectId)},'company-knowledge',${lit(path)},${lit(actor)},${lit(updatedAt)}::timestamptz);
    insert into public.knowledge_sources(
      id,company_id,kind,title,content,file_name,content_type,byte_size,storage_path,status,content_version,updated_at,created_by
    ) values(
      ${lit(source)},${lit(company)},'file','sample','','sample.pdf','application/pdf',12,${lit(path)},'stored',1,
      ${lit(updatedAt)}::timestamptz,${lit(actor)}
    );
    insert into private.es02_branch_knowledge_sources(company_id,branch_id,source_id)
      values(${lit(company)},${lit(branchA)}::uuid,${lit(source)});
    insert into private.g03_company_inputs(company_id) values(${lit(company)})
      on conflict do nothing;
  `);
  record("fixture_on_real_binding_table", true, { branchA, singleBranchScope: true });

  const attemptA = randomUUID();
  async function claimOnce(
    attempt,
    branch,
    recover = null,
    expectedUpdated = updatedAt,
    opts = {},
  ) {
    const sourceId = opts.sourceId ?? source;
    const storagePath = opts.storagePath ?? path;
    const objId = opts.objectId ?? objectId;
    const objectUpdated = opts.objectUpdatedAt ?? updatedAt;
    const version = opts.version ?? 1;
    try {
      const raw = await db.sql(`
        begin;
        set local role service_role;
        select public.g03_claim_file_attempt(
          ${lit(actor)}::uuid,${lit(session)}::uuid,${lit(company)}::uuid,${lit(sourceId)}::uuid,${lit(attempt)}::uuid,${lit(branch)}::uuid,
          ${version},${lit(expectedUpdated)}::timestamptz,${lit(storagePath)},${lit(objId)}::uuid,${lit(objectUpdated)}::timestamptz,
          (clock_timestamp() + interval '15 minutes'),${recover ? lit(recover) + "::uuid" : "null"}
        );
        commit;
      `);
      return { kind: "json", value: JSON.parse(raw) };
    } catch (error) {
      return { kind: "error", value: String(error.message ?? error) };
    }
  }

  const claim1 = await claimOnce(attemptA, branchA);
  record(
    "claim_succeeds_and_sets_processing",
    claim1.kind === "json" && claim1.value.ok === true && claim1.value.attemptId === attemptA,
    claim1.value,
  );

  const replay = await claimOnce(attemptA, branchA);
  record(
    "same_attemptId_replay_without_new_row",
    replay.kind === "json" && replay.value.ok === true && replay.value.replayed === true,
    replay.value,
  );

  const status = await db.sql(`select status from public.knowledge_sources where id=${lit(source)}`);
  const liveUpdatedAt = await db.sql(
    `select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.knowledge_sources where id=${lit(source)}`,
  );
  record(
    "queued_processing_only_after_saved_attempt",
    status === "processing" && claim1.kind === "json" && claim1.value.ok === true,
    { status, liveUpdatedAt },
  );

  const claim2 = await claimOnce(randomUUID(), branchA, null, liveUpdatedAt || updatedAt);
  record(
    "concurrent_second_claim_busy",
    claim2.kind === "json" && claim2.value.ok === false && ["BUSY", "CONFLICT"].includes(claim2.value.code),
    claim2.value,
  );

  const foreign = await claimOnce(randomUUID(), foreignBranch, null, liveUpdatedAt || updatedAt);
  record(
    "foreign_branch_claim_rejected",
    (foreign.kind === "json" && foreign.value.ok === false)
      || (foreign.kind === "error" && /BRANCH_BINDING_REQUIRED|42501|forbidden|SECOND_BRANCH/i.test(foreign.value)),
    foreign.value,
  );

  await db.sql(
    `update private.g03_file_attempts set expires_at=clock_timestamp() - interval '1 second' where source_id=${lit(source)}`,
  );
  let stalePublish;
  try {
    stalePublish = {
      kind: "json",
      value: JSON.parse(await db.sql(`
        begin; set local role service_role;
        select public.g03_publish_file_attempt(
          ${lit(attemptA)}::uuid,${lit(actor)}::uuid,${lit(session)}::uuid,${lit(source)}::uuid,${lit(company)}::uuid,${lit(branchA)}::uuid,
          1,${lit(path)},'text','${"a".repeat(64)}',12,${lit(objectId)}::uuid,${lit(updatedAt)}::timestamptz
        );
        commit;
      `)),
    };
  } catch (error) {
    stalePublish = { kind: "error", value: String(error.message ?? error) };
  }
  record(
    "expired_attempt_cannot_publish",
    stalePublish.kind === "json" && stalePublish.value.ok === false,
    stalePublish.value,
  );

  const recoverId = randomUUID();
  const liveUpdatedForRecover = await db.sql(
    `select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.knowledge_sources where id=${lit(source)}`,
  );
  const recovered = await claimOnce(
    recoverId,
    branchA,
    attemptA,
    liveUpdatedForRecover || liveUpdatedAt || updatedAt,
  );
  record(
    "explicit_expired_recovery_with_new_attempt",
    recovered.kind === "json" && recovered.value.ok === true && recovered.value.attemptId === recoverId,
    recovered.value,
  );

  await db.sql(`
    update private.g03_file_attempts
      set provider_dispatch='dispatched', expires_at=clock_timestamp() - interval '1 second'
    where source_id=${lit(source)};
  `);
  const liveUpdatedReview = await db.sql(
    `select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from public.knowledge_sources where id=${lit(source)}`,
  );
  const reviewClaim = await claimOnce(
    randomUUID(),
    branchA,
    recoverId,
    liveUpdatedReview || liveUpdatedForRecover || updatedAt,
  );
  record(
    "post_provider_unknown_blocks_auto_recovery",
    reviewClaim.kind === "json" && reviewClaim.value.ok === false && reviewClaim.value.code === "REVIEW_REQUIRED",
    reviewClaim.value,
  );

  const listed = JSON.parse(await db.sql(`
    begin; set local role service_role;
    select public.g03_list_running_file_attempts(10);
    commit;
  `));
  record(
    "list_running_attempts_rpc",
    Array.isArray(listed) && listed.some((r) => r.attempt_id === recoverId),
    listed,
  );

  const anonDenied = await db.sql(`
    begin; set local role anon;
    select has_function_privilege('anon', 'public.g03_claim_file_attempt(uuid,uuid,uuid,uuid,uuid,uuid,integer,timestamptz,text,uuid,timestamptz,timestamptz,uuid)'::regprocedure, 'execute');
    commit;
  `).catch((e) => String(e.message));
  record("anon_execute_denied_or_false", anonDenied === "f" || /permission denied|42501/i.test(String(anonDenied)), anonDenied);

  // --- Local /setup-equivalent txt journey (offline extract; not a Gemini provider proof) ---
  {
    const { createHash } = await import("node:crypto");
    const txtSource = randomUUID();
    const txtObject = randomUUID();
    const txtAttempt = randomUUID();
    const txtBody = "Velora local knowledge worker proof text for assistant context.";
    const txtBytes = Buffer.from(txtBody, "utf8");
    const txtSha = createHash("sha256").update(txtBytes).digest("hex");
    const txtPath = `${company}/${txtSource}/local-proof.txt`;
    const txtUpdated = "2026-10-31T13:00:00.000000Z";
    await db.sql(`
      insert into storage.objects(id,bucket_id,name,owner,updated_at)
        values(${lit(txtObject)},'company-knowledge',${lit(txtPath)},${lit(actor)},${lit(txtUpdated)}::timestamptz);
      insert into public.knowledge_sources(
        id,company_id,kind,title,content,file_name,content_type,byte_size,storage_path,status,content_version,updated_at,created_by
      ) values(
        ${lit(txtSource)},${lit(company)},'file','local-proof','','local-proof.txt','text/plain',${txtBytes.byteLength},
        ${lit(txtPath)},'stored',1,${lit(txtUpdated)}::timestamptz,${lit(actor)}
      );
      insert into private.es02_branch_knowledge_sources(company_id,branch_id,source_id)
        values(${lit(company)},${lit(branchA)}::uuid,${lit(txtSource)});
    `);
    // Match owner upload client: claim with the live row/object generations, not the insert literal.
    const liveTxt = await db.sql(`
      select jsonb_build_object(
        'updated_at', to_char(k.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'version', k.content_version,
        'path', k.storage_path,
        'object_updated_at', to_char(o.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )
      from public.knowledge_sources k
      join storage.objects o on o.id=${lit(txtObject)}::uuid
      where k.id=${lit(txtSource)}
    `);
    const live = JSON.parse(liveTxt);
    record("setup_journey_upload_bind_stored", true, { txtSource, kind: "text/plain", live });

    const enqueued = await claimOnce(txtAttempt, branchA, null, live.updated_at, {
      sourceId: txtSource,
      storagePath: live.path,
      objectId: txtObject,
      objectUpdatedAt: live.object_updated_at,
      version: live.version,
    });
    record(
      "setup_journey_auto_enqueue_returns_without_extract",
      enqueued.kind === "json" && enqueued.value.ok === true && enqueued.value.attemptId === txtAttempt,
      enqueued.value,
    );

    // Local offline extract (same prepareKind txt path the worker uses) — not Gemini.
    const published = JSON.parse(await db.sql(`
      begin; set local role service_role;
      select public.g03_publish_file_attempt(
        ${lit(txtAttempt)}::uuid,${lit(actor)}::uuid,${lit(session)}::uuid,${lit(txtSource)}::uuid,
        ${lit(company)}::uuid,${lit(branchA)}::uuid,${live.version},${lit(live.path)},${lit(txtBody)},${lit(txtSha)},
        ${txtBytes.byteLength},${lit(txtObject)}::uuid,${lit(live.object_updated_at)}::timestamptz
      );
      commit;
    `));
    record(
      "setup_journey_worker_local_txt_publish",
      published.ok === true,
      { ok: published.ok, code: published.code ?? null, note: "local_txt_extract_not_gemini" },
    );

    const ready = await db.sql(
      `select status||':'||content_version::text||':'||left(content,40) from public.knowledge_sources where id=${lit(txtSource)}`,
    );
    record("setup_journey_content_visible", /^ready:2:Velora local knowledge/.test(ready), ready);

    // Owner approve via the same trigger gate the RPC uses (velora.knowledge_approval=1).
    const fingerprint = createHash("sha256").update(txtBody).digest("hex");
    await db.sql(`
      begin;
      select set_config('velora.knowledge_approval','1',true);
      update public.knowledge_sources
        set approved_for_answers=true
      where id=${lit(txtSource)} and status='ready' and content=${lit(txtBody)};
      commit;
    `);
    const approved = await db.sql(
      `select approved_for_answers::text||':'||coalesce(approved_version::text,'') from public.knowledge_sources where id=${lit(txtSource)}`,
    );
    record("setup_journey_owner_approve", approved === "true:2", { approved, fingerprint });

    const contextRow = await db.sql(`
      select count(*)::text from public.knowledge_sources
      where company_id=${lit(company)} and id=${lit(txtSource)}
        and approved_for_answers=true and status='ready' and content=${lit(txtBody)}
    `);
    record(
      "setup_journey_assistant_context_eligible",
      contextRow === "1",
      { contextRow, loader: "approved_knowledge_select_shape", geminiViaWorker: false },
    );

    // Content change must clear approval for re-review (trigger invalidates without approval gate).
    await db.sql(`
      update public.knowledge_sources
        set content='changed body that must revoke approval'
      where id=${lit(txtSource)};
    `);
    const revoked = await db.sql(
      `select approved_for_answers::text||':'||content_version::text||':'||left(content,20) from public.knowledge_sources where id=${lit(txtSource)}`,
    );
    record(
      "setup_journey_approval_cleared_on_content_change",
      /^false:\d+:changed body/.test(String(revoked)),
      revoked,
    );

    evidence.setup_journey = {
      kind: "local_txt_offline_extract",
      gemini_provider_via_worker: false,
      tag_city_mutated: false,
      sourceId: txtSource,
    };
  }

  evidence.package_10_11.state = evidence.tested.every((t) => t.pass) ? "PASS_ON_REAL_CHAIN" : "FAIL_ON_REAL_CHAIN";
  evidence.status = evidence.package_10_11.state === "PASS_ON_REAL_CHAIN" ? "PASS_ISOLATED_REAL_CHAIN" : "FAIL_ISOLATED";
  if (!evidence.tested.every((t) => t.pass)) process.exitCode = 1;
} catch (error) {
  evidence.error = String(error?.message ?? error).slice(0, 800);
  const match = evidence.error.match(/MIGRATION_FAILED\s+(\S+):\s*(.*)/s);
  if (match) {
    evidence.blocked_at_migration = match[1];
    evidence.blocked_reason = match[2].slice(0, 500);
    evidence.status = "FULL_MIGRATION_CHAIN_NOT_RUN";
    evidence.package_10_11.state = "NOT_RUN";
    evidence.gaps.push(`Real chain blocked at ${match[1]}`);
    process.exitCode = 2;
  } else if (evidence.status === "STARTED") {
    evidence.status = "BLOCKED";
    process.exitCode = 1;
  }
  console.log(`BLOCKED|${evidence.error}`);
} finally {
  try {
    if (db) {
      await db.close();
      evidence.cleaned = true;
    }
  } catch (cleanupError) {
    evidence.cleaned = false;
    evidence.cleanup_error = String(cleanupError?.message ?? cleanupError).slice(0, 400);
    process.exitCode = 1;
  }
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  evidence.at_end = new Date().toISOString();
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  console.log(`EVIDENCE|${evidencePath}|${evidence.status}|10_11=${evidence.package_10_11.state}`);
}
