import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { isolatedPostgres, lit } from '../g03-review-acceptance/postgres.mjs';
import { assemble } from './build.mjs';
const state = vi.hoisted(() => ({ service: null }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.service }));
import { readExactStorageGeneration } from '@/lib/knowledge/exact-generation';
import { publishPreparedFile } from '@/lib/knowledge/prepared-publication';
const uuid = label => createHash('md5').update(label).digest('hex').replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5');
const actor = uuid('precision-owner'), session = uuid('precision-session'), company = uuid('precision-company'), source = uuid('precision-file'), object = uuid('precision-object');
const path = `${company}/${source}/synthetic.txt`;
const exact = '2026-10-10T03:34:24.587754Z';
let db;
const readRpc = async (name, args) => {
  if (name !== 'g03_read_file_generation') throw Error('RPC_OUTSIDE_SCOPE');
  const values = Object.entries(args).map(([k,v]) => `${k}=>${lit(v)}`).join(',');
  try { return { data: JSON.parse(await db.sql(`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL "request.jwt.claim.sub"=${lit(actor)};SET LOCAL "request.jwt.claims"=${lit(JSON.stringify({sub:actor,session_id:session,role:'authenticated'}))};SELECT public.g03_read_file_generation(${values});COMMIT;`)), error: null }; }
  catch (e) { return {data:null,error:{message:e.message}}; }
};
const readInput = {sourceId:source,companyId:company,storagePath:path};
const authenticated = { rpc: readRpc, auth: { getClaims: async () => ({ data: { claims: { sub: actor, session_id: session } }, error: null }) } };
beforeAll(async () => {
  if (!process.env.VELORA_G03_SCHEMA) throw Error('PRIVATE_METADATA_PATH_REQUIRED: VELORA_G03_SCHEMA');
  db = await isolatedPostgres();
  await db.bootstrap({ baselineMetadataPath: process.env.VELORA_G03_SCHEMA });
  const pkg = assemble(); await db.sql(pkg.containment); await db.sql(pkg.bundle); await db.file("supabase/migrations/20261010050337_g03_exact_file_generation.sql");
  await db.sql(`INSERT INTO auth.users(id,email,email_confirmed_at) VALUES(${lit(actor)},'precision@example.invalid',now());
INSERT INTO auth.sessions(id,user_id) VALUES(${lit(session)},${lit(actor)});
INSERT INTO private.app_session_activity(session_id,user_id,last_activity_at) VALUES(${lit(session)},${lit(actor)},clock_timestamp());
INSERT INTO public.companies(id,display_name,business_type,hours,created_by) VALUES(${lit(company)},'Synthetic shop','shop','09-18',${lit(actor)});
INSERT INTO public.company_members(company_id,user_id,role,status) VALUES(${lit(company)},${lit(actor)},'owner','active');
INSERT INTO storage.objects(id,bucket_id,name,owner,updated_at) VALUES(${lit(object)},'company-knowledge',${lit(path)},${lit(actor)},${lit(exact)});
INSERT INTO public.knowledge_sources(id,company_id,kind,title,content,status,file_name,content_type,byte_size,storage_path,created_by) VALUES(${lit(source)},${lit(company)},'file','Synthetic','','processing','synthetic.txt','text/plain',3,${lit(path)},${lit(actor)});`);
  state.service = { rpc: async (name, args) => {
    if (name !== 'g03_publish_prepared_file') throw Error('RPC_OUTSIDE_SCOPE');
    const values = Object.entries(args).map(([k,v]) => `${k}=>${typeof v === 'number' ? v : lit(v)}`).join(',');
    try { return { data: JSON.parse(await db.sql(`BEGIN;SET LOCAL ROLE service_role;SELECT public.g03_publish_prepared_file(${values});COMMIT;`)), error: null }; }
    catch (e) { return { data: null, error: { message: e.message } }; }
  }};
});
afterAll(async () => { if (db) await db.close(); });
it('rejects truncated Storage generation without mutating proof, then publishes the exact generation', async () => {
  const result = await publishPreparedFile(authenticated, { sourceId: source, companyId: company, expectedVersion: 1, storagePath: path, text: 'Synthetic extraction', bytes: Buffer.from('abc'), generation: { objectId: object, updatedAt: new Date(exact).toISOString() } });
  expect(result).toEqual({ ok: false, reason: 'superseded' });
  const unchanged = JSON.parse(await db.sql(`SELECT jsonb_build_object('status',status,'approved',approved_for_answers,'file_proof',prepared_file_sha256,'text_proof',prepared_text_sha256,'version_proof',prepared_content_version) FROM public.knowledge_sources WHERE id=${lit(source)};`));
  expect(unchanged).toEqual({status:'processing',approved:false,file_proof:null,text_proof:null,version_proof:null});
  const read = await readExactStorageGeneration(authenticated, readInput);
  expect(read.status).toBe("ok"); if(read.status!=="ok") throw Error("GENERATION_UNAVAILABLE");
  expect(read.generation.updatedAt).toBe(exact);
  const precise = await publishPreparedFile(authenticated, { sourceId: source, companyId: company, expectedVersion: 1, storagePath: path, text: 'Synthetic extraction', bytes: Buffer.from('abc'), generation: read.generation });
  expect(precise.ok).toBe(true);
  expect(precise.row).toMatchObject({status:'ready',content_version:2,prepared_content_version:2,approved_for_answers:false,prepared_file_sha256:createHash('sha256').update('abc').digest('hex'),prepared_text_sha256:createHash('sha256').update('Synthetic extraction').digest('hex')});
});




it('rejects same-millisecond object replacement and the captured stale publication', async () => {
  const before = await readExactStorageGeneration(authenticated, readInput);
  await db.sql(`ALTER TABLE storage.objects DISABLE TRIGGER update_objects_updated_at;UPDATE storage.objects SET updated_at='2026-10-10T03:34:24.587755Z' WHERE id=${lit(object)};ALTER TABLE storage.objects ENABLE TRIGGER update_objects_updated_at;UPDATE public.knowledge_sources SET status='processing' WHERE id=${lit(source)};`);
  const after = await readExactStorageGeneration(authenticated, readInput);
  expect(before.status).toBe('ok');expect(after.status).toBe('ok');
  expect(before.generation.updatedAt).not.toBe(after.generation.updatedAt);
  expect(new Date(before.generation.updatedAt).toISOString()).toBe(new Date(after.generation.updatedAt).toISOString());
  const version=Number(await db.sql(`SELECT content_version FROM public.knowledge_sources WHERE id=${lit(source)};`));
  expect(await publishPreparedFile(authenticated,{sourceId:source,companyId:company,expectedVersion:version,storagePath:path,text:'Stale extraction',bytes:Buffer.from('abc'),generation:before.generation})).toEqual({ok:false,reason:'superseded'});
});
it('does not read or publish after source path replacement', async () => {
  const before=await readExactStorageGeneration(authenticated,readInput);
  await db.sql(`UPDATE public.knowledge_sources SET storage_path=${lit(path+'.other')} WHERE id=${lit(source)};`);
  expect(await readExactStorageGeneration(authenticated,readInput)).toEqual({status:'missing'});
  const version=Number(await db.sql(`SELECT content_version FROM public.knowledge_sources WHERE id=${lit(source)};`));
  expect(await publishPreparedFile(authenticated,{sourceId:source,companyId:company,expectedVersion:version,storagePath:path,text:'Stale extraction',bytes:Buffer.from('abc'),generation:before.generation})).toEqual({ok:false,reason:'superseded'});
  await db.sql(`UPDATE public.knowledge_sources SET storage_path=${lit(path)} WHERE id=${lit(source)};`);
});
it('denies anonymous/service calls, cross-company paths, and action spoofing', async () => {
  for(const role of ['anon','service_role']) await expect(db.sql(`BEGIN;SET LOCAL ROLE ${role};SELECT public.g03_read_file_generation(${lit(source)},${lit(company)},${lit(path)});COMMIT;`)).rejects.toThrow(/permission denied/);
  expect(await readExactStorageGeneration(authenticated,{...readInput,companyId:uuid('another-company')})).toEqual({status:'error'});
  expect((await readRpc('g03_read_file_generation',{p_source_id:source,p_company_id:company,p_storage_path:path,p_action:'request_changes'})).error).not.toBe(null);
});
it('denies malformed paths and null source identity without exposing metadata',async()=>{
  for(const bad of [`${company}/${source}/../other`,`${company}/${source}/bad\\name`,null]) {
    const args={p_source_id:source,p_company_id:company,p_storage_path:bad,p_action:'publish'};
    const values=Object.entries(args).map(([k,v])=>`${k}=>${v===null?'NULL':lit(v)}`).join(',');
    await expect(db.sql(`BEGIN;SET LOCAL ROLE authenticated;SELECT public.g03_read_file_generation(${values});COMMIT;`)).rejects.toThrow(/invalid_input/);
  }
});
it('rechecks permission and session revocation at generation read and publication', async () => {
  const before=await readExactStorageGeneration(authenticated,readInput);
  const version=Number(await db.sql(`SELECT content_version FROM public.knowledge_sources WHERE id=${lit(source)};`));
  const publish=()=>publishPreparedFile(authenticated,{sourceId:source,companyId:company,expectedVersion:version,storagePath:path,text:'Revoked extraction',bytes:Buffer.from('abc'),generation:before.generation});
  await db.sql(`UPDATE public.company_members SET status='disabled' WHERE company_id=${lit(company)} AND user_id=${lit(actor)};`);
  expect(await readExactStorageGeneration(authenticated,readInput)).toEqual({status:'error'});
  expect(await publish()).toEqual({ok:false,reason:'error'});
  await db.sql(`UPDATE public.company_members SET status='active' WHERE company_id=${lit(company)} AND user_id=${lit(actor)};UPDATE private.app_session_activity SET expired_at=clock_timestamp() WHERE session_id=${lit(session)};`);
  expect(await readExactStorageGeneration(authenticated,readInput)).toEqual({status:'error'});
  expect(await publish()).toEqual({ok:false,reason:'error'});
});
