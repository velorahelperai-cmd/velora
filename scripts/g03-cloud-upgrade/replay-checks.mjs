import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSchema, assertNoSecrets } from './schema-replay.mjs';

const empty = () => ({ project_ref:'vmpifljyozsbtssxhoxd',structure:{tables:[],enums:[],extensions:[]},
  routines:{functions:[],triggers:[]},security:{roles:[],memberships:[],sequences:[],policies:[],table_acl:[],column_acl:[],schema_acl:[],default_acl:[]},views:[] });
test('reject secrets before schema replay',()=>assert.throws(()=>assertNoSecrets('sk-proj-'+'a'.repeat(40)),/SECRET/));
test('reject a different cloud project',()=>assert.throws(()=>renderSchema({...empty(),project_ref:'wrong'}),/PROJECT/));
test('replay revokes PUBLIC function defaults and applies captured column grants',()=>{
  const m=empty();m.routines.functions=[{schema:'public',name:'example',identity:'',owner:'postgres',definition:'CREATE FUNCTION public.example() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;',acl:[{grantee:'authenticated',privilege:'EXECUTE',grantable:false}]}];
  m.structure.tables=[{schema:'public',name:'example',owner:'postgres',rls:true,force_rls:false,columns:[{name:'body',type:'text',not_null:true,default:"''::text"}],constraints:[],indexes:[]}];
  m.security.column_acl=[{schema:'public',table:'example',column:'body',grantee:'authenticated',privilege:'UPDATE',grantable:false}];
  const sql=renderSchema(m);assert.match(sql,/REVOKE ALL ON FUNCTION/);assert.match(sql,/UPDATE \("body"\)/);assert.match(sql,/ENABLE ROW LEVEL SECURITY/);assert.doesNotMatch(sql,/INSERT INTO/);
});
