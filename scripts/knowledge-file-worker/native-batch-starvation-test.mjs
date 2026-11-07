// CLN-17: Isolated native PostgreSQL verification for Knowledge File Worker batch starvation prevention
// Proves on real PostgreSQL (port 55439) that:
// 1. 10 expired attempts before provider do not starve subsequent valid attempts.
// 2. Expired pre-provider attempts are transitioned to failed via g03_control_file_attempt, preventing infinite loop.
// 3. Valid attempts are processed within bounded cycles.
// 4. Unknown/dispatched external provider results remain on review hold without blind re-execution.

import pg from 'pg';
import { normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { processKnowledgeFileWorkerBatch } from '../../src/lib/knowledge/file-worker/batch-core.ts';

const expected = normalize(resolve('.git/velora-isolated-pg/data')).toLowerCase();
const base = { host: '127.0.0.1', port: 55439, user: 'postgres', database: 'postgres', connectionTimeoutMillis: 5000 };
const control = new pg.Client(base);
const dbName = `velora_kfw_${randomUUID().replaceAll('-', '')}`;

console.log('[CLN-17] Connecting to local isolated PostgreSQL on port 55439...');
await control.connect();
const actualDataDir = normalize((await control.query('show data_directory')).rows[0].data_directory).toLowerCase();
if (actualDataDir !== expected) throw Error('REFUSE_NON_ISOLATED_DATABASE');

console.log(`[CLN-17] Creating isolated test database: ${dbName}`);
await control.query(`create database ${dbName}`);

const db = new pg.Client({ ...base, database: dbName });
await db.connect();

try {
  // Set up schema and migration functions from 10 & 11 review SQL
  await db.query(`
    create schema private;
    grant usage on schema private to service_role;
    grant all on schema private to service_role;
    create table private.g03_file_attempts(
      source_id uuid primary key,
      company_id uuid not null,
      branch_id uuid not null,
      attempt_id uuid not null unique,
      actor_id uuid not null,
      session_id uuid not null,
      state text not null check(state in ('running','published','failed')),
      expires_at timestamptz not null,
      source_updated_at timestamptz not null default now(),
      content_version integer not null default 1,
      storage_path text not null default 'test.txt',
      object_id uuid not null default gen_random_uuid(),
      object_updated_at timestamptz not null default now(),
      provider_dispatch text not null default 'none' check (provider_dispatch in ('none','dispatched','unknown','verified'))
    );
    grant all on private.g03_file_attempts to service_role;
    alter table private.g03_file_attempts enable row level security;

    create or replace function public.g03_list_running_file_attempts(p_limit integer default 20)
    returns jsonb language plpgsql security definer set search_path='' as $$
    declare rows jsonb;
    begin
      if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501'; end if;
      if p_limit is null or p_limit<1 or p_limit>50 then raise exception 'invalid_input' using errcode='22023'; end if;
      select coalesce(jsonb_agg(jsonb_build_object(
        'source_id',a.source_id,'attempt_id',a.attempt_id,'company_id',a.company_id,'branch_id',a.branch_id,
        'actor_id',a.actor_id,'session_id',a.session_id,'expires_at',a.expires_at,
        'provider_dispatch',a.provider_dispatch,'content_version',a.content_version,'storage_path',a.storage_path,
        'object_id',a.object_id,'object_updated_at',a.object_updated_at
      ) order by (case when a.expires_at > clock_timestamp() then 0 else 1 end) asc, a.expires_at asc), '[]'::jsonb)
      into rows
      from (
        select * from private.g03_file_attempts where state='running'
        order by (case when expires_at > clock_timestamp() then 0 else 1 end) asc, expires_at asc
        limit p_limit
      ) a;
      return rows;
    end; $$;

    create or replace function public.g03_control_file_attempt(
      p_actor_id uuid,p_session_id uuid,p_company_id uuid,p_source_id uuid,p_attempt_id uuid,p_branch_id uuid,
      p_action text,p_expires_at timestamptz default null,p_failure_code text default null
    ) returns jsonb language plpgsql security definer set search_path='' as $$
    declare a private.g03_file_attempts%rowtype;
    begin
      if current_setting('role',true)<>'service_role' then raise exception 'SERVER_ROLE_REQUIRED' using errcode='42501'; end if;
      select * into a from private.g03_file_attempts where source_id=p_source_id for update;
      if not found or a.attempt_id<>p_attempt_id or a.state<>'running' then
        return jsonb_build_object('ok',false,'code','ATTEMPT_STATE_CONFLICT');
      end if;
      if p_action='fail' then
        update private.g03_file_attempts set state='failed' where source_id=p_source_id;
        return jsonb_build_object('ok',true,'state','failed','code',p_failure_code);
      elsif p_action='publish' then
        update private.g03_file_attempts set state='published' where source_id=p_source_id;
        return jsonb_build_object('ok',true,'state','published');
      end if;
      return jsonb_build_object('ok',false,'code','UNKNOWN_ACTION');
    end; $$;
  `);

  const companyId = randomUUID(), branchId = randomUUID(), actorId = randomUUID(), sessionId = randomUUID();

  console.log('[CLN-17] Seeding 10 expired pre-provider attempts...');
  for (let i = 1; i <= 10; i++) {
    await db.query(
      `insert into private.g03_file_attempts(source_id, company_id, branch_id, attempt_id, actor_id, session_id, state, expires_at, provider_dispatch)
       values($1, $2, $3, $4, $5, $6, 'running', clock_timestamp() - interval '${100 - i * 5} seconds', 'none')`,
      [randomUUID(), companyId, branchId, randomUUID(), actorId, sessionId]
    );
  }

  const validAttemptId = randomUUID(), validSourceId = randomUUID();
  console.log('[CLN-17] Seeding 1 valid runnable attempt following the expired ones...');
  await db.query(
    `insert into private.g03_file_attempts(source_id, company_id, branch_id, attempt_id, actor_id, session_id, state, expires_at, provider_dispatch)
     values($1, $2, $3, $4, $5, $6, 'running', clock_timestamp() + interval '5 minutes', 'none')`,
    [validSourceId, companyId, branchId, validAttemptId, actorId, sessionId]
  );

  // Assertion 1: Verify SQL selection prioritizes active attempts over expired attempts
  await db.query('set role service_role');
  const initialList = (await db.query('select public.g03_list_running_file_attempts(10) res')).rows[0].res;
  assert.equal(initialList.length, 10, 'Expected batch of 10 items');
  // First item MUST be the valid unexpired attempt due to: (case when expires_at > clock_timestamp() then 0 else 1 end) asc
  assert.equal(initialList[0].attempt_id, validAttemptId, 'Active attempt MUST be ordered first in SQL, preventing starvation');
  console.log('PASS: SQL ordering prioritizes active attempts before expired ones');

  // Build batch adapter backed by real PostgreSQL
  function createRealSqlBatchPorts() {
    return {
      nowMs: () => Date.now(),
      listDue: async (limit) => {
        const res = await db.query('select public.g03_list_running_file_attempts($1) res', [limit]);
        const rows = res.rows[0].res;
        return rows.map(r => ({
          sourceId: r.source_id,
          attemptId: r.attempt_id,
          companyId: r.company_id,
          branchId: r.branch_id,
          actorId: r.actor_id,
          sessionId: r.session_id,
          expiresAt: r.expires_at,
          providerDispatch: r.provider_dispatch,
          contentVersion: r.content_version,
          storagePath: r.storage_path,
          objectId: r.object_id,
          objectUpdatedAt: r.object_updated_at,
        }));
      },
      forAttempt: (row) => ({
        nowMs: () => Date.now(),
        loadAttempt: async () => ({
          attemptId: row.attemptId,
          state: 'running',
          expiresAt: row.expiresAt,
          contentVersion: row.contentVersion,
          storagePath: row.storagePath,
        }),
        loadSource: async () => ({
          status: 'processing',
          contentVersion: row.contentVersion,
          storagePath: row.storagePath,
        }),
        extract: async () => ({
          ok: true,
          text: 'Extracted plain text from valid attempt',
          evidence: 'none',
        }),
        publish: async () => {
          const r = (await db.query(
            'select public.g03_control_file_attempt($1,$2,$3,$4,$5,$6,$7) res',
            [row.actorId, row.sessionId, row.companyId, row.sourceId, row.attemptId, row.branchId, 'publish']
          )).rows[0].res;
          return { ok: r.ok === true };
        },
        failAttempt: async ({ code }) => {
          const r = (await db.query(
            'select public.g03_control_file_attempt($1,$2,$3,$4,$5,$6,$7,null,$8) res',
            [row.actorId, row.sessionId, row.companyId, row.sourceId, row.attemptId, row.branchId, 'fail', code]
          )).rows[0].res;
          return r.ok === true;
        },
      }),
    };
  }

  // Assertion 2: Cycle 1 processes the 10 items (1 valid extracted, 9 expired reaped)
  console.log('[CLN-17] Executing Batch Cycle 1 on real PostgreSQL...');
  const ports = createRealSqlBatchPorts();
  const obs1 = await processKnowledgeFileWorkerBatch(ports, 10);
  console.log('[CLN-17] Cycle 1 observation:', JSON.stringify(obs1));
  assert.equal(obs1.processed, 10);
  assert.equal(obs1.extracted, 1, 'Valid attempt extracted in Cycle 1');
  assert.equal(obs1.failed, 9, '9 expired attempts transitioned to failed in Cycle 1');

  // Verify in PostgreSQL table directly
  const stateCounts1 = (await db.query('select state, count(*)::int n from private.g03_file_attempts group by state order by state')).rows;
  console.log('[CLN-17] PostgreSQL state counts after Cycle 1:', JSON.stringify(stateCounts1));
  assert.deepEqual(stateCounts1, [
    { state: 'failed', n: 9 },
    { state: 'published', n: 1 },
    { state: 'running', n: 1 } // exactly 1 expired attempt remains from the original 10
  ]);

  // Assertion 3: Cycle 2 finishes remaining 1 expired attempt, reaching 0 running
  console.log('[CLN-17] Executing Batch Cycle 2 on real PostgreSQL...');
  const obs2 = await processKnowledgeFileWorkerBatch(ports, 10);
  console.log('[CLN-17] Cycle 2 observation:', JSON.stringify(obs2));
  assert.equal(obs2.processed, 1);
  assert.equal(obs2.failed, 1);

  const stateCounts2 = (await db.query('select state, count(*)::int n from private.g03_file_attempts group by state order by state')).rows;
  console.log('[CLN-17] PostgreSQL state counts after Cycle 2:', JSON.stringify(stateCounts2));
  assert.deepEqual(stateCounts2, [
    { state: 'failed', n: 10 },
    { state: 'published', n: 1 }
  ]);
  console.log('PASS: All 10 expired attempts reaped and 1 valid attempt published in bounded cycles (2 cycles)');

  // Assertion 4: Verify unknown external provider results remain on review hold without blind retry
  console.log('[CLN-17] Testing unknown external provider outcome on real PostgreSQL...');
  const unknownSourceId = randomUUID(), unknownAttemptId = randomUUID();
  await db.query(
    `insert into private.g03_file_attempts(source_id, company_id, branch_id, attempt_id, actor_id, session_id, state, expires_at, provider_dispatch)
     values($1, $2, $3, $4, $5, $6, 'running', clock_timestamp() - interval '1 minute', 'dispatched')`,
    [unknownSourceId, companyId, branchId, unknownAttemptId, actorId, sessionId]
  );

  let extractCalledForUnknown = false;
  const unknownPorts = {
    ...ports,
    forAttempt: (row) => ({
      ...ports.forAttempt(row),
      extract: async () => {
        extractCalledForUnknown = true;
        return { ok: false, evidence: 'none', code: 'SHOULD_NOT_EXTRACT' };
      },
    }),
  };

  const obsUnknown = await processKnowledgeFileWorkerBatch(unknownPorts, 10);
  console.log('[CLN-17] Unknown attempt observation:', JSON.stringify(obsUnknown));
  assert.equal(obsUnknown.code, 'RECONCILIATION_REQUIRED');
  assert.equal(obsUnknown.unknown, 1);
  assert.equal(obsUnknown.reviewRequired, 1);
  assert.equal(extractCalledForUnknown, false, 'Provider extract MUST NOT be called for unverified in-flight attempts');

  // Verify DB state
  const unknownAttemptState = (await db.query('select state from private.g03_file_attempts where attempt_id=$1', [unknownAttemptId])).rows[0].state;
  assert.equal(unknownAttemptState, 'failed', 'Unknown attempt failed with PROVIDER_OUTCOME_UNKNOWN code and held for reconciliation');
  console.log('PASS: Unknown provider outcome held for reconciliation without blind re-execution');

  console.log('\n=== ALL CLN-17 NATIVE SQL ASSERTIONS PASSED SUCCESSFULLY ===');
} finally {
  await db.end();
  await control.query(`drop database if exists ${dbName}`);
  await control.end();
}
