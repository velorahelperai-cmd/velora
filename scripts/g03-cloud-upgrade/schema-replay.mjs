// Offline metadata replay ONLY, consumed by the guarded network-none G03 harness.
// Never saves the rendered schema, reads application rows or accepts a DB URL.
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const q = s => `"${String(s).replaceAll('"','""')}"`;
const name = (s,n) => `${q(s)}.${q(n)}`;
const literal = s => `'${String(s).replaceAll("'","''")}'`;
const role = s => s === 'PUBLIC' ? 'PUBLIC' : q(s);
export function assertNoSecrets(text) {
  if (/sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|AIza[A-Za-z0-9_-]{30,}|AQ\.[A-Za-z0-9_-]{35,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(text)
    || /(?:api_key|access_token|client_secret|service_role_key)\s*(?::=|=)\s*'[A-Za-z0-9_.-]{24,}'/i.test(text)) throw Error('SCHEMA_SECRET_DETECTED');
}
export function loadMetadata(path) {
  const actual=realpathSync(path), root=realpathSync(resolve('.'));
  const rel=relative(root,actual);
  if (!isAbsolute(rel) && !rel.startsWith('..')) throw Error('PRIVATE_METADATA_MUST_BE_OUTSIDE_REPOSITORY');
  const raw=readFileSync(actual,'utf8');assertNoSecrets(raw);
  const manifest=JSON.parse(readFileSync(resolve(dirname(actual),'manifest.json'),'utf8'));
  if (manifest.project_ref!=='vmpifljyozsbtssxhoxd' || manifest.customer_rows!==0 || manifest.secrets_scan_findings!==0
    || manifest.sha256!==createHash('sha256').update(raw).digest('hex')) throw Error('METADATA_INTEGRITY_FAILED');
  return JSON.parse(raw);
}
export function renderSchema(m) {
  if(m.project_ref!=='vmpifljyozsbtssxhoxd')throw Error('WRONG_PROJECT');
  assertNoSecrets(JSON.stringify(m));
  const {structure:t,routines:r,security:s}=m;
  if(m.views.length)throw Error('UNSUPPORTED_BASELINE_VIEWS');
  const sql=['-- PRIVATE local clone; no rows. DO NOT SAVE/COMMIT this SQL.', 'BEGIN;', 'SET check_function_bodies=false;'];
  for(const x of s.roles)sql.push(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${literal(x.name)}) THEN CREATE ROLE ${q(x.name)} ${x.inherit?'INHERIT':'NOINHERIT'} ${x.bypass_rls?'BYPASSRLS':'NOBYPASSRLS'}; END IF; END $$;`);
  for(const x of s.memberships)sql.push(`GRANT ${q(x.role)} TO ${q(x.member)}${x.admin?' WITH ADMIN OPTION':''};`);
  for(const schema of ['auth','storage','private','extensions','public'])sql.push(`CREATE SCHEMA IF NOT EXISTS ${q(schema)};`);
  for(const [schema,owner] of new Map(s.schema_acl.map(a=>[a.schema,a.owner])))sql.push(`ALTER SCHEMA ${q(schema)} OWNER TO ${q(owner)};`);
  for(const x of t.extensions)sql.push(`CREATE EXTENSION IF NOT EXISTS ${q(x.name)} WITH SCHEMA ${q(x.schema)};`);
  for(const x of t.enums)sql.push(`CREATE TYPE ${name(x.schema,x.name)} AS ENUM (${x.values.map(literal).join(',')});`);
  for(const x of s.sequences)sql.push(`CREATE SEQUENCE ${name(x.schema,x.name)} AS ${x.type} START ${x.start} MINVALUE ${x.minimum} ${x.type==='bigint' && !Number.isSafeInteger(x.maximum)?'NO MAXVALUE':`MAXVALUE ${x.maximum}`} INCREMENT ${x.increment} ${x.cycle?'CYCLE':'NO CYCLE'};`);
  for(const x of t.tables) {
    const cols=x.columns.map(c=>{
      if(c.generated && c.generated!=='s')throw Error('UNSUPPORTED_GENERATED_COLUMN');
      return `${q(c.name)} ${c.type}${c.generated?` GENERATED ALWAYS AS (${c.default}) STORED`:''}${c.identity?` GENERATED ${c.identity==='a'?'ALWAYS':'BY DEFAULT'} AS IDENTITY`:''}${c.not_null?' NOT NULL':''}`;
    });
    sql.push(`CREATE TABLE ${name(x.schema,x.name)} (${cols.join(',')});`);
  }
  for(const foreign of [false,true])for(const x of t.tables)for(const c of x.constraints??[])
    if((c.type==='f')===foreign)sql.push(`ALTER TABLE ${name(x.schema,x.name)} ADD CONSTRAINT ${q(c.name)} ${c.definition};`);
  for(const x of r.functions)sql.push(`${x.definition};`);
  for(const x of t.tables) {
    for(const c of x.columns)if(c.default && !c.identity && !c.generated)sql.push(`ALTER TABLE ${name(x.schema,x.name)} ALTER COLUMN ${q(c.name)} SET DEFAULT ${c.default};`);
    for(const index of x.indexes??[])sql.push(`${index};`);
    if(x.rls)sql.push(`ALTER TABLE ${name(x.schema,x.name)} ENABLE ROW LEVEL SECURITY;`);
    if(x.force_rls)sql.push(`ALTER TABLE ${name(x.schema,x.name)} FORCE ROW LEVEL SECURITY;`);
    sql.push(`ALTER TABLE ${name(x.schema,x.name)} OWNER TO ${q(x.owner)};`);
  }
  for(const x of r.triggers) {
    sql.push(`${x.definition};`);
    if(x.enabled!=='O')sql.push(`ALTER TABLE ${name(x.schema,x.table)} ${x.enabled==='D'?'DISABLE':x.enabled==='A'?'ENABLE ALWAYS':'ENABLE REPLICA'} TRIGGER ${q(x.name)};`);
  }
  for(const x of s.policies)sql.push(`CREATE POLICY ${q(x.name)} ON ${name(x.schema,x.table)} AS ${x.permissive===true || x.permissive==='PERMISSIVE'?'PERMISSIVE':'RESTRICTIVE'} FOR ${x.cmd} TO ${x.roles.map(role).join(',')}${x.qual?` USING (${x.qual})`:''}${x.with_check?` WITH CHECK (${x.with_check})`:''};`);
  const principals=['PUBLIC',...s.roles.map(x=>x.name)].map(role).join(',');
  for(const x of t.tables)sql.push(`REVOKE ALL ON TABLE ${name(x.schema,x.name)} FROM ${principals};`);
  for(const x of r.functions) {
    const sig=`${name(x.schema,x.name)}(${x.identity})`;
    sql.push(`ALTER FUNCTION ${sig} OWNER TO ${q(x.owner)};`, `REVOKE ALL ON FUNCTION ${sig} FROM ${principals};`);
    for(const a of x.acl)sql.push(`GRANT ${a.privilege} ON FUNCTION ${sig} TO ${role(a.grantee)}${a.grantable?' WITH GRANT OPTION':''};`);
  }
  for(const x of s.table_acl.filter(a=>t.tables.some(t=>t.schema===a.schema&&t.name===a.table)))sql.push(`GRANT ${x.privilege} ON TABLE ${name(x.schema,x.table)} TO ${role(x.grantee)}${x.grantable?' WITH GRANT OPTION':''};`);
  for(const x of s.column_acl.filter(a=>t.tables.some(t=>t.schema===a.schema&&t.name===a.table)))sql.push(`GRANT ${x.privilege} (${q(x.column)}) ON TABLE ${name(x.schema,x.table)} TO ${role(x.grantee)}${x.grantable?' WITH GRANT OPTION':''};`);
  for(const schema of ['auth','storage','private','extensions','public'])sql.push(`REVOKE ALL ON SCHEMA ${q(schema)} FROM ${principals};`);
  for(const x of s.schema_acl)sql.push(`GRANT ${x.privilege} ON SCHEMA ${q(x.schema)} TO ${role(x.grantee)}${x.grantable?' WITH GRANT OPTION':''};`);
  const cleared=new Set();
  for(const x of s.default_acl) {
    const kind={r:'TABLES',S:'SEQUENCES',f:'FUNCTIONS',T:'TYPES',n:'SCHEMAS'}[x.type];if(!kind)throw Error('UNSUPPORTED_DEFAULT_ACL');
    // Remove default PUBLIC execute before reproducing actual captured defaults.
    const key=JSON.stringify([x.owner,x.schema]);
    if(x.type==='f' && !cleared.has(key)){sql.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${q(x.owner)}${x.schema?` IN SCHEMA ${q(x.schema)}`:''} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`);cleared.add(key);}
    sql.push(`ALTER DEFAULT PRIVILEGES FOR ROLE ${q(x.owner)}${x.schema?` IN SCHEMA ${q(x.schema)}`:''} GRANT ${x.privilege} ON ${kind} TO ${role(x.grantee)}${x.grantable?' WITH GRANT OPTION':''};`);
  }
  sql.push('SET check_function_bodies=true;','COMMIT;');return sql.join('\n');
}
