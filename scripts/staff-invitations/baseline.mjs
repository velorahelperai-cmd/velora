import assert from "node:assert/strict";
import { bootstrap, cleanup, sql, lit } from "./postgres.mjs";

const owner = "f1000000-0000-4000-8000-000000000001";
const company = "f2000000-0000-4000-8000-000000000001";
const claims = JSON.stringify({ sub: owner, session_id: "f3000000-0000-4000-8000-000000000001", role: "authenticated" });
try {
  await bootstrap();
  await sql(`insert into auth.users values('${owner}','owner@fixture.invalid',clock_timestamp());
    insert into auth.sessions(id,user_id) values('f3000000-0000-4000-8000-000000000001','${owner}');
    insert into public.companies values('${company}','Synthetic fixture','active');
    insert into public.company_members(company_id,user_id,role,status,member_name) values('${company}','${owner}','owner','active','Owner');`);
  for (const hash of ["a".repeat(64), "b".repeat(64)]) {
    const result = JSON.parse(await sql(`set request.jwt.claims=${lit(claims)};set role authenticated;
      select public.create_staff_invitation('${company}','member@fixture.invalid','Staff fixture','${hash}');`));
    assert.equal(result.ok, true);
  }
  assert.equal(await sql(`select count(*) from private.staff_invitations where company_id='${company}' and email='member@fixture.invalid' and accepted_at is null and expires_at>clock_timestamp()`), "2");
  for (const hash of ["a".repeat(64), "b".repeat(64)]) {
    assert.equal(JSON.parse(await sql(`set role anon;select public.read_staff_invitation('${hash}')`)).ok, true);
  }
  console.log("BASELINE DEFECT REPRODUCED on native PostgreSQL: two create calls persisted two simultaneously valid pending links for one company/recipient.");
} finally { await cleanup(); }
