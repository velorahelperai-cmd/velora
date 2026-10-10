// Disposable financial-contract replay only; no URLs, env files or provider clients.
import {readFileSync,readdirSync,realpathSync} from 'node:fs';
import {relative,isAbsolute,join} from 'node:path';
import {createHash} from 'node:crypto';
import {assertNoSecrets} from '../g03-cloud-upgrade/schema-replay.mjs';
const q=s=>'"'+s.replaceAll('"','""')+'"';
// pg_get_constraintdef expands BETWEEN. Preserve the original source spelling
// for these two checks so reparsing retains the same nested Boolean expression.
const originalCheck={billing_orders_product_code_chk:'CHECK (char_length(btrim(product_code)) BETWEEN 1 AND 64 AND product_code=btrim(product_code))',billing_payment_attempts_open_client_op_chk:'CHECK (open_client_op_id IS NULL OR (char_length(btrim(open_client_op_id)) BETWEEN 1 AND 128 AND open_client_op_id=btrim(open_client_op_id)))'};
const hash=s=>createHash('md5').update(s.replaceAll('\r','')).digest('hex');
export function metadata(){
 const path=realpathSync(process.env.VELORA_STAGE1_METADATA??'');
 const rel=relative(realpathSync('.'),path);
 if(!isAbsolute(rel)&&!rel.startsWith('..'))throw Error('METADATA_MUST_STAY_OUTSIDE_GIT');
 const raw=readFileSync(path,'utf8');assertNoSecrets(raw);
 const manifest=JSON.parse(readFileSync('supabase/upgrade-packages/financial-proof-cloud/manifest.json','utf8'));
 if(createHash('sha256').update(raw).digest('hex')!==manifest.metadata_sha256)throw Error('METADATA_FINGERPRINT_CHANGED');
 const m=JSON.parse(raw);if(m.project!=='vmpifljyozsbtssxhoxd'||m.tables.length!==7)throw Error('WRONG_METADATA');
 return m;
}
export function sourceDefinitions(){
 const defs=[];
 function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){
  const p=join(dir,e.name);if(e.isDirectory())walk(p);else if(e.name.endsWith('.sql')){
   const s=readFileSync(p,'utf8').replace(/^\uFEFF/,'');
   for(const m of s.matchAll(/create\s+(?:or\s+replace\s+)?function\s+((?:public|private)\.[a-z_][a-z0-9_]*)/gi)){
    const tail=s.slice(m.index+m[0].length),a=/\bas\s+(\$[a-z_0-9]*\$)/i.exec(tail);if(!a)continue;
    const start=m.index+m[0].length+a.index+a[0].length,end=s.indexOf(a[1],start);if(end<0)continue;
    const finish=s.indexOf(';',end+a[1].length);
    defs.push({name:m[1],hash:hash(s.slice(start,end)),sql:s.slice(m.index,finish+1)});
   }
  }
 }}walk('supabase');return defs;
}
export async function replay(db,m){
 await db.bootstrap({throughMigration:'20261008070000_vel_staff_invitations.sql'});
 await db.verify();
 const defs=sourceDefinitions(),roles=(await db.sql('SELECT rolname FROM pg_roles ORDER BY rolname')).split('\n');
 const principals=['PUBLIC',...roles.map(q)].join(',');
 const sql=['BEGIN;SET LOCAL search_path=\'\';SET LOCAL check_function_bodies=false;',
  'ALTER SCHEMA private OWNER TO postgres;REVOKE ALL ON SCHEMA private FROM '+principals+';GRANT USAGE,CREATE ON SCHEMA private TO postgres;GRANT USAGE ON SCHEMA private TO service_role;',
  'DROP TABLE '+m.tables.map(t=>t.name).join(',')+' CASCADE;'];
 for(const t of m.tables)sql.push('CREATE TABLE '+t.name+' ('+t.columns.map(c=>q(c.name)+' '+c.type+(c.default?' DEFAULT '+c.default:'')+(c.notnull?' NOT NULL':'')).join(',')+');');
 for(const foreign of [false,true])for(const t of m.tables)for(const c of t.constraints??[]){
  if((c.type==='f')===foreign)sql.push('ALTER TABLE '+t.name+' ADD CONSTRAINT '+q(c.name)+' '+(originalCheck[c.name]??c.definition)+(c.validated||c.definition.includes('NOT VALID')?'':' NOT VALID')+';');
 }
 const dependencies=JSON.parse(readFileSync('supabase/upgrade-packages/financial-proof-cloud/manifest.json','utf8')).fixture_dependencies;
 const funcs=[...m.functions,...dependencies,...m.tables.flatMap(t=>(t.triggers??[]).map(g=>({signature:g.function,body_md5:g.function_md5,owner:'postgres'})))];
 const seen=new Set();
 for(const f of funcs){
  if(seen.has(f.signature))continue;seen.add(f.signature);
  const def=defs.find(d=>d.name.split('.')[1]===f.signature.split('(')[0].split('.')[1]&&d.hash===f.body_md5);
  if(!def)throw Error('SOURCE_EQUIVALENT_BODY_MISSING '+f.signature);
  sql.push(def.sql.replace(/create\s+(?:or\s+replace\s+)?function/i,'CREATE OR REPLACE FUNCTION').replace(def.name,f.signature.split('(')[0]),'ALTER FUNCTION '+f.signature+' OWNER TO '+q(f.owner)+';');
  if(f.acl){sql.push('REVOKE ALL ON FUNCTION '+f.signature+' FROM '+principals+';');
   for(const a of f.acl)sql.push('GRANT '+a.privilege+' ON FUNCTION '+f.signature+' TO '+(a.role==='PUBLIC'?'PUBLIC':q(a.role))+(a.grantable?' WITH GRANT OPTION':'')+';');
  }
 }
 for(const t of m.tables){
  for(const i of t.indexes??[])if(!i.constraint_owned)sql.push(i.definition+';');
  sql.push('ALTER TABLE '+t.name+' OWNER TO '+q(t.owner)+';','REVOKE ALL ON '+t.name+' FROM '+principals+';');
  for(const a of t.acl??[])sql.push('GRANT '+a.privilege+' ON '+t.name+' TO '+(a.role==='PUBLIC'?'PUBLIC':q(a.role))+(a.grantable?' WITH GRANT OPTION':'')+';');
  for(const a of t.column_acl??[])sql.push('GRANT '+a.privilege+' ('+q(a.column)+') ON '+t.name+' TO '+(a.role==='PUBLIC'?'PUBLIC':q(a.role))+(a.grantable?' WITH GRANT OPTION':'')+';');
  if(t.rls)sql.push('ALTER TABLE '+t.name+' ENABLE ROW LEVEL SECURITY;');
  if(t.force_rls)sql.push('ALTER TABLE '+t.name+' FORCE ROW LEVEL SECURITY;');
  for(const p of t.policies??[]){
   sql.push('CREATE POLICY '+q(p.name)+' ON '+t.name+' AS '+(p.permissive?'PERMISSIVE':'RESTRICTIVE')+' FOR '+({r:'SELECT',a:'INSERT',w:'UPDATE',d:'DELETE','*':'ALL'}[p.cmd])+' TO '+p.roles.map(r=>r==='PUBLIC'?'PUBLIC':q(r)).join(',')+(p.using?' USING ('+p.using+')':'')+(p.check?' WITH CHECK ('+p.check+')':'')+';');
  }
  for(const g of t.triggers??[]){sql.push(g.definition+';');if(g.enabled!=='O')sql.push('ALTER TABLE '+t.name+' '+({D:'DISABLE',A:'ENABLE ALWAYS',R:'ENABLE REPLICA'}[g.enabled])+' TRIGGER '+q(g.name)+';');}
 }
 sql.push('SET LOCAL check_function_bodies=true;COMMIT;');
 await db.sql(sql.join('\n'));
}
