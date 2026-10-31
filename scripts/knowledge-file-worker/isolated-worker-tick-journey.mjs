/**
 * Isolated disposable only: prove real worker tick path for a new text/plain file.
 * Gate ON, provider extract OFF. No TAG CITY. Does not re-run adversarial 10/11 suite.
 *
 * Evidence: attemptId, successful HTTP tick, claim capture, publish under source.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { isolatedPostgres, lit, wrapMigrationTransaction } from "./postgres-lf.mjs";

const MUTATIONS_THROUGH = "20261028171327_es02_branch_knowledge_mutations.sql";
const evidencePath = join(
  "supabase",
  "upgrade-packages",
  "knowledge-file-worker",
  "isolated-worker-tick.evidence.json",
);
const secret = `local-kfw-tick-${randomBytes(16).toString("hex")}`;
process.env.VELORA_KNOWLEDGE_FILE_WORKER_ENABLED = "true";
process.env.VELORA_KNOWLEDGE_FILE_WORKER_PROVIDER_EXTRACT = "false";
process.env.VELORA_KNOWLEDGE_FILE_WORKER_SECRET = secret;

function lf(sql) {
  return String(sql).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}
function stripReviewStop(sql) {
  return lf(sql).replace(
    /do \$\$ begin raise exception 'REVIEW_ONLY_NOT_APPROVED_FOR_EXECUTION';\s*end \$\$;/g,
    "-- ISOLATED_TICK: review stop removed for disposable DB",
  );
}

// Import worker core only (batch.ts pulls Next server-only admin client).
const { runKnowledgeFileAttempt } = await import(
  pathToFileURL(resolve("src/lib/knowledge/file-worker/run.ts")).href
);
const { buildWorkerObservation } = await import(
  pathToFileURL(resolve("src/lib/knowledge/file-worker/observation.ts")).href
);
const { classifyStuckAttempt, PROVIDER_OUTCOME_UNKNOWN_CODE } = await import(
  pathToFileURL(resolve("src/lib/knowledge/file-worker/recovery.ts")).href
);
function extractLocalPlainText(fileBytes) {
  const text = new TextDecoder("utf-8", { fatal: false })
    .decode(fileBytes)
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (text.length < 8) return { ok: false, code: "no_text" };
  return { ok: true, text: text.slice(0, 200_000) };
}

async function processKnowledgeFileWorkerBatch(ports, limit = 10) {
  const nowMs = ports.nowMs();
  let due = [];
  try {
    due = await ports.listDue(limit);
  } catch {
    return buildWorkerObservation({
      nowMs,
      ok: false,
      code: "LIST_UNAVAILABLE",
      backlog: 0,
      processed: 0,
      extracted: 0,
      unknown: 0,
      failed: 0,
      reviewRequired: 0,
      oldestDueExpiresAtMs: null,
    });
  }
  let processed = 0;
  let extracted = 0;
  let unknown = 0;
  let failed = 0;
  let reviewRequired = 0;
  let oldestDueExpiresAtMs = null;
  for (const row of due) {
    const exp = Date.parse(row.expiresAt);
    if (Number.isFinite(exp)) {
      oldestDueExpiresAtMs =
        oldestDueExpiresAtMs == null ? exp : Math.min(oldestDueExpiresAtMs, exp);
    }
    const decision = classifyStuckAttempt(
      {
        attemptId: row.attemptId,
        state: "running",
        expiresAt: row.expiresAt,
        providerDispatch: row.providerDispatch,
        sourceStatus: "processing",
        failureCode: null,
      },
      nowMs,
    );
    if (decision.action === "review_required") {
      processed += 1;
      unknown += 1;
      reviewRequired += 1;
      await ports.forAttempt(row).failAttempt({
        sourceId: row.sourceId,
        attemptId: row.attemptId,
        code: PROVIDER_OUTCOME_UNKNOWN_CODE,
      });
      continue;
    }
    if (decision.action === "recover_expired") {
      processed += 1;
      failed += 1;
      continue;
    }
    const result = await runKnowledgeFileAttempt(
      { sourceId: row.sourceId, attemptId: row.attemptId },
      ports.forAttempt(row),
    );
    processed += 1;
    if (result.extracted) extracted += 1;
    if (result.code === "PROVIDER_OUTCOME_UNKNOWN") {
      unknown += 1;
      reviewRequired += 1;
      await ports.forAttempt(row).failAttempt({
        sourceId: row.sourceId,
        attemptId: row.attemptId,
        code: PROVIDER_OUTCOME_UNKNOWN_CODE,
      });
    } else if (!result.ok) {
      failed += 1;
    }
  }
  return buildWorkerObservation({
    nowMs,
    ok: true,
    code: due.length === 0 ? "IDLE" : reviewRequired > 0 ? "RECONCILIATION_REQUIRED" : "COMPLETE",
    backlog: due.length,
    processed,
    extracted,
    unknown,
    failed,
    reviewRequired,
    oldestDueExpiresAtMs,
  });
}

const evidence = {
  at: new Date().toISOString(),
  production: false,
  tagCity: false,
  gateEnabled: true,
  providerExtract: false,
  attemptId: null,
  sourceId: null,
  tick: null,
  claim: null,
  afterTick: null,
  publish: null,
  error: null,
};

const work = mkdtempSync(join(tmpdir(), "velora-kfw-tick-"));
let db;
let server;
try {
  db = await isolatedPostgres();
  evidence.container = db.container;
  await db.bootstrap({ throughMigration: MUTATIONS_THROUGH, skipMigrations: [] });

  for (const name of ["10-file-attempts.review.sql", "11-worker-ops.review.sql"]) {
    const body = stripReviewStop(
      readFileSync(join("supabase/upgrade-packages/knowledge-file-worker", name), "utf8"),
    );
    const file = join(work, name);
    writeFileSync(file, body, "utf8");
    await db.file(file, { transactionalMigration: true });
  }

  const company = randomUUID();
  const actor = randomUUID();
  const session = randomUUID();
  const sourceId = randomUUID();
  const objectId = randomUUID();
  const attemptId = randomUUID();
  const txtBody =
    "Isolated worker tick proof text/plain — local extract only, provider locked.";
  const bytes = Buffer.from(txtBody, "utf8");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const path = `${company}/${sourceId}/worker-tick-proof.txt`;
  const seedUpdated = "2026-10-31T17:00:00.000000Z";

  await db.sql(`
    insert into auth.users(id,email,email_confirmed_at)
      values(${lit(actor)},'kfw-tick@example.invalid',now()) on conflict do nothing;
    insert into auth.sessions(id,user_id) values(${lit(session)},${lit(actor)}) on conflict do nothing;
    insert into private.app_session_activity(session_id,user_id,last_activity_at)
      values(${lit(session)},${lit(actor)},clock_timestamp()) on conflict do nothing;
    insert into public.companies(id,display_name,business_type,hours,status,created_by)
      values(${lit(company)},'KFW tick','restaurant','09:00-18:00','active',${lit(actor)})
      on conflict do nothing;
    insert into public.company_members(company_id,user_id,role,status)
      values(${lit(company)},${lit(actor)},'owner','active') on conflict do nothing;
  `);
  const branchId = await db.sql(
    `select id::text from public.company_branches where company_id=${lit(company)} and is_primary limit 1`,
  );
  if (!/^[0-9a-f-]{36}$/i.test(branchId)) throw Error(`PRIMARY_BRANCH_MISSING:${branchId}`);

  await db.sql(`
    insert into storage.buckets(id,name,public) values('company-knowledge','company-knowledge',false)
      on conflict do nothing;
    insert into storage.objects(id,bucket_id,name,owner,updated_at)
      values(${lit(objectId)},'company-knowledge',${lit(path)},${lit(actor)},${lit(seedUpdated)}::timestamptz);
    insert into public.knowledge_sources(
      id,company_id,kind,title,content,file_name,content_type,byte_size,storage_path,status,content_version,updated_at,created_by
    ) values(
      ${lit(sourceId)},${lit(company)},'file','worker-tick-proof','','worker-tick-proof.txt','text/plain',
      ${bytes.byteLength},${lit(path)},'stored',1,${lit(seedUpdated)}::timestamptz,${lit(actor)}
    );
    insert into private.es02_branch_knowledge_sources(company_id,branch_id,source_id)
      values(${lit(company)},${lit(branchId)}::uuid,${lit(sourceId)});
    insert into private.g03_company_inputs(company_id) values(${lit(company)}) on conflict do nothing;
  `);

  const live = JSON.parse(await db.sql(`
    select jsonb_build_object(
      'updated_at', to_char(k.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'version', k.content_version,
      'path', k.storage_path,
      'object_updated_at', to_char(o.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )
    from public.knowledge_sources k
    join storage.objects o on o.id=${lit(objectId)}::uuid
    where k.id=${lit(sourceId)}
  `));

  const claimRaw = await db.sql(`
    begin; set local role service_role;
    select public.g03_claim_file_attempt(
      ${lit(actor)}::uuid,${lit(session)}::uuid,${lit(company)}::uuid,${lit(sourceId)}::uuid,
      ${lit(attemptId)}::uuid,${lit(branchId)}::uuid,${live.version},
      ${lit(live.updated_at)}::timestamptz,${lit(live.path)},${lit(objectId)}::uuid,
      ${lit(live.object_updated_at)}::timestamptz,(clock_timestamp()+interval '15 minutes'),null
    );
    commit;
  `);
  const claim = JSON.parse(claimRaw);
  evidence.attemptId = attemptId;
  evidence.sourceId = sourceId;
  evidence.claim = {
    ok: claim.ok === true,
    attemptId: claim.attemptId ?? null,
    replayed: claim.replayed === true,
    sourceStatus: claim.source?.status ?? null,
  };
  if (!claim.ok) throw Error(`CLAIM_FAILED:${JSON.stringify(claim).slice(0, 300)}`);

  const byteStore = new Map([[sourceId, bytes]]);

  function sqlPorts() {
    return {
      nowMs: () => Date.now(),
      async listDue(limit) {
        const rows = JSON.parse(await db.sql(`
          begin; set local role service_role;
          select public.g03_list_running_file_attempts(${Math.min(Math.max(limit, 1), 50)});
          commit;
        `));
        return (Array.isArray(rows) ? rows : []).flatMap((r) => {
          if (
            typeof r.source_id !== "string"
            || typeof r.attempt_id !== "string"
            || typeof r.company_id !== "string"
            || typeof r.branch_id !== "string"
            || typeof r.actor_id !== "string"
            || typeof r.session_id !== "string"
            || typeof r.expires_at !== "string"
            || typeof r.content_version !== "number"
            || typeof r.storage_path !== "string"
            || typeof r.object_id !== "string"
            || typeof r.object_updated_at !== "string"
          ) {
            return [];
          }
          const dispatch = r.provider_dispatch;
          return [{
            sourceId: r.source_id,
            attemptId: r.attempt_id,
            companyId: r.company_id,
            branchId: r.branch_id,
            actorId: r.actor_id,
            sessionId: r.session_id,
            expiresAt: r.expires_at,
            contentVersion: r.content_version,
            storagePath: r.storage_path,
            objectId: r.object_id,
            objectUpdatedAt: r.object_updated_at,
            providerDispatch:
              dispatch === "dispatched" || dispatch === "unknown" || dispatch === "verified"
                ? dispatch
                : "none",
          }];
        });
      },
      forAttempt(row) {
        let cached = byteStore.get(row.sourceId) ?? null;
        return {
          nowMs: () => Date.now(),
          async loadAttempt() {
            const a = JSON.parse(await db.sql(`
              begin; set local role service_role;
              select public.g03_read_file_attempt(${lit(row.sourceId)}::uuid);
              commit;
            `));
            if (a.ok === false) return null;
            if (
              typeof a.attempt_id !== "string"
              || typeof a.state !== "string"
              || typeof a.expires_at !== "string"
              || typeof a.content_version !== "number"
              || typeof a.storage_path !== "string"
            ) {
              return null;
            }
            if (a.state !== "running" && a.state !== "published" && a.state !== "failed") return null;
            return {
              attemptId: a.attempt_id,
              state: a.state,
              expiresAt: a.expires_at,
              contentVersion: a.content_version,
              storagePath: a.storage_path,
            };
          },
          async loadSource() {
            const s = JSON.parse(await db.sql(`
              select jsonb_build_object(
                'status', status, 'content_version', content_version, 'storage_path', storage_path
              ) from public.knowledge_sources where id=${lit(row.sourceId)}
            `));
            if (typeof s.status !== "string" || typeof s.content_version !== "number" || typeof s.storage_path !== "string") {
              return null;
            }
            return {
              status: s.status,
              contentVersion: s.content_version,
              storagePath: s.storage_path,
            };
          },
          async extract() {
            const meta = JSON.parse(await db.sql(`
              select jsonb_build_object(
                'file_name', file_name, 'content_type', content_type
              ) from public.knowledge_sources where id=${lit(row.sourceId)}
            `));
            if (meta.content_type !== "text/plain" && !String(meta.file_name || "").endsWith(".txt")) {
              return { ok: false, evidence: "safe_failure", code: "PROVIDER_EXTRACT_DISABLED" };
            }
            const fileBytes = byteStore.get(row.sourceId);
            if (!fileBytes) {
              return { ok: false, evidence: "safe_failure", code: "BYTES_MISSING" };
            }
            cached = fileBytes;
            const extracted = extractLocalPlainText(fileBytes);
            if (!extracted.ok) {
              return { ok: false, evidence: "safe_failure", code: extracted.code };
            }
            return { ok: true, text: extracted.text, evidence: "none" };
          },
          async publish(input) {
            const fileBytes = cached ?? byteStore.get(row.sourceId);
            if (!fileBytes) return { ok: false, code: "BYTES_REQUIRED_FOR_PUBLISH" };
            const out = JSON.parse(await db.sql(`
              begin; set local role service_role;
              select public.g03_publish_file_attempt(
                ${lit(input.attemptId)}::uuid,${lit(row.actorId)}::uuid,${lit(row.sessionId)}::uuid,
                ${lit(input.sourceId)}::uuid,${lit(row.companyId)}::uuid,${lit(row.branchId)}::uuid,
                ${row.contentVersion},${lit(row.storagePath)},${lit(input.text)},
                ${lit(createHash("sha256").update(fileBytes).digest("hex"))},
                ${fileBytes.byteLength},${lit(row.objectId)}::uuid,${lit(row.objectUpdatedAt)}::timestamptz
              );
              commit;
            `));
            return out?.ok === true
              ? { ok: true }
              : { ok: false, code: typeof out?.code === "string" ? out.code : "PUBLISH_REJECTED" };
          },
          async failAttempt(input) {
            const out = JSON.parse(await db.sql(`
              begin; set local role service_role;
              select public.g03_control_file_attempt(
                ${lit(row.actorId)}::uuid,${lit(row.sessionId)}::uuid,${lit(row.companyId)}::uuid,
                ${lit(input.sourceId)}::uuid,${lit(input.attemptId)}::uuid,${lit(row.branchId)}::uuid,
                'fail',null,${lit(input.code)}
              );
              commit;
            `));
            return out?.ok === true;
          },
        };
      },
    };
  }

  const ports = sqlPorts();
  server = createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || req.url !== "/api/internal/knowledge/file-worker") {
        res.writeHead(404);
        res.end();
        return;
      }
      const auth = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
      if (auth !== secret) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "UNAUTHORIZED" }));
        return;
      }
      if (process.env.VELORA_KNOWLEDGE_FILE_WORKER_ENABLED !== "true") {
        res.writeHead(503, { "content-type": "application/json" });
        res.end(JSON.stringify({ code: "WORKER_DISABLED" }));
        return;
      }
      const observation = await processKnowledgeFileWorkerBatch(ports, 10);
      const status =
        observation.code === "LIST_UNAVAILABLE" || observation.code === "ADMIN_UNAVAILABLE"
          ? 503
          : observation.reviewRequired > 0 || observation.stalledDueWork
            ? 202
            : 200;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(observation));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "TICK_ERROR", message: String(error?.message ?? error).slice(0, 200) }));
    }
  });

  const port = await new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => ok(server.address().port));
  });
  const tickUrl = `http://127.0.0.1:${port}/api/internal/knowledge/file-worker`;
  const tickRes = await fetch(tickUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
  });
  const tickBody = await tickRes.json();
  evidence.tick = {
    url: tickUrl,
    httpStatus: tickRes.status,
    ok: tickRes.status === 200 && tickBody?.ok === true,
    code: tickBody?.code ?? null,
    processed: tickBody?.processed ?? null,
    extracted: tickBody?.extracted ?? null,
    failed: tickBody?.failed ?? null,
    backlog: tickBody?.backlog ?? null,
  };
  if (!evidence.tick.ok) throw Error(`TICK_NOT_SUCCESS:${JSON.stringify(tickBody).slice(0, 400)}`);

  const after = JSON.parse(await db.sql(`
    select jsonb_build_object(
      'source_status', k.status,
      'content_version', k.content_version,
      'content_prefix', left(k.content, 48),
      'attempt_state', a.state,
      'attempt_id', a.attempt_id
    )
    from public.knowledge_sources k
    left join private.g03_file_attempts a on a.source_id=k.id
    where k.id=${lit(sourceId)}
  `));
  evidence.afterTick = after;
  evidence.publish = {
    ok: after.source_status === "ready" && after.attempt_state === "published" && after.attempt_id === attemptId,
    contentMatches: String(after.content_prefix || "").startsWith("Isolated worker tick proof"),
  };
  if (!evidence.publish.ok) throw Error(`PUBLISH_NOT_OBSERVED:${JSON.stringify(after)}`);

  evidence.status = "PASS_WORKER_TICK_JOURNEY";
  console.log(
    `PASS|attemptId=${attemptId}|tick=${tickRes.status}/${tickBody.code}|published=${after.source_status}/${after.attempt_state}`,
  );
} catch (error) {
  evidence.status = "FAIL_WORKER_TICK_JOURNEY";
  evidence.error = String(error?.message ?? error).slice(0, 800);
  console.log(`FAIL|${evidence.error}`);
  process.exitCode = 1;
} finally {
  if (server) {
    await new Promise((ok) => server.close(ok));
  }
  try {
    if (db) {
      await db.close();
      evidence.cleaned = true;
    }
  } catch {
    evidence.cleaned = false;
  }
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  evidence.at_end = new Date().toISOString();
  // Never persist the live secret.
  evidence.secretConfiguredLength = secret.length;
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n", "utf8");
  console.log(`EVIDENCE|${evidencePath}|${evidence.status}`);
}
