import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
// @ts-expect-error existing isolated, network-disabled PostgreSQL fixture
import {isolatedPostgres} from '../../../scripts/account-deletion/postgres.mjs';
it.skipIf(process.env.VELORA_RATE_LIMIT_NATIVE_TEST!=='true')('atomically limits concurrent calls, isolates subjects, preserves trusted checkout replay and recovers',async()=>{
 const db=await isolatedPostgres();
 try{
  await db.sql("create schema private; create role anon;create role authenticated;create role service_role;create table private.es02_account_orders(account_id uuid,client_op_id uuid);");
  await db.sql(readFileSync('supabase/migrations/20261029004849_security_rate_limits.sql','utf8'));
  const hash='a'.repeat(64),other='b'.repeat(64);
  const call=(h=hash)=>`set role service_role;select public.security_consume_rate_limit('checkout','${h}');`;
  await db.sql("update private.security_rate_policies set mode='enforce',max_requests=2 where endpoint='checkout'");
  const results:Array<{allowed:boolean;retryAfterSeconds:number}>=await Promise.all(Array.from({length:6},()=>db.sql(call()).then((s:string)=>JSON.parse(s))));
  expect(results.filter(x=>x.allowed)).toHaveLength(2);expect(results.filter(x=>!x.allowed)).toHaveLength(4);
  expect(results.filter(x=>!x.allowed).every(x=>x.retryAfterSeconds>0)).toBe(true);
  expect(JSON.parse(await db.sql(call(other))).allowed).toBe(true);
  const account='10000000-0000-4000-8000-000000000001',operation='10000000-0000-4000-8000-000000000002';
  await db.sql(`insert into private.es02_account_orders values('${account}','${operation}')`);
  const replay=(actor=account)=>`set role service_role;select public.security_consume_rate_limit('checkout','${hash}','${actor}','${operation}');`;
  expect(JSON.parse(await db.sql(replay()))).toMatchObject({allowed:true,replayed:true});
  expect(JSON.parse(await db.sql(replay(operation)))).toMatchObject({allowed:false,replayed:false});
  await db.sql("update private.security_rate_counters set expires_at=clock_timestamp()-interval '1 second'");
  expect(JSON.parse(await db.sql(call())).allowed).toBe(true);
  await db.sql("update private.security_rate_policies set mode='monitor',max_requests=1 where endpoint='checkout'");
  expect(JSON.parse(await db.sql(call()))).toMatchObject({allowed:true,exceeded:true,mode:'monitor'});
  await expect(db.sql(`set role authenticated;select public.security_consume_rate_limit('checkout','${hash}')`)).rejects.toThrow(/permission denied/);
  await expect(db.sql('set role service_role;select * from private.security_rate_counters')).rejects.toThrow(/permission denied/);
 }finally{await db.close();}
},120000);

